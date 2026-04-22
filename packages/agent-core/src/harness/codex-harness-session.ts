/**
 * CodexHarnessSession — wraps a persistent `codex app-server` subprocess
 * and bridges its JSON-RPC notifications into Anton's SessionEvent stream.
 *
 * Public interface mirrors HarnessSession (Claude Code) so server.ts can
 * hold either behind a single union type. Differences are invisible above
 * the session boundary:
 *   - one subprocess per session (persistent across turns, not per-turn)
 *   - real text / reasoning deltas
 *   - real steering via `turn/interrupt` + `turn/steer`
 *   - native sub-agents via `collabAgentToolCall` items
 *
 * Speaks the v2 `thread/*` + `turn/*` + `item/*` protocol introduced in
 * codex 0.107 and required by 0.120+ (which dropped the legacy
 * `newConversation` / `sendUserTurn` surface).
 *
 * See specs/features/HARNESS_APP_SERVER_MIGRATION.md for the full mapping.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { createLogger } from '@anton/logger'
import type { ChatImageAttachmentInput, ThinkingLevel } from '@anton/protocol'
import { ANTON_MCP_NAMESPACE } from '../prompt-layers.js'
import type { SessionEvent } from '../session.js'
import type { ReasoningEffort } from './codex-proto/ReasoningEffort.js'
import { CodexRpcClient, CodexRpcError } from './codex-rpc.js'
import { PINNED_CLI_VERSION, detectCodexCli } from './codex-version.js'
import type { McpSpawnConfig } from './mcp-spawn-config.js'

/**
 * Map Anton's UI-facing ThinkingLevel onto the Codex protocol's
 * ReasoningEffort enum. Names line up except for 'off', which Codex
 * spells 'none'. Both enums include 'minimal' and 'xhigh'.
 */
function thinkingLevelToCodexEffort(level: ThinkingLevel): ReasoningEffort {
  return level === 'off' ? 'none' : level
}

const log = createLogger('codex-harness-session')

/**
 * Codex's built-in execution sandbox (bubblewrap on Linux). Anton runs
 * inside an already-isolated VM, so the bwrap layer is redundant — and
 * on container runtimes that don't grant unprivileged user namespaces it
 * outright breaks, failing every shell call with `bwrap: setting up uid
 * map: Permission denied`. Default is `danger-full-access` to sidestep
 * bwrap entirely; tighter modes are opt-in for environments where Anton
 * runs outside a trusted container.
 *
 *   ANTON_CODEX_SANDBOX=danger-full-access  → default; no bwrap
 *   ANTON_CODEX_SANDBOX=workspace-write     → bwrap confines writes to cwd + TMPDIR
 *   ANTON_CODEX_SANDBOX=read-only           → read-only
 */
type AntonSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

const DEFAULT_SANDBOX_MODE: AntonSandboxMode = 'danger-full-access'

function resolveSandboxMode(): AntonSandboxMode {
  const raw = process.env.ANTON_CODEX_SANDBOX?.trim()
  if (!raw) return DEFAULT_SANDBOX_MODE
  if (raw === 'read-only' || raw === 'workspace-write' || raw === 'danger-full-access') {
    return raw
  }
  log.warn(
    { value: raw, fallback: DEFAULT_SANDBOX_MODE },
    'ANTON_CODEX_SANDBOX: invalid value — ignoring',
  )
  return DEFAULT_SANDBOX_MODE
}

/**
 * Map the kebab-case SandboxMode (thread/start) onto the camelCase
 * SandboxPolicy discriminated union that `turn/start.sandboxPolicy`
 * expects. The two fields use different shapes in the v2 proto.
 */
function buildTurnSandboxPolicy(mode: AntonSandboxMode): Record<string, unknown> {
  switch (mode) {
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
    case 'read-only':
      return { type: 'readOnly', access: { type: 'fullAccess' } }
    case 'workspace-write':
      return {
        type: 'workspaceWrite',
        writableRoots: [],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      }
  }
}

/**
 * MCP bridge config passed into CodexHarnessSession. The `spawn` block is
 * produced by `buildMcpSpawnConfig()` from agent-core (package-owned
 * shim path + `process.execPath` — see `mcp-spawn-config.ts`). We keep
 * this as an opaque bag so future transports (e.g. HTTP MCP) don't force
 * a new breaking param.
 */
export interface CodexHarnessMcpOpts {
  /** Unix socket path for MCP IPC. */
  socketPath: string
  /** Per-session auth token presented by the shim to Anton's IPC server. */
  authToken: string
  /** How to launch the shim subprocess — single source of truth. */
  spawn: McpSpawnConfig
}

export interface CodexHarnessSessionOpts {
  id: string
  provider: string
  model: string
  /**
   * MCP bridge configuration. Constructed by the server once from
   * `buildMcpSpawnConfig()` and wrapped with the per-session auth token +
   * socket path. Replaces the old flat `socketPath` / `shimPath` /
   * `authToken` triple.
   */
  mcp: CodexHarnessMcpOpts
  /** Project workspace. Passed as `cwd` to codex and `thread/start.cwd`. */
  cwd?: string
  /** Static system prompt fallback (used if no builder provided). */
  systemPrompt?: string
  /** Per-turn system-prompt builder — same contract as HarnessSession. */
  buildSystemPrompt?: (userMessage: string, turnIndex: number) => Promise<string>
  /**
   * Capability block appended ONCE to `developerInstructions` at
   * thread-start — ground truth for which connectors are live in THIS
   * session. Built by the server from live connector state (see
   * `buildHarnessCapabilityBlock`). `developerInstructions` is immutable
   * for the life of a codex thread, so baking it in here is both
   * sufficient and cheap; no per-turn re-injection.
   *
   * Empty string = no connectors live (still safe to pass — appended
   * as-is and produces no extra text).
   */
  capabilityBlock?: string
  /**
   * Stable ids of the connectors reflected in `capabilityBlock`, purely
   * for telemetry: logged after `thread/start` succeeds so we know which
   * services the model was told it has. Not otherwise used.
   */
  capabilityConnectorIds?: string[]
  /** Hook invoked after each turn with {userMessage, events}. */
  onTurnEnd?: (turn: { userMessage: string; events: SessionEvent[] }) => void | Promise<void>
  maxBudgetUsd?: number
  /**
   * Initial reasoning effort applied to every `turn/start`. Can be changed
   * mid-session via `setThinkingLevel()`; takes effect on the next turn.
   * Codex's protocol treats `effort` as "override for this and subsequent
   * turns," so we re-send it on every call anyway.
   */
  thinkingLevel?: ThinkingLevel
}

interface TurnQueue {
  events: SessionEvent[]
  resolve: (() => void) | null
  done: boolean
  error: Error | null
}

export class CodexHarnessSession {
  readonly id: string
  readonly provider: string
  model: string
  readonly createdAt: number
  readonly isHarness = true as const

  private readonly opts: CodexHarnessSessionOpts
  private proc: ChildProcess | null = null
  private rpc: CodexRpcClient | null = null
  private threadId: string | null = null
  private started = false
  private startPromise: Promise<void> | null = null
  private turnIndex = 0
  private title = ''
  private lastActiveAt: number
  private currentTurn: TurnQueue | null = null
  private currentTurnId: string | null = null
  private currentTurnUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
  } | null = null

  // Per-item tracking across the current turn.
  private openToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>()

  /**
   * Map AgentMessage item.id → its phase from `item/started`. Used to
   * tag each subsequent `item/agentMessage/delta` event with the phase
   * (commentary vs final_answer) so the UI can render them distinctly.
   */
  private messagePhases = new Map<string, 'commentary' | 'final_answer'>()

  /**
   * The last system prompt we baked into `thread/start.developerInstructions`.
   * developerInstructions is immutable for the life of the thread, so if
   * `buildSystemPrompt` produces a meaningfully different prompt on a later
   * turn we inject the delta as a user-visible context block.
   */
  private lastSystemPrompt: string | undefined

  /**
   * Hash of the last plan payload we forwarded as `tasks_update`. Codex
   * emits the same plan via both `turn/plan/updated` and `item/plan/delta`;
   * dedup prevents double-renders in the UI.
   */
  private lastPlanHash = ''

  /**
   * Hash of the last token usage snapshot we forwarded as `token_update`.
   * `thread/tokenUsage/updated` can fire repeatedly with the same totals
   * during a turn — dedup keeps the UI quiet.
   */
  private lastTokenUsageHash = ''

  /**
   * Race-window buffer for steer/cancel that arrive between when we
   * fire `turn/start` and when `turn/started` (or the request response)
   * lands `currentTurnId`. Drained in `onTurnStarted` once the id is
   * known. Cancel beats steer — cancel makes the buffered steer moot.
   */
  private pendingCancel = false
  private pendingSteer: { text: string; attachments: ChatImageAttachmentInput[] } | null = null

  /**
   * Sandbox mode resolved once at construction from `ANTON_CODEX_SANDBOX`.
   * Applied identically to `thread/start.sandbox` (kebab), `config.sandbox_mode`
   * (kebab), and every `turn/start.sandboxPolicy` (camelCase shape).
   */
  private readonly sandboxMode: AntonSandboxMode

  /** Wall-clock start of the current turn. Set in `onTurnStarted`, read in `onTurnCompleted`. */
  private currentTurnStartedAt: number | null = null
  /** Wall-clock start of each open item, for durationMs in `onItemCompleted`. */
  private readonly openItemStartedAt = new Map<string, number>()

  /**
   * Reasoning effort for subsequent `turn/start` calls. Mutable — the
   * composer's Effort pill forwards changes here via
   * `Session.setThinkingLevel()` and they take effect on the next turn.
   */
  private effort: ReasoningEffort

  constructor(opts: CodexHarnessSessionOpts) {
    this.opts = opts
    this.id = opts.id
    this.provider = opts.provider
    this.model = opts.model
    this.createdAt = Date.now()
    this.lastActiveAt = Date.now()
    this.sandboxMode = resolveSandboxMode()
    this.effort = thinkingLevelToCodexEffort(opts.thinkingLevel ?? 'medium')
  }

  /** Apply a new reasoning effort level to subsequent turns. */
  setThinkingLevel(level: ThinkingLevel): void {
    this.effort = thinkingLevelToCodexEffort(level)
  }

  getTitle(): string {
    return this.title
  }

  /**
   * Set the conversation title and emit a `title_update` SessionEvent.
   * Called by the `set_session_title` MCP tool on the model's first turn
   * — the canonical title path for harness sessions. No-op if the
   * incoming value is empty or already the current title.
   */
  setTitle(title: string): void {
    const next = title.trim().split('\n')[0].slice(0, 60)
    if (!next || next === this.title) return
    this.title = next
    this.emit({ type: 'title_update', title: this.title })
  }

  getLastActiveAt(): number {
    return this.lastActiveAt
  }

  /**
   * Swap the model used for subsequent turns. The codex app-server
   * subprocess is bound to the provider (its CLI binary / auth), but
   * `turn/start.model` is a per-turn override — so mutating `this.model`
   * makes the next `buildTurnStartParams` pick up the new model without
   * respawning. Cross-provider switches throw; the caller should create a
   * fresh session instead.
   */
  switchModel(provider: string, model: string): void {
    if (provider !== this.provider) {
      throw new Error(
        `CodexHarnessSession cannot switch provider mid-session (have=${this.provider}, requested=${provider})`,
      )
    }
    this.model = model
  }

  async *processMessage(
    userMessage: string,
    attachments: ChatImageAttachmentInput[] = [],
  ): AsyncGenerator<SessionEvent> {
    this.lastActiveAt = Date.now()

    // Guard against concurrent turns on the same session. The server
    // already serializes via `activeTurns`, but a direct caller must not
    // silently tangle two turns on one queue.
    if (this.currentTurn) {
      log.warn(
        { sessionId: this.id },
        'processMessage called while a turn is already active — rejecting',
      )
      yield { type: 'error', message: 'session busy: a turn is already in flight', code: 'runtime' }
      yield { type: 'done' }
      return
    }

    // Per-turn system prompt — assembled before we send.
    let systemPromptForTurn: string | undefined
    if (this.opts.buildSystemPrompt) {
      try {
        systemPromptForTurn = await this.opts.buildSystemPrompt(userMessage, this.turnIndex)
      } catch (err) {
        log.warn({ err, sessionId: this.id }, 'buildSystemPrompt threw — falling back to static')
        systemPromptForTurn = this.opts.systemPrompt
      }
    } else {
      systemPromptForTurn = this.opts.systemPrompt
    }

    // First-turn title: truncated user question. Mirrors ChatGPT/Claude.ai —
    // the UI gets a title immediately; `thread/name/updated` may later
    // upgrade it to a server-generated smart title.
    if (this.turnIndex === 0 && !this.title) {
      const seed = userMessage.trim().slice(0, 60).split('\n')[0]
      if (seed.length > 0) {
        this.title = seed
        yield { type: 'title_update', title: this.title }
      }
    }

    this.turnIndex += 1

    try {
      await this.ensureStarted(systemPromptForTurn)
    } catch (err) {
      const message = (err as Error).message
      const code = classifyStartupError(message)
      yield { type: 'error', message, code }
      yield { type: 'done' }
      return
    }

    // Per-turn context refresh. `developerInstructions` on `thread/start`
    // is immutable for the life of the thread. If the builder returned a
    // new prompt for this turn, prepend a compact delta block to the user
    // message so Codex sees memory/workflow/surface updates inline.
    const effectiveUserMessage = this.injectContextIfChanged(userMessage, systemPromptForTurn)

    // Prepare the turn queue.
    const queue: TurnQueue = {
      events: [],
      resolve: null,
      done: false,
      error: null,
    }
    this.currentTurn = queue
    this.currentTurnUsage = null
    this.openToolCalls.clear()
    this.messagePhases.clear()
    // Per-turn dedup state — fresh so the first update of this turn
    // always propagates even if it happens to hash-match the previous
    // turn's last snapshot.
    this.lastPlanHash = ''
    this.lastTokenUsageHash = ''

    const turnEvents: SessionEvent[] = []

    // Kick off the turn. We capture the response asynchronously to seed
    // `currentTurnId` from the response (it's also set by the
    // `turn/started` notification — whichever lands first wins).
    try {
      const input = buildUserInput(effectiveUserMessage, attachments)
      void this.rpc!.request<{ turn: { id: string } }>(
        'turn/start',
        this.buildTurnStartParams(input),
      )
        .then((res) => {
          if (res?.turn?.id && !this.currentTurnId) this.currentTurnId = res.turn.id
        })
        .catch((err: unknown) => {
          // request rejections surface as a terminal error on the queue.
          const e = err instanceof Error ? err : new Error(String(err))
          queue.error = e
          queue.done = true
          queue.resolve?.()
        })
    } catch (err) {
      queue.error = err as Error
      queue.done = true
    }

    try {
      while (!queue.done || queue.events.length > 0) {
        if (queue.events.length > 0) {
          const ev = queue.events.shift()!
          turnEvents.push(ev)
          yield ev
        } else if (!queue.done) {
          await new Promise<void>((res) => {
            queue.resolve = res
          })
        }
      }

      if (queue.error) {
        const errEv: SessionEvent = {
          type: 'error',
          message: queue.error.message,
          code: classifyStartupError(queue.error.message),
        }
        turnEvents.push(errEv)
        yield errEv
      }
    } finally {
      this.currentTurn = null
      this.currentTurnId = null
      this.currentTurnStartedAt = null
      this.openToolCalls.clear()
      this.openItemStartedAt.clear()
      // Buffered cancel/steer that didn't get a turn id (e.g. turn/start
      // rejected before turn/started fired) would otherwise leak into
      // the next turn. Drop them.
      this.pendingCancel = false
      this.pendingSteer = null
    }

    // Mirror hook fires before the terminal `done`. Pass the original
    // user message, not the context-injected variant — the mirror is for
    // conversation history, not telemetry of internal prompt deltas.
    if (this.opts.onTurnEnd) {
      try {
        await this.opts.onTurnEnd({ userMessage, events: turnEvents })
      } catch (err) {
        log.warn({ err, sessionId: this.id }, 'onTurnEnd threw — turn still completes')
      }
    }

    const rawUsage = this.readCurrentTurnUsage()
    if (rawUsage) {
      yield {
        type: 'done',
        usage: {
          inputTokens: rawUsage.inputTokens,
          outputTokens: rawUsage.outputTokens,
          totalTokens: rawUsage.inputTokens + rawUsage.outputTokens,
          cacheReadTokens: rawUsage.cacheReadTokens ?? 0,
          cacheWriteTokens: 0,
        },
      }
    } else {
      yield { type: 'done' }
    }
  }

  /** Interrupt the in-flight turn, then inject the user's steer text. */
  async steer(text: string, attachments: ChatImageAttachmentInput[] = []): Promise<void> {
    if (!this.rpc || !this.threadId) {
      throw new Error('CodexHarnessSession.steer: session not started')
    }
    if (!this.currentTurnId) {
      // We're inside the race window between firing `turn/start` and
      // either its response or `turn/started` notification. Buffer the
      // steer so onTurnStarted can apply it the moment a turn id appears.
      if (!this.currentTurn) {
        log.warn({ sessionId: this.id }, 'steer called with no active turn — skipping')
        return
      }
      this.pendingSteer = { text, attachments }
      return
    }
    await this.applySteer(text, attachments, this.currentTurnId)
  }

  /** Best-effort cancel: interrupt current turn. */
  cancel(): void {
    if (!this.rpc || !this.threadId) return
    if (!this.currentTurnId) {
      // Race window: a turn is in flight (currentTurn set by
      // processMessage) but we don't yet have its id. Buffer the cancel
      // so onTurnStarted can drain it.
      if (this.currentTurn) {
        this.pendingCancel = true
        // A cancel makes any buffered steer pointless.
        this.pendingSteer = null
      }
      return
    }
    this.fireInterrupt(this.currentTurnId)
  }

  /** Send turn/interrupt; swallow & log the error. Used by cancel + steer. */
  private fireInterrupt(turnId: string): void {
    if (!this.rpc || !this.threadId) return
    this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId }).catch((err) => {
      log.warn({ err: (err as Error).message, sessionId: this.id }, 'turn/interrupt failed')
    })
  }

  /** Interrupt + steer the named turn. Shared between live and buffered paths. */
  private async applySteer(
    text: string,
    attachments: ChatImageAttachmentInput[],
    turnId: string,
  ): Promise<void> {
    if (!this.rpc || !this.threadId) return
    try {
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId })
    } catch (err) {
      log.warn(
        { err: (err as Error).message, sessionId: this.id },
        'turn/interrupt failed — continuing to steer',
      )
    }
    try {
      await this.rpc.request('turn/steer', {
        threadId: this.threadId,
        input: buildUserInput(text, attachments),
        expectedTurnId: turnId,
      })
    } catch (err) {
      log.warn({ err: (err as Error).message, sessionId: this.id }, 'turn/steer failed')
      throw err
    }
  }

  /**
   * Defeats TS's control-flow narrowing on `this.currentTurnUsage`.
   * Inside processMessage, assignments happen via notification handlers
   * the compiler can't see, so it narrows the field to `null`. Reading
   * through this method returns the field at its declared union type.
   */
  private readCurrentTurnUsage(): {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
  } | null {
    return this.currentTurnUsage
  }

  /** Graceful shutdown: end stdin → SIGTERM → SIGKILL. */
  async shutdown(): Promise<void> {
    if (!this.proc || this.proc.killed) return
    log.info({ sessionId: this.id }, 'shutting down codex app-server')

    this.rpc?.close('shutdown')
    try {
      this.proc.stdin?.end()
    } catch {
      /* ignore */
    }
    await delay(2000)
    if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM')
    await delay(5000)
    if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL')
  }

  // ── startup ──────────────────────────────────────────────────

  private async ensureStarted(systemPrompt?: string): Promise<void> {
    if (this.started) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInner(systemPrompt).catch((err) => {
      this.startPromise = null
      throw err
    })
    return this.startPromise
  }

  private async startInner(systemPrompt?: string): Promise<void> {
    const cliInfo = await detectCodexCli()
    if (!cliInfo.installed) {
      throw new Error(
        `codex CLI not installed or not on PATH. Install codex (${PINNED_CLI_VERSION} tested) and try again.`,
      )
    }

    log.info(
      { sessionId: this.id, cliVersion: cliInfo.version, supported: cliInfo.supported },
      'spawning codex app-server',
    )

    this.proc = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.opts.cwd || process.cwd(),
      env: { ...process.env, RUST_LOG: process.env.ANTON_CODEX_RUST_LOG ?? 'error' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Drain stderr into the log.
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd()
      if (text) log.debug({ sessionId: this.id, stderr: text.slice(0, 400) }, 'codex stderr')
    })

    this.proc.on('exit', (code, signal) => {
      log.info({ sessionId: this.id, code, signal }, 'codex app-server exited')
      const turn = this.currentTurn
      if (turn && !turn.done) {
        turn.error = new Error(`codex app-server exited (code=${code}, signal=${signal})`)
        turn.done = true
        turn.resolve?.()
      }
      this.started = false
      this.startPromise = null
      this.proc = null
      this.threadId = null
    })

    this.rpc = new CodexRpcClient(this.proc, { label: this.id })
    this.wireNotifications()

    try {
      await this.rpc.request('initialize', {
        clientInfo: { name: 'anton', title: 'Anton', version: PINNED_CLI_VERSION },
        capabilities: null,
      })

      const baseInstructions = (systemPrompt ?? this.opts.systemPrompt ?? '').trim()
      const capabilityBlock = (this.opts.capabilityBlock ?? '').trim()
      // Explicit `\n\n` joiner — don't rely on the leading blank lines
      // `systemReminder()` emits to separate the capability block from the
      // prompt above it. Either piece may be empty; `filter(Boolean)` drops
      // empties so we never leave a stray `\n\n` at the start or end.
      const developerInstructionsJoined = [baseInstructions, capabilityBlock]
        .filter((s) => s.length > 0)
        .join('\n\n')
      const developerInstructions =
        developerInstructionsJoined.length > 0 ? developerInstructionsJoined : null

      const threadStartParams: Record<string, unknown> = {
        model: this.model,
        modelProvider: null,
        cwd: this.opts.cwd ?? null,
        approvalPolicy: 'never',
        sandbox: this.sandboxMode,
        config: this.buildConfig(),
        baseInstructions: null,
        developerInstructions,
        // Required fields in v2 — we do not opt into either.
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      }

      const startResult = await this.rpc.request<{
        thread: { id: string }
        model?: string
      }>('thread/start', threadStartParams)

      this.threadId = startResult.thread.id
      if (startResult.model) this.model = startResult.model

      this.started = true
      log.info(
        {
          sessionId: this.id,
          threadId: this.threadId,
          model: this.model,
          sandbox: this.sandboxMode,
        },
        'codex app-server ready',
      )
      if (capabilityBlock.length > 0) {
        log.info(
          {
            sessionId: this.id,
            threadId: this.threadId,
            capabilityBlockChars: capabilityBlock.length,
            liveConnectorIds: this.opts.capabilityConnectorIds ?? [],
          },
          'capability block installed via thread/start',
        )
      }
    } catch (err) {
      const message = err instanceof CodexRpcError ? err.message : (err as Error).message
      this.rpc?.close('init-failed')
      try {
        this.proc?.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      this.proc = null
      this.rpc = null
      throw new Error(`codex app-server init failed: ${message}`)
    }
  }

  private buildConfig(): Record<string, unknown> {
    const mcpEnv: Record<string, string> = {
      ANTON_SOCK: this.opts.mcp.socketPath,
      ANTON_SESSION: this.id,
      ANTON_AUTH: this.opts.mcp.authToken,
    }
    // The namespace Codex uses to prefix our tools (e.g. `anton:gmail_*`)
    // MUST match the value the identity + capability blocks reference.
    return {
      model_reasoning_summary: 'detailed',
      sandbox_mode: this.sandboxMode,
      mcp_servers: {
        [ANTON_MCP_NAMESPACE]: {
          command: this.opts.mcp.spawn.command,
          args: this.opts.mcp.spawn.args,
          env: mcpEnv,
        },
      },
    }
  }

  private buildTurnStartParams(input: UserInput[]): Record<string, unknown> {
    return {
      threadId: this.threadId,
      input,
      cwd: this.opts.cwd ?? process.cwd(),
      approvalPolicy: 'never',
      sandboxPolicy: buildTurnSandboxPolicy(this.sandboxMode),
      model: this.model,
      effort: this.effort,
      summary: 'detailed',
      outputSchema: null,
    }
  }

  /**
   * If the per-turn system prompt differs from the one baked into the
   * thread, prepend a compact context-update block to the user message
   * so the model sees the fresh state inline.
   *
   * The first time this runs it records `lastSystemPrompt` and does not
   * inject (ensureStarted already sent the full prompt via
   * `developerInstructions`). Subsequent turns compare and only inject
   * on change.
   */
  private injectContextIfChanged(userMessage: string, newPrompt: string | undefined): string {
    if (!newPrompt) {
      return userMessage
    }
    if (this.lastSystemPrompt === undefined) {
      this.lastSystemPrompt = newPrompt
      return userMessage
    }
    if (this.lastSystemPrompt === newPrompt) {
      return userMessage
    }
    this.lastSystemPrompt = newPrompt
    // Wrap so the model can recognize and parse it if needed; wrapped
    // blocks like this are stable across Anthropic and OpenAI models.
    return `<anton-context-update>\n${newPrompt}\n</anton-context-update>\n\n${userMessage}`
  }

  // ── notification wiring (event mapping) ───────────────────────

  private wireNotifications() {
    const rpc = this.rpc!

    rpc.on_('turn/started', (p) => this.onTurnStarted(p))
    rpc.on_('turn/completed', (p) => this.onTurnCompleted(p))
    rpc.on_('item/started', (p) => this.onItemStarted(p))
    rpc.on_('item/completed', (p) => this.onItemCompleted(p))
    rpc.on_('item/agentMessage/delta', (p) => this.onAgentMessageDelta(p))
    rpc.on_('item/reasoning/textDelta', (p) => this.onReasoningDelta(p))
    rpc.on_('item/reasoning/summaryTextDelta', (p) => this.onReasoningDelta(p))
    // Intentionally NOT subscribing to `thread/name/updated`: Codex's
    // server-side titler emits progressive partial names ("I", "I'll",
    // "I'll che", …) which pins the UI to whatever prefix arrived first.
    // The model now owns titling via the `anton:set_session_title` MCP
    // tool — one-shot, finalized, sentence-cased.
    rpc.on_('thread/tokenUsage/updated', (p) => this.onTokenUsageUpdated(p))
    rpc.on_('thread/compacted', () => this.onCompacted())

    // Streaming progress from Anton-side MCP tools (today: spawn_sub_agent).
    // Routed back as `sub_agent_progress` keyed by the parent tool call's id.
    rpc.on_('item/mcpToolCall/progress', (p) => this.onMcpToolCallProgress(p))

    // Plan updates fire through both channels; both route through
    // onPlanUpdated which de-dups on content hash.
    rpc.on_('turn/plan/updated', (p) => this.onPlanUpdated(p))
    rpc.on_('item/plan/delta', (p) => this.onPlanUpdated(p))

    // Top-level error stream. Carries TurnError in `params.error`.
    rpc.on_('error', (p) => this.onError(p))
  }

  private emit(...events: SessionEvent[]) {
    const turn = this.currentTurn
    if (!turn) return // out-of-turn events are dropped
    turn.events.push(...events)
    turn.resolve?.()
    turn.resolve = null
  }

  /**
   * Translate the `anton:artifact` MCP call's input into the
   * SessionEvent shape Pi SDK emits from `Session.detectArtifact`.
   * Keeping the shape identical means the desktop ArtifactPanel renders
   * harness-emitted artifacts the same as Pi-SDK-emitted ones.
   */
  private emitArtifactEvent(toolCallId: string, rawInput: unknown) {
    const input = (rawInput ?? {}) as {
      type?: string
      title?: string
      content?: string
      filename?: string
      language?: string
    }
    const artType = (input.type as 'html' | 'code' | 'markdown' | 'svg' | 'mermaid') || 'code'
    const language = artType === 'code' ? (input.language ?? 'text') : artType
    if (typeof input.content !== 'string' || !input.content) return
    this.emit({
      type: 'artifact',
      id: `artifact_${toolCallId}_${Date.now()}`,
      toolCallId,
      artifactType: 'artifact',
      renderType: artType,
      title: input.title,
      filename: input.filename,
      filepath: input.filename,
      language,
      content: input.content,
    })
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
    this.emit({ type: 'browser_state', ...state })
  }

  /** Push a `browser_close` event. See `emitBrowserState`. */
  emitBrowserClose() {
    this.emit({ type: 'browser_close' })
  }

  /**
   * Translate the `anton:task_tracker` MCP call's input into the
   * `tasks_update` SessionEvent the desktop checklist consumes. Mirrors
   * Pi SDK's `Session.emitTasksUpdate` shape. Codex also has a native
   * plan stream we translate elsewhere — the MCP path is here so Claude
   * Code (no native plan) and any other harness CLI can drive the same
   * UI via the explicit tool call.
   */
  private emitTasksUpdateEvent(rawInput: unknown) {
    const input = (rawInput ?? {}) as {
      tasks?: Array<{
        content?: string
        activeForm?: string
        status?: 'pending' | 'in_progress' | 'completed'
      }>
    }
    if (!Array.isArray(input.tasks)) return
    const tasks = input.tasks
      .filter((t) => typeof t?.content === 'string' && typeof t.status === 'string')
      .map((t) => ({
        content: t.content as string,
        activeForm: typeof t.activeForm === 'string' ? t.activeForm : (t.content as string),
        status: t.status as 'pending' | 'in_progress' | 'completed',
      }))
    if (tasks.length === 0) return
    this.emit({ type: 'tasks_update', tasks })
  }

  private onTurnStarted(params: unknown) {
    const p = params as { turn?: { id?: string } } | undefined
    const id = p?.turn?.id
    if (!id) return
    this.currentTurnId = id
    this.currentTurnStartedAt = Date.now()

    log.info({ sessionId: this.id, turnId: id, turnIndex: this.turnIndex }, 'codex turn started')

    // Drain race-window buffers in priority order. A buffered cancel
    // tears the turn down — no point also steering. A buffered steer
    // alone interrupts and sends the new input.
    if (this.pendingCancel) {
      this.pendingCancel = false
      this.pendingSteer = null
      this.fireInterrupt(id)
      return
    }
    const steer = this.pendingSteer
    if (steer) {
      this.pendingSteer = null
      void this.applySteer(steer.text, steer.attachments, id).catch((err) => {
        log.warn({ err: (err as Error).message, sessionId: this.id }, 'buffered steer failed')
      })
    }
  }

  private onTurnCompleted(params: unknown) {
    // `turn/completed` carries `{threadId, turn: Turn}`. The Turn's
    // status tells us whether it ended cleanly; usage is reported
    // separately via `thread/tokenUsage/updated`.
    const p = params as { turn?: { status?: string; error?: { message?: string } } } | undefined
    const status = p?.turn?.status
    const durationMs = this.currentTurnStartedAt ? Date.now() - this.currentTurnStartedAt : null
    log.info(
      {
        sessionId: this.id,
        turnId: this.currentTurnId,
        status: status ?? 'unknown',
        durationMs,
        openItems: this.openToolCalls.size,
      },
      'codex turn completed',
    )
    this.currentTurnStartedAt = null
    if (status === 'failed' || status === 'interrupted') {
      const message = p?.turn?.error?.message ?? `turn ${status}`
      this.emit({ type: 'error', message, code: 'runtime' })
    }
    const turn = this.currentTurn
    if (turn) {
      turn.done = true
      turn.resolve?.()
    }
  }

  private onAgentMessageDelta(params: unknown) {
    const p = params as { delta?: string; itemId?: string } | undefined
    const delta = p?.delta
    if (typeof delta !== 'string' || delta.length === 0) return
    const blockId = p?.itemId
    const phase = blockId ? this.messagePhases.get(blockId) : undefined
    this.emit({ type: 'text', content: delta, blockId, phase })
  }

  private onReasoningDelta(params: unknown) {
    const p = params as { delta?: string; itemId?: string } | undefined
    const delta = p?.delta
    if (typeof delta !== 'string' || delta.length === 0) return
    this.emit({ type: 'thinking', text: delta, blockId: p?.itemId, kind: 'summary' })
  }

  private onTokenUsageUpdated(params: unknown) {
    // Shape:
    //   { threadId, turnId,
    //     tokenUsage: { total: TokenUsageBreakdown, last: …, modelContextWindow } }
    //   TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens,
    //                           outputTokens, reasoningOutputTokens }
    const p = params as
      | {
          tokenUsage?: {
            total?: {
              inputTokens?: number
              outputTokens?: number
              cachedInputTokens?: number
              totalTokens?: number
            }
            last?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
          }
        }
      | undefined
    const u = p?.tokenUsage?.total ?? p?.tokenUsage?.last
    if (!u) return
    const input = u.inputTokens ?? 0
    const output = u.outputTokens ?? 0
    const cached = u.cachedInputTokens ?? 0
    const hash = `${input}:${output}:${cached}`
    if (hash === this.lastTokenUsageHash) return
    this.lastTokenUsageHash = hash
    this.currentTurnUsage = { inputTokens: input, outputTokens: output, cacheReadTokens: cached }
    this.emit({
      type: 'token_update',
      usage: {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    })
  }

  private onCompacted() {
    this.emit({ type: 'compaction', compactedMessages: 0, totalCompactions: 1 })
  }

  /**
   * `item/mcpToolCall/progress`: { threadId, turnId, itemId, message }.
   *
   * Routed into the existing `sub_agent_progress` event so the UI renders
   * inside the parent tool call's SubAgentGroup card. Only surface for
   * tools we recognize as sub-agent spawners.
   */
  private onMcpToolCallProgress(params: unknown) {
    const p = params as { itemId?: string; message?: string } | undefined
    const callId = p?.itemId
    const msg = p?.message
    if (!callId || typeof msg !== 'string' || msg.length === 0) return
    const tc = this.openToolCalls.get(callId)
    if (tc && (tc.name === 'anton:spawn_sub_agent' || tc.name.endsWith(':spawn_sub_agent'))) {
      this.emit({ type: 'sub_agent_progress', toolCallId: callId, content: msg })
    }
  }

  private onPlanUpdated(params: unknown) {
    // Two channels feed this:
    //   `turn/plan/updated`: { threadId, turnId, explanation, plan: [{step, status}] }
    //   `item/plan/delta`  : { threadId, turnId, itemId, delta }
    // The delta channel is text-only (no structured plan); skip it here
    // and let `turn/plan/updated` carry the canonical plan.
    const p = params as { plan?: unknown[]; delta?: unknown } | undefined
    const plan = Array.isArray(p?.plan) ? p.plan : undefined
    if (!plan || plan.length === 0) return

    const tasks = plan.map((raw, idx) => {
      const item = raw as { step?: string; status?: string }
      // v2 statuses: "pending" | "inProgress" | "completed". Map to the
      // SessionEvent's snake_case union.
      const statusRaw = item.status ?? 'pending'
      const status: 'pending' | 'in_progress' | 'completed' | 'cancelled' =
        statusRaw === 'inProgress' || statusRaw === 'in_progress'
          ? 'in_progress'
          : statusRaw === 'completed'
            ? 'completed'
            : statusRaw === 'cancelled'
              ? 'cancelled'
              : 'pending'
      const content = item.step ?? `task ${idx + 1}`
      return { id: String(idx), content, activeForm: content, status }
    })

    const hash = createHash('sha1').update(JSON.stringify(tasks)).digest('hex')
    if (hash === this.lastPlanHash) return
    this.lastPlanHash = hash

    this.emit({ type: 'tasks_update', tasks: tasks as never })
  }

  private onError(params: unknown) {
    const p = params as { error?: { message?: string } } | undefined
    const message = p?.error?.message ?? 'codex stream error'
    const lower = message.toLowerCase()
    const code: 'not_authed' | 'runtime' =
      lower.includes('401') || lower.includes('unauthorized') || lower.includes('not logged in')
        ? 'not_authed'
        : 'runtime'
    log.error(
      { sessionId: this.id, turnId: this.currentTurnId, code, message },
      'codex stream error',
    )
    this.emit({ type: 'error', message, code })
  }

  private onItemStarted(params: unknown) {
    const item = pickItem(params)
    if (!item || typeof item.id !== 'string') return

    switch (item.type) {
      case 'agentMessage': {
        const phaseRaw = (item as { phase?: string }).phase
        if (phaseRaw === 'commentary' || phaseRaw === 'final_answer') {
          this.messagePhases.set(item.id, phaseRaw)
        }
        return
      }

      case 'webSearch': {
        if (this.openToolCalls.has(item.id)) return
        this.openToolCalls.set(item.id, { name: 'web_search', input: {} })
        this.openItemStartedAt.set(item.id, Date.now())
        log.info(
          { sessionId: this.id, turnId: this.currentTurnId, itemId: item.id, tool: 'web_search' },
          'codex tool_call started',
        )
        this.emit({ type: 'tool_call', id: item.id, name: 'web_search', input: {} })
        return
      }

      case 'commandExecution': {
        if (this.openToolCalls.has(item.id)) return
        const cmd = (item as { command?: string }).command ?? ''
        const cwd = (item as { cwd?: string }).cwd ?? this.opts.cwd ?? ''
        const input = { command: cmd, cwd }
        this.openToolCalls.set(item.id, { name: 'shell', input })
        this.openItemStartedAt.set(item.id, Date.now())
        log.info(
          {
            sessionId: this.id,
            turnId: this.currentTurnId,
            itemId: item.id,
            tool: 'shell',
            command: cmd.slice(0, 200),
          },
          'codex tool_call started',
        )
        this.emit({ type: 'tool_call', id: item.id, name: 'shell', input })
        return
      }

      case 'mcpToolCall': {
        if (this.openToolCalls.has(item.id)) return
        const i = item as { server?: string; tool?: string; arguments?: Record<string, unknown> }
        const name = `${i.server ?? 'mcp'}:${i.tool ?? 'tool'}`
        const inp = i.arguments ?? {}
        this.openToolCalls.set(item.id, { name, input: inp })
        this.openItemStartedAt.set(item.id, Date.now())
        log.info(
          {
            sessionId: this.id,
            turnId: this.currentTurnId,
            itemId: item.id,
            tool: name,
          },
          'codex tool_call started',
        )
        this.emit({ type: 'tool_call', id: item.id, name, input: inp })
        return
      }

      case 'collabAgentToolCall': {
        const i = item as { tool?: string; prompt?: string }
        // Only spawnAgent is a "start a sub-agent" event. Other collab
        // verbs (sendInput, wait, resumeAgent, closeAgent) interact with
        // an already-open sub-agent and don't start a new card.
        if (i.tool !== 'spawnAgent') return
        log.info(
          { sessionId: this.id, turnId: this.currentTurnId, itemId: item.id },
          'codex sub_agent started',
        )
        this.emit({ type: 'sub_agent_start', toolCallId: item.id, task: i.prompt ?? '' })
        return
      }
    }
  }

  private onItemCompleted(params: unknown) {
    const item = pickItem(params)
    if (!item || typeof item.id !== 'string') return

    switch (item.type) {
      case 'agentMessage': {
        // Phase lookup is no longer needed; free the entry.
        this.messagePhases.delete(item.id)
        return
      }

      case 'webSearch': {
        if (this.openToolCalls.has(item.id)) {
          const output = JSON.stringify({
            query: (item as { query?: string }).query,
            action: (item as { action?: unknown }).action,
          })
          this.openToolCalls.delete(item.id)
          this.logItemCompleted(item.id, 'web_search', false)
          this.emit({ type: 'tool_result', id: item.id, output })
        }
        return
      }

      case 'commandExecution': {
        if (this.openToolCalls.has(item.id)) {
          const i = item as { aggregatedOutput?: string; exitCode?: number }
          const out = i.aggregatedOutput ?? ''
          const exitCode = i.exitCode
          const isError = typeof exitCode === 'number' && exitCode !== 0
          this.openToolCalls.delete(item.id)
          this.logItemCompleted(item.id, 'shell', isError, { exitCode: exitCode ?? null })
          this.emit({
            type: 'tool_result',
            id: item.id,
            output: out || `exit code: ${exitCode ?? 'unknown'}`,
            isError,
          })
        }
        return
      }

      case 'mcpToolCall': {
        if (this.openToolCalls.has(item.id)) {
          const i = item as {
            result?: {
              content?: Array<{ type?: string; text?: string }>
              structuredContent?: unknown
            }
            error?: string | { message?: string }
          }
          const errMsg = typeof i.error === 'string' ? i.error : i.error?.message
          let output = ''
          let isError = false
          if (errMsg) {
            output = errMsg
            isError = true
          } else if (Array.isArray(i.result?.content)) {
            output = i.result.content
              .map((c) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : ''))
              .filter(Boolean)
              .join('\n')
          }
          if (!output && i.result?.structuredContent !== undefined) {
            try {
              output = JSON.stringify(i.result.structuredContent)
            } catch {
              /* ignore */
            }
          }
          // Mirror Pi SDK's Session.detectArtifact / emitTasksUpdate
          // for Anton-owned tools whose side effects are protocol-level
          // SessionEvents on top of the normal tool_result. Without
          // this, codex would see the tool call go through but the
          // desktop side panel / task checklist would never update.
          const open = this.openToolCalls.get(item.id)
          if (!isError && open?.name === 'anton:artifact') {
            this.emitArtifactEvent(item.id, open.input)
          }
          if (!isError && open?.name === 'anton:task_tracker') {
            this.emitTasksUpdateEvent(open.input)
          }
          this.openToolCalls.delete(item.id)
          this.logItemCompleted(item.id, open?.name ?? 'mcp:unknown', isError, {
            ...(errMsg ? { error: errMsg.slice(0, 200) } : {}),
          })
          this.emit({ type: 'tool_result', id: item.id, output, isError })
        }
        return
      }

      case 'fileChange': {
        // v2 replacement for v1 `codex/event/patch_apply_end`.
        // Item shape: { id, changes: [{path, kind, diff}], status }.
        const changes = (item as { changes?: Array<{ path?: string }> }).changes
        if (!Array.isArray(changes)) return
        for (const c of changes) {
          const fp = c?.path
          if (typeof fp !== 'string' || !existsSync(fp)) continue
          try {
            const stat = statSync(fp)
            if (!stat.isFile() || stat.size > 1_000_000) continue
            const content = readFileSync(fp, 'utf8')
            const ext = extname(fp).slice(1) || 'txt'
            this.emit({
              type: 'artifact',
              id: `artifact_${randomUUID().slice(0, 8)}`,
              toolCallId: `patch_${randomUUID().slice(0, 8)}`,
              artifactType: 'file',
              renderType: inferRenderType(ext),
              filename: basename(fp),
              filepath: fp,
              language: inferLanguage(ext),
              content,
            })
          } catch (e) {
            log.warn(
              { err: (e as Error).message, path: fp },
              'fileChange: failed to read changed file',
            )
          }
        }
        return
      }

      case 'collabAgentToolCall': {
        const i = item as { tool?: string; status?: string }
        if (i.tool !== 'spawnAgent') return
        const success = i.status === 'completed'
        log.info(
          {
            sessionId: this.id,
            turnId: this.currentTurnId,
            itemId: item.id,
            success,
          },
          'codex sub_agent completed',
        )
        this.emit({ type: 'sub_agent_end', toolCallId: item.id, success })
        return
      }
    }
  }

  /**
   * Centralized `tool_call completed` log so every path (shell, MCP,
   * webSearch) emits the same shape with a durationMs sourced from
   * `openItemStartedAt`. Missing start times produce `durationMs: null`
   * rather than a bogus number.
   */
  private logItemCompleted(
    itemId: string,
    tool: string,
    isError: boolean,
    extra: Record<string, unknown> = {},
  ): void {
    const startedAt = this.openItemStartedAt.get(itemId)
    this.openItemStartedAt.delete(itemId)
    log.info(
      {
        sessionId: this.id,
        turnId: this.currentTurnId,
        itemId,
        tool,
        isError,
        durationMs: startedAt ? Date.now() - startedAt : null,
        ...extra,
      },
      'codex tool_call completed',
    )
  }
}

// ── helpers ──────────────────────────────────────────────────────

/**
 * The app-server `UserInput` discriminated union. Rather than import the
 * generated binding (which has transitive dependencies for skill/mention
 * elements we don't construct), we inline the minimal shape we use.
 */
export type UserInput =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }

const IMG_MARKER_RE = /\[img:([^\]]+)\]/g

/**
 * Build the `input` array for `turn/start` / `turn/steer`.
 *
 * Mirrors Pi SDK's `buildInterleavedContent` semantics: if the text has
 * `[img:<id>]` markers, each marker is replaced by the corresponding
 * image at that position. Unreferenced attachments append after the text.
 * If there are no markers and no attachments, returns a single text item.
 */
export function buildUserInput(text: string, attachments: ChatImageAttachmentInput[]): UserInput[] {
  if (attachments.length === 0) {
    return [{ type: 'text', text, text_elements: [] }]
  }

  const attachmentMap = new Map(attachments.map((a) => [a.id, a]))

  // No markers — append images after the text. Same backward-compat as Pi SDK.
  IMG_MARKER_RE.lastIndex = 0
  if (!IMG_MARKER_RE.test(text)) {
    const items: UserInput[] = [{ type: 'text', text, text_elements: [] }]
    for (const a of attachments) {
      items.push({ type: 'image', url: attachmentToDataUrl(a) })
    }
    return items
  }

  // Interleave: split the text around each marker, emit image items in place.
  IMG_MARKER_RE.lastIndex = 0
  const items: UserInput[] = []
  const usedIds = new Set<string>()
  let lastIndex = 0
  for (let match = IMG_MARKER_RE.exec(text); match !== null; match = IMG_MARKER_RE.exec(text)) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk.length > 0) items.push({ type: 'text', text: chunk, text_elements: [] })
    }

    const id = match[1]
    const attachment = attachmentMap.get(id)
    if (attachment) {
      items.push({ type: 'image', url: attachmentToDataUrl(attachment) })
      usedIds.add(id)
    }

    lastIndex = match.index + match[0].length
  }

  // Trailing text
  if (lastIndex < text.length) {
    const trailing = text.slice(lastIndex)
    if (trailing.trim().length > 0) {
      items.push({ type: 'text', text: trailing, text_elements: [] })
    }
  }

  // Images that weren't referenced by a marker append at the end — matches Pi SDK.
  for (const a of attachments) {
    if (!usedIds.has(a.id)) {
      items.push({ type: 'image', url: attachmentToDataUrl(a) })
    }
  }

  return items
}

function attachmentToDataUrl(a: ChatImageAttachmentInput): string {
  // a.data is base64; a.mimeType is e.g. "image/png".
  return `data:${a.mimeType};base64,${a.data}`
}

/**
 * Extract the `item` field from an item/started or item/completed
 * notification. Shape: { item, threadId, turnId }.
 */
function pickItem(
  params: unknown,
): { id?: string; type?: string; [k: string]: unknown } | undefined {
  const p = params as { item?: Record<string, unknown> } | undefined
  return p?.item as { id?: string; type?: string; [k: string]: unknown } | undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function classifyStartupError(
  stderr: string,
): 'not_installed' | 'not_authed' | 'startup_timeout' | 'runtime' {
  const s = stderr.toLowerCase()
  if (s.includes('enoent') || s.includes('not installed') || s.includes('not found on path'))
    return 'not_installed'
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
  if (s.includes('timeout')) return 'startup_timeout'
  return 'runtime'
}

function inferLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    md: 'markdown',
    mdx: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    toml: 'toml',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    xml: 'xml',
    txt: 'text',
  }
  return map[ext] ?? 'text'
}

function inferRenderType(ext: string): 'code' | 'markdown' | 'html' | 'svg' | 'mermaid' {
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'mmd') return 'mermaid'
  return 'code'
}
