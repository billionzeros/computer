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
 *   - interactive handlers (confirm, plan, ask_user) via text-based approval
 *   - progress updates for long-running tasks
 */

import type { AgentConfig } from '@anton/agent-config'
import type { McpManager, Session, SurfaceInfo } from '@anton/agent-core'
import { createSession, resumeSession } from '@anton/agent-core'
import type { ConnectorManager } from '@anton/connectors'
import { createLogger } from '@anton/logger'
import type { TaskItem } from '@anton/protocol'
import type { CanonicalEvent, OutboundImage, WebhookProvider, WebhookRunResult } from './provider.js'

const log = createLogger('webhook-runner')

/**
 * Maximum number of events queued per session before we start dropping.
 * Picked small enough that a runaway producer can't OOM us, but large enough
 * to absorb a normal burst (e.g. a user sending three quick messages while
 * the agent is mid-response).
 */
const MAX_QUEUE_DEPTH = 5

/** Minimum interval between progress message edits (Slack rate limits). */
const PROGRESS_THROTTLE_MS = 3000

/** Timeouts for interactive handlers. */
const CONFIRM_TIMEOUT_MS = 60_000
const PLAN_TIMEOUT_MS = 24 * 60 * 60 * 1000
const ASK_USER_TIMEOUT_MS = 24 * 60 * 60 * 1000

interface SessionChain {
  tail: Promise<unknown>
  depth: number
}

// ── Pending interaction types ────────────────────────────────────────

export interface InteractionResponse {
  approved: boolean
  feedback?: string
  answers?: Record<string, string>
}

interface PendingInteraction {
  type: 'confirm' | 'plan_confirm' | 'ask_user'
  resolve: (response: InteractionResponse) => void
  timeout: ReturnType<typeof setTimeout>
}

// ── Progress tracking ────────────────────────────────────────────────

interface ProgressState {
  messageId?: string
  lastSentAt: number
  pendingUpdate: TaskItem[] | null
  pendingTimer?: ReturnType<typeof setTimeout>
}

// ── Approval text parsing ────────────────────────────────────────────

const APPROVE_KEYWORDS = new Set(['yes', 'y', 'approve', 'approved', 'ok', 'go', 'allow', 'confirm'])
const REJECT_KEYWORDS = new Set(['no', 'n', 'reject', 'rejected', 'deny', 'denied', 'cancel'])

export function parseApprovalText(text: string): InteractionResponse {
  const normalized = text.trim().toLowerCase()
  if (APPROVE_KEYWORDS.has(normalized)) return { approved: true }
  if (REJECT_KEYWORDS.has(normalized)) return { approved: false }
  // Anything else is treated as rejection with the text as feedback
  // (useful for plan revision — the user's reply becomes the revision instruction).
  return { approved: false, feedback: text.trim() }
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

  /**
   * Pending interactive prompts — keyed by sessionId. Only one can exist per
   * session at a time because the session generator is blocked waiting for
   * the handler to resolve.
   */
  private pendingInteractions = new Map<string, PendingInteraction>()

  /** Progress message state per session — tracks message IDs for editing. */
  private progressStates = new Map<string, ProgressState>()

  constructor(
    private config: AgentConfig,
    private mcpManager: McpManager,
    private connectorManager: ConnectorManager,
  ) {}

  /** Check if a session has a pending interaction awaiting user response. */
  hasPendingInteraction(sessionId: string): boolean {
    return this.pendingInteractions.has(sessionId)
  }

  /**
   * Resolve a pending interaction for a session. Called when the user responds
   * via text reply, button click, or callback query. Returns true if an
   * interaction was pending and resolved.
   */
  resolveInteraction(sessionId: string, response: InteractionResponse): boolean {
    const pending = this.pendingInteractions.get(sessionId)
    if (!pending) return false
    clearTimeout(pending.timeout)
    this.pendingInteractions.delete(sessionId)
    log.info(
      { sessionId, type: pending.type, approved: response.approved },
      'interaction resolved',
    )
    pending.resolve(response)
    return true
  }

  /**
   * Run the agent on a canonical event and return the turn's reply —
   * final text plus any outbound images the session emitted during the
   * turn (currently: the last browser screenshot, if any).
   *
   * If this session has a pending interaction (confirm, plan, ask_user),
   * the incoming message is parsed as an approval/rejection response and
   * routed to the pending handler instead of creating a new agent turn.
   *
   * If the same session is already mid-flight, this call queues behind the
   * in-flight one and resolves once its turn runs. The router then calls
   * `provider.reply()` with this event's response, preserving FIFO order.
   *
   * Returns an empty result only if the per-session queue is full (we drop
   * to protect memory) — the router treats empty text + no images as no-op.
   */
  run(event: CanonicalEvent, provider: WebhookProvider): Promise<WebhookRunResult> {
    // If there's a pending interaction, intercept this message as a response
    // instead of feeding it to the agent as a new turn.
    if (this.hasPendingInteraction(event.sessionId)) {
      const response = parseApprovalText(event.text)
      this.resolveInteraction(event.sessionId, response)
      return Promise.resolve({ text: '', images: [] })
    }

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
      () => this.runOne(event, provider),
      () => this.runOne(event, provider),
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

  private async runOne(
    event: CanonicalEvent,
    provider: WebhookProvider,
  ): Promise<WebhookRunResult> {
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
      const { session, isNew } = this.getOrCreateSession(sessionId, event.surface)
      // Refresh the surface every turn — the same sessionId can span
      // multiple threads/users in a channel, and we want the model to see
      // the up-to-date label. No-op when surface is undefined (desktop).
      if (event.surface) {
        // For brand-new sessions joining a thread, inject prior thread
        // messages into the surface so the model sees them in the system
        // prompt (not baked into user message history). Subsequent turns
        // rebuild the surface from their own event data, so this naturally
        // drops off after turn 1.
        const threadContext = event.context.threadContext as string | undefined
        if (isNew && threadContext) {
          event.surface.details = event.surface.details ?? {}
          event.surface.details['thread context'] = threadContext
        }
        session.setSurface(event.surface)
      }

      // Wire interactive handlers so tools that need approval work on webhooks.
      this.wireInteractiveHandlers(session, sessionId, event, provider)

      const chunks: string[] = []
      const errorMessages: string[] = []
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
        } else if (ev.type === 'error') {
          errorMessages.push(ev.message)
        } else if (ev.type === 'tasks_update') {
          this.handleTasksUpdate(sessionId, event, provider, ev.tasks, started).catch((err) => {
            log.warn({ err, sessionId }, 'progress update failed (non-fatal)')
          })
        } else if (ev.type === 'sub_agent_start') {
          this.sendSubAgentMessage(provider, event, `Starting: ${ev.task}`).catch((err) => {
            log.warn({ err, sessionId }, 'sub_agent_start message failed')
          })
        } else if (ev.type === 'sub_agent_end') {
          const status = ev.success ? 'Completed' : 'Failed'
          this.sendSubAgentMessage(provider, event, status).catch((err) => {
            log.warn({ err, sessionId }, 'sub_agent_end message failed')
          })
        }
      }

      // Flush any pending throttled progress update.
      this.flushProgress(sessionId)

      let out = sanitizeResponse(chunks.join(''))

      // If the agent produced no text but there were errors, surface them.
      if (out.length === 0 && errorMessages.length > 0) {
        out = errorMessages.map((m) => `Error: ${m}`).join('\n')
      }

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
          errorCount: errorMessages.length,
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

  // ── Interactive handlers ─────────────────────────────────────────────

  /**
   * Wire confirm, plan, and ask_user handlers on a webhook session. These
   * send a prompt message to the user via the provider and block the session
   * generator until the user responds (intercepted by `run()`).
   */
  private wireInteractiveHandlers(
    session: Session,
    sessionId: string,
    event: CanonicalEvent,
    provider: WebhookProvider,
  ): void {
    session.setConfirmHandler(async (command, reason) => {
      // Phase 3: prefer buttons if provider supports them
      if (provider.sendConfirmPrompt) {
        const interactionId = `c_${Date.now()}`
        await provider.sendConfirmPrompt(event, interactionId, command, reason)
        const response = await this.waitForInteraction(sessionId, 'confirm', CONFIRM_TIMEOUT_MS)
        return response.approved
      }
      // Phase 1 fallback: text-based approval
      const prompt =
        `:warning: *Confirmation required*\n\`\`\`\n${command}\n\`\`\`\n${reason}\n\nReply *yes* to approve or *no* to deny.`
      await provider.reply(event, prompt, [])
      const response = await this.waitForInteraction(sessionId, 'confirm', CONFIRM_TIMEOUT_MS)
      return response.approved
    })

    session.setPlanConfirmHandler(async (title, content) => {
      // Phase 3: prefer buttons if provider supports them
      if (provider.sendPlanForApproval) {
        const interactionId = `plan_${Date.now()}`
        await provider.sendPlanForApproval(event, interactionId, title, content)
        const response = await this.waitForInteraction(sessionId, 'plan_confirm', PLAN_TIMEOUT_MS)
        return { approved: response.approved, feedback: response.feedback }
      }
      // Phase 1 fallback: text-based approval
      const prompt =
        `:memo: *Plan: ${title}*\n\n${content}\n\nReply *approve* to proceed, or reply with feedback to revise.`
      await provider.reply(event, prompt, [])
      const response = await this.waitForInteraction(sessionId, 'plan_confirm', PLAN_TIMEOUT_MS)
      return { approved: response.approved, feedback: response.feedback }
    })

    session.setAskUserHandler(async (questions) => {
      const lines = questions.map((q, i) => {
        const opts = q.options?.length
          ? `\n   Options: ${q.options.map((o) => (typeof o === 'string' ? o : o.label)).join(', ')}`
          : ''
        return `${i + 1}. ${q.question}${opts}`
      })
      const prompt = `:question: *Questions:*\n${lines.join('\n')}\n\nPlease reply with your answers.`
      await provider.reply(event, prompt, [])
      const response = await this.waitForInteraction(sessionId, 'ask_user', ASK_USER_TIMEOUT_MS)
      // For text-based responses, map the single reply to the first question.
      if (response.answers) return response.answers
      if (response.feedback && questions.length > 0) {
        return { [questions[0].question]: response.feedback }
      }
      return {}
    })
  }

  /**
   * Create a pending interaction promise. The session generator blocks on
   * this until the user responds (via text or button) or the timeout fires.
   */
  private waitForInteraction(
    sessionId: string,
    type: PendingInteraction['type'],
    timeoutMs: number,
  ): Promise<InteractionResponse> {
    return new Promise<InteractionResponse>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingInteractions.get(sessionId)?.resolve === resolve) {
          this.pendingInteractions.delete(sessionId)
          log.info({ sessionId, type, timeoutMs }, 'interaction timed out')
          resolve({ approved: false, feedback: 'Timed out waiting for response.' })
        }
      }, timeoutMs)
      // Ensure the timeout doesn't keep the process alive.
      timeout.unref?.()

      this.pendingInteractions.set(sessionId, { type, resolve, timeout })
      log.info({ sessionId, type, timeoutMs }, 'waiting for interaction')
    })
  }

  // ── Progress updates ───────────────────────────────────────────────

  /**
   * Handle a tasks_update event from the session. Posts or edits a progress
   * message in the user's thread. Throttled to one edit per PROGRESS_THROTTLE_MS.
   */
  private async handleTasksUpdate(
    sessionId: string,
    event: CanonicalEvent,
    provider: WebhookProvider,
    tasks: TaskItem[],
    turnStarted: number,
  ): Promise<void> {
    if (!provider.sendMessage) return

    let state = this.progressStates.get(sessionId)
    if (!state) {
      state = { lastSentAt: 0, pendingUpdate: null }
      this.progressStates.set(sessionId, state)
    }

    const now = Date.now()
    const elapsed = Math.round((now - turnStarted) / 1000)

    if (now - state.lastSentAt >= PROGRESS_THROTTLE_MS) {
      await this.sendProgressMessage(state, event, provider, tasks, elapsed)
    } else {
      // Throttled — store latest state and schedule a trailing update.
      state.pendingUpdate = tasks
      if (!state.pendingTimer) {
        const remaining = PROGRESS_THROTTLE_MS - (now - state.lastSentAt)
        state.pendingTimer = setTimeout(async () => {
          const s = this.progressStates.get(sessionId)
          if (s?.pendingUpdate) {
            const e = Math.round((Date.now() - turnStarted) / 1000)
            await this.sendProgressMessage(s, event, provider, s.pendingUpdate, e).catch(
              (err) => log.warn({ err, sessionId }, 'trailing progress update failed'),
            )
            s.pendingUpdate = null
          }
          if (s) s.pendingTimer = undefined
        }, remaining)
        state.pendingTimer.unref?.()
      }
    }
  }

  private async sendProgressMessage(
    state: ProgressState,
    event: CanonicalEvent,
    provider: WebhookProvider,
    tasks: TaskItem[],
    elapsedSeconds: number,
  ): Promise<void> {
    const text = formatProgressText(tasks, elapsedSeconds)
    if (state.messageId && provider.editMessage) {
      await provider.editMessage(event, state.messageId, text)
    } else if (provider.sendMessage) {
      state.messageId = await provider.sendMessage(event, text)
    }
    state.lastSentAt = Date.now()
  }

  /** Flush any pending throttled progress update for a session. */
  private flushProgress(sessionId: string): void {
    const state = this.progressStates.get(sessionId)
    if (state?.pendingTimer) {
      clearTimeout(state.pendingTimer)
      state.pendingTimer = undefined
    }
    // Clean up — the turn is done, the progress message stays as-is.
    this.progressStates.delete(sessionId)
  }

  /** Send a sub-agent status message (fire-and-forget). */
  private async sendSubAgentMessage(
    provider: WebhookProvider,
    event: CanonicalEvent,
    text: string,
  ): Promise<void> {
    if (provider.sendMessage) {
      await provider.sendMessage(event, text)
    }
  }

  // ── Session lifecycle ──────────────────────────────────────────────

  /** Refresh connector tools across all live webhook sessions. */
  refreshAllSessionTools(): void {
    for (const session of this.sessions.values()) {
      session.refreshConnectorTools()
    }
  }

  private getOrCreateSession(
    sessionId: string,
    surface?: SurfaceInfo,
  ): { session: Session; isNew: boolean } {
    const existing = this.sessions.get(sessionId)
    if (existing) return { session: existing, isNew: false }

    // resumeSession is a "try to rehydrate" helper — it can throw on
    // corrupted state, version skew, or filesystem errors. Historically we
    // let that propagate into runOne() and the webhook silently failed.
    // Treat any throw the same as "no saved session" and fall through to a
    // fresh createSession so the conversation keeps flowing.
    let session: Session | undefined
    try {
      session =
        resumeSession(sessionId, this.config, {
          mcpManager: this.mcpManager,
          connectorManager: this.connectorManager,
          surface,
        }) ?? undefined
    } catch (err) {
      log.warn({ sessionId, err }, 'resumeSession threw, starting fresh')
      session = undefined
    }

    // A resumed session has prior history — treat it as not-new so we
    // don't re-inject thread context the model already saw.
    const isNew = !session

    if (!session) {
      session = createSession(sessionId, this.config, {
        mcpManager: this.mcpManager,
        connectorManager: this.connectorManager,
        surface,
      })
    }

    this.sessions.set(sessionId, session)
    return { session, isNew }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Strip <think>…</think> blocks that some models emit as raw text. */
function sanitizeResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

/** Format task list as a progress status message. */
function formatProgressText(tasks: TaskItem[], elapsedSeconds: number): string {
  const lines: string[] = []
  let completedCount = 0
  for (const task of tasks) {
    if (task.status === 'completed') {
      lines.push(`:white_check_mark: ${task.content}`)
      completedCount += 1
    } else if (task.status === 'in_progress') {
      lines.push(`:hourglass_flowing_sand: ${task.activeForm ?? task.content}...`)
    } else {
      lines.push(`:white_circle: ${task.content}`)
    }
  }
  if (tasks.length > 0) {
    lines.push('')
    lines.push(`Step ${completedCount + 1}/${tasks.length} | ${elapsedSeconds}s elapsed`)
  }
  return lines.join('\n')
}
