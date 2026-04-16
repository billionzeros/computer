/**
 * HarnessSession — spawns a CLI subprocess (e.g. `claude`) and bridges
 * its stream-json output into Anton's SessionEvent system.
 *
 * Exposes the same `processMessage()` async generator interface as Session
 * so server.ts can consume both identically.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@anton/logger'
import type { ChatImageAttachmentInput } from '@anton/protocol'
import type { SessionEvent } from '../session.js'
import type { HarnessAdapter } from './adapter.js'

const log = createLogger('harness-session')

export interface HarnessSessionOpts {
  id: string
  provider: string
  model: string
  adapter: HarnessAdapter
  socketPath: string
  shimPath: string
  cwd?: string
  systemPrompt?: string
  maxBudgetUsd?: number
}

export class HarnessSession {
  readonly id: string
  readonly provider: string
  model: string
  readonly createdAt: number

  private adapter: HarnessAdapter
  private socketPath: string
  private shimPath: string
  private cwd?: string
  private systemPrompt?: string
  private maxBudgetUsd?: number
  private proc: ChildProcess | null = null
  private title = ''
  private lastActiveAt: number

  /** Claude Code's internal session ID, used for --resume */
  private cliSessionId: string | null = null

  /** Sentinel — set to true so server.ts can distinguish from Session */
  readonly isHarness = true as const

  constructor(opts: HarnessSessionOpts) {
    this.id = opts.id
    this.provider = opts.provider
    this.model = opts.model
    this.adapter = opts.adapter
    this.socketPath = opts.socketPath
    this.shimPath = opts.shimPath
    this.cwd = opts.cwd
    this.systemPrompt = opts.systemPrompt
    this.maxBudgetUsd = opts.maxBudgetUsd
    this.createdAt = Date.now()
    this.lastActiveAt = Date.now()
  }

  getTitle(): string {
    return this.title
  }

  getLastActiveAt(): number {
    return this.lastActiveAt
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

    try {
      const args = this.adapter.buildSpawnArgs({
        message: userMessage,
        mcpConfigPath,
        model: this.model,
        resumeSessionId: this.cliSessionId ?? undefined,
        systemPrompt: this.systemPrompt,
        maxBudgetUsd: this.maxBudgetUsd,
        cwd: this.cwd,
        shimPath: this.shimPath,
        socketPath: this.socketPath,
        sessionId: this.id,
      })

      const env = {
        ...process.env,
        ...this.adapter.buildEnv({
          socketPath: this.socketPath,
          sessionId: this.id,
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
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity })

      // Use an async queue pattern to bridge readline events to the generator
      const eventQueue: SessionEvent[] = []
      let resolveWait: (() => void) | null = null
      let done = false

      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return

        // Safely parse JSON — non-JSON lines (loading messages, etc.) are logged and skipped
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          log.warn({ sessionId: this.id, line: trimmed.slice(0, 200) }, 'Non-JSON line from CLI, skipping')
          return
        }

        // Capture CLI session ID for --resume
        const sid = this.adapter.extractSessionId(parsed)
        if (sid) this.cliSessionId = sid

        const events = this.adapter.parseEvent(line)
        eventQueue.push(...events)

        // Auto-generate title from first text content
        if (!this.title) {
          for (const ev of events) {
            if (ev.type === 'text' && ev.content.length > 0) {
              this.title = ev.content.slice(0, 60).split('\n')[0]
              eventQueue.push({ type: 'title_update', title: this.title })
              break
            }
          }
        }

        if (resolveWait) {
          resolveWait()
          resolveWait = null
        }
      })

      // Startup timeout: if no JSON events arrive within 30s, surface stderr and abort
      let receivedFirstEvent = false
      const startupTimeout = setTimeout(() => {
        if (!receivedFirstEvent && !done) {
          const errMsg = stderrChunks.trim() || 'CLI did not produce any output within 30 seconds. Check that the provider is logged in and configured correctly.'
          log.error({ sessionId: this.id, stderr: stderrChunks.slice(0, 500) }, 'Harness CLI startup timeout')
          eventQueue.push({ type: 'error', message: errMsg })
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
          eventQueue.push({ type: 'error', message: `CLI process error: ${err.message}` })
          done = true
          if (resolveWait) {
            resolveWait()
            resolveWait = null
          }
          resolve(null)
        })
      })

      // Yield events as they arrive
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          receivedFirstEvent = true
          yield eventQueue.shift()!
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
        yield { type: 'error', message: errMsg }
      }

      // Ensure a done event is always emitted
      yield { type: 'done' }
    } finally {
      // Clean up temp MCP config
      this.cleanupFile(mcpConfigPath)
      this.proc = null
    }
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
          command: 'node',
          args: [this.shimPath],
          env: {
            ANTON_SOCK: this.socketPath,
            ANTON_SESSION: this.id,
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

/** Type guard to distinguish HarnessSession from Session */
export function isHarnessSession(s: unknown): s is HarnessSession {
  return s instanceof HarnessSession || (s != null && (s as HarnessSession).isHarness === true)
}
