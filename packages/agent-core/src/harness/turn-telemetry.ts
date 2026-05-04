/**
 * TurnTelemetry — provider-agnostic per-turn observability shared by
 * every harness session. Counters, idle watchdog, and `turn started/
 * completed` log lines are derived purely from the SessionEvent stream,
 * so the same instance fits any harness without leaking provider
 * details. Provider-specific lifecycle logs stay in the harness.
 */

import type { Logger } from '@anton/logger'
import type { SessionEvent } from '../session.js'

const IDLE_WARN_MS = 30_000
const IDLE_TIMER_INTERVAL_MS = 5_000

export interface TurnTelemetryOpts {
  logger: Logger
  sessionId: string
}

interface TurnCounters {
  reasoningChars: number
  messageChars: number
  toolCalls: number
  fileChanges: number
}

export class TurnTelemetry {
  private readonly log: Logger
  private readonly sessionId: string

  private currentTurnId: string | null = null
  private currentTurnStartedAt: number | null = null
  private counters: TurnCounters = freshCounters()

  private lastActivityAt = 0
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private idleWarnedAt = 0

  constructor(opts: TurnTelemetryOpts) {
    this.log = opts.logger
    this.sessionId = opts.sessionId
  }

  /** Begin tracking a turn: log `turn started`, reset counters, start the idle watchdog. */
  startTurn(turnId: string, turnIndex: number): void {
    this.currentTurnId = turnId
    this.currentTurnStartedAt = Date.now()
    this.lastActivityAt = Date.now()
    this.counters = freshCounters()
    this.idleWarnedAt = 0
    this.startIdleWatchdog()
    this.log.info({ sessionId: this.sessionId, turnId, turnIndex }, 'turn started')
  }

  /**
   * Bump counters and the activity clock from a `SessionEvent`. Called
   * for every event the harness emits to its consumer. Token-usage
   * updates and other low-signal channels intentionally don't pass
   * through here — they re-fire on a steady cadence and would mask
   * real stalls.
   */
  recordEvent(event: SessionEvent): void {
    this.lastActivityAt = Date.now()
    switch (event.type) {
      case 'thinking':
        this.counters.reasoningChars += event.text.length
        return
      case 'text':
        this.counters.messageChars += event.content.length
        return
      case 'tool_call':
        this.counters.toolCalls += 1
        return
      case 'artifact':
        // Only count actual file writes (codex apply_patch) — artifact-
        // type 'artifact'/'output' come from the anton:artifact MCP
        // tool and represent UI artifacts, not files on disk.
        if (event.artifactType === 'file') this.counters.fileChanges += 1
        return
      default:
        return
    }
  }

  /**
   * Finish the current turn. Idempotent — a second call (e.g. from a
   * generator's finally block after the success path already closed
   * the turn) is a no-op so no duplicate log lands.
   */
  completeTurn(status: string, extras: Record<string, unknown> = {}): void {
    if (this.currentTurnId === null) return
    this.stopIdleWatchdog()
    const durationMs = this.currentTurnStartedAt ? Date.now() - this.currentTurnStartedAt : null
    this.log.info(
      {
        sessionId: this.sessionId,
        turnId: this.currentTurnId,
        status,
        durationMs,
        reasoningChars: this.counters.reasoningChars,
        messageChars: this.counters.messageChars,
        toolCalls: this.counters.toolCalls,
        fileChanges: this.counters.fileChanges,
        ...extras,
      },
      'turn completed',
    )
    this.currentTurnId = null
    this.currentTurnStartedAt = null
  }

  /** Stop the watchdog. Safe to call from session shutdown regardless of turn state. */
  dispose(): void {
    this.stopIdleWatchdog()
  }

  private startIdleWatchdog() {
    this.stopIdleWatchdog()
    this.idleTimer = setInterval(() => {
      if (!this.currentTurnStartedAt) return
      const idleMs = Date.now() - this.lastActivityAt
      if (idleMs < IDLE_WARN_MS) return
      // Debounce: re-warn only after another full IDLE_WARN_MS of silence
      // so a long stall produces ~one log line per window rather than spam.
      if (this.idleWarnedAt && Date.now() - this.idleWarnedAt < IDLE_WARN_MS) return
      this.idleWarnedAt = Date.now()
      this.log.warn(
        {
          sessionId: this.sessionId,
          turnId: this.currentTurnId,
          idleMs,
          reasoningChars: this.counters.reasoningChars,
          messageChars: this.counters.messageChars,
          toolCalls: this.counters.toolCalls,
          fileChanges: this.counters.fileChanges,
        },
        'turn idle',
      )
    }, IDLE_TIMER_INTERVAL_MS)
    this.idleTimer.unref?.()
  }

  private stopIdleWatchdog() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }
}

function freshCounters(): TurnCounters {
  return { reasoningChars: 0, messageChars: 0, toolCalls: 0, fileChanges: 0 }
}
