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

import type { AgentConfig, PersistedSession } from '@anton/agent-config'
import { loadSession, saveSession } from '@anton/agent-config'
import type { TokenUsage } from '@anton/protocol'
import { Agent as PiAgent } from '@mariozechner/pi-agent-core'
import type {
  AgentMessage,
  AgentTool,
  AgentEvent as PiAgentEvent,
} from '@mariozechner/pi-agent-core'
import { completeSimple, getModel } from '@mariozechner/pi-ai'
import type { Api, Model, TextContent } from '@mariozechner/pi-ai'
import { type AskUserHandler, SYSTEM_PROMPT, buildTools } from './agent.js'
import {
  type CompactionConfig,
  type CompactionState,
  compactContext,
  createInitialCompactionState,
  getDefaultCompactionConfig,
} from './compaction.js'

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

export interface SessionInfo {
  id: string
  provider: string
  model: string
  title: string
  messageCount: number
  createdAt: number
  lastActiveAt: number
}

/** Fallback max messages if compaction fails */
const FALLBACK_MAX_MESSAGES = 100

export class Session {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly createdAt: number

  private piAgent: PiAgent
  private config: AgentConfig
  private confirmHandler?: ConfirmHandler
  private planConfirmHandler?: PlanConfirmHandler
  private askUserHandler?: AskUserHandler
  private title = ''
  private lastActiveAt: number
  private clientApiKey?: string // client-provided, never persisted
  private lastEmittedTextLength = 0 // track delta for streaming
  // Pending tool calls for artifact detection
  private pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>()

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
  }) {
    this.id = opts.id
    this.provider = opts.provider
    this.model = opts.model
    this.config = opts.config
    this.clientApiKey = opts.apiKey
    this.title = opts.title || ''
    this.createdAt = opts.createdAt || Date.now()
    this.lastActiveAt = Date.now()

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

          // If compaction happened, queue an event
          if (state.compactionCount > prevCount) {
            this.pendingCompactionEvent = {
              type: 'compaction',
              compactedMessages: state.compactedMessageCount,
              totalCompactions: state.compactionCount,
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

  /**
   * Process a user message. Streams events back via async generator.
   * Persists session state after completion.
   */
  async *processMessage(userMessage: string): AsyncGenerator<SessionEvent> {
    this.lastActiveAt = Date.now()
    this.lastEmittedTextLength = 0 // reset delta tracking for new turn

    // Auto-generate title from first message
    const isFirstMessage = !this.title
    if (isFirstMessage) {
      this.title = generateSmartTitle(userMessage)
    }

    // Fire off AI title generation in parallel (non-blocking)
    let aiTitlePromise: Promise<string | null> | null = null
    if (isFirstMessage) {
      aiTitlePromise = generateAITitle(
        userMessage,
        this.resolvedModel,
        this.provider,
        async (provider: string) => this.resolveApiKey(provider, this.clientApiKey, this.config),
      ).catch((err) => {
        console.warn('AI title generation failed, keeping regex title:', err.message)
        return null
      })
    }

    const events: SessionEvent[] = []
    let resolveNext: (() => void) | null = null
    let done = false
    let eventCount = 0
    let textEventCount = 0

    const unsub = this.piAgent.subscribe((event: PiAgentEvent) => {
      console.log(`[session ${this.id}] pi event: ${event.type}`)
      const translated = this.translateEvent(event)
      for (const ev of translated) {
        eventCount++
        if (ev.type === 'text') textEventCount++
        events.push(ev)
      }
      if (translated.length > 0) resolveNext?.()
    })

    try {
      this.piAgent
        .prompt(userMessage)
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

    // Yield any pending compaction event
    if (this.pendingCompactionEvent) {
      yield this.pendingCompactionEvent
      this.pendingCompactionEvent = null
    }

    // Yield AI-generated title if available
    if (aiTitlePromise) {
      const aiTitle = await aiTitlePromise
      if (aiTitle) {
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

    // Persist after each turn
    this.persist()

    yield {
      type: 'done',
      usage: this.lastTurnUsage,
      cumulativeUsage: this.getCumulativeUsage(),
      provider: (this.resolvedModel as unknown as { provider: string }).provider,
      model: (this.resolvedModel as unknown as { id: string }).id,
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

  private getCumulativeUsage(): TokenUsage {
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
    this.persist()
  }

  /** Cancel any running work. */
  cancel() {
    // pi Agent handles abort internally
  }

  /** Get chat history in a client-friendly format. */
  getHistory(): Array<{
    seq: number
    role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
    content: string
    ts: number
    toolName?: string
    toolInput?: Record<string, unknown>
    toolId?: string
    isError?: boolean
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
    }> = []
    let seq = 0

    type ContentBlock = { type: string; text?: string; name?: string; input?: unknown; id?: string }
    type RawMsg = {
      role: string
      content: string | ContentBlock[]
      tool_use_id?: string
      is_error?: boolean
    }

    for (const msg of this.piAgent.state.messages as RawMsg[]) {
      if (msg.role === 'user') {
        const text = Array.isArray(msg.content)
          ? msg.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('')
          : String(msg.content)
        entries.push({ seq: ++seq, role: 'user', content: text, ts: this.createdAt })
      } else if (msg.role === 'assistant') {
        if (!Array.isArray(msg.content)) continue
        // Extract text parts
        const textParts = msg.content.filter((c) => c.type === 'text')
        if (textParts.length > 0) {
          const text = textParts.map((c) => c.text ?? '').join('')
          entries.push({ seq: ++seq, role: 'assistant', content: text, ts: this.createdAt })
        }
        // Extract tool use parts
        const toolUses = msg.content.filter((c) => c.type === 'tool_use')
        for (const tu of toolUses) {
          entries.push({
            seq: ++seq,
            role: 'tool_call',
            content: `Running: ${tu.name}`,
            toolName: tu.name,
            toolInput: tu.input as Record<string, unknown>,
            toolId: tu.id,
            ts: this.createdAt,
          })
        }
      } else if (msg.role === 'tool') {
        const content = Array.isArray(msg.content)
          ? msg.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('')
          : String(msg.content || '')
        entries.push({
          seq: ++seq,
          role: 'tool_result',
          content,
          toolId: msg.tool_use_id,
          isError: msg.is_error,
          ts: this.createdAt,
        })
      }
    }

    return entries
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
    }
  }

  /** Persist session state to disk. */
  private persist(): void {
    const persisted: PersistedSession = {
      id: this.id,
      provider: this.provider,
      model: this.model,
      messages: this.piAgent.state.messages as unknown[],
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      title: this.title,
      compactionState: this.compactionState,
    }
    saveSession(persisted)
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
        const msg = piEvent.message as unknown as Record<string, Record<string, number>>
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
        return []
      }

      case 'agent_end': {
        const endMessages = (piEvent as unknown as { messages?: Array<{ errorMessage?: string }> })
          .messages
        const errorMessage = endMessages?.[0]?.errorMessage
        if (errorMessage) {
          return [{ type: 'error', message: errorMessage }]
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

  private getSystemPrompt(): string {
    let prompt = SYSTEM_PROMPT
    if (this.config.skills.length > 0) {
      prompt += '\n\n## Active Skills\n'
      for (const skill of this.config.skills) {
        prompt += `\n### ${skill.name}\n${skill.description}\n${skill.prompt}\n`
      }
    }
    return prompt
  }
}

/**
 * Create a new session from scratch.
 */
export function createSession(
  id: string,
  config: AgentConfig,
  opts?: { provider?: string; model?: string; apiKey?: string },
): Session {
  const provider = opts?.provider || config.defaults.provider
  const model = opts?.model || config.defaults.model

  // Holder lets the ask_user tool call the handler set later via setAskUserHandler
  const handlerRef: { askUser?: AskUserHandler } = {}
  const session = new Session({
    id,
    provider,
    model,
    config,
    tools: buildTools(config, { getAskUserHandler: () => handlerRef.askUser }),
    apiKey: opts?.apiKey,
  })
  // Wire: when setAskUserHandler is called on session, update the holder
  const origSet = session.setAskUserHandler.bind(session)
  session.setAskUserHandler = (handler: AskUserHandler) => {
    handlerRef.askUser = handler
    origSet(handler)
  }
  return session
}

/**
 * Resume a persisted session from disk.
 * Returns null if session doesn't exist.
 */
export function resumeSession(id: string, config: AgentConfig): Session | null {
  const persisted = loadSession(id)
  if (!persisted) return null

  const handlerRef: { askUser?: AskUserHandler } = {}
  const session = new Session({
    id: persisted.id,
    provider: persisted.provider,
    model: persisted.model,
    config,
    tools: buildTools(config, { getAskUserHandler: () => handlerRef.askUser }),
    existingMessages: persisted.messages,
    title: persisted.title,
    createdAt: persisted.createdAt,
    compactionState: persisted.compactionState || undefined,
  })
  const origSet = session.setAskUserHandler.bind(session)
  session.setAskUserHandler = (handler: AskUserHandler) => {
    handlerRef.askUser = handler
    origSet(handler)
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
