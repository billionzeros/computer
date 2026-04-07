/**
 * WebhookAgentRunner — shared session/agent execution for all webhook providers.
 *
 * Extracted from the original telegram-bot.ts so every provider gets the same
 * behaviour for free:
 *   - per-sessionId persistent Session (resumed from disk if available)
 *   - per-sessionId FIFO queue (re-entrant events run sequentially, never in
 *     parallel — agents aren't safe against the same Session at once)
 *   - bounded queue depth so a spammed channel can't grow memory unboundedly
 *   - response sanitization (strips <think> blocks some models emit)
 */

import type { AgentConfig } from '@anton/agent-config'
import type { McpManager, Session } from '@anton/agent-core'
import { createSession, resumeSession } from '@anton/agent-core'
import type { ConnectorManager } from '@anton/connectors'
import { createLogger } from '@anton/logger'
import type { CanonicalEvent } from './provider.js'

const log = createLogger('webhook-runner')

/**
 * Maximum number of events queued per session before we start dropping.
 * Picked small enough that a runaway producer can't OOM us, but large enough
 * to absorb a normal burst (e.g. a user sending three quick messages while
 * the agent is mid-response).
 */
const MAX_QUEUE_DEPTH = 5

interface SessionChain {
  tail: Promise<unknown>
  depth: number
}

export class WebhookAgentRunner {
  private sessions = new Map<string, Session>()
  /**
   * Per-sessionId promise chain. The `tail` is the most-recently queued
   * promise; new events `.then()` off it so they run strictly after every
   * earlier event for the same session. `depth` tracks how many runs are
   * currently queued or in-flight, used to enforce MAX_QUEUE_DEPTH.
   */
  private chains = new Map<string, SessionChain>()

  constructor(
    private config: AgentConfig,
    private mcpManager: McpManager,
    private connectorManager: ConnectorManager,
  ) {}

  /**
   * Run the agent on a canonical event and return the final text response.
   *
   * If the same session is already mid-flight, this call queues behind the
   * in-flight one and resolves once its turn runs. The router then calls
   * `provider.reply()` with this event's response, preserving FIFO order.
   *
   * Returns an empty string only if the per-session queue is full (we drop
   * to protect memory) — the router treats empty replies as no-op.
   */
  run(event: CanonicalEvent): Promise<string> {
    const existing = this.chains.get(event.sessionId)
    if (existing && existing.depth >= MAX_QUEUE_DEPTH) {
      log.warn({ sessionId: event.sessionId, depth: existing.depth }, 'queue full, dropping event')
      return Promise.resolve('')
    }

    const entry: SessionChain = existing ?? { tail: Promise.resolve(), depth: 0 }
    entry.depth += 1
    const prevTail = entry.tail

    // Use both `then` callbacks so an upstream failure (e.g. previous agent
    // throw) does not poison the queue — every queued event still gets to run.
    const myTurn: Promise<string> = prevTail.then(
      () => this.runOne(event),
      () => this.runOne(event),
    )

    entry.tail = myTurn.finally(() => {
      entry.depth -= 1
      // Drop the chain entry once it's empty, so long-idle sessions don't
      // accumulate. Compare-and-set guards against a racing new arrival
      // having already replaced the tail.
      if (entry.depth <= 0 && this.chains.get(event.sessionId) === entry) {
        this.chains.delete(event.sessionId)
      }
    })
    this.chains.set(event.sessionId, entry)

    return myTurn
  }

  private async runOne(event: CanonicalEvent): Promise<string> {
    const { sessionId } = event
    const started = Date.now()
    log.info(
      { sessionId, provider: event.provider, textBytes: event.text.length },
      'runOne: start',
    )
    try {
      const session = this.getOrCreateSession(sessionId)
      const chunks: string[] = []
      let textEvents = 0
      let totalEvents = 0
      for await (const ev of session.processMessage(event.text)) {
        totalEvents += 1
        if (ev.type === 'text') {
          chunks.push(ev.content)
          textEvents += 1
        }
      }
      const out = sanitizeResponse(chunks.join(''))
      log.info(
        {
          sessionId,
          durationMs: Date.now() - started,
          totalEvents,
          textEvents,
          replyBytes: out.length,
          empty: out.length === 0,
        },
        'runOne: complete',
      )
      return out
    } catch (err) {
      // Catch-and-log so upstream router sees the error surface properly
      // instead of an opaque rejected promise in a `.catch(...)`. Still
      // rethrows so the chain poison-proof handler in run() advances.
      log.error({ err, sessionId, durationMs: Date.now() - started }, 'runOne: threw')
      throw err
    }
  }

  /** Refresh connector tools across all live webhook sessions. */
  refreshAllSessionTools(): void {
    for (const session of this.sessions.values()) {
      session.refreshConnectorTools()
    }
  }

  private getOrCreateSession(sessionId: string): Session {
    let session = this.sessions.get(sessionId)
    if (session) return session

    // resumeSession is a "try to rehydrate" helper — it can throw on
    // corrupted state, version skew, or filesystem errors. Historically we
    // let that propagate into runOne() and the webhook silently failed.
    // Treat any throw the same as "no saved session" and fall through to a
    // fresh createSession so the conversation keeps flowing.
    try {
      session =
        resumeSession(sessionId, this.config, {
          mcpManager: this.mcpManager,
          connectorManager: this.connectorManager,
        }) ?? undefined
    } catch (err) {
      log.warn({ sessionId, err }, 'resumeSession threw, starting fresh')
      session = undefined
    }

    if (!session) {
      session = createSession(sessionId, this.config, {
        mcpManager: this.mcpManager,
        connectorManager: this.connectorManager,
      })
    }

    this.sessions.set(sessionId, session)
    return session
  }
}

/** Strip <think>…</think> blocks that some models emit as raw text. */
function sanitizeResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}
