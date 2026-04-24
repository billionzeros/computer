/**
 * Context compaction — Claude Code-style two-layer context management.
 *
 * Layer 1: Trim verbose tool outputs (file reads, command outputs)
 * Layer 2: LLM-summarize older conversation turns
 *
 * Called from Session's transformContext hook before every LLM call.
 */

import { createLogger } from '@anton/logger'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

const log = createLogger('compaction')
import { completeSimple } from '@mariozechner/pi-ai'
import type {
  Api,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@mariozechner/pi-ai'
import { COMPACTION_SYSTEM_PROMPT, buildCompactionUserPrompt } from './compaction-prompt.js'

// ── Types ───────────────────────────────────────────────────────────

export interface CompactionConfig {
  enabled: boolean
  /** Fraction of context window that triggers compaction (default: 0.80) */
  threshold: number
  /** Max context window in tokens (inferred from model, fallback 128000) */
  maxContextTokens: number
  /** Max tokens per tool result before trimming (default: 4000) */
  toolOutputMaxTokens: number
  /** Number of recent messages to always keep verbatim (default: 20) */
  preserveRecentCount: number
}

export interface CompactionState {
  summary: string | null
  compactedMessageCount: number
  lastCompactedAt: number | null
  compactionCount: number
}

// ── Token estimation ────────────────────────────────────────────────

/**
 * Estimate tokens for a single message.
 * Uses ~4 chars per token heuristic (provider-agnostic).
 */
export function estimateMessageTokens(msg: AgentMessage): number {
  // Only process LLM message types
  const m = msg as Message
  if (!m.role) return 0

  let chars = 0

  if (m.role === 'user') {
    const user = m as UserMessage
    if (typeof user.content === 'string') {
      chars = user.content.length
    } else if (Array.isArray(user.content)) {
      for (const block of user.content) {
        if (block.type === 'text') chars += block.text.length
      }
    }
  } else if (m.role === 'assistant') {
    for (const block of m.content) {
      if (block.type === 'text') chars += (block as TextContent).text.length
      else if (block.type === 'thinking') chars += (block as ThinkingContent).thinking.length
      else if (block.type === 'toolCall')
        chars += JSON.stringify((block as ToolCall).arguments).length
    }
  } else if (m.role === 'toolResult') {
    const tr = m as ToolResultMessage
    for (const block of tr.content) {
      if (block.type === 'text') chars += block.text.length
    }
  }

  // ~4 chars per token, round up, add overhead for role/metadata
  return Math.ceil(chars / 4) + 4
}

/**
 * Estimate total tokens for a message array.
 */
export function estimateTokens(messages: AgentMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

// ── Model context sizes ─────────────────────────────────────────────

const MODEL_CONTEXT_SIZES: Record<string, number> = {
  // Anthropic
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  // Google
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  // Groq
  'llama-3.3-70b-versatile': 128_000,
  // Mistral
  'mistral-large-latest': 128_000,
  // Anton (GRU) — models not already covered above
  'gpt-5.5': 1_000_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.4-pro': 1_000_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
  'gemini-3.1-pro': 1_000_000,
  'gemini-3.1-flash-lite': 1_000_000,
  'grok-4.1-fast': 128_000,
  'grok-3-mini': 128_000,
  'deepseek-v3.2': 128_000,
  'deepseek-r1': 128_000,
  'qwen3-235b': 128_000,
  'minimax-m2.5': 1_000_000,
  'minimax-m2.7': 1_000_000,
  'kimi-k2.5': 128_000,
  'llama-4-maverick': 1_000_000,
  codestral: 256_000,
}

export function getModelContextSize(modelId: string): number {
  // Exact match
  if (MODEL_CONTEXT_SIZES[modelId]) return MODEL_CONTEXT_SIZES[modelId]

  // Partial match (for openrouter-style IDs like "anthropic/claude-sonnet-4-6")
  for (const [key, size] of Object.entries(MODEL_CONTEXT_SIZES)) {
    if (modelId.includes(key)) return size
  }

  return 128_000 // safe default
}

export function getDefaultCompactionConfig(modelId?: string): CompactionConfig {
  return {
    enabled: true,
    threshold: 0.8,
    maxContextTokens: modelId ? getModelContextSize(modelId) : 128_000,
    toolOutputMaxTokens: 4_000,
    preserveRecentCount: 20,
  }
}

export function createInitialCompactionState(): CompactionState {
  return {
    summary: null,
    compactedMessageCount: 0,
    lastCompactedAt: null,
    compactionCount: 0,
  }
}

// ── Layer 1: Tool output trimming ───────────────────────────────────

/**
 * Trim long tool result outputs. Returns a new array with cloned messages.
 * Never mutates the originals.
 */
export function trimToolOutputs(
  messages: AgentMessage[],
  maxTokensPerOutput: number,
): AgentMessage[] {
  const maxChars = maxTokensPerOutput * 4 // reverse the ~4 chars/token heuristic

  return messages.map((msg) => {
    const m = msg as Message
    if (m.role !== 'toolResult') return msg

    const tr = m as ToolResultMessage
    let needsTrim = false

    for (const block of tr.content) {
      if (block.type === 'text' && block.text.length > maxChars) {
        needsTrim = true
        break
      }
    }

    if (!needsTrim) return msg

    // Clone and trim
    const trimmed: ToolResultMessage = {
      ...tr,
      content: tr.content.map((block) => {
        if (block.type === 'text' && block.text.length > maxChars) {
          const originalTokens = Math.ceil(block.text.length / 4)
          return {
            type: 'text' as const,
            text: `${block.text.slice(0, maxChars)}\n\n[... output truncated, was ~${originalTokens} tokens ...]`,
          }
        }
        return block
      }),
    }

    return trimmed as AgentMessage
  })
}

// ── Message serialization for summarization ─────────────────────────

function serializeMessages(messages: AgentMessage[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    const m = msg as Message
    if (!m.role) continue

    if (m.role === 'user') {
      const user = m as UserMessage
      const text =
        typeof user.content === 'string'
          ? user.content
          : user.content
              .filter((b): b is TextContent => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
      parts.push(`[User]: ${text}`)
    } else if (m.role === 'assistant') {
      const textParts = m.content
        .filter((b): b is TextContent => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      const toolCalls = m.content
        .filter((b) => b.type === 'toolCall')
        .map(
          (b) =>
            `  Tool: ${(b as ToolCall).name}(${JSON.stringify((b as ToolCall).arguments).slice(0, 200)})`,
        )
        .join('\n')
      let entry = `[Assistant]: ${textParts}`
      if (toolCalls) entry += `\n${toolCalls}`
      parts.push(entry)
    } else if (m.role === 'toolResult') {
      const tr = m as ToolResultMessage
      const text = tr.content
        .filter((b): b is TextContent => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      // Truncate tool results in serialization too
      const truncated = text.length > 2000 ? `${text.slice(0, 2000)}\n[...truncated...]` : text
      parts.push(`[Tool Result (${tr.toolName})]: ${truncated}`)
    }
  }

  return parts.join('\n\n')
}

// ── Summary message creation ────────────────────────────────────────

function createSummaryMessage(summary: string): UserMessage {
  return {
    role: 'user',
    content: `[CONVERSATION SUMMARY — This conversation was compacted to save context space. The following is a summary of what happened before this point.]\n\n${summary}`,
    timestamp: Date.now(),
  }
}

// ── Main compaction function ────────────────────────────────────────

export async function compactContext(
  messages: AgentMessage[],
  state: CompactionState,
  config: CompactionConfig,
  model: Model<Api>,
  provider: string,
  getApiKey: (provider: string) => Promise<string | undefined>,
  customInstructions?: string,
): Promise<{ messages: AgentMessage[]; state: CompactionState }> {
  // Layer 0: Always trim tool outputs — prevents large tool results from blowing
  // the context window before the threshold check even runs.
  const trimmed = trimToolOutputs(messages, config.toolOutputMaxTokens)

  if (!config.enabled && !customInstructions) {
    return { messages: trimmed, state }
  }

  const threshold = config.threshold * config.maxContextTokens
  const totalTokens = estimateTokens(trimmed)

  // Under threshold — no further compaction needed
  if (totalTokens < threshold && !customInstructions) {
    return { messages: trimmed, state }
  }

  log.info({ tokens: totalTokens, threshold: Math.round(threshold) }, 'compacting')

  // Layer 2: LLM summarization
  const preserveCount = Math.min(config.preserveRecentCount, trimmed.length)
  const splitPoint = trimmed.length - preserveCount

  if (splitPoint <= 0) {
    // Not enough messages to split — just return trimmed
    return { messages: trimmed, state }
  }

  const olderMessages = trimmed.slice(0, splitPoint)
  const recentMessages = trimmed.slice(splitPoint)

  const serialized = serializeMessages(olderMessages)
  const userPrompt = buildCompactionUserPrompt(serialized, customInstructions)

  const apiKey = await getApiKey(provider)

  const result = await completeSimple(
    model,
    {
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
    },
    {
      apiKey,
    },
  )

  // Extract summary text from the response
  const summaryText = result.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  if (!summaryText) {
    log.error('LLM returned empty summary, falling back')
    return { messages: trimmed, state }
  }

  const summaryMessage = createSummaryMessage(summaryText)
  const compactedMessages: AgentMessage[] = [summaryMessage, ...recentMessages]

  const newState: CompactionState = {
    summary: summaryText,
    compactedMessageCount: state.compactedMessageCount + olderMessages.length,
    lastCompactedAt: Date.now(),
    compactionCount: state.compactionCount + 1,
  }

  const compactedTokens = estimateTokens(compactedMessages)
  log.info(
    {
      tokensBefore: totalTokens,
      tokensAfter: compactedTokens,
      summarized: olderMessages.length,
      preserved: recentMessages.length,
    },
    'layer 2 complete',
  )

  return { messages: compactedMessages, state: newState }
}
