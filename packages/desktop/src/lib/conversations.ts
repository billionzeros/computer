import type { ChatMessage } from './store.js'

/**
 * Strip <think>...</think> tags from a title string.
 * Handles both complete and unclosed tags (from streaming).
 */
export function sanitizeTitle(title: string): string {
  return (
    title
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/g, '')
      .trim() || 'New conversation'
  )
}

export interface ConversationContextInfo {
  globalMemories: string[]
  conversationMemories: string[]
  crossConversationMemories: Array<{
    fromConversation: string
    conversationTitle: string
    memoryKey: string
  }>
  projectId?: string
}

export interface Conversation {
  id: string
  sessionId: string // server-side session ID
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  projectId?: string // set if this conversation belongs to a project
  agentSessionId?: string // if spawned from an agent, the agent's session ID
  provider?: string // model provider for this conversation
  model?: string // model name for this conversation
  contextInfo?: ConversationContextInfo // loaded context/memory info from server
  pendingCreation?: boolean // true until server confirms session_created
}

const STORAGE_KEY = 'anton.conversations'
const ACTIVE_CONV_KEY = 'anton.activeConversationId'

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveConversations(conversations: Conversation[]) {
  // Persist metadata only — messages are never stored in localStorage.
  // They live in-memory (zustand) and are fetched from server on demand.
  const metadataOnly = conversations.map(({ messages: _msgs, contextInfo: _ctx, ...rest }) => ({
    ...rest,
    messages: [], // always empty in storage
  }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(metadataOnly))
}

export function persistActiveConversationId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_CONV_KEY, id)
  } else {
    localStorage.removeItem(ACTIVE_CONV_KEY)
  }
}

export function reconcileActiveConversationId(
  conversations: Conversation[],
  activeConversationId: string | null,
): string | null {
  const nextActiveId =
    activeConversationId && conversations.some((c) => c.id === activeConversationId)
      ? activeConversationId
      : (conversations[0]?.id ?? null)

  persistActiveConversationId(nextActiveId)
  return nextActiveId
}

export function createConversation(
  title?: string,
  sessionId?: string,
  projectId?: string,
  provider?: string,
  model?: string,
  agentSessionId?: string,
): Conversation {
  const resolvedSessionId = sessionId || `sess_${Date.now().toString(36)}`
  return {
    id: resolvedSessionId, // id === sessionId — single identity
    sessionId: resolvedSessionId,
    title: title || 'New conversation',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectId,
    agentSessionId,
    provider,
    model,
    pendingCreation: true,
  }
}

/**
 * Generate a smart, concise title from the first user message.
 * Extracts the core intent/topic rather than just truncating.
 */
export function autoTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'New conversation'

  const text = firstUser.content.trim()
  if (!text) {
    if (firstUser.attachments?.length) {
      return firstUser.attachments.length === 1
        ? `Image: ${firstUser.attachments[0].name}`
        : `${firstUser.attachments.length} images`
    }
    return 'New conversation'
  }

  return generateTitle(text)
}

function generateTitle(text: string): string {
  // Strip <think>...</think> tags that some models embed
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()

  // Remove common filler/greeting prefixes
  cleaned = cleaned
    .replace(
      /^(hey|hi|hello|yo|sup|ok|okay|please|can you|could you|i want to|i need to|i'd like to|help me|let's|let me)\b[,!.\s]*/i,
      '',
    )
    .trim()

  // If cleaning removed everything, use original
  if (!cleaned) cleaned = text.trim()

  // Remove trailing punctuation for cleaner titles
  cleaned = cleaned.replace(/[.!?]+$/, '').trim()

  // If it starts with a verb, capitalize and use as-is (it's already action-oriented)
  // Common action verbs that make good title starts
  const actionVerbs =
    /^(build|create|make|set up|setup|deploy|fix|debug|write|add|remove|delete|update|install|configure|analyze|track|design|implement|refactor|migrate|optimize|test|check|find|search|list|show|explain|generate|convert|merge|split|run|start|stop|monitor|connect|schedule|automate|scrape|fetch|download|upload|compare|review|plan|organize|sort|filter|clean|format|validate|import|export|parse|render|compile|package)/i

  const MAX_TITLE = 40

  if (actionVerbs.test(cleaned)) {
    return capitalize(truncateSmart(cleaned, MAX_TITLE))
  }

  // If it's a question, extract the topic
  const questionMatch = cleaned.match(
    /^(?:what|how|why|where|when|which|who|is|are|can|do|does|will|should|would)\s+(.+)/i,
  )
  if (questionMatch) {
    const topic = questionMatch[1].replace(/^(?:the|a|an|i|we|you)\s+/i, '').trim()
    return capitalize(truncateSmart(topic, MAX_TITLE))
  }

  // For short messages, use as-is
  if (cleaned.length <= 30) {
    return capitalize(cleaned)
  }

  // For longer messages, try to extract the first meaningful clause
  const clauses = cleaned.split(/[,;:\-–—]/)
  const firstClause = clauses[0].trim()

  if (firstClause.length >= 10 && firstClause.length <= MAX_TITLE) {
    return capitalize(firstClause)
  }

  // Fallback: smart truncate at word boundary
  return capitalize(truncateSmart(cleaned, MAX_TITLE))
}

function truncateSmart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  // Cut at word boundary
  const truncated = text.slice(0, maxLen)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLen * 0.6) {
    return `${truncated.slice(0, lastSpace)}...`
  }
  return `${truncated}...`
}

function capitalize(text: string): string {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}
