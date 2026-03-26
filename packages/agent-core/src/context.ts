/**
 * Context assembly — loads memories from global, conversation, and cross-conversation sources.
 *
 * Runs on session start to build a context block injected into the system prompt.
 * Records what was loaded in context.json for transparency.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getConversationDir,
  getConversationMemoryDir,
  getConversationsDir,
  getGlobalMemoryDir,
} from '@anton/agent-config'

export interface ContextInfo {
  loadedAt: number
  globalMemories: string[]
  conversationMemories: string[]
  crossConversationMemories: Array<{
    fromConversation: string
    conversationTitle: string
    memoryKey: string
  }>
  projectId?: string
}

interface MemoryEntry {
  key: string
  content: string
  source: string
}

/**
 * Load all memory files from a directory.
 */
function loadMemoriesFromDir(dir: string): MemoryEntry[] {
  if (!existsSync(dir)) return []

  const entries: MemoryEntry[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8')
      const firstLine = content.split('\n').find((l) => l.startsWith('# '))?.slice(2) || file.replace('.md', '')
      entries.push({ key: firstLine, content, source: file })
    } catch {
      // skip unreadable files
    }
  }
  return entries
}

/**
 * Extract keywords from text for cross-conversation matching.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like',
    'through', 'after', 'over', 'between', 'out', 'up', 'down', 'this',
    'that', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'she', 'they', 'them', 'what', 'which', 'who',
    'how', 'when', 'where', 'why', 'and', 'or', 'but', 'not', 'if', 'then',
    'so', 'just', 'also', 'very', 'some', 'any', 'all', 'each', 'every',
    'help', 'please', 'want', 'need', 'make', 'get', 'set', 'use',
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 15) // limit to avoid noise
}

/**
 * Find relevant memories from other conversations based on keyword matching.
 */
function findCrossConversationMemories(
  keywords: string[],
  currentConvId: string,
  maxResults = 5,
): ContextInfo['crossConversationMemories'] {
  if (keywords.length === 0) return []

  const convDir = getConversationsDir()
  if (!existsSync(convDir)) return []

  const results: Array<{
    fromConversation: string
    conversationTitle: string
    memoryKey: string
    score: number
  }> = []

  for (const entry of readdirSync(convDir)) {
    if (entry === 'index.json' || entry === currentConvId) continue

    const memoryDir = join(convDir, entry, 'memory')
    if (!existsSync(memoryDir)) continue

    // Get conversation title from meta.json
    let convTitle = entry
    const metaPath = join(convDir, entry, 'meta.json')
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        convTitle = meta.title || entry
      } catch {}
    }

    // Score each memory file against keywords
    for (const file of readdirSync(memoryDir).filter((f) => f.endsWith('.md'))) {
      try {
        const content = readFileSync(join(memoryDir, file), 'utf-8')
        const firstLine = content.split('\n').find((l) => l.startsWith('# '))?.slice(2) || ''
        const searchText = `${file} ${firstLine} ${convTitle}`.toLowerCase()

        let score = 0
        for (const kw of keywords) {
          if (searchText.includes(kw)) score++
        }

        if (score > 0) {
          results.push({
            fromConversation: entry,
            conversationTitle: convTitle,
            memoryKey: firstLine || file.replace('.md', ''),
            score,
          })
        }
      } catch {}
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ fromConversation, conversationTitle, memoryKey }) => ({
      fromConversation,
      conversationTitle,
      memoryKey,
    }))
}

/**
 * Assemble context for a conversation.
 * Returns the context string to inject into the system prompt,
 * and the ContextInfo for transparency.
 */
export function assembleConversationContext(
  conversationId: string,
  firstMessage?: string,
  projectId?: string,
): { contextBlock: string; contextInfo: ContextInfo } {
  const globalMemories = loadMemoriesFromDir(getGlobalMemoryDir())
  const convMemories = loadMemoriesFromDir(getConversationMemoryDir(conversationId))

  // Extract keywords for cross-conversation matching
  const keywords = firstMessage ? extractKeywords(firstMessage) : []
  const crossConvMemories = findCrossConversationMemories(keywords, conversationId)

  // Load cross-conversation memory content
  const crossConvContent: MemoryEntry[] = []
  for (const ref of crossConvMemories) {
    const memDir = getConversationMemoryDir(ref.fromConversation)
    const entries = loadMemoriesFromDir(memDir)
    const match = entries.find((e) => e.key === ref.memoryKey)
    if (match) {
      crossConvContent.push({ ...match, source: `${ref.conversationTitle}/${match.source}` })
    }
  }

  // Build context block
  let block = ''

  if (globalMemories.length > 0) {
    block += '\n\n[GLOBAL MEMORY]\n'
    for (const mem of globalMemories) {
      block += `\n### ${mem.key}\n${mem.content.split('\n').slice(3).join('\n').trim()}\n`
    }
    block += '[/GLOBAL MEMORY]\n'
  }

  if (convMemories.length > 0) {
    block += '\n\n[CONVERSATION MEMORY]\n'
    for (const mem of convMemories) {
      block += `\n### ${mem.key}\n${mem.content.split('\n').slice(3).join('\n').trim()}\n`
    }
    block += '[/CONVERSATION MEMORY]\n'
  }

  if (crossConvContent.length > 0) {
    block += '\n\n[RELEVANT CONTEXT from other conversations]\n'
    for (const mem of crossConvContent) {
      block += `\n### ${mem.key} (from: ${mem.source})\n${mem.content.split('\n').slice(3).join('\n').trim()}\n`
    }
    block += '[/RELEVANT CONTEXT]\n'
  }

  // Build context info for transparency
  const contextInfo: ContextInfo = {
    loadedAt: Date.now(),
    globalMemories: globalMemories.map((m) => m.key),
    conversationMemories: convMemories.map((m) => m.key),
    crossConversationMemories: crossConvMemories,
    projectId,
  }

  // Persist context.json
  const convDir = getConversationDir(conversationId)
  if (existsSync(convDir)) {
    try {
      writeFileSync(join(convDir, 'context.json'), JSON.stringify(contextInfo, null, 2), 'utf-8')
    } catch {}
  }

  return { contextBlock: block, contextInfo }
}
