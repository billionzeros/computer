/**
 * Session — one pi SDK Agent instance per session.
 *
 * Each session has its own:
 * - Model/provider (can differ from defaults)
 * - Message history (persisted to ~/.anton/sessions/)
 * - Context window management (transformContext hook)
 *
 * pi SDK does the heavy lifting — we just manage lifecycle and persistence.
 */

import type { AgentConfig, PersistedSession, PersistedTaskItem } from '@anton/agent-config'
import {
  ensureConversationDirs,
  getConversationWorkspace,
  getProjectSessionsDir,
  loadProjectTypePrompt,
  loadReferences,
  loadSession,
  loadUserRules,
  loadWorkspaceRules,
  saveSession,
  saveSessionTasks,
} from '@anton/agent-config'
import type { ProjectType } from '@anton/agent-config'
import type { ChatImageAttachmentInput, SessionImageAttachment, TokenUsage } from '@anton/protocol'
import { Agent as PiAgent } from '@mariozechner/pi-agent-core'
import type {
  AgentMessage,
  AgentTool,
  AgentEvent as PiAgentEvent,
} from '@mariozechner/pi-agent-core'
import { completeSimple, getModel } from '@mariozechner/pi-ai'
import type { Api, ImageContent, Model, TextContent } from '@mariozechner/pi-ai'
import {
  type AskUserHandler,
  CORE_SYSTEM_PROMPT,
  type ToolCallbacks,
  buildTools,
} from './agent.js'
import {
  type CompactionConfig,
  type CompactionState,
  compactContext,
  createInitialCompactionState,
  getDefaultCompactionConfig,
} from './compaction.js'
import { type ContextInfo, type MemoryData, assembleConversationContext } from './context.js'
import {
  type Span,
  startTrace,
  startChildTrace,
  estimateCost,
  categorizeError,
  computeHeuristicScores,
  logScore,
  hashPromptVersion,
} from './tracing.js'

export type ConfirmHandler = (command: string, reason: string) => Promise<boolean>
export type PlanConfirmHandler = (
  title: string,
  content: string,
) => Promise<{ approved: boolean; feedback?: string }>

export type ArtifactRenderType = 'code' | 'markdown' | 'html' | 'svg' | 'mermaid'

export type SessionEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; output: string; isError?: boolean }
  | {
      type: 'artifact'
      id: string
      toolCallId: string
      artifactType: 'file' | 'output' | 'artifact'
      renderType: ArtifactRenderType
      title?: string
      filename?: string
      filepath?: string
      language: string
      content: string
    }
  | { type: 'confirm'; id: string; command: string; reason: string }
  | { type: 'compaction'; compactedMessages: number; totalCompactions: number }
  | { type: 'title_update'; title: string }
  | {
      type: 'done'
      usage?: TokenUsage
      cumulativeUsage?: TokenUsage
      provider?: string
      model?: string
    }
  | { type: 'error'; message: string }
  | { type: 'sub_agent_start'; toolCallId: string; task: string }
  | { type: 'sub_agent_end'; toolCallId: string; success: boolean }
  | { type: 'sub_agent_progress'; toolCallId: string; content: string }
  | { type: 'tasks_update'; tasks: import('@anton/protocol').TaskItem[] }
  | { type: 'token_update'; usage: TokenUsage }
  | {
      type: 'browser_state'
      url: string
      title: string
      screenshot?: string
      lastAction: import('@anton/protocol').BrowserAction
      elementCount?: number
    }
  | { type: 'browser_close' }

export interface SessionInfo {
  id: string
  provider: string
  model: string
  title: string
  messageCount: number
  createdAt: number
  lastActiveAt: number
  lastTasks?: import('@anton/agent-config').PersistedTaskItem[]
  usage?: import('@anton/protocol').TokenUsage
}

/** Fallback max messages if compaction fails */
const FALLBACK_MAX_MESSAGES = 100

export class Session {
  readonly id: string
  provider: string
  model: string
  readonly createdAt: number

  private piAgent: PiAgent
  private config: AgentConfig
  private confirmHandler?: ConfirmHandler
  private planConfirmHandler?: PlanConfirmHandler
  private askUserHandler?: AskUserHandler
  _connectorManager?: { getAllTools(): AgentTool[] }
  _mcpManager?: import('./mcp/mcp-manager.js').McpManager
  _toolCallbacks?: Parameters<typeof buildTools>[1]
  private title = ''
  private lastActiveAt: number
  private clientApiKey?: string // client-provided, never persisted
  private lastEmittedTextLength = 0 // track delta for streaming
  // Pending tool calls for artifact detection
  private pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>()
  // Injected event push — set during processMessage so tools can emit events
  private pushEvent?: (event: SessionEvent) => void

  // Token usage tracking
  private lastTurnUsage: TokenUsage | undefined
  private cumulativeUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }

  // Compaction state
  private compactionState: CompactionState
  private compactionConfig: CompactionConfig
  private compactionInProgress = false
  private pendingCompactionEvent: SessionEvent | null = null
  private resolvedModel: Model<Api>
  private ephemeral: boolean
  public projectId?: string
  private projectContext?: string
  private projectType?: string
  private workspacePath?: string
  private memoryData?: MemoryData
  private agentInstructions?: string
  private agentMemory?: string
  private firstMessage?: string
  public contextInfo?: ContextInfo

  // Braintrust tracing
  private parentTraceSpan?: Span // when this is a sub-agent, inherit parent's span
  currentTraceSpan?: Span // current turn's trace span (exposed for sub-agent threading)
  private _promptVersion?: string // hash of assembled system prompt

  // Safety limits
  private maxTokenBudget: number
  private maxDurationMs: number
  private maxTurns: number
  private _turnCount = 0
  private _processStartedAt = 0

  // Last known task tracker state — persisted for resume
  private _lastTasks: PersistedTaskItem[] = []
  // Whether we need to inject task context on the next user message (set on resume)
  private _needsTaskResumeHint = false

  constructor(opts: {
    id: string
    provider: string
    model: string
    config: AgentConfig
    tools: AgentTool[]
    apiKey?: string // client override
    existingMessages?: unknown[] // for session resume
    title?: string
    createdAt?: number
    compactionState?: CompactionState
    ephemeral?: boolean // sub-agent sessions: no persist, no title gen, no compaction
    projectId?: string // scoped to a project
    projectContext?: string // injected into system prompt
    projectType?: string // project type for prompt module loading
    agentInstructions?: string // standing instructions for scheduled agents (injected into system prompt)
    agentMemory?: string // persistent memory from previous runs (injected into system prompt)
    lastTasks?: PersistedTaskItem[] // restored task state from persistence
    // Safety limits
    maxTokenBudget?: number // max total tokens before aborting (0 = unlimited)
    maxDurationMs?: number // max wall-clock time for processMessage (0 = unlimited)
    maxTurns?: number // max LLM turns per processMessage call (0 = unlimited)
    parentTraceSpan?: Span // for sub-agents: nest under parent's trace
  }) {
    this.id = opts.id
    this.provider = opts.provider
    this.model = opts.model
    this.config = opts.config
    this.clientApiKey = opts.apiKey
    this.title = opts.title || ''
    this.createdAt = opts.createdAt || Date.now()
    this.lastActiveAt = Date.now()
    this.ephemeral = opts.ephemeral || false
    this.projectId = opts.projectId
    this.projectContext = opts.projectContext
    this.projectType = opts.projectType
    this.agentInstructions = opts.agentInstructions
    this.agentMemory = opts.agentMemory
    this._lastTasks = opts.lastTasks || []
    // If resuming with incomplete tasks, flag for context injection on next message
    this._needsTaskResumeHint = this._lastTasks.some((t) => t.status !== 'completed')
    this.maxTokenBudget = opts.maxTokenBudget ?? 0
    this.maxDurationMs = opts.maxDurationMs ?? 0
    this.maxTurns = opts.maxTurns ?? 0
    this.parentTraceSpan = opts.parentTraceSpan

    // Set up conversation workspace (skip for ephemeral sub-agents)
    if (!this.ephemeral) {
      ensureConversationDirs(this.id)
      this.workspacePath = getConversationWorkspace(this.id)
    }

    // Initialize compaction
    const configCompaction = opts.config.compaction
    const defaultCompaction = getDefaultCompactionConfig(opts.model)
    this.compactionConfig = {
      enabled: configCompaction?.enabled ?? defaultCompaction.enabled,
      threshold: configCompaction?.threshold ?? defaultCompaction.threshold,
      maxContextTokens: defaultCompaction.maxContextTokens,
      toolOutputMaxTokens:
        configCompaction?.toolOutputMaxTokens ?? defaultCompaction.toolOutputMaxTokens,
      preserveRecentCount:
        configCompaction?.preserveRecentCount ?? defaultCompaction.preserveRecentCount,
    }
    this.compactionState = opts.compactionState || createInitialCompactionState()

    // Runtime strings from config — cast to the SDK's nominal types
    const model = (getModel as (p: string, m: string) => Model<Api> | undefined)(
      opts.provider,
      opts.model,
    )

    if (!model) {
      throw new Error(
        `Unknown model "${opts.model}" for provider "${opts.provider}". Model IDs must exactly match pi SDK's registry. For openrouter, use format like "anthropic/claude-sonnet-4.6" or "MiniMaxAI/MiniMax-M2.5".`,
      )
    }

    this.resolvedModel = model

    this.piAgent = new PiAgent({
      initialState: {
        model,
        systemPrompt: this.getSystemPrompt(),
        tools: opts.tools,
        messages: (opts.existingMessages || []) as AgentMessage[],
        thinkingLevel: 'off',
      },
      // Dynamic API key resolution — called on every LLM call
      getApiKey: async (provider: string) => {
        const key = this.resolveApiKey(provider, this.clientApiKey, this.config)
        if (!key) {
          console.error(
            `[session ${this.id}] No API key found for provider "${provider}". Check config or env vars.`,
          )
        } else {
          console.log(
            `[session ${this.id}] Resolved API key for "${provider}" (${key.slice(0, 8)}...)`,
          )
        }
        return key
      },
      transformContext: async (messages) => {
        try {
          // Prevent re-entrant compaction
          if (this.compactionInProgress) {
            return messages
          }

          this.compactionInProgress = true
          const prevCount = this.compactionState.compactionCount

          const { messages: compacted, state } = await compactContext(
            messages,
            this.compactionState,
            this.compactionConfig,
            this.resolvedModel,
            this.provider,
            async (provider: string) =>
              this.resolveApiKey(provider, this.clientApiKey, this.config),
          )

          this.compactionState = state

          // If compaction happened, queue an event and trace it
          if (state.compactionCount > prevCount) {
            this.pendingCompactionEvent = {
              type: 'compaction',
              compactedMessages: state.compactedMessageCount,
              totalCompactions: state.compactionCount,
            }

            // Braintrust: log compaction as a child span
            if (this.currentTraceSpan) {
              try {
                const compSpan = this.currentTraceSpan.startSpan({ name: 'compaction' })
                compSpan.log({
                  metadata: {
                    messagesBefore: messages.length,
                    messagesAfter: compacted.length,
                    compactedMessageCount: state.compactedMessageCount,
                    layer: state.summary ? 'llm_summarization' : 'tool_trimming',
                    compactionNumber: state.compactionCount,
                  },
                })
                compSpan.end()
              } catch (spanErr) {
                console.error('[tracing] Failed to log compaction span:', spanErr)
              }
            }
          }

          return compacted
        } catch (err) {
          // Safe fallback: sliding window
          console.error('[compaction] Failed, falling back to sliding window:', err)
          if (messages.length > FALLBACK_MAX_MESSAGES) {
            return messages.slice(messages.length - FALLBACK_MAX_MESSAGES)
          }
          return messages
        } finally {
          this.compactionInProgress = false
        }
      },
      beforeToolCall: async (ctx) => {
        // Shell: check for dangerous command patterns
        if (ctx.toolCall.name === 'shell') {
          const args = ctx.args as { command: string }
          const { needsConfirmation } = await import('./tools/shell.js')
          if (needsConfirmation(args.command, this.config.security.confirmPatterns)) {
            if (this.confirmHandler) {
              const approved = await this.confirmHandler(
                args.command,
                'Command matches a dangerous pattern',
              )
              if (!approved) {
                return { block: true, reason: 'Command denied by user.' }
              }
            } else {
              return {
                block: true,
                reason: 'Command requires confirmation but no handler available.',
              }
            }
          }
        }

        // Database: check for destructive SQL (DROP, DELETE, TRUNCATE)
        if (ctx.toolCall.name === 'database') {
          const args = ctx.args as { operation: string; sql?: string }
          if (args.sql) {
            const { isDangerousSql } = await import('./tools/security.js')
            if (isDangerousSql(args.sql)) {
              if (this.confirmHandler) {
                const approved = await this.confirmHandler(
                  args.sql,
                  'SQL statement is destructive (DROP/DELETE/TRUNCATE)',
                )
                if (!approved) {
                  return { block: true, reason: 'SQL statement denied by user.' }
                }
              } else {
                return {
                  block: true,
                  reason: 'Destructive SQL requires confirmation but no handler available.',
                }
              }
            }
          }
        }

        // Filesystem write: check for dangerous target paths
        if (ctx.toolCall.name === 'filesystem') {
          const args = ctx.args as { operation: string; path: string }
          if (args.operation === 'write') {
            const { isDangerousFsWrite } = await import('./tools/security.js')
            if (isDangerousFsWrite(args.path)) {
              if (this.confirmHandler) {
                const approved = await this.confirmHandler(
                  `Write to ${args.path}`,
                  'Writing to a critical system directory',
                )
                if (!approved) {
                  return { block: true, reason: 'File write denied by user.' }
                }
              } else {
                return {
                  block: true,
                  reason: 'Write to system directory requires confirmation but no handler available.',
                }
              }
            }
          }
        }

        // Plan: user approval flow
        if (ctx.toolCall.name === 'plan') {
          const args = ctx.args as { title: string; content: string }
          if (this.planConfirmHandler) {
            const result = await this.planConfirmHandler(args.title, args.content)
            if (!result.approved) {
              return {
                block: true,
                reason: `Plan rejected by user.${result.feedback ? ` Feedback: ${result.feedback}` : ''} Please revise the plan based on the feedback and resubmit.`,
              }
            }
          } else {
            return {
              block: true,
              reason: 'Plan requires user approval but no handler available.',
            }
          }
        }
        return undefined
      },
    })
  }

  setConfirmHandler(handler: ConfirmHandler) {
    this.confirmHandler = handler
  }

  setPlanConfirmHandler(handler: PlanConfirmHandler) {
    this.planConfirmHandler = handler
  }

  setAskUserHandler(handler: AskUserHandler) {
    this.askUserHandler = handler
  }

  /** Get last known task state (for resume). */
  get lastTasks(): PersistedTaskItem[] {
    return this._lastTasks
  }

  /** Check if there are incomplete tasks from a prior turn. */
  hasIncompleteTasks(): boolean {
    return this._lastTasks.some((t) => t.status !== 'completed')
  }

  /** Push a tasks_update event into the live event stream (called by task_tracker tool). */
  emitTasksUpdate(tasks: import('@anton/protocol').TaskItem[]) {
    // Store for persistence and resume
    this._lastTasks = tasks.map((t) => ({
      content: t.content,
      activeForm: t.activeForm,
      status: t.status,
    }))
    // Persist immediately so tasks survive mid-turn disconnects
    if (!this.ephemeral) {
      const basePath = this.projectId ? getProjectSessionsDir(this.projectId) : undefined
      saveSessionTasks(this.id, this._lastTasks, basePath)
    }
    this.pushEvent?.({ type: 'tasks_update', tasks })
  }

  /** Push a browser_state event into the live event stream (called by browser tool). */
  emitBrowserState(state: {
    url: string
    title: string
    screenshot?: string
    lastAction: import('@anton/protocol').BrowserAction
    elementCount?: number
  }) {
    this.pushEvent?.({ type: 'browser_state', ...state })
  }

  /** Push a browser_close event into the live event stream. */
  emitBrowserClose() {
    this.pushEvent?.({ type: 'browser_close' })
  }

  /**
   * Process a user message. Streams events back via async generator.
   * Persists session state after completion.
   */
  async *processMessage(
    userMessage: string,
    attachments: ChatImageAttachmentInput[] = [],
  ): AsyncGenerator<SessionEvent> {
    this.lastActiveAt = Date.now()
    this.lastEmittedTextLength = 0 // reset delta tracking for new turn
    this._turnCount = 0
    this._processStartedAt = Date.now()
    let trimmedMessage = userMessage.trim()
    const hasAttachments = attachments.length > 0

    // If this is a resumed session with incomplete tasks, inject context so the LLM
    // knows where it left off (the user chose auto-continue behavior).
    // Only done once — the flag is cleared after injection.
    if (this._needsTaskResumeHint && this._lastTasks.length > 0) {
      this._needsTaskResumeHint = false
      const taskSummary = this._lastTasks
        .map((t) => {
          const icon =
            t.status === 'completed'
              ? '[DONE]'
              : t.status === 'in_progress'
                ? '[IN PROGRESS]'
                : '[PENDING]'
          return `  ${icon} ${t.content}`
        })
        .join('\n')
      const resumeHint = `\n\n<session_resume_context>\nYou were previously working on a multi-step task. Here is your last known task state:\n${taskSummary}\nPlease continue from where you left off. If you need to pick up an in-progress or pending task, do so now.\n</session_resume_context>`
      trimmedMessage = trimmedMessage + resumeHint
    }

    if (hasAttachments && !this.resolvedModel.input.includes('image')) {
      throw new Error(`Model "${this.model}" does not support image input.`)
    }

    // Auto-generate title from first message (skip for ephemeral sub-agent sessions)
    const isFirstMessage = !this.title && !this.ephemeral
    if (isFirstMessage) {
      this.title = generateSmartTitle(
        trimmedMessage ||
          (hasAttachments
            ? attachments.length === 1
              ? `Image: ${attachments[0].name}`
              : `${attachments.length} images`
            : userMessage),
      )
    }

    // Fire off AI title generation in parallel (non-blocking)
    let aiTitlePromise: Promise<string | null> | null = null
    if (isFirstMessage && trimmedMessage) {
      aiTitlePromise = generateAITitle(
        trimmedMessage,
        this.resolvedModel,
        this.provider,
        async (provider: string) => this.resolveApiKey(provider, this.clientApiKey, this.config),
      ).catch((err) => {
        console.warn('AI title generation failed, keeping regex title:', err.message)
        return null
      })
    }

    const events: SessionEvent[] = []

    // Send initial regex-based title immediately so the client always has one,
    // even if the async AI title generation fails later.
    if (isFirstMessage) {
      events.push({ type: 'title_update', title: this.title })
    }

    let resolveNext: (() => void) | null = null
    let done = false
    let eventCount = 0
    let textEventCount = 0
    let assistantText = ''

    // Braintrust tracing: start a span for this turn (nested under parent if sub-agent)
    const traceSpan = this.parentTraceSpan
      ? startChildTrace(this.parentTraceSpan, {
          name: 'sub-agent-turn',
          input: { message: userMessage, attachments: attachments.length },
          metadata: {
            sessionId: this.id,
            provider: this.provider,
            model: this.model,
            ephemeral: this.ephemeral,
            turnNumber: this._turnCount,
            promptVersion: this._promptVersion,
          },
        })
      : startTrace({
          name: 'agent-turn',
          input: { message: userMessage, attachments: attachments.length },
          metadata: {
            sessionId: this.id,
            provider: this.provider,
            model: this.model,
            ephemeral: this.ephemeral,
            turnNumber: this._turnCount,
            promptVersion: this._promptVersion,
          },
        })
    this.currentTraceSpan = traceSpan ?? undefined
    // Track active tool spans by toolCallId
    const toolSpans = new Map<string, Span>()
    const usedToolNames = new Set<string>()
    let toolCallCount = 0
    let toolErrorCount = 0

    // Allow tools (like task_tracker) to push events into the stream
    this.pushEvent = (ev: SessionEvent) => {
      events.push(ev)
      resolveNext?.()
    }

    const unsub = this.piAgent.subscribe((event: PiAgentEvent) => {
      console.log(`[session ${this.id}] pi event: ${event.type}`)
      // Log detailed info for error diagnosis
      if (event.type === 'turn_end' || event.type === 'agent_end') {
        const msg = (
          event as unknown as { message?: { stopReason?: string; errorMessage?: string } }
        ).message
        if (msg?.stopReason === 'error') {
          console.error(
            `[session ${this.id}] LLM ERROR in ${event.type}: ${msg.errorMessage || 'unknown'}`,
          )
        }
      }
      const translated = this.translateEvent(event)
      for (const ev of translated) {
        eventCount++
        if (ev.type === 'text') {
          textEventCount++
          assistantText += ev.content
        }
        events.push(ev)

        // Braintrust: start a child span for each tool call
        if (traceSpan && ev.type === 'tool_call') {
          usedToolNames.add(ev.name)
          toolCallCount++
          const toolSpan = traceSpan.startSpan({
            name: ev.name,
            event: {
              input: ev.input,
              metadata: { toolCallId: ev.id },
            },
          })
          toolSpans.set(ev.id, toolSpan)
        }

        // Braintrust: end the child span when the tool finishes
        if (traceSpan && ev.type === 'tool_result') {
          if (ev.isError) toolErrorCount++
          const toolSpan = toolSpans.get(ev.id)
          if (toolSpan) {
            toolSpan.log({
              output: ev.output.slice(0, 2000),
              metadata: { isError: ev.isError ?? false },
            })
            toolSpan.end()
            toolSpans.delete(ev.id)
          }
        }
      }
      // Incremental persist: save state after tool completions and turn ends
      // so that if the client disconnects mid-turn, progress is not lost.
      if (event.type === 'tool_execution_end' || event.type === 'turn_end') {
        this.persist()
      }
      if (translated.length > 0) resolveNext?.()
    })

    try {
      const images: ImageContent[] = attachments.map((attachment) => ({
        type: 'image',
        data: attachment.data,
        mimeType: attachment.mimeType,
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
      }))

      this.piAgent
        .prompt(userMessage, images)
        .then(() => {
          done = true
          resolveNext?.()
        })
        .catch((err: Error) => {
          events.push({ type: 'error', message: err.message })
          done = true
          resolveNext?.()
        })

      while (!done || events.length > 0) {
        if (events.length > 0) {
          yield events.shift()!
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve
          })
        }
      }
    } finally {
      unsub()
    }

    // Helper: close the trace span safely — called in normal flow AND finally block
    let spanClosed = false
    const closeTraceSpan = (errorMessage?: string) => {
      if (spanClosed || !traceSpan) return
      spanClosed = true
      try {
        // End any orphaned tool spans
        for (const [, s] of toolSpans) {
          try { s.end() } catch { /* best-effort cleanup */ }
        }
        toolSpans.clear()

        // Cost estimation
        const cost =
          this.lastTurnUsage && this.model
            ? estimateCost(this.model, this.lastTurnUsage)
            : undefined

        traceSpan.log({
          output: assistantText.slice(0, 4000),
          metadata: {
            eventCount,
            textEventCount,
            title: this.title,
            turnNumber: this._turnCount,
            toolsUsed: [...usedToolNames],
            toolCallCount,
            toolErrorCount,
            compactionCount: this.compactionState.compactionCount,
            promptVersion: this._promptVersion,
            ...(errorMessage ? { errorMessage, errorCategory: categorizeError(errorMessage) } : {}),
          },
          metrics: this.lastTurnUsage
            ? {
                inputTokens: this.lastTurnUsage.inputTokens,
                outputTokens: this.lastTurnUsage.outputTokens,
                totalTokens: this.lastTurnUsage.totalTokens,
                ...(cost ? { cost: cost.totalCost } : {}),
              }
            : undefined,
        })

        // Heuristic scores — zero cost, logged on every traced turn
        const heuristics = computeHeuristicScores({
          toolCallCount,
          toolErrorCount,
          responseText: assistantText,
          cost: cost?.totalCost ?? 0,
        })
        logScore(traceSpan, 'tool_success_rate', heuristics.toolSuccessRate)
        logScore(traceSpan, 'response_length', heuristics.responseLength)
        if (cost) logScore(traceSpan, 'cost', cost.totalCost)

        traceSpan.end()
      } catch (spanErr) {
        console.error('[tracing] Failed to close trace span:', spanErr)
      }
      this.currentTraceSpan = undefined
    }

    try {
    // Yield any pending compaction event
    if (this.pendingCompactionEvent) {
      yield this.pendingCompactionEvent
      this.pendingCompactionEvent = null
    }

    // Yield AI-generated title if available and meaningful
    if (aiTitlePromise) {
      const aiTitle = await aiTitlePromise
      // Skip AI title if it's just "New Conversation" — keep the regex title instead
      if (aiTitle && aiTitle.toLowerCase() !== 'new conversation') {
        this.title = aiTitle
        yield { type: 'title_update', title: aiTitle }
      }
    }

    console.log(
      `[session ${this.id}] processMessage complete: ${eventCount} events, ${textEventCount} text chunks`,
    )
    if (eventCount === 0) {
      console.error(
        `[session ${this.id}] WARNING: No events produced! The LLM may not have been called. Check API key.`,
      )
    }

    // Final persist (incremental persists happen during tool_execution_end/turn_end,
    // but this ensures we capture any title or compaction state changes)
    this.persist()

    // Close the trace span in normal flow
    closeTraceSpan()

    yield {
      type: 'done',
      usage: this.lastTurnUsage,
      cumulativeUsage: this.getCumulativeUsage(),
      provider: (this.resolvedModel as unknown as { provider: string }).provider,
      model: (this.resolvedModel as unknown as { id: string }).id,
    }
    } finally {
      // Safety net: ensure trace span is always closed, even on generator abort or exception
      closeTraceSpan('generator_terminated')
    }
  }

  /**
   * Force compaction now (for /compact command).
   * Optionally pass custom instructions for what to focus on.
   */
  async compactNow(customInstructions?: string): Promise<CompactionState> {
    this.compactionInProgress = true
    try {
      const messages = this.piAgent.state.messages
      const forceConfig = { ...this.compactionConfig, threshold: 0 } // force by setting threshold to 0

      const { messages: compacted, state } = await compactContext(
        messages,
        this.compactionState,
        forceConfig,
        this.resolvedModel,
        this.provider,
        async (provider: string) => this.resolveApiKey(provider, this.clientApiKey, this.config),
        customInstructions,
      )

      this.compactionState = state
      this.piAgent.replaceMessages(compacted)
      this.persist()
      return state
    } finally {
      this.compactionInProgress = false
    }
  }

  /** Get current compaction state for status queries. */
  getCompactionState(): CompactionState {
    return { ...this.compactionState }
  }

  /** Get cumulative token usage for this session. */
  getUsage(): TokenUsage {
    return { ...this.cumulativeUsage }
  }

  getCumulativeUsage(): TokenUsage {
    return { ...this.cumulativeUsage }
  }

  /**
   * Switch model mid-session. pi SDK handles this gracefully —
   * keeps all messages, next LLM call uses the new model.
   */
  switchModel(provider: string, model: string): void {
    const newModel = (getModel as (p: string, m: string) => Model<Api>)(provider, model)
    this.piAgent.setModel(newModel)
    this.resolvedModel = newModel
    this.provider = provider
    this.model = model
    this.persist()
  }

  /** Re-build the tools list and push it to the running agent — call after adding/removing a connector. */
  refreshConnectorTools(): void {
    if (!this._toolCallbacks) return
    const newTools = buildTools(
      this.config,
      this._toolCallbacks,
      this._mcpManager,
      this._connectorManager,
    )
    this.piAgent.setTools(newTools)
    console.log(`[session ${this.id}] refreshed tools (${newTools.length} total)`)
  }

  /**
   * Steer the agent mid-run with a user message.
   * The message is queued and delivered after the current tool execution.
   */
  steer(message: string) {
    const wrapped = `<user_steering>\nThe user sent this message while you were working. Briefly acknowledge it (1-2 sentences), share your thought on how it affects your current task, then continue your work incorporating this new context.\n\nUser message: "${message}"\n</user_steering>`
    this.piAgent.steer({
      role: 'user',
      content: [{ type: 'text', text: wrapped }],
      timestamp: Date.now(),
    })
  }

  /** Cancel any running work and persist current state. */
  cancel() {
    this.piAgent.abort()
    this.persist()
  }

  /** Get chat history in a client-friendly format.
   *  Supports pagination: pass `opts.before` to get entries with seq < before,
   *  and `opts.limit` to cap the number of entries returned (from the end).
   */
  getHistory(opts?: { before?: number; limit?: number }): Array<{
    seq: number
    role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
    content: string
    ts: number
    toolName?: string
    toolInput?: Record<string, unknown>
    toolId?: string
    isError?: boolean
    attachments?: SessionImageAttachment[]
  }> {
    const entries: Array<{
      seq: number
      role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
      content: string
      ts: number
      toolName?: string
      toolInput?: Record<string, unknown>
      toolId?: string
      isError?: boolean
      attachments?: SessionImageAttachment[]
    }> = []
    let seq = 0

    type ContentBlock = {
      type: string
      text?: string
      name?: string
      input?: unknown
      arguments?: unknown
      id?: string
      mimeType?: string
      data?: string
      storagePath?: string
      sizeBytes?: number
    }
    type RawMsg = {
      role: string
      content?: string | ContentBlock[]
      timestamp?: number
      toolCallId?: string
      toolName?: string
      isError?: boolean
      tool_use_id?: string
      is_error?: boolean
    }

    const extractText = (content: string | ContentBlock[] | undefined): string => {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      return content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
    }

    const sanitizeAttachmentName = (name: string): string =>
      name
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'image'

    const extensionFromMimeType = (mimeType: string): string => {
      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
        'image/heic': '.heic',
        'image/heif': '.heif',
      }
      return extMap[mimeType] || ''
    }

    const inferStoragePath = (
      messageIndex: number,
      blockIndex: number,
      block: ContentBlock,
    ): string => {
      const rawName = typeof block.name === 'string' ? block.name.trim() : 'image'
      const dot = rawName.lastIndexOf('.')
      const hasExt = dot > 0 && dot < rawName.length - 1
      const base = sanitizeAttachmentName(hasExt ? rawName.slice(0, dot) : rawName)
      const ext = hasExt ? rawName.slice(dot) : extensionFromMimeType(block.mimeType || '')
      return `images/${String(messageIndex + 1).padStart(4, '0')}-${String(blockIndex + 1).padStart(2, '0')}-${base}${ext}`
    }

    const extractAttachments = (
      content: string | ContentBlock[] | undefined,
      messageIndex: number,
    ): SessionImageAttachment[] | undefined => {
      if (!Array.isArray(content)) return undefined
      const attachments = content
        .filter(
          (block) =>
            block.type === 'image' &&
            typeof block.mimeType === 'string' &&
            typeof block.data === 'string',
        )
        .map((block, index) => ({
          id:
            typeof block.storagePath === 'string'
              ? block.storagePath
              : inferStoragePath(messageIndex, index, block),
          name:
            typeof block.name === 'string'
              ? block.name
              : typeof block.storagePath === 'string'
                ? block.storagePath.split('/').pop() || `image-${index + 1}`
                : `image-${index + 1}`,
          mimeType: block.mimeType!,
          storagePath:
            typeof block.storagePath === 'string'
              ? block.storagePath
              : inferStoragePath(messageIndex, index, block),
          sizeBytes: typeof block.sizeBytes === 'number' ? block.sizeBytes : 0,
          data: block.data,
        }))
      return attachments.length > 0 ? attachments : undefined
    }

    for (const [messageIndex, msg] of (this.piAgent.state.messages as RawMsg[]).entries()) {
      if (msg.role === 'user') {
        entries.push({
          seq: ++seq,
          role: 'user',
          content: extractText(msg.content),
          ts: msg.timestamp ?? this.createdAt,
          attachments: extractAttachments(msg.content, messageIndex),
        })
      } else if (msg.role === 'assistant') {
        if (!Array.isArray(msg.content)) continue
        const text = extractText(msg.content)
        if (text) {
          entries.push({
            seq: ++seq,
            role: 'assistant',
            content: text,
            ts: msg.timestamp ?? this.createdAt,
          })
        }

        const toolUses = msg.content.filter((c) => c.type === 'toolCall' || c.type === 'tool_use')
        for (const tu of toolUses) {
          entries.push({
            seq: ++seq,
            role: 'tool_call',
            content: `Running: ${tu.name}`,
            toolName: tu.name,
            toolInput: (tu.arguments ?? tu.input ?? {}) as Record<string, unknown>,
            toolId: tu.id,
            ts: msg.timestamp ?? this.createdAt,
          })
        }
      } else if (msg.role === 'toolResult' || msg.role === 'tool') {
        entries.push({
          seq: ++seq,
          role: 'tool_result',
          content: extractText(msg.content),
          toolId: msg.toolCallId ?? msg.tool_use_id,
          toolName: msg.toolName,
          isError: msg.isError ?? msg.is_error,
          ts: msg.timestamp ?? this.createdAt,
          attachments: extractAttachments(msg.content, messageIndex),
        })
      }
    }

    // Apply pagination if requested
    if (opts) {
      let filtered = entries
      if (opts.before !== undefined) {
        filtered = filtered.filter((e) => e.seq < opts.before!)
      }
      if (opts.limit !== undefined && filtered.length > opts.limit) {
        filtered = filtered.slice(-opts.limit)
      }
      return filtered
    }

    return entries
  }

  /** Extract artifacts from full history (tool_call/tool_result pairs).
   *  Used for paginated sync — client gets all artifacts without needing all messages.
   */
  getArtifacts(): Array<{
    id: string
    type: 'file' | 'output' | 'artifact'
    renderType: string
    title?: string
    filename?: string
    filepath?: string
    language: string
    content: string
    toolCallId: string
  }> {
    const entries = this.getHistory()
    const artifacts: Array<{
      id: string
      type: 'file' | 'output' | 'artifact'
      renderType: string
      title?: string
      filename?: string
      filepath?: string
      language: string
      content: string
      toolCallId: string
    }> = []

    // Build tool_call map
    const toolCalls = new Map<string, (typeof entries)[0]>()
    for (const e of entries) {
      if (e.role === 'tool_call' && e.toolId) {
        toolCalls.set(e.toolId, e)
      }
    }

    // Match tool_results to their calls and extract artifacts
    for (const e of entries) {
      if (e.role !== 'tool_result' || !e.toolId || e.isError) continue
      const call = toolCalls.get(e.toolId)
      if (!call || !call.toolName) continue

      const toolInput = call.toolInput || {}

      // Explicit artifact tool
      if (call.toolName === 'artifact') {
        const artifactType = (toolInput.type as string) || 'code'
        artifacts.push({
          id: `artifact_tc_${call.toolId}`,
          type: 'artifact',
          renderType: artifactType,
          title: toolInput.title as string,
          filename: toolInput.filename as string | undefined,
          filepath: toolInput.filename as string | undefined,
          language:
            artifactType === 'code' ? (toolInput.language as string) || 'text' : artifactType,
          content: (toolInput.content as string) || '',
          toolCallId: `tc_${call.toolId}`,
        })
      }

      // File writes
      if (call.toolName === 'filesystem' && toolInput.operation === 'write' && toolInput.content) {
        const filepath = toolInput.path as string
        const filename = filepath?.split('/').pop() || 'untitled'
        const ext = filename.split('.').pop()?.toLowerCase() || ''
        const langMap: Record<string, string> = {
          html: 'html',
          css: 'css',
          js: 'javascript',
          ts: 'typescript',
          tsx: 'typescript',
          jsx: 'javascript',
          py: 'python',
          md: 'markdown',
          json: 'json',
          svg: 'svg',
          sh: 'bash',
          yml: 'yaml',
          yaml: 'yaml',
        }
        const renderMap: Record<string, string> = {
          html: 'html',
          svg: 'svg',
          md: 'markdown',
          markdown: 'markdown',
        }
        const language = langMap[ext] || ext || 'text'
        artifacts.push({
          id: `artifact_tc_${call.toolId}`,
          type: 'file',
          renderType: renderMap[language] || 'code',
          filename,
          filepath,
          language,
          content: toolInput.content as string,
          toolCallId: `tc_${call.toolId}`,
        })
      }

      // Large shell outputs
      if (call.toolName === 'shell' && e.content && e.content.length > 500) {
        const cmd = (toolInput.command as string) || 'output'
        const shortCmd = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd
        artifacts.push({
          id: `artifact_tc_${call.toolId}`,
          type: 'output',
          renderType: 'code',
          filename: shortCmd,
          language: 'text',
          content: e.content,
          toolCallId: `tc_${call.toolId}`,
        })
      }
    }

    // Deduplicate by filepath (keep latest)
    const seen = new Map<string, number>()
    for (let i = 0; i < artifacts.length; i++) {
      if (artifacts[i].filepath) {
        seen.set(artifacts[i].filepath!, i)
      }
    }
    return artifacts.filter((a, i) => !a.filepath || seen.get(a.filepath) === i)
  }

  /** Get session info for listing. */
  getInfo(): SessionInfo {
    return {
      id: this.id,
      provider: this.provider,
      model: this.model,
      title: this.title,
      messageCount: this.piAgent.state.messages.length,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      lastTasks: this._lastTasks.length > 0 ? this._lastTasks : undefined,
      usage: this.cumulativeUsage.totalTokens > 0 ? this.getCumulativeUsage() : undefined,
    }
  }

  /** Persist session state to disk. Skipped for ephemeral (sub-agent) sessions. */
  private persist(): void {
    if (this.ephemeral) return
    const persisted: PersistedSession = {
      id: this.id,
      provider: this.provider,
      model: this.model,
      messages: this.piAgent.state.messages as unknown[],
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      title: this.title,
      compactionState: this.compactionState,
      lastTasks: this._lastTasks.length > 0 ? this._lastTasks : undefined,
      usage: this.cumulativeUsage.totalTokens > 0 ? this.getCumulativeUsage() : undefined,
    }
    const basePath = this.projectId ? getProjectSessionsDir(this.projectId) : undefined
    saveSession(persisted, basePath)
  }

  private translateEvent(piEvent: PiAgentEvent): SessionEvent[] {
    switch (piEvent.type) {
      case 'message_update': {
        const msg = piEvent.message
        if (msg.role === 'assistant') {
          const textParts = msg.content.filter((c): c is TextContent => c.type === 'text')
          if (textParts.length > 0) {
            const fullText = textParts.map((c) => c.text).join('')
            if (fullText.length > this.lastEmittedTextLength) {
              const delta = fullText.slice(this.lastEmittedTextLength)
              this.lastEmittedTextLength = fullText.length
              return [{ type: 'text', content: delta }]
            }
          }
        }
        return []
      }

      case 'tool_execution_start':
        this.pendingToolCalls.set(piEvent.toolCallId, {
          name: piEvent.toolName,
          input: piEvent.args || {},
        })
        return [
          {
            type: 'tool_call',
            id: piEvent.toolCallId,
            name: piEvent.toolName,
            input: piEvent.args || {},
          },
        ]

      case 'tool_execution_end': {
        const resultContent = piEvent.result?.content as
          | { type: string; text?: string }[]
          | undefined
        const output =
          resultContent
            ?.filter((c) => c.type === 'text')
            ?.map((c) => c.text ?? '')
            ?.join('\n') ?? ''

        const result: SessionEvent[] = [
          {
            type: 'tool_result',
            id: piEvent.toolCallId,
            output,
            isError: piEvent.isError,
          },
        ]

        // Detect and emit artifact event after tool_result
        const toolCall = this.pendingToolCalls.get(piEvent.toolCallId)
        this.pendingToolCalls.delete(piEvent.toolCallId)
        if (toolCall && !piEvent.isError) {
          const artifact = this.detectArtifact(
            piEvent.toolCallId,
            toolCall.name,
            toolCall.input,
            output,
          )
          if (artifact) result.push(artifact)
        }

        return result
      }

      case 'turn_end': {
        const msg = piEvent.message as unknown as Record<string, Record<string, number>> & {
          stopReason?: string
          errorMessage?: string
        }
        if (msg?.usage) {
          const u = msg.usage
          this.lastTurnUsage = {
            inputTokens: u.input ?? 0,
            outputTokens: u.output ?? 0,
            totalTokens: u.totalTokens ?? 0,
            cacheReadTokens: u.cacheRead ?? 0,
            cacheWriteTokens: u.cacheWrite ?? 0,
          }
          this.cumulativeUsage.inputTokens += this.lastTurnUsage.inputTokens
          this.cumulativeUsage.outputTokens += this.lastTurnUsage.outputTokens
          this.cumulativeUsage.totalTokens += this.lastTurnUsage.totalTokens
          this.cumulativeUsage.cacheReadTokens += this.lastTurnUsage.cacheReadTokens
          this.cumulativeUsage.cacheWriteTokens += this.lastTurnUsage.cacheWriteTokens
        }
        // Surface LLM errors (e.g. invalid API key, rate limits) that the pi SDK captures
        if (msg?.stopReason === 'error' && msg?.errorMessage) {
          console.error(`[session ${this.id}] LLM error: ${msg.errorMessage}`)
        }
        // Emit streaming token update so the client can show live counters
        const events: SessionEvent[] = [
          { type: 'token_update' as const, usage: this.getCumulativeUsage() },
        ]
        // If the LLM call failed, emit an error event so the client shows the real reason
        if (msg?.stopReason === 'error') {
          events.push({
            type: 'error',
            message: msg.errorMessage || 'The LLM call failed with an unknown error.',
          })
        }

        // Track turns for limit enforcement
        this._turnCount++

        // Enforce token budget
        if (this.maxTokenBudget > 0 && this.cumulativeUsage.totalTokens > this.maxTokenBudget) {
          this.cancel()
          events.push({
            type: 'error',
            message: `Token budget exceeded: ${this.cumulativeUsage.totalTokens}/${this.maxTokenBudget} tokens`,
          })
        }

        // Enforce max turns
        if (this.maxTurns > 0 && this._turnCount >= this.maxTurns) {
          this.cancel()
          events.push({
            type: 'error',
            message: `Max turns reached: ${this._turnCount}/${this.maxTurns}`,
          })
        }

        // Enforce max duration
        if (
          this.maxDurationMs > 0 &&
          this._processStartedAt > 0 &&
          Date.now() - this._processStartedAt > this.maxDurationMs
        ) {
          this.cancel()
          events.push({
            type: 'error',
            message: `Max duration exceeded: ${Math.round((Date.now() - this._processStartedAt) / 1000)}s`,
          })
        }

        return events
      }

      case 'agent_end': {
        const endMessages = (
          piEvent as unknown as { messages?: Array<{ errorMessage?: string; stopReason?: string }> }
        ).messages
        // Check ALL messages for errors — the error is typically on the assistant response,
        // not the first message (which is the user prompt)
        if (endMessages) {
          for (const m of endMessages) {
            if (m.errorMessage) {
              return [{ type: 'error', message: m.errorMessage }]
            }
          }
        }
        return []
      }

      default:
        return []
    }
  }

  /** Detect if a tool call produced an artifact. */
  private detectArtifact(
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    output: string,
  ): SessionEvent | null {
    const EXT_MAP: Record<string, string> = {
      md: 'markdown',
      mdx: 'markdown',
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      json: 'json',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      html: 'html',
      css: 'css',
      svg: 'xml',
      sql: 'sql',
      sh: 'bash',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      txt: 'text',
    }

    function langFromPath(path: string): string {
      const ext = path.split('.').pop()?.toLowerCase() || ''
      return EXT_MAP[ext] || 'text'
    }

    function langToRenderType(lang: string): ArtifactRenderType {
      if (lang === 'markdown') return 'markdown'
      if (lang === 'html') return 'html'
      return 'code'
    }

    // Explicit artifact tool
    if (toolName === 'artifact') {
      const artType = (toolInput.type as string) || 'code'
      const language = artType === 'code' ? (toolInput.language as string) || 'text' : artType
      return {
        type: 'artifact',
        id: `artifact_${toolCallId}_${Date.now()}`,
        toolCallId,
        artifactType: 'artifact',
        renderType: artType as ArtifactRenderType,
        title: toolInput.title as string,
        filename: toolInput.filename as string | undefined,
        filepath: toolInput.filename as string | undefined,
        language,
        content: toolInput.content as string,
      }
    }

    // File writes
    if (toolName === 'filesystem' && toolInput.operation === 'write' && toolInput.content) {
      const filepath = toolInput.path as string
      const filename = filepath?.split('/').pop() || 'untitled'
      const language = langFromPath(filepath || '')
      return {
        type: 'artifact',
        id: `artifact_${toolCallId}_${Date.now()}`,
        toolCallId,
        artifactType: 'file',
        renderType: langToRenderType(language),
        filename,
        filepath,
        language,
        content: toolInput.content as string,
      }
    }

    // Large shell outputs — only show when genuinely useful, not routine commands
    if (toolName === 'shell' && output.length > 500) {
      const cmd = (toolInput.command as string) || 'output'

      // Skip routine/exploratory commands whose output isn't artifact-worthy
      const SKIP_PATTERNS = [
        /^\s*ls\b/, // directory listings
        /^\s*find\b/, // file search results
        /^\s*cat\b/, // file dumps (already readable inline or via filesystem)
        /^\s*head\b/, // partial file reads
        /^\s*tail\b/, // partial file reads
        /^\s*echo\b/, // echo output
        /^\s*pwd\b/, // working directory
        /^\s*whoami\b/, // user info
        /^\s*env\b/, // environment dump
        /^\s*printenv\b/, // environment dump
        /^\s*set\b/, // shell variables
        /^\s*df\b/, // disk usage
        /^\s*du\b/, // directory sizes
        /^\s*free\b/, // memory info
        /^\s*top\b/, // process list
        /^\s*ps\b/, // process list
        /^\s*uname\b/, // system info
        /^\s*which\b/, // command location
        /^\s*whereis\b/, // command location
        /^\s*file\b/, // file type info
        /^\s*wc\b/, // word/line count
        /^\s*grep\b/, // search results
        /^\s*rg\b/, // search results
        /^\s*tree\b/, // directory tree
        /^\s*stat\b/, // file stats
        /^\s*mount\b/, // mount points
        /^\s*ip\b/, // network config
        /^\s*ifconfig\b/, // network config
        /^\s*netstat\b/, // network stats
        /^\s*ss\b/, // socket stats
        /^\s*systemctl\s+(status|list)/, // service status
        /^\s*apt\s+list/, // package listing
        /^\s*dpkg\s+-l/, // package listing
        /^\s*brew\s+list/, // package listing
        /^\s*pip\s+list/, // package listing
        /^\s*npm\s+list/, // package listing
        /^\s*docker\s+(ps|images|container\s+ls)/, // docker listings
      ]
      if (SKIP_PATTERNS.some((p) => p.test(cmd))) return null

      const shortCmd = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd
      return {
        type: 'artifact',
        id: `artifact_${toolCallId}_${Date.now()}`,
        toolCallId,
        artifactType: 'output',
        renderType: 'code',
        filename: shortCmd,
        language: 'text',
        content: output,
      }
    }

    return null
  }

  /**
   * Resolve API key with priority: client override > config > env var.
   */
  private resolveApiKey(
    provider: string,
    clientKey?: string,
    config?: AgentConfig,
  ): string | undefined {
    // 1. Client-provided key (highest priority)
    if (clientKey) return clientKey

    // 2. Config file key
    const providerConfig = config?.providers?.[provider]
    if (providerConfig?.apiKey) return providerConfig.apiKey

    // 3. Environment variable fallback
    const envMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      groq: 'GROQ_API_KEY',
      together: 'TOGETHER_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      mistral: 'MISTRAL_API_KEY',
    }
    const envVar = envMap[provider]
    if (envVar && process.env[envVar]) return process.env[envVar]

    return undefined
  }

  /**
   * Wrap content in a <system-reminder> tag with a heading.
   * Returns empty string if content is blank (avoids empty tags).
   */
  private static systemReminder(heading: string, content: string): string {
    const trimmed = content.trim()
    if (!trimmed) return ''
    return `\n\n<system-reminder>\n# ${heading}\n${trimmed}\n</system-reminder>`
  }

  /** Get the full composed system prompt. Used internally and exposed for dev mode inspection. */
  getComposedSystemPrompt(): string {
    return this.getSystemPrompt()
  }

  private getSystemPrompt(): string {
    // Layer 0: Core system prompt — self-contained behavioral instructions.
    // Identical for all deployments. Works perfectly even if all other layers are empty.
    let prompt = CORE_SYSTEM_PROMPT

    prompt +=
      '\n\nContextual information, rules, and memory are provided in <system-reminder> tags below. These are injected by the system and should be treated as trusted context. Priority order: workspace rules > user rules > memory > other context.'

    // Layer 1: Workspace rules (.anton.md) — highest priority contextual layer
    if (this.workspacePath) {
      const workspaceRules = loadWorkspaceRules(this.workspacePath)
      prompt += Session.systemReminder('Workspace Rules', workspaceRules)
    }

    // Layer 2: User rules (append.md + rules/*.md from ~/.anton/prompts/)
    prompt += Session.systemReminder('User Rules', loadUserRules())

    // Layer 3: Current context — workspace, project, date
    const contextLines: string[] = []
    if (this.workspacePath) {
      contextLines.push(`- Workspace: ${this.workspacePath}/`)
      contextLines.push(
        'Use this directory for any files you need to create or store during this conversation.',
      )
    }
    if (this.projectContext) {
      contextLines.push(this.projectContext)
    }
    contextLines.push(`- Date: ${new Date().toISOString().split('T')[0]}`)
    prompt += Session.systemReminder('Current Context', contextLines.join('\n'))

    // Layer 4: Memory — global, conversation, and cross-conversation
    if (this.memoryData) {
      const memSections: string[] = []
      if (this.memoryData.globalMemories.length > 0) {
        memSections.push('## Global Memory')
        for (const mem of this.memoryData.globalMemories) {
          memSections.push(`### ${mem.key}\n${mem.content}`)
        }
      }
      if (this.memoryData.conversationMemories.length > 0) {
        memSections.push('## Conversation Memory')
        for (const mem of this.memoryData.conversationMemories) {
          memSections.push(`### ${mem.key}\n${mem.content}`)
        }
      }
      if (this.memoryData.crossConversationMemories.length > 0) {
        memSections.push('## Relevant Context (from other conversations)')
        for (const mem of this.memoryData.crossConversationMemories) {
          memSections.push(`### ${mem.key} (from: ${mem.source})\n${mem.content}`)
        }
      }
      prompt += Session.systemReminder('Memory', memSections.join('\n\n'))
    }

    // Layer 5: Project memory instructions
    if (this.projectId) {
      prompt += Session.systemReminder(
        'Project Memory Instructions',
        `When you have completed meaningful work in this session (e.g. implemented a feature, fixed a bug, made a significant decision), call the update_project_context tool once near the end of the conversation with:
- session_summary: A 1-2 sentence summary of what was accomplished
- project_summary: An updated overall project summary (only if something significant changed about the project's state, goals, or architecture)
Do not call this on every turn — only once per session when there is something worth remembering.`,
      )
    }

    // Layer 6: Agent context — standing instructions + run history (scheduled agents only)
    if (this.agentInstructions || this.agentMemory) {
      const agentSections: string[] = []
      if (this.agentInstructions) {
        agentSections.push(
          `## Standing Instructions\nYou are a scheduled agent. Execute these instructions on every run.\nDo NOT re-create scripts or tooling that you have already built in previous runs. Re-use existing work.\nIf something is broken, fix it. If everything works, just run it.\n\n${this.agentInstructions}`,
        )
      }
      if (this.agentMemory) {
        agentSections.push(
          `## Run History\nThis is your memory from previous runs. Use it to know what you've already built, where scripts are, and what happened last time. Do NOT rebuild things that already exist.\n\n${this.agentMemory}`,
        )
      }
      prompt += Session.systemReminder('Agent Context', agentSections.join('\n\n'))
    }

    // Layer 7: Project type guidelines (code.md, document.md, etc.)
    if (this.projectType) {
      const typePrompt = loadProjectTypePrompt(this.projectType as ProjectType)
      if (typePrompt) {
        prompt += Session.systemReminder('Project Type Guidelines', typePrompt)
      }
    }

    // Layer 8: Reference knowledge — auto-selected coding guides
    const refs = loadReferences({
      projectType: this.projectType,
      firstMessage: this.firstMessage,
    })
    if (refs) {
      prompt += Session.systemReminder('Reference Knowledge', refs)
    }

    // Layer 9: Active skills
    if (this.config.skills.length > 0) {
      let skillBlock = ''
      for (const skill of this.config.skills) {
        skillBlock += `### ${skill.name}\n${skill.description}\n${skill.prompt}\n\n`
      }
      prompt += Session.systemReminder('Active Skills', skillBlock)
    }

    // Compute prompt version hash for tracing
    this._promptVersion = hashPromptVersion(prompt)

    return prompt
  }

  /**
   * Load conversation context (memories) for this session.
   * Call after construction with the first user message for cross-conversation matching.
   */
  loadConversationContext(firstMessage?: string): ContextInfo | undefined {
    if (firstMessage) this.firstMessage = firstMessage
    if (this.ephemeral) return undefined
    const { memoryData, contextInfo } = assembleConversationContext(
      this.id,
      firstMessage,
      this.projectId,
    )
    this.memoryData = memoryData
    this.contextInfo = contextInfo
    // Update system prompt with new context
    this.piAgent.setSystemPrompt(this.getSystemPrompt())
    return contextInfo
  }
}

/**
 * Create a new session from scratch.
 */
/** Sub-agent event callback — events from child agents, tagged with parent tool call ID. */
export type SubAgentEventHandler = (event: SessionEvent & { parentToolCallId: string }) => void

export function createSession(
  id: string,
  config: AgentConfig,
  opts?: {
    provider?: string
    model?: string
    apiKey?: string
    onSubAgentEvent?: SubAgentEventHandler
    ephemeral?: boolean
    projectId?: string
    projectContext?: string
    projectWorkspacePath?: string
    projectType?: string
    mcpManager?: import('./mcp/mcp-manager.js').McpManager
    connectorManager?: { getAllTools(): import('@mariozechner/pi-agent-core').AgentTool[] }
    onJobAction?: import('./tools/job.js').JobActionHandler
    onDeliverResult?: import('./tools/deliver-result.js').DeliverResultHandler
    maxDurationMs?: number
    /** Domain for the agent (e.g. "slug.antoncomputer.in"). Passed to publish tool. */
    domain?: string
    /** Standing instructions for scheduled agents (injected into system prompt) */
    agentInstructions?: string
    /** Persistent memory from previous agent runs */
    agentMemory?: string
  },
): Session {
  const provider = opts?.provider || config.defaults.provider
  const model = opts?.model || config.defaults.model

  // Holder lets the ask_user tool call the handler set later via setAskUserHandler
  const handlerRef: { askUser?: AskUserHandler } = {}
  const confirmRef: { handler?: ConfirmHandler } = {}
  const sessionRef: { session?: Session } = {}

  const toolCallbacks: ToolCallbacks = {
    getAskUserHandler: () => handlerRef.askUser,
    onSubAgentEvent: opts?.onSubAgentEvent,
    getConfirmHandler: () => confirmRef.handler,
    getParentTraceSpan: () => sessionRef.session?.currentTraceSpan,
    clientApiKey: opts?.apiKey,
    conversationId: opts?.ephemeral ? undefined : id,
    onTasksUpdate: (tasks) => {
      sessionRef.session?.emitTasksUpdate(tasks)
    },
    onBrowserState: (state) => {
      sessionRef.session?.emitBrowserState(state)
    },
    onBrowserClose: () => {
      sessionRef.session?.emitBrowserClose()
    },
    defaultWorkingDirectory: opts?.projectWorkspacePath,
    projectId: opts?.projectId,
    onJobAction: opts?.onJobAction,
    onDeliverResult: opts?.onDeliverResult,
    domain: opts?.domain,
  }

  const session = new Session({
    id,
    provider,
    model,
    config,
    tools: buildTools(config, toolCallbacks, opts?.mcpManager, opts?.connectorManager),
    apiKey: opts?.apiKey,
    ephemeral: opts?.ephemeral,
    projectId: opts?.projectId,
    projectContext: opts?.projectContext,
    projectType: opts?.projectType,
    agentInstructions: opts?.agentInstructions,
    agentMemory: opts?.agentMemory,
    maxDurationMs: opts?.maxDurationMs,
  })
  sessionRef.session = session
  session._connectorManager = opts?.connectorManager
  session._mcpManager = opts?.mcpManager
  session._toolCallbacks = toolCallbacks
  // Wire: when setAskUserHandler is called on session, update the holder
  const origSet = session.setAskUserHandler.bind(session)
  session.setAskUserHandler = (handler: AskUserHandler) => {
    handlerRef.askUser = handler
    origSet(handler)
  }
  // Wire: confirm handler ref so sub-agents can use the parent's handler
  const origConfirmSet = session.setConfirmHandler.bind(session)
  session.setConfirmHandler = (handler: ConfirmHandler) => {
    confirmRef.handler = handler
    origConfirmSet(handler)
  }
  return session
}

/**
 * Resume a persisted session from disk.
 * Returns null if session doesn't exist.
 */
export function resumeSession(
  id: string,
  config: AgentConfig,
  opts?: {
    onSubAgentEvent?: SubAgentEventHandler
    projectId?: string
    projectContext?: string
    projectWorkspacePath?: string
    projectType?: string
    mcpManager?: import('./mcp/mcp-manager.js').McpManager
    connectorManager?: { getAllTools(): import('@mariozechner/pi-agent-core').AgentTool[] }
    onJobAction?: import('./tools/job.js').JobActionHandler
    onDeliverResult?: import('./tools/deliver-result.js').DeliverResultHandler
    maxDurationMs?: number
    agentInstructions?: string
    agentMemory?: string
  },
): Session | null {
  const basePath = opts?.projectId ? getProjectSessionsDir(opts.projectId) : undefined
  const persisted = loadSession(id, basePath)
  if (!persisted) return null

  const handlerRef: { askUser?: AskUserHandler } = {}
  const confirmRef: { handler?: ConfirmHandler } = {}
  const sessionRef: { session?: Session } = {}

  const toolCallbacks: ToolCallbacks = {
    getAskUserHandler: () => handlerRef.askUser,
    onSubAgentEvent: opts?.onSubAgentEvent,
    getConfirmHandler: () => confirmRef.handler,
    getParentTraceSpan: () => sessionRef.session?.currentTraceSpan,
    conversationId: persisted.id,
    onTasksUpdate: (tasks) => {
      sessionRef.session?.emitTasksUpdate(tasks)
    },
    onBrowserState: (state) => {
      sessionRef.session?.emitBrowserState(state)
    },
    onBrowserClose: () => {
      sessionRef.session?.emitBrowserClose()
    },
    defaultWorkingDirectory: opts?.projectWorkspacePath,
    projectId: opts?.projectId,
    onJobAction: opts?.onJobAction,
    onDeliverResult: opts?.onDeliverResult,
  }

  const session = new Session({
    id: persisted.id,
    provider: persisted.provider,
    model: persisted.model,
    config,
    tools: buildTools(config, toolCallbacks, opts?.mcpManager, opts?.connectorManager),
    existingMessages: persisted.messages,
    title: persisted.title,
    createdAt: persisted.createdAt,
    compactionState: persisted.compactionState || undefined,
    projectId: opts?.projectId,
    projectContext: opts?.projectContext,
    projectType: opts?.projectType,
    agentInstructions: opts?.agentInstructions,
    agentMemory: opts?.agentMemory,
    lastTasks: persisted.lastTasks,
    maxDurationMs: opts?.maxDurationMs,
  })
  sessionRef.session = session
  session._connectorManager = opts?.connectorManager
  session._mcpManager = opts?.mcpManager
  session._toolCallbacks = toolCallbacks

  // Load conversation context on resume
  session.loadConversationContext()
  const origSet = session.setAskUserHandler.bind(session)
  session.setAskUserHandler = (handler: AskUserHandler) => {
    handlerRef.askUser = handler
    origSet(handler)
  }
  const origConfirmSet = session.setConfirmHandler.bind(session)
  session.setConfirmHandler = (handler: ConfirmHandler) => {
    confirmRef.handler = handler
    origConfirmSet(handler)
  }
  return session
}

/**
 * Generate a concise, descriptive title from the first user message.
 * Strips filler/greetings, extracts the core intent.
 */
function generateSmartTitle(text: string): string {
  let cleaned = text.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ')
  if (!cleaned) return 'New conversation'

  // Strip greeting prefixes
  cleaned = cleaned
    .replace(
      /^(hey|hi|hello|yo|sup|ok|okay|please|can you|could you|i want to|i need to|i'd like to|help me|let's|let me)\b[,!.\s]*/i,
      '',
    )
    .trim()

  if (!cleaned) cleaned = text.trim().replace(/\n/g, ' ')

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[.!?]+$/, '').trim()

  // Extract question topic
  const qMatch = cleaned.match(
    /^(?:what|how|why|where|when|which|who|is|are|can|do|does|will|should|would)\s+(.+)/i,
  )
  if (qMatch) {
    const topic = qMatch[1].replace(/^(?:the|a|an|i|we|you)\s+/i, '').trim()
    return smartCap(smartTruncate(topic, 40))
  }

  // Capitalize and truncate
  return smartCap(smartTruncate(cleaned, 40))
}

function smartTruncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.lastIndexOf(' ')
  return last > max * 0.6 ? `${cut.slice(0, last)}...` : `${cut}...`
}

function smartCap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

const TITLE_MAX_LENGTH = 40

const TITLE_SYSTEM_PROMPT = `Generate a short conversation title from the user's first message. Output ONLY the title, nothing else. Rules:
- Maximum 5 words and 40 characters
- No quotes, no punctuation at the end
- Capitalize like a headline
- If it's just a greeting, output "New Conversation"
- Be specific but brief`

/**
 * Use the LLM to generate a meaningful conversation title from the first message.
 */
async function generateAITitle(
  text: string,
  model: Model<Api>,
  provider: string,
  getApiKey: (provider: string) => Promise<string | undefined>,
): Promise<string> {
  const apiKey = await getApiKey(provider)

  const result = await completeSimple(
    model,
    {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text, timestamp: Date.now() }],
    },
    { apiKey },
  )

  let title = result.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    // Clean up any quotes or trailing punctuation the model might add
    .replace(/^["']|["']$/g, '')
    .replace(/[.!?]+$/, '')
    .trim()

  // Hard cap: truncate at word boundary
  if (title.length > TITLE_MAX_LENGTH) {
    const truncated = title.slice(0, TITLE_MAX_LENGTH)
    const lastSpace = truncated.lastIndexOf(' ')
    title = lastSpace > TITLE_MAX_LENGTH * 0.5 ? truncated.slice(0, lastSpace) : truncated
  }

  return title || 'New Conversation'
}
