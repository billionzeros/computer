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

import { type AgentConfig, DEFAULT_PROVIDERS } from '@anton/agent-config'
import type {
  CodexHarnessSession,
  CommandContext,
  CommandResult,
  HarnessSession,
  JobActionHandler,
  McpManager,
  Session,
  SurfaceInfo,
} from '@anton/agent-core'
import { createSession, executeCommand, isHarnessSession, resumeSession } from '@anton/agent-core'
import type { ConnectorManager } from '@anton/connectors'
import { createLogger } from '@anton/logger'
import type { TaskItem } from '@anton/protocol'
import { extractBindingKey, getBinding, saveBinding, saveModelOverride } from './bindings.js'
import type {
  CanonicalEvent,
  InlineMenuOpts,
  InlineMenuRef,
  MenuRow,
  OutboundImage,
  WebhookProvider,
  WebhookRunResult,
} from './provider.js'

/**
 * Extra session options resolved per-session by the host (e.g. project-scoped
 * callbacks like onJobAction). The server builds this from webhook bindings
 * so that Telegram/Slack sessions get the same tools as desktop sessions.
 */
export interface WebhookSessionOptions {
  projectId?: string
  projectContext?: string
  projectWorkspacePath?: string
  projectType?: string
  onJobAction?: JobActionHandler
  availableWorkflows?: { name: string; description: string; whenToUse: string }[]
}

/**
 * Callback the server provides to resolve project-scoped session options
 * from a webhook session ID (using bindings to look up the projectId).
 */
export type WebhookSessionOptionsBuilder = (sessionId: string) => WebhookSessionOptions | undefined

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

const APPROVE_KEYWORDS = new Set([
  'yes',
  'y',
  'approve',
  'approved',
  'ok',
  'go',
  'allow',
  'confirm',
])
const REJECT_KEYWORDS = new Set(['no', 'n', 'reject', 'rejected', 'deny', 'denied', 'cancel'])

export function parseApprovalText(text: string): InteractionResponse {
  const normalized = text.trim().toLowerCase()
  if (APPROVE_KEYWORDS.has(normalized)) return { approved: true }
  if (REJECT_KEYWORDS.has(normalized)) return { approved: false }
  // Anything else is treated as rejection with the text as feedback
  // (useful for plan revision — the user's reply becomes the revision instruction).
  return { approved: false, feedback: text.trim() }
}

/**
 * Factory for creating a harness-backed session for a webhook surface.
 * Injected by the server so the runner can build HarnessSession without
 * pulling AgentServer's full wiring into this module.
 */
export type HarnessSessionFactory = (opts: {
  sessionId: string
  providerName: string
  model: string
  projectId?: string
  surface: string
}) => Promise<HarnessSession | CodexHarnessSession>

/**
 * Server-side session teardown hook. The runner holds its own sessions
 * Map for per-surface state (chains, pending interactions, progress),
 * but harness subprocesses and IPC auth live in the server's
 * SessionRegistry + harnessSessionContexts. Dropping the Map entry
 * alone leaks the subprocess; this callback asks the server to run
 * `registry.delete(id)` (which awaits `shutdown()`) and evict the
 * associated IPC/context bookkeeping. Fire-and-forget callers should
 * `void` the returned promise.
 */
export type SessionDisposer = (sessionId: string) => Promise<void>

export class WebhookAgentRunner {
  private sessions = new Map<string, Session | HarnessSession | CodexHarnessSession>()
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

  /** Optional callback to list scheduled jobs (wired by the server). */
  private getSchedulerJobs?: () => {
    name: string
    description: string
    schedule: string
    nextRun: number
    lastRun: number | null
    enabled: boolean
  }[]

  constructor(
    private config: AgentConfig,
    private mcpManager: McpManager,
    private connectorManager: ConnectorManager,
    private sessionOptionsBuilder?: WebhookSessionOptionsBuilder,
    /**
     * Optional — when set, lets the runner create harness-backed
     * sessions (Codex, Claude Code) for webhook surfaces. Without it,
     * harness providers fall back to Pi SDK createSession which throws
     * on harness-only models like "gpt-5.4".
     */
    private harnessSessionFactory?: HarnessSessionFactory,
    /**
     * Optional — when set, session eviction paths (/model switch,
     * switchAllSessionModels, /reset, etc.) call this to have the
     * server drop its SessionRegistry entry + IPC auth + harness
     * context maps. Without it, harness sessions leak their codex/
     * claude-code subprocess on every eviction.
     */
    private sessionDisposer?: SessionDisposer,
  ) {}

  /**
   * Tear down a webhook session on eviction. Handles:
   *   - local Map entry (queue continues to run on the old reference if
   *     mid-turn, which is fine — JS keeps the object alive and the
   *     shutdown() call sequenced by the server registry only triggers
   *     after the queue drains if the subprocess still has in-flight
   *     work)
   *   - pending interactive prompts (clearTimeout + resolve with a
   *     rejection so the blocked generator unblocks cleanly)
   *   - throttled progress-message timers
   *   - server-side registry + IPC auth, via `sessionDisposer`
   *
   * Safe to call on unknown ids; all steps are no-ops when state is
   * absent.
   */
  private async disposeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)

    const pending = this.pendingInteractions.get(sessionId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingInteractions.delete(sessionId)
      // Resolve as rejection so the awaiting handler inside the session
      // generator unblocks instead of hanging until the interaction
      // timeout (up to 24h for plan/ask_user). No feedback text — for
      // plan_confirm and ask_user the feedback field is forwarded to the
      // model as plan-revision input / the first question's answer, and
      // we don't want "Session evicted." to leak into the conversation
      // the way it used to.
      pending.resolve({ approved: false })
    }

    const progress = this.progressStates.get(sessionId)
    if (progress?.pendingTimer) clearTimeout(progress.pendingTimer)
    this.progressStates.delete(sessionId)

    if (this.sessionDisposer) {
      try {
        await this.sessionDisposer(sessionId)
      } catch (err) {
        log.warn({ err, sessionId }, 'sessionDisposer threw — continuing')
      }
    }
  }

  /** Wire access to the scheduler's job list (called by the server after init). */
  setSchedulerJobsProvider(fn: typeof this.getSchedulerJobs): void {
    this.getSchedulerJobs = fn
  }

  /**
   * Try to execute a slash command from the event text. Returns null if the
   * text is not a registered command. Zero-token-cost — no LLM involved.
   */
  tryCommand(sessionId: string, text: string): CommandResult | null {
    const bindingKey = extractBindingKey(sessionId)
    const ctx: CommandContext = {
      sessionId,
      // CommandContext.evictSession is typed `() => void` because the
      // slash-command handlers that call it are synchronous. Fire-and-
      // forget the dispose — the next turn the user sends will create a
      // fresh session, and the ~seconds-long harness shutdown runs in
      // the background.
      evictSession: () => {
        void this.disposeSession(sessionId)
      },
      // CommandContext.getSession is typed for Pi SDK Session — the
      // builtin /model and /status command handlers reach into
      // session.model/provider which both Session and HarnessSession
      // expose, but the type doesn't know that. Erase the harness
      // discriminant so the existing handlers can read those fields
      // without a code change here.
      getSession: () => this.sessions.get(sessionId) as Session | undefined,
      getProjectId: () => getBinding(bindingKey)?.projectId || undefined,
      saveProjectBinding: (projectId) => saveBinding(bindingKey, projectId),
      saveModelOverride: (model) => saveModelOverride(bindingKey, model),
      getModelOverride: () => getBinding(bindingKey)?.model,
      getDefaultModel: () => ({
        provider: this.config.defaults.provider,
        model: this.config.defaults.model,
      }),
      listProviders: () => {
        const defaultProvider = this.config.defaults.provider
        const knownProviders = [
          'anthropic',
          'openai',
          'google',
          'groq',
          'together',
          'openrouter',
          'mistral',
        ]
        return knownProviders.map((name) => ({
          name,
          hasKey: this.hasApiKey(name),
          isDefault: name === defaultProvider,
        }))
      },
      listAgents: () => this.getSchedulerJobs?.() ?? [],
    }
    return executeCommand(text, ctx)
  }

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
    log.info({ sessionId, type: pending.type, approved: response.approved }, 'interaction resolved')
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

    const settled = myTurn.finally(() => {
      entry.depth -= 1
      // Drop the chain entry once it's empty, so long-idle sessions don't
      // accumulate. Compare-and-set guards against a racing new arrival
      // having already replaced the tail.
      if (entry.depth <= 0 && this.chains.get(event.sessionId) === entry) {
        this.chains.delete(event.sessionId)
      }
    })
    // Swallow rejections on the tail itself. The router awaits `myTurn`
    // and handles its rejection; a subsequent event would attach an
    // onRejected handler via `prevTail.then(..., ...)`. But if no next
    // event arrives before the microtask drains, `settled` is a
    // handler-less rejected promise and Node emits an
    // unhandledRejection. The swallow here is decoupled from the chain:
    // subsequent `.then(fn, fn)` still observes the rejection
    // independently.
    settled.catch(() => {})
    entry.tail = settled
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
      const { session, isNew } = await this.getOrCreateSession(sessionId, event.surface)

      // Pre-flight: check if the session's provider has a usable API key.
      // Mirrors the env-var map in Session.resolveApiKey so we can catch this
      // early with a clear message instead of a cryptic SDK error.
      // Skip for harness sessions — they auth through the CLI's own OAuth
      // (Codex login, Claude Code login), not an Anton-managed API key.
      if (!isHarnessSession(session) && !this.hasApiKey(session.provider)) {
        return {
          text: 'No API key configured for your AI provider. Please set one up in Settings \u2192 Providers on the desktop app.',
          images: [],
        }
      }
      // Refresh the surface every turn — the same sessionId can span
      // multiple threads/users in a channel, and we want the model to see
      // the up-to-date label. No-op when surface is undefined (desktop).
      // Harness sessions don't expose setSurface (their surface is baked
      // into the per-turn system prompt at HarnessSession build time);
      // skip silently rather than throw.
      if (event.surface && !isHarnessSession(session)) {
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

      // Wire interactive handlers so tools that need approval work on
      // webhooks. Harness CLIs handle their own approval UX (Codex
      // --full-auto auto-approves, Claude Code has its own flow), so
      // skip for harness sessions.
      if (!isHarnessSession(session)) {
        this.wireInteractiveHandlers(session, sessionId, event, provider)
      }

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
      const prompt = `:warning: *Confirmation required*\n\`\`\`\n${command}\n\`\`\`\n${reason}\n\nReply *yes* to approve or *no* to deny.`
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
      const prompt = `:memo: *Plan: ${title}*\n\n${content}\n\nReply *approve* to proceed, or reply with feedback to revise.`
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
            await this.sendProgressMessage(s, event, provider, s.pendingUpdate, e).catch((err) =>
              log.warn({ err, sessionId }, 'trailing progress update failed'),
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
      // Harness sessions rebuild the tool list per-turn from the
      // registry, so they pick up new connectors automatically — nothing
      // to refresh here.
      if (isHarnessSession(session)) continue
      session.refreshConnectorTools()
    }
  }

  /** Switch all live webhook sessions to a new default provider/model. */
  switchAllSessionModels(provider: string, model: string): void {
    for (const [id, session] of this.sessions) {
      try {
        if (isHarnessSession(session)) {
          // Harness model lives on the session and is read at every CLI
          // spawn, so just mutating the field is enough — the next turn
          // picks it up. Switching providers (codex ↔ claude-code)
          // would need a fresh HarnessSession; dispose so the subprocess
          // is reaped and the next message rebuilds via the factory.
          if (session.provider === provider) {
            session.model = model
          } else {
            void this.disposeSession(id)
          }
        } else {
          session.switchModel(provider, model)
        }
      } catch (err) {
        log.warn({ err, sessionId: id }, 'failed to switch webhook session model')
      }
    }
  }

  // ── Inline menu (button-driven /model selector) ───────────────────

  /**
   * Pre-runOne intercept for interactive flows. Returns true when the
   * event has been handled here and the caller should NOT continue with
   * tryCommand / agent run.
   *
   * Two cases:
   *   1. Stateless menu navigation triggered by a previous button click.
   *      The provider's parseCallbackQuery / handleInteraction tagged the
   *      event with `context.menuAction` + `context.menuRef`.
   *   2. The user typed `/model` with no args on a provider that
   *      implements sendInlineMenu — open the picker as buttons rather
   *      than fall through to the text-based command handler.
   */
  async tryInteractive(event: CanonicalEvent, provider: WebhookProvider): Promise<boolean> {
    const menuAction = event.context.menuAction as string | undefined
    const menuRef = event.context.menuRef as InlineMenuRef | undefined
    if (menuAction && menuRef) {
      await this.handleMenuAction(event.sessionId, menuAction, menuRef, provider)
      return true
    }
    if (event.text.trim() === '/model' && provider.sendInlineMenu) {
      await this.openModelMenu(event, provider)
      return true
    }
    return false
  }

  /** Send the root model menu in response to a fresh `/model` command. */
  private async openModelMenu(event: CanonicalEvent, provider: WebhookProvider): Promise<void> {
    if (!provider.sendInlineMenu) return
    const opts = this.buildModelRootMenu(event.sessionId)
    try {
      await provider.sendInlineMenu(event, opts)
    } catch (err) {
      log.warn({ err, sessionId: event.sessionId }, 'sendInlineMenu failed')
      // Fall back to text reply so the user isn't left wondering.
      await provider.reply(event, opts.body, []).catch(() => {})
    }
  }

  /** Drive a single menu navigation step. Caller already validated provider supports edits. */
  async handleMenuAction(
    sessionId: string,
    action: string,
    ref: InlineMenuRef,
    provider: WebhookProvider,
  ): Promise<void> {
    if (!provider.editInlineMenu) {
      log.warn(
        { provider: provider.slug },
        'menu action received but provider has no editInlineMenu',
      )
      return
    }
    let next: InlineMenuOpts
    if (action === 'm:open') {
      next = this.buildModelRootMenu(sessionId)
    } else if (action.startsWith('m:p:')) {
      next = this.buildProviderModelsMenu(sessionId, action.slice(4))
    } else if (action.startsWith('m:s:')) {
      // Set: action is "m:s:<provider>/<model>" or "m:s:<model>".
      const slug = action.slice(4)
      const slashIdx = slug.indexOf('/')
      const providerName = slashIdx > 0 ? slug.slice(0, slashIdx) : ''
      const modelName = slashIdx > 0 ? slug.slice(slashIdx + 1) : slug
      const bindingKey = extractBindingKey(sessionId)
      saveModelOverride(bindingKey, slug)
      // Drop the live session so the next message recreates it via the
      // override we just saved. Same eviction the text-based /model does.
      // Fire-and-forget: the user's ack message should post immediately;
      // the background shutdown takes ~seconds for harness sessions.
      void this.disposeSession(sessionId)
      next = {
        body: `\u2705 Model set to *${modelName}*${providerName ? ` on *${providerName}*` : ''}.\nYour next message will use it.`,
        rows: [[{ label: '\u2039\u2039 Back', action: 'm:open' }]],
      }
    } else {
      log.warn({ action }, 'unknown menu action')
      return
    }
    try {
      await provider.editInlineMenu(ref, next)
    } catch (err) {
      log.warn({ err, action }, 'editInlineMenu failed')
    }
  }

  /** Root menu: shows current model + a per-provider entry button. */
  private buildModelRootMenu(sessionId: string): InlineMenuOpts {
    const bindingKey = extractBindingKey(sessionId)
    const overrideRaw = getBinding(bindingKey)?.model
    const currentLabel = overrideRaw
      ? overrideRaw
      : `${this.config.defaults.provider}/${this.config.defaults.model}`
    const providers = this.listAvailableProviders()
    const rows: MenuRow[] = []
    // Two providers per row to keep the menu compact.
    for (let i = 0; i < providers.length; i += 2) {
      const row: MenuRow = []
      const a = providers[i]
      if (a) row.push({ label: providerButtonLabel(a), action: `m:p:${a.name}` })
      const b = providers[i + 1]
      if (b) row.push({ label: providerButtonLabel(b), action: `m:p:${b.name}` })
      rows.push(row)
    }
    return {
      body: `Current model: \`${currentLabel}\`\nPick a provider to see its models.`,
      rows,
    }
  }

  /** Drill-down menu: lists a single provider's models, ✓ on the current one. */
  private buildProviderModelsMenu(sessionId: string, providerName: string): InlineMenuOpts {
    const bindingKey = extractBindingKey(sessionId)
    const overrideRaw = getBinding(bindingKey)?.model
    let currentProvider = this.config.defaults.provider
    let currentModel = this.config.defaults.model
    if (overrideRaw) {
      const slashIdx = overrideRaw.indexOf('/')
      if (slashIdx > 0) {
        currentProvider = overrideRaw.slice(0, slashIdx)
        currentModel = overrideRaw.slice(slashIdx + 1)
      } else {
        currentModel = overrideRaw
      }
    }
    const models = this.listModelsForProvider(providerName)
    if (models.length === 0) {
      return {
        body: `No models known for *${providerName}* yet. Use \`/model ${providerName}/<id>\` to set one manually.`,
        rows: [[{ label: '\u2039\u2039 Back', action: 'm:open' }]],
      }
    }
    const rows: MenuRow[] = models.map((m) => [
      {
        label: m === currentModel && providerName === currentProvider ? `${m} \u2713` : m,
        action: `m:s:${providerName}/${m}`,
      },
    ])
    rows.push([{ label: '\u2039\u2039 Back', action: 'm:open' }])
    return {
      body: `*${providerName}* models${
        currentProvider === providerName ? ` (current: ${currentModel})` : ''
      }`,
      rows,
    }
  }

  /**
   * Providers worth showing in the picker. API providers must have a key;
   * harness providers (codex, claude-code) are always shown — they auth
   * via the CLI's own login, not an Anton-managed key.
   */
  private listAvailableProviders(): { name: string; type: 'api' | 'harness' }[] {
    const out: { name: string; type: 'api' | 'harness' }[] = []
    const candidates = [
      'anton',
      'openrouter',
      'anthropic',
      'openai',
      'google',
      'groq',
      'together',
      'mistral',
      'codex',
      'claude-code',
    ]
    for (const name of candidates) {
      const cfg = this.config.providers[name] || DEFAULT_PROVIDERS[name]
      if (!cfg) continue
      if (cfg.type === 'harness') {
        out.push({ name, type: 'harness' })
      } else if (this.hasApiKey(name)) {
        out.push({ name, type: 'api' })
      }
    }
    return out
  }

  /**
   * Static catalog of well-known models per provider. For API providers
   * we read from DEFAULT_PROVIDERS; for harness providers (Codex,
   * Claude Code) we hardcode the commonly available models since the
   * CLI doesn't expose an enumeration over its supported models in a
   * machine-readable form. Empty for unknown providers — caller renders
   * a "set manually" hint in that case.
   */
  private listModelsForProvider(providerName: string): string[] {
    if (providerName === 'codex') {
      return ['gpt-5.4', 'gpt-5.4-mini']
    }
    if (providerName === 'claude-code') {
      return ['claude-sonnet-4.6', 'claude-opus-4.6', 'claude-haiku-4.5']
    }
    const cfg = this.config.providers[providerName] || DEFAULT_PROVIDERS[providerName]
    const models = (cfg as { models?: string[] } | undefined)?.models
    return Array.isArray(models) ? models : []
  }

  /** Check if a provider has an API key in config or environment. */
  private hasApiKey(provider: string): boolean {
    const providerConfig = this.config.providers?.[provider]
    if (providerConfig?.apiKey && providerConfig.apiKey.length > 0) return true

    const envMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      groq: 'GROQ_API_KEY',
      together: 'TOGETHER_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      anton: 'ANTON_API_KEY',
    }
    const envVar = envMap[provider]
    return !!(envVar && process.env[envVar])
  }

  private async getOrCreateSession(
    sessionId: string,
    surface?: SurfaceInfo,
  ): Promise<{ session: Session | HarnessSession | CodexHarnessSession; isNew: boolean }> {
    const existing = this.sessions.get(sessionId)
    if (existing) return { session: existing, isNew: false }

    // Resolve project-scoped options (projectId, onJobAction, etc.) from
    // webhook bindings so the session gets the same tools as desktop sessions.
    const extra = this.sessionOptionsBuilder?.(sessionId)
    if (extra?.projectId) {
      log.info({ sessionId, projectId: extra.projectId }, 'webhook session bound to project')
    }

    // Resolve provider/model. Order:
    //   1. Per-binding override saved by /model (webhook-bindings.json).
    //      Stored as either "provider/model" (preferred) or just "model"
    //      (legacy — assumes default provider).
    //   2. Global config defaults.
    // Without this, /model X silently no-ops on Slack/Telegram because
    // getOrCreateSession previously read only the defaults.
    const bindingKey = extractBindingKey(sessionId)
    const overrideRaw = getBinding(bindingKey)?.model
    let providerName = this.config.defaults.provider
    let model = this.config.defaults.model
    if (overrideRaw) {
      const slashIdx = overrideRaw.indexOf('/')
      if (slashIdx > 0) {
        providerName = overrideRaw.slice(0, slashIdx)
        model = overrideRaw.slice(slashIdx + 1)
      } else {
        // Legacy bare-model override — keep current default provider.
        model = overrideRaw
      }
      log.info({ sessionId, providerName, model }, 'webhook session using model override')
    }

    // ── Harness providers (Codex, Claude Code) ────────────────────────
    // Harness sessions don't go through Pi SDK's resumeSession/createSession
    // (their model isn't in Pi SDK's registry, and history is stored in
    // the harness mirror, not Pi SDK's tape). Delegate to the factory the
    // server injected so the wiring matches desktop harness sessions.
    const providerCfg = this.config.providers[providerName] || DEFAULT_PROVIDERS[providerName]
    if (providerCfg?.type === 'harness') {
      if (!this.harnessSessionFactory) {
        throw new Error(
          `Provider "${providerName}" is harness-backed but no harnessSessionFactory was injected into WebhookAgentRunner`,
        )
      }
      const surfaceLabel = surface?.kind ?? 'webhook'
      const session = await this.harnessSessionFactory({
        sessionId,
        providerName,
        model,
        projectId: extra?.projectId,
        surface: surfaceLabel,
      })
      this.sessions.set(sessionId, session)
      return { session, isNew: true }
    }

    // ── Pi SDK API providers (anton, openrouter, anthropic, …) ────────
    const baseOpts = {
      mcpManager: this.mcpManager,
      connectorManager: this.connectorManager,
      surface,
      // Forward the resolved override so createSession picks it up
      // instead of defaulting to config.defaults.{provider,model}.
      provider: providerName,
      model,
      ...extra,
    }

    // resumeSession is a "try to rehydrate" helper — it can throw on
    // corrupted state, version skew, or filesystem errors. Historically we
    // let that propagate into runOne() and the webhook silently failed.
    // Treat any throw the same as "no saved session" and fall through to a
    // fresh createSession so the conversation keeps flowing.
    let session: Session | undefined
    try {
      session = resumeSession(sessionId, this.config, baseOpts) ?? undefined
    } catch (err) {
      log.warn({ sessionId, err }, 'resumeSession threw, starting fresh')
      session = undefined
    }

    // If the resumed session's provider no longer has a key, switch to the current default
    if (session && !this.hasApiKey(session.provider)) {
      try {
        session.switchModel(this.config.defaults.provider, this.config.defaults.model)
      } catch {
        // fall through — createSession will handle it
      }
    }

    // A resumed session has prior history — treat it as not-new so we
    // don't re-inject thread context the model already saw.
    const isNew = !session

    if (!session) {
      session = createSession(sessionId, this.config, baseOpts)
    }

    this.sessions.set(sessionId, session)
    return { session, isNew }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Display label for a provider button — adds a hint at its auth source. */
function providerButtonLabel(p: { name: string; type: 'api' | 'harness' }): string {
  return p.type === 'harness' ? `${p.name} \u2728` : `${p.name} \ud83d\udd11`
}

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
