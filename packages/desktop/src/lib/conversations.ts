import type { ChatMessage } from './store.js'

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
  provider?: string // model provider for this conversation
  model?: string // model name for this conversation
  contextInfo?: ConversationContextInfo // loaded context/memory info from server
}

const STORAGE_KEY = 'anton.conversations'

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveConversations(conversations: Conversation[]) {
  const sanitized = conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: message.attachments?.map(({ data: _data, ...attachment }) => attachment),
    })),
  }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
}

export function createConversation(
  title?: string,
  sessionId?: string,
  projectId?: string,
  provider?: string,
  model?: string,
): Conversation {
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    sessionId: sessionId || `sess_${Date.now().toString(36)}`,
    title: title || 'New conversation',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectId,
    provider,
    model,
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
  // Remove common filler/greeting prefixes
  let cleaned = text
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
