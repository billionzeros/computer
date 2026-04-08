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
 *   - slash command interception (zero LLM tokens)
 *   - project-aware sessions via webhook bindings
 */

import type { AgentConfig } from '@anton/agent-config'
import {
  buildProjectContext,
  ensureDefaultProject,
  loadProject,
} from '@anton/agent-config'
import type { McpManager, Session, SurfaceInfo } from '@anton/agent-core'
import { createSession, resumeSession } from '@anton/agent-core'
import { executeCommand, type CommandContext } from '@anton/agent-core'
import type { ConnectorManager } from '@anton/connectors'
import { createLogger } from '@anton/logger'
import { extractBindingKey, getBinding, saveBinding, saveModelOverride } from './bindings.js'
import type { CanonicalEvent, OutboundImage, WebhookRunResult } from './provider.js'

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
   * Run the agent on a canonical event and return the turn's reply —
   * final text plus any outbound images the session emitted during the
   * turn (currently: the last browser screenshot, if any).
   *
   * Slash commands (e.g. /help, /project) are intercepted before the
   * queue — zero LLM tokens, instant response.
   *
   * If the same session is already mid-flight, this call queues behind the
   * in-flight one and resolves once its turn runs. The router then calls
   * `provider.reply()` with this event's response, preserving FIFO order.
   *
   * Returns an empty result only if the per-session queue is full (we drop
   * to protect memory) — the router treats empty text + no images as no-op.
   */
  run(event: CanonicalEvent): Promise<WebhookRunResult> {
    // ── Command interception (before queue, before LLM) ──────────
    const cmdResult = this.tryCommand(event)
    if (cmdResult) return Promise.resolve(cmdResult)

    const existing = this.chains.get(event.sessionId)
    if (existing && existing.depth >= MAX_QUEUE_DEPTH) {
      log.warn({ sessionId: event.sessionId, depth: existing.depth }, 'queue full, dropping event')
      return Promise.resolve({ text: '', images: [] })
    }

    const entry: SessionChain = existing ?? { tail: Promise.resolve(), depth: 0 }
    entry.depth += 1
    const prevTail = entry.tail

    // Use both `then` callbacks so an upstream failure (e.g. previous agent
    // throw) does not poison the queue — every queued event still gets to run.
    const myTurn: Promise<WebhookRunResult> = prevTail.then(
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

  private async runOne(event: CanonicalEvent): Promise<WebhookRunResult> {
    const { sessionId } = event
    const started = Date.now()
    const attachmentCount = event.attachments?.length ?? 0
    log.info(
      {
        sessionId,
        provider: event.provider,
        textBytes: event.text.length,
        attachmentCount,
      },
      'runOne: start',
    )
    try {
      const session = this.getOrCreateSession(sessionId, event.surface)
      // Refresh the surface every turn — the same sessionId can span
      // multiple threads/users in a channel, and we want the model to see
      // the up-to-date label. No-op when surface is undefined (desktop).
      if (event.surface) {
        session.setSurface(event.surface)
      }
      const chunks: string[] = []
      let textEvents = 0
      let totalEvents = 0

      let lastBrowserScreenshot: { data: string; url: string; title: string } | null = null
      let browserStateEvents = 0

      const attachments = (event.attachments ?? []) as Parameters<typeof session.processMessage>[1]
      for await (const ev of session.processMessage(event.text, attachments)) {
        totalEvents += 1
        if (ev.type === 'text') {
          chunks.push(ev.content)
          textEvents += 1
        } else if (ev.type === 'tool_call') {
          chunks.length = 0
        } else if (ev.type === 'browser_state') {
          browserStateEvents += 1
          if (ev.screenshot) {
            lastBrowserScreenshot = {
              data: ev.screenshot,
              url: ev.url,
              title: ev.title,
            }
          }
        }
      }
      const out = sanitizeResponse(chunks.join(''))

      const images: OutboundImage[] = []
      if (lastBrowserScreenshot) {
        images.push({
          id: `browser-${Date.now()}`,
          data: lastBrowserScreenshot.data,
          mimeType: 'image/jpeg',
          // Use the page title (or URL as fallback) as the caption so
          // the user sees what they're looking at without the model
          // having to narrate it.
          caption: lastBrowserScreenshot.title || lastBrowserScreenshot.url,
        })
      }

      log.info(
        {
          sessionId,
          durationMs: Date.now() - started,
          totalEvents,
          textEvents,
          browserStateEvents,
          imageCount: images.length,
          replyBytes: out.length,
          empty: out.length === 0 && images.length === 0,
        },
        'runOne: complete',
      )
      return { text: out, images }
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

  /** Remove a session from memory. Next message will create a fresh one. */
  evictSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private getOrCreateSession(sessionId: string, surface?: SurfaceInfo): Session {
    let session = this.sessions.get(sessionId)
    if (session) return session

    // ── Resolve project binding ────────────────────────────────────
    const bindingKey = extractBindingKey(sessionId)
    let binding = getBinding(bindingKey)

    if (!binding) {
      // No binding yet — default to "My Computer"
      const defaultProject = ensureDefaultProject(this.config)
      saveBinding(bindingKey, defaultProject.id)
      binding = { projectId: defaultProject.id }
      log.info({ sessionId, bindingKey, projectId: binding.projectId }, 'bound to default project')
    }

    const { projectId } = binding
    const project = loadProject(projectId)
    const projectContext = project ? buildProjectContext(project, projectId) : undefined
    const projectWorkspacePath = project?.workspacePath
    const projectType = project?.type

    const sessionOpts = {
      mcpManager: this.mcpManager,
      connectorManager: this.connectorManager,
      surface,
      projectId,
      projectContext,
      projectWorkspacePath,
      projectType,
      // Apply model override from binding (e.g. from /model command)
      ...(binding.model ? { model: binding.model } : {}),
    }

    // resumeSession is a "try to rehydrate" helper — it can throw on
    // corrupted state, version skew, or filesystem errors. Historically we
    // let that propagate into runOne() and the webhook silently failed.
    // Treat any throw the same as "no saved session" and fall through to a
    // fresh createSession so the conversation keeps flowing.
    try {
      session = resumeSession(sessionId, this.config, sessionOpts) ?? undefined
    } catch (err) {
      log.warn({ sessionId, err }, 'resumeSession threw, starting fresh')
      session = undefined
    }

    if (!session) {
      session = createSession(sessionId, this.config, sessionOpts)
    }

    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Try to execute a slash command from the event text.
   * Returns null if the text is not a command.
   */
  private tryCommand(event: CanonicalEvent): WebhookRunResult | null {
    const bindingKey = extractBindingKey(event.sessionId)

    const ctx: CommandContext = {
      sessionId: event.sessionId,
      evictSession: () => this.evictSession(event.sessionId),
      getSession: () => this.sessions.get(event.sessionId),
      getProjectId: () => getBinding(bindingKey)?.projectId,
      saveProjectBinding: (projectId: string) => saveBinding(bindingKey, projectId),
      saveModelOverride: (model: string) => saveModelOverride(bindingKey, model),
    }

    const result = executeCommand(event.text, ctx)
    if (!result) return null
    return { text: result.text, images: [] }
  }
}

/** Strip <think>…</think> blocks that some models emit as raw text. */
function sanitizeResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}
