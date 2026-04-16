/**
 * Memory tool — persistent cross-session knowledge storage.
 *
 * Supports two scopes:
 * - 'global': stored in ~/.anton/memory/ (cross-conversation)
 * - 'conversation': stored in ~/.anton/conversations/{convId}/memory/ (conversation-scoped)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { getConversationMemoryDir, getGlobalMemoryDir } from '@anton/agent-config'

export interface MemoryInput {
  operation: 'save' | 'recall' | 'list' | 'forget'
  key?: string
  content?: string
  query?: string
  scope?: 'global' | 'conversation'
}

const GLOBAL_MEMORY_DIR = getGlobalMemoryDir()

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function keyToFile(key: string, dir: string): string {
  const safe = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  return join(dir, `${safe}.md`)
}

function getMemoryDir(scope: 'global' | 'conversation', conversationId?: string): string {
  if (scope === 'conversation' && conversationId) {
    return getConversationMemoryDir(conversationId)
  }
  return GLOBAL_MEMORY_DIR
}

export function executeMemory(input: MemoryInput, conversationId?: string): string {
  const scope = input.scope || (conversationId ? 'conversation' : 'global')
  const memDir = getMemoryDir(scope, conversationId)
  ensureDir(memDir)

  switch (input.operation) {
    case 'save': {
      if (!input.key) return 'Error: key is required for save.'
      if (!input.content) return 'Error: content is required for save.'
      const file = keyToFile(input.key, memDir)
      const header = `# ${input.key}\n\n_Saved: ${new Date().toISOString()}_\n\n`
      writeFileSync(file, header + input.content, 'utf-8')
      return `Saved memory "${input.key}" (scope: ${scope}).`
    }

    case 'recall': {
      if (!input.key) return 'Error: key is required for recall.'

      // Try the requested scope first, then fall back to the other
      const file = keyToFile(input.key, memDir)
      if (existsSync(file)) {
        return readFileSync(file, 'utf-8')
      }

      // Fallback: check the other scope
      const otherDir =
        scope === 'global'
          ? conversationId
            ? getConversationMemoryDir(conversationId)
            : null
          : GLOBAL_MEMORY_DIR
      if (otherDir) {
        const otherFile = keyToFile(input.key, otherDir)
        if (existsSync(otherFile)) {
          return readFileSync(otherFile, 'utf-8')
        }
      }

      return `No memory found for "${input.key}".`
    }

    case 'list': {
      const query = input.query?.toLowerCase()

      // List from both scopes
      const results: { key: string; scope: string }[] = []

      // Conversation memories
      if (conversationId) {
        const convDir = getConversationMemoryDir(conversationId)
        if (existsSync(convDir)) {
          for (const f of readdirSync(convDir).filter((f) => f.endsWith('.md'))) {
            const content = readFileSync(join(convDir, f), 'utf-8')
            const firstLine =
              content
                .split('\n')
                .find((l) => l.startsWith('# '))
                ?.slice(2) || f.replace('.md', '')
            if (!query || firstLine.toLowerCase().includes(query)) {
              results.push({ key: firstLine, scope: 'conversation' })
            }
          }
        }
      }

      // Global memories
      if (existsSync(GLOBAL_MEMORY_DIR)) {
        for (const f of readdirSync(GLOBAL_MEMORY_DIR).filter((f) => f.endsWith('.md'))) {
          const content = readFileSync(join(GLOBAL_MEMORY_DIR, f), 'utf-8')
          const firstLine =
            content
              .split('\n')
              .find((l) => l.startsWith('# '))
              ?.slice(2) || f.replace('.md', '')
          if (!query || firstLine.toLowerCase().includes(query)) {
            results.push({ key: firstLine, scope: 'global' })
          }
        }
      }

      if (results.length === 0) {
        return query ? `No memories matching "${input.query}".` : 'No memories stored.'
      }

      const lines = results.map((r) => `• [${r.scope}] ${r.key}`)
      return `Memories (${results.length}):\n${lines.join('\n')}`
    }

    case 'forget': {
      if (!input.key) return 'Error: key is required for forget.'
      const file = keyToFile(input.key, memDir)
      if (!existsSync(file)) return `No memory found for "${input.key}" in ${scope} scope.`
      unlinkSync(file)
      return `Forgot memory "${input.key}" (scope: ${scope}).`
    }

    default:
      return `Error: unknown operation "${input.operation}".`
  }
}

// ── Tool factory ────────────────────────────────────────────────────

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { defineTool, toolResult } from './_helpers.js'

/**
 * Build the `memory` tool definition. Shared between the Pi SDK agent
 * and the harness MCP shim — do not duplicate this schema elsewhere.
 */
export function buildMemoryTool(conversationId?: string): AgentTool {
  return defineTool({
    name: 'memory',
    label: 'Memory',
    description:
      'Persistent memory that survives across sessions. Save facts, preferences, project context. ' +
      'Operations: save (store a memory by key), recall (retrieve by key), list (show all, optionally filtered), forget (delete by key). ' +
      'Scope: "conversation" (default) stores memory for this conversation only, "global" stores across all conversations. ' +
      'Use proactively to remember user preferences and important context. ' +
      'Use scope=global for broadly useful info (user preferences, server configs). ' +
      'Use scope=conversation for conversation-specific facts.',
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal('save'),
          Type.Literal('recall'),
          Type.Literal('list'),
          Type.Literal('forget'),
        ],
        { description: 'Memory operation' },
      ),
      key: Type.Optional(Type.String({ description: 'Memory key (for save/recall/forget)' })),
      content: Type.Optional(Type.String({ description: 'Content to store (for save)' })),
      query: Type.Optional(Type.String({ description: 'Filter term (for list)' })),
      scope: Type.Optional(
        Type.Union([Type.Literal('global'), Type.Literal('conversation')], {
          description:
            'Memory scope: "conversation" (default) for this conversation, "global" for cross-conversation',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return toolResult(executeMemory(params, conversationId))
    },
  })
}
