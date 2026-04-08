/**
 * Background memory extraction — runs after each turn to extract durable
 * memories from the conversation.
 *
 * Design: single `completeSimple` call returning structured JSON.
 * No agentic loop, no tool calls. The caller writes files directly.
 *
 * Model selection is dynamic based on the user's active provider:
 * - anton (GRU): gemini-3.1-flash-lite (cheapest non-reasoning)
 * - anthropic: claude-haiku-3-5
 * - openai: gpt-4.1-mini
 * - google: gemini-2.0-flash-lite
 * - openrouter: anthropic/claude-haiku-3-5
 * Falls back to the main conversation model if the preferred model is unavailable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getGlobalMemoryDir, getProjectDir } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { completeSimple, getModel as piGetModel } from '@mariozechner/pi-ai'
import type { Api, Model, TextContent } from '@mariozechner/pi-ai'
import { getAntonModel } from './anton-models.js'

const log = createLogger('memory-extraction')

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// ── Config ──────────────────────────────────────────────────────────

/** Run extraction every N user messages */
const EXTRACTION_INTERVAL = 4

/** Skip extraction if serialized content is shorter than this */
const MIN_CONTENT_LENGTH = 200

/** Cap serialized messages at this many characters to control token usage */
const MAX_SERIALIZED_CHARS = 4000

/** Timeout for the extraction API call (ms) */
const EXTRACTION_TIMEOUT_MS = 30_000

/** Max memories per extraction */
const MAX_MEMORIES_PER_EXTRACTION = 3

/**
 * Preferred extraction models per provider — cheapest non-reasoning models.
 * Order matters: first match that resolves wins.
 */
const PREFERRED_EXTRACTION_MODELS: Record<string, string[]> = {
  anton: ['gemini-3.1-flash-lite', 'glm-5-turbo', 'gemini-2.5-flash'],
  anthropic: ['claude-haiku-3-5-20241022', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4.1-mini', 'gpt-4o-mini'],
  google: ['gemini-2.0-flash-lite', 'gemini-1.5-flash'],
  openrouter: ['anthropic/claude-3-5-haiku-20241022', 'google/gemini-2.0-flash-lite-001'],
}

// ── Types ───────────────────────────────────────────────────────────

export interface ExtractedMemory {
  key: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
}

export interface ExtractionResult {
  memories: ExtractedMemory[]
  skipped: boolean
  reason?: string
}

interface ExtractionState {
  /** Index into messages array — cursor for what we've already processed */
  lastProcessedIndex: number
  /** Count of user messages since last extraction */
  userMessagesSinceLastExtraction: number
  /** Whether the main agent used the memory tool this turn */
  agentUsedMemoryTool: boolean
  /** True while an extraction is in progress — prevents overlapping runs */
  inProgress: boolean
}

// ── Prompt ──────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You extract durable memories from a conversation. Output JSON only.

## Rules
- Save ONLY facts useful in future conversations (preferences, decisions, project context, corrections)
- Do NOT save: transient task details, code snippets, things obvious from the request
- Do NOT duplicate existing memories (listed below)
- Each memory needs: key (slug), type, 1-3 sentence content
- For feedback/project types include **Why:** and **How to apply:** lines
- Max ${MAX_MEMORIES_PER_EXTRACTION} memories. Return empty array if nothing worth saving.

## Types
- user: who they are, role, expertise, preferences
- feedback: corrections/confirmations on approach — include WHY
- project: tech stack, architecture decisions, goals, deadlines
- reference: external system pointers (URLs, project names, API endpoints)

## Output format
{"memories":[{"key":"slug-name","type":"user","content":"..."}]}

Return ONLY valid JSON. No markdown fences, no explanation.`

// ── Serialization ───────────────────────────────────────────────────

/**
 * Serialize recent messages into a compact text format for the extraction LLM.
 * Reuses the same approach as compaction.ts but caps output size.
 */
function serializeRecentMessages(
  messages: AgentMessage[],
  sinceIndex: number,
  maxChars: number,
): string {
  const parts: string[] = []
  let totalChars = 0

  for (let i = sinceIndex; i < messages.length; i++) {
    const msg = messages[i] as { role?: string; content?: unknown }
    if (!msg.role) continue

    let entry = ''

    if (msg.role === 'user') {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as { type: string; text?: string }[])
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('\n')
            : ''
      entry = `[User]: ${text}`
    } else if (msg.role === 'assistant') {
      const content = msg.content
      if (Array.isArray(content)) {
        const textParts = (content as { type: string; text?: string }[])
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join('\n')
        const toolCalls = (content as { type: string; name?: string; arguments?: unknown }[])
          .filter((b) => b.type === 'toolCall')
          .map((b) => `  Tool: ${b.name}(...)`)
          .join('\n')
        entry = `[Assistant]: ${textParts}`
        if (toolCalls) entry += `\n${toolCalls}`
      }
    }
    // Skip tool results — they're verbose and rarely contain memory-worthy info

    if (!entry) continue

    // Truncate individual entries
    if (entry.length > 1000) {
      entry = `${entry.slice(0, 1000)}[...truncated]`
    }

    if (totalChars + entry.length > maxChars) break
    parts.push(entry)
    totalChars += entry.length
  }

  return parts.join('\n\n')
}

// ── Memory directory helpers ────────────────────────────────────────

function getMemoryDir(projectId?: string): string | null {
  if (projectId) {
    const projectDir = getProjectDir(projectId)
    // Don't create memory dirs for non-existent projects
    if (!existsSync(projectDir)) return null
    return join(projectDir, 'memory')
  }
  return getGlobalMemoryDir()
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function keyToFile(key: string): string {
  const normalized = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') // strip leading/trailing dashes
    .slice(0, 80)
  return normalized || 'unnamed-memory'
}

/**
 * List existing memory keys to pass to the extraction LLM for dedup.
 */
function listExistingMemoryKeys(memDir: string): string[] {
  if (!existsSync(memDir)) return []
  try {
    return readdirSync(memDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        // Try to extract the name from frontmatter, fall back to filename
        try {
          const content = readFileSync(join(memDir, f), 'utf-8')
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          if (nameMatch) return nameMatch[1].trim()
          // Fall back to # heading
          const headingMatch = content.match(/^#\s+(.+)$/m)
          if (headingMatch) return headingMatch[1].trim()
        } catch {
          /* ignore read errors */
        }
        return f.replace('.md', '')
      })
  } catch {
    return []
  }
}

/**
 * Sanitize a string for safe inclusion in YAML frontmatter.
 * Strips newlines (prevents key injection) and wraps in quotes if
 * the value contains YAML-special characters.
 */
function sanitizeForYaml(value: string): string {
  // Collapse to single line
  const oneLine = value.replace(/[\r\n]+/g, ' ').trim()
  // If it contains colons, quotes, or other YAML specials, wrap in quotes
  if (/[:#"'{}[\]|>]/.test(oneLine) || oneLine.startsWith('-') || oneLine.startsWith('?')) {
    return `"${oneLine.replace(/"/g, '\\"')}"`
  }
  return oneLine
}

/**
 * Write a memory file with frontmatter format.
 */
function writeMemoryFile(memDir: string, memory: ExtractedMemory): string {
  ensureDir(memDir)
  const filename = `${keyToFile(memory.key)}.md`
  const filePath = join(memDir, filename)

  const description = memory.content.split('\n')[0].slice(0, 100)

  const content = [
    '---',
    `name: ${sanitizeForYaml(memory.key)}`,
    `description: ${sanitizeForYaml(description)}`,
    `type: ${memory.type}`,
    `extracted: ${new Date().toISOString()}`,
    '---',
    '',
    memory.content,
    '',
  ].join('\n')

  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// ── Model resolution ────────────────────────────────────────────────

/**
 * Build a Model-compatible object for an OpenRouter model.
 * Mirrors the same builder in session.ts.
 */
function buildOpenRouterModel(modelId: string) {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions' as const,
    provider: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    reasoning: false, // extraction models are never reasoning
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  }
}

/**
 * Resolve the best extraction model for the given provider.
 * Tries provider-specific cheap models first, then falls back to the
 * main conversation model (so extraction always works if the conversation works).
 */
function resolveExtractionModel(
  provider: string,
  fallbackModel: Model<Api>,
): { model: Model<Api>; provider: string } {
  const candidates = PREFERRED_EXTRACTION_MODELS[provider]

  if (candidates) {
    for (const modelId of candidates) {
      // Anton (GRU) models — custom runtime registry
      if (provider === 'anton') {
        const m = getAntonModel(modelId)
        if (m) return { model: m as Model<Api>, provider }
        continue
      }

      // OpenRouter — any model ID is valid (it's a proxy)
      if (provider === 'openrouter') {
        return { model: buildOpenRouterModel(modelId) as Model<Api>, provider }
      }

      // pi-ai built-in registry (cast to bypass KnownProvider constraint)
      try {
        const m = (piGetModel as (p: string, m: string) => Model<Api> | undefined)(
          provider,
          modelId,
        )
        if (m) return { model: m, provider }
      } catch {
        /* not in registry, try next */
      }
    }
  }

  // Fallback: use the main conversation model (guaranteed to work)
  log.info({ provider }, 'no cheap extraction model found, falling back to conversation model')
  return { model: fallbackModel, provider }
}

// ── Main extraction ─────────────────────────────────────────────────

/**
 * Run memory extraction on recent messages.
 * Returns the extracted memories (already written to disk).
 */
export async function extractMemories(opts: {
  messages: AgentMessage[]
  sinceIndex: number
  projectId?: string
  provider: string
  fallbackModel: Model<Api>
  getApiKey: (provider: string) => string | undefined
}): Promise<ExtractionResult> {
  const { messages, sinceIndex, projectId, provider, fallbackModel, getApiKey } = opts

  // Serialize recent messages
  const serialized = serializeRecentMessages(messages, sinceIndex, MAX_SERIALIZED_CHARS)
  if (serialized.length < MIN_CONTENT_LENGTH) {
    return { memories: [], skipped: true, reason: 'content too short' }
  }

  // Resolve cheapest model for this provider, fall back to conversation model
  const resolved = resolveExtractionModel(provider, fallbackModel)

  const apiKey = getApiKey(resolved.provider)
  if (!apiKey) {
    return { memories: [], skipped: true, reason: `no API key for ${resolved.provider}` }
  }

  // Get existing memory keys for dedup
  const memDir = getMemoryDir(projectId)
  if (!memDir) {
    return { memories: [], skipped: true, reason: 'project directory does not exist' }
  }
  const existingKeys = listExistingMemoryKeys(memDir)
  const existingSection =
    existingKeys.length > 0
      ? `\n\nExisting memories (do not duplicate):\n${existingKeys.map((k) => `- ${k}`).join('\n')}`
      : ''

  // Build user prompt
  const userPrompt = `${serialized}${existingSection}`

  try {
    // Race the API call against a timeout so a hanging request doesn't
    // permanently disable extraction (inProgress would stay true forever)
    const apiPromise = completeSimple(
      resolved.model,
      {
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      },
      { apiKey, reasoning: undefined, maxTokens: 400 },
    )
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('extraction timed out')), EXTRACTION_TIMEOUT_MS)
    })
    const result = await Promise.race([apiPromise, timeoutPromise])

    // Parse response
    let responseText = result.content
      .filter((b): b is TextContent => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    // Strip markdown fences if the model wrapped the response
    responseText = responseText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    // Strip any <think>...</think> tags
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    if (!responseText) {
      return { memories: [], skipped: false }
    }

    const parsed = JSON.parse(responseText) as { memories?: ExtractedMemory[] }
    const memories = (parsed.memories || []).slice(0, MAX_MEMORIES_PER_EXTRACTION)

    // Validate and write each memory
    const validTypes = new Set(['user', 'feedback', 'project', 'reference'])
    const written: ExtractedMemory[] = []
    // Track keys written in this batch to prevent intra-batch overwrites
    const writtenKeysThisBatch = new Set<string>()

    for (const mem of memories) {
      if (!mem.key || !mem.content || !validTypes.has(mem.type)) {
        log.warn({ mem }, 'skipping invalid memory from extraction')
        continue
      }

      // Skip if key already exists on disk (fuzzy match on normalized filename)
      const normalizedKey = keyToFile(mem.key)
      const isDuplicate = existingKeys.some((k) => keyToFile(k) === normalizedKey)
      if (isDuplicate) {
        log.info({ key: mem.key }, 'skipping duplicate memory')
        continue
      }

      // Skip if another memory in this same batch already wrote to this filename
      if (writtenKeysThisBatch.has(normalizedKey)) {
        log.info({ key: mem.key }, 'skipping intra-batch duplicate')
        continue
      }

      try {
        const path = writeMemoryFile(memDir, mem)
        written.push(mem)
        writtenKeysThisBatch.add(normalizedKey)
        log.info({ key: mem.key, type: mem.type, path }, 'extracted memory saved')
      } catch (err) {
        log.warn({ err, key: mem.key }, 'failed to write memory file')
      }
    }

    return { memories: written, skipped: false }
  } catch (err) {
    log.warn({ err }, 'memory extraction failed')
    return { memories: [], skipped: true, reason: `extraction error: ${(err as Error).message}` }
  }
}

// ── State management ────────────────────────────────────────────────

/**
 * Create a fresh extraction state tracker.
 * Attach this to a Session instance.
 */
export function createExtractionState(): ExtractionState {
  return {
    lastProcessedIndex: 0,
    userMessagesSinceLastExtraction: 0,
    agentUsedMemoryTool: false,
    inProgress: false,
  }
}

/**
 * Create extraction state for a resumed session.
 * Sets the cursor to the current message count so we don't re-scan history.
 */
export function createResumedExtractionState(messageCount: number): ExtractionState {
  return {
    lastProcessedIndex: messageCount,
    userMessagesSinceLastExtraction: 0,
    agentUsedMemoryTool: false,
    inProgress: false,
  }
}

/**
 * Call after each user message to increment the counter.
 */
export function trackUserMessage(state: ExtractionState): void {
  state.userMessagesSinceLastExtraction++
}

/**
 * Check whether extraction should run.
 */
export function shouldExtract(state: ExtractionState): boolean {
  if (state.inProgress) return false
  if (state.agentUsedMemoryTool) return false
  return state.userMessagesSinceLastExtraction >= EXTRACTION_INTERVAL
}

/**
 * Reset state after a successful extraction.
 */
export function advanceExtractionCursor(state: ExtractionState, newIndex: number): void {
  state.lastProcessedIndex = newIndex
  state.userMessagesSinceLastExtraction = 0
  state.agentUsedMemoryTool = false
}
