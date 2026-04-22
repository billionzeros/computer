/**
 * HarnessSession — spawns a CLI subprocess (e.g. `claude`) and bridges
 * its stream-json output into Anton's SessionEvent system.
 *
 * Exposes the same `processMessage()` async generator interface as Session
 * so server.ts can consume both identically.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createLogger } from '@anton/logger'
import type { ChatImageAttachmentInput } from '@anton/protocol'
import type { SessionEvent } from '../session.js'
import type { HarnessAdapter } from './adapter.js'
import type { McpSpawnConfig } from './mcp-spawn-config.js'

/**
 * MCP bridge config for HarnessSession. Mirrors CodexHarnessMcpOpts; we
 * keep the types separate so the two paths can diverge later (e.g. HTTP
 * MCP for Codex only) without coupling.
 */
export interface HarnessMcpOpts {
  socketPath: string
  authToken: string
  spawn: McpSpawnConfig
}

const log = createLogger('harness-session')

export interface HarnessSessionOpts {
  id: string
  provider: string
  model: string
  adapter: HarnessAdapter
  /**
   * MCP bridge configuration. Constructed once by the server from
   * `buildMcpSpawnConfig()` and wrapped with the per-session auth token +
   * socket path. Replaces the old flat `socketPath` / `shimPath` /
   * `authToken` fields.
   */
  mcp: HarnessMcpOpts
  cwd?: string
  /**
   * Static system prompt. Kept for back-compat / test paths that don't
   * need per-turn context. Ignored if `buildSystemPrompt` is provided.
   */
  systemPrompt?: string
  /**
   * Per-turn system prompt builder. Called at the start of every
   * processMessage() with the current user message and turn index so the
   * caller can load fresh memories / workflows / surface for this turn.
   *
   * When set, `systemPrompt` is ignored.
   */
  buildSystemPrompt?: (userMessage: string, turnIndex: number) => Promise<string>
  /**
   * Called once per turn after the CLI exits, before the terminal `done`
   * event is yielded. Gives the caller the user message and the ordered
   * list of SessionEvents the turn produced — intended for the
   * conversation mirror (messages.jsonl append, project-context
   * capture, etc.). Errors from the callback are logged and swallowed
   * so they never break the stream.
   */
  onTurnEnd?: (turn: {
    userMessage: string
    events: SessionEvent[]
  }) => void | Promise<void>
  maxBudgetUsd?: number
}

export class HarnessSession {
  readonly id: string
  readonly provider: string
  model: string
  readonly createdAt: number

  private adapter: HarnessAdapter
  private mcp: HarnessMcpOpts
  private cwd?: string
  private systemPrompt?: string
  private buildSystemPromptFn?: (userMessage: string, turnIndex: number) => Promise<string>
  private onTurnEnd?: (turn: {
    userMessage: string
    events: SessionEvent[]
  }) => void | Promise<void>
  private turnIndex = 0
  private maxBudgetUsd?: number
  private proc: ChildProcess | null = null
  private title = ''
  private lastActiveAt: number
  /**
   * Late-bound pusher into the active per-turn event queue. Set inside
   * `processMessage`, cleared when the turn ends. Out-of-band events
   * (browser screenshots from MCP tool execution) call this so they
   * land in the same generator stream the adapter's CLI events do.
   */
  private pushEvent: ((event: SessionEvent) => void) | null = null

  /** Claude Code's internal session ID, used for --resume */
  private cliSessionId: string | null = null

  /** Sentinel — set to true so server.ts can distinguish from Session */
  readonly isHarness = true as const

  constructor(opts: HarnessSessionOpts) {
    this.id = opts.id
    this.provider = opts.provider
    this.model = opts.model
    this.adapter = opts.adapter
    this.mcp = opts.mcp
    this.cwd = opts.cwd
    this.systemPrompt = opts.systemPrompt
    this.buildSystemPromptFn = opts.buildSystemPrompt
    this.onTurnEnd = opts.onTurnEnd
    this.maxBudgetUsd = opts.maxBudgetUsd
    this.createdAt = Date.now()
    this.lastActiveAt = Date.now()
  }

  getTitle(): string {
    return this.title
  }

  /**
   * Set the conversation title and push a `title_update` through the
   * event queue. Called by the `set_session_title` MCP tool on the
   * model's first turn — the canonical title path. No-op if the value
   * is empty or already the current title.
   *
   * Uses `pushEvent` (the same late-bound queue out-of-band MCP events
   * use) so the update flows through the active turn's generator.
   */
  setTitle(title: string): void {
    const next = title.trim().split('\n')[0].slice(0, 60)
    if (!next || next === this.title) return
    this.title = next
    this.pushEvent?.({ type: 'title_update', title: this.title })
  }

  getLastActiveAt(): number {
    return this.lastActiveAt
  }

  /**
   * Switch the model for subsequent turns. Provider is fixed at spawn
   * (the adapter + CLI binary are bound to it), so cross-provider switches
   * throw and the caller should spin a new session instead. The next turn
   * picks up the new model at spawn time via `buildSpawnArgs({ model })`.
   */
  switchModel(provider: string, model: string): void {
    if (provider !== this.provider) {
      throw new Error(
        `HarnessSession cannot switch provider mid-session (have=${this.provider}, requested=${provider})`,
      )
    }
    this.model = model
  }

  /**
   * Process a user message by spawning the CLI and streaming back events.
   * Same async generator interface as Session.processMessage().
   */
  async *processMessage(
    userMessage: string,
    _attachments: ChatImageAttachmentInput[] = [],
  ): AsyncGenerator<SessionEvent> {
    this.lastActiveAt = Date.now()

    // Generate temp MCP config pointing to anton-mcp-shim
    const mcpConfigPath = this.writeMcpConfig()

    // Assemble the per-turn system prompt. A builder takes precedence; a
    // static prompt is kept as a fallback for tests / callers that don't
    // want per-turn context.
    let systemPromptForTurn: string | undefined
    if (this.buildSystemPromptFn) {
      try {
        systemPromptForTurn = await this.buildSystemPromptFn(userMessage, this.turnIndex)
      } catch (err) {
        log.warn(
          { err, sessionId: this.id },
          'buildSystemPrompt threw — falling back to static systemPrompt',
        )
        systemPromptForTurn = this.systemPrompt
      }
    } else {
      systemPromptForTurn = this.systemPrompt
    }
    // First-turn title: truncated user question. Mirrors the Codex harness
    // and Pi SDK seed — gives the UI a stable title up front instead of
    // latching onto the first streaming text chunk (which produced titles
    // like "I" from "I'm checking …").
    if (this.turnIndex === 0 && !this.title) {
      const seed = userMessage.trim().slice(0, 60).split('\n')[0]
      if (seed.length > 0) {
        this.title = seed
        yield { type: 'title_update', title: this.title }
      }
    }

    this.turnIndex += 1

    try {
      const args = this.adapter.buildSpawnArgs({
        message: userMessage,
        mcpConfigPath,
        model: this.model,
        resumeSessionId: this.cliSessionId ?? undefined,
        systemPrompt: systemPromptForTurn,
        maxBudgetUsd: this.maxBudgetUsd,
        cwd: this.cwd,
        shimPath: this.mcp.spawn.shimPath,
        socketPath: this.mcp.socketPath,
        sessionId: this.id,
        authToken: this.mcp.authToken,
      })

      const env = {
        ...process.env,
        ...this.adapter.buildEnv({
          socketPath: this.mcp.socketPath,
          sessionId: this.id,
          authToken: this.mcp.authToken,
        }),
      }

      log.info(
        { sessionId: this.id, command: this.adapter.command, args: args.slice(0, 6) },
        'Spawning harness CLI',
      )

      this.proc = spawn(this.adapter.command, args, {
        cwd: this.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      })

      const proc = this.proc

      // Close stdin immediately — the message is passed as a CLI arg,
      // and an open pipe makes Codex wait for "additional input from stdin"
      proc.stdin?.end()

      // Collect stderr for error reporting
      let stderrChunks = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks += chunk.toString()
      })

      // Read stdout line-by-line (NDJSON)
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Number.POSITIVE_INFINITY })

      // Use an async queue pattern to bridge readline events to the generator
      const eventQueue: SessionEvent[] = []
      let resolveWait: (() => void) | null = null
      let done = false

      // Wire the late-bound pusher so out-of-band events (browser
      // callbacks from MCP tool execution) can land in the same queue
      // and surface through the generator.
      this.pushEvent = (event) => {
        eventQueue.push(event)
        if (resolveWait) {
          resolveWait()
          resolveWait = null
        }
      }

      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return

        // Log every raw line the CLI emits so we can discover item
        // types the adapter doesn't model yet (e.g. Codex reasoning,
        // first-party connector calls). Cheap — one line per JSON
        // event, already inside an event handler that runs anyway.
        log.info({ sessionId: this.id, raw: trimmed }, 'harness raw stdout')

        // Safely parse JSON — non-JSON lines (loading messages, etc.) are logged and skipped
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          log.warn(
            { sessionId: this.id, line: trimmed.slice(0, 200) },
            'Non-JSON line from CLI, skipping',
          )
          return
        }

        // Capture CLI session ID for --resume
        const sid = this.adapter.extractSessionId(parsed)
        if (sid) this.cliSessionId = sid

        const events = this.adapter.parseEvent(line)
        eventQueue.push(...events)

        if (resolveWait) {
          resolveWait()
          resolveWait = null
        }
      })

      // Startup timeout: if no JSON events arrive within 30s, surface stderr and abort
      let receivedFirstEvent = false
      const startupTimeout = setTimeout(() => {
        if (!receivedFirstEvent && !done) {
          const errMsg =
            stderrChunks.trim() ||
            'CLI did not produce any output within 30 seconds. Check that the provider is logged in and configured correctly.'
          log.error(
            { sessionId: this.id, stderr: stderrChunks.slice(0, 500) },
            'Harness CLI startup timeout',
          )
          eventQueue.push({
            type: 'error',
            message: errMsg,
            code: classifyStartupError(stderrChunks),
          })
          done = true
          // Kill the hung process
          if (!proc.killed) proc.kill('SIGTERM')
          if (resolveWait) {
            resolveWait()
            resolveWait = null
          }
        }
      }, 30_000)

      const exitPromise = new Promise<number | null>((resolve) => {
        proc.on('close', (code) => {
          clearTimeout(startupTimeout)
          done = true
          if (resolveWait) {
            resolveWait()
            resolveWait = null
          }
          resolve(code)
        })

        proc.on('error', (err) => {
          clearTimeout(startupTimeout)
          const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
          eventQueue.push({
            type: 'error',
            message: isEnoent
              ? `CLI not installed: ${this.adapter.command} was not found on PATH`
              : `CLI process error: ${err.message}`,
            code: isEnoent ? 'not_installed' : 'runtime',
          })
          done = true
          if (resolveWait) {
            resolveWait()
            resolveWait = null
          }
          resolve(null)
        })
      })

      // Accumulate every yielded event for the onTurnEnd callback
      // (conversation mirror / project-context capture). Terminal
      // `done` is excluded — it's a stream marker, not content.
      const turnEvents: SessionEvent[] = []

      // Yield events as they arrive
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          receivedFirstEvent = true
          const ev = eventQueue.shift()!
          turnEvents.push(ev)
          yield ev
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve
          })
        }
      }

      // Wait for process to fully exit
      const exitCode = await exitPromise

      if (exitCode !== 0 && exitCode !== null) {
        const errMsg = stderrChunks.trim() || `CLI exited with code ${exitCode}`
        const errorEvent: SessionEvent = {
          type: 'error',
          message: errMsg,
          code: classifyStartupError(stderrChunks),
        }
        turnEvents.push(errorEvent)
        yield errorEvent
      }

      // Mirror hook: fire before the terminal `done` so consumers see
      // the persisted turn before the stream closes.
      if (this.onTurnEnd) {
        try {
          await this.onTurnEnd({ userMessage, events: turnEvents })
        } catch (err) {
          log.warn({ err, sessionId: this.id }, 'onTurnEnd callback threw — turn still completes')
        }
      }

      // Ensure a done event is always emitted
      yield { type: 'done' }
    } finally {
      // Clean up temp MCP config
      this.cleanupFile(mcpConfigPath)
      this.proc = null
      this.pushEvent = null
    }
  }

  /**
   * Push a `browser_state` event into the live turn stream. Called by
   * the harness MCP browser tool when the user-visible browser changes
   * (navigation, click, screenshot, etc.). No-op outside of an active
   * turn so out-of-turn callbacks don't leak.
   */
  emitBrowserState(state: {
    url: string
    title: string
    screenshot?: string
    lastAction: import('@anton/protocol').BrowserAction
    elementCount?: number
  }) {
    this.pushEvent?.({ type: 'browser_state', ...state })
  }

  /** Push a `browser_close` event. See `emitBrowserState`. */
  emitBrowserClose() {
    this.pushEvent?.({ type: 'browser_close' })
  }

  /** Send SIGINT to the CLI process (Claude Code handles it gracefully) */
  cancel() {
    if (this.proc && !this.proc.killed) {
      log.info({ sessionId: this.id }, 'Cancelling harness CLI (SIGINT)')
      this.proc.kill('SIGINT')
    }
  }

  /** Graceful shutdown: end stdin → SIGTERM → SIGKILL */
  async shutdown() {
    if (!this.proc || this.proc.killed) return

    log.info({ sessionId: this.id }, 'Shutting down harness CLI')

    // Close stdin to signal no more input
    this.proc.stdin?.end()

    // Wait 2s, then SIGTERM
    await this.delay(2000)
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM')
    }

    // Wait 5s more, then SIGKILL
    await this.delay(5000)
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGKILL')
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private writeMcpConfig(): string {
    const configDir = join(tmpdir(), 'anton-harness')
    mkdirSync(configDir, { recursive: true })

    const configPath = join(configDir, `mcp-${this.id}-${randomUUID().slice(0, 8)}.json`)
    const config = {
      mcpServers: {
        anton: {
          command: this.mcp.spawn.command,
          args: this.mcp.spawn.args,
          env: {
            ANTON_SOCK: this.mcp.socketPath,
            ANTON_SESSION: this.id,
            ANTON_AUTH: this.mcp.authToken,
          },
        },
      },
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2))
    return configPath
  }

  private cleanupFile(path: string) {
    try {
      unlinkSync(path)
    } catch {
      // Ignore — file may already be deleted
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Type guard to distinguish a harness-backed session (Claude Code or
 * Codex app-server) from a Pi SDK Session. Both concrete classes carry
 * `readonly isHarness = true as const` so we detect either via sentinel.
 *
 * The refined type is the union of both implementations so the compiler
 * knows which methods are safe to call above the guard.
 */
export function isHarnessSession(
  s: unknown,
): s is HarnessSession | import('./codex-harness-session.js').CodexHarnessSession {
  return (
    s instanceof HarnessSession || (s != null && (s as { isHarness?: boolean }).isHarness === true)
  )
}

/**
 * Best-effort heuristic to classify a stderr/exit failure into an error code
 * the UI can render distinctly. Matches on common CLI phrases; falls back to
 * 'startup_timeout' since that's the only reason we inspect stderr today.
 */
function classifyStartupError(stderr: string): 'not_authed' | 'startup_timeout' | 'runtime' {
  const s = stderr.toLowerCase()
  if (
    s.includes('not logged in') ||
    s.includes('unauthorized') ||
    s.includes(' 401') ||
    s.includes('please log in') ||
    s.includes('authentication failed') ||
    s.includes('invalid credentials')
  ) {
    return 'not_authed'
  }
  return 'startup_timeout'
}
