/**
 * Memory tool — persistent cross-session knowledge storage.
 * Stores memories as markdown files in ~/.anton/memory/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface MemoryInput {
  operation: 'save' | 'recall' | 'list' | 'forget'
  key?: string
  content?: string
  query?: string
}

const MEMORY_DIR = join(homedir(), '.anton', 'memory')

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
}

function keyToFile(key: string): string {
  // Sanitize key to safe filename
  const safe = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  return join(MEMORY_DIR, `${safe}.md`)
}

export function executeMemory(input: MemoryInput): string {
  ensureDir()

  switch (input.operation) {
    case 'save': {
      if (!input.key) return 'Error: key is required for save.'
      if (!input.content) return 'Error: content is required for save.'
      const file = keyToFile(input.key)
      const header = `# ${input.key}\n\n_Saved: ${new Date().toISOString()}_\n\n`
      writeFileSync(file, header + input.content, 'utf-8')
      return `Saved memory "${input.key}".`
    }

    case 'recall': {
      if (!input.key) return 'Error: key is required for recall.'
      const file = keyToFile(input.key)
      if (!existsSync(file)) return `No memory found for "${input.key}".`
      return readFileSync(file, 'utf-8')
    }

    case 'list': {
      const files = existsSync(MEMORY_DIR)
        ? readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md'))
        : []
      if (files.length === 0) return 'No memories stored.'

      const entries = files.map((f) => {
        const content = readFileSync(join(MEMORY_DIR, f), 'utf-8')
        const firstLine =
          content
            .split('\n')
            .find((l) => l.startsWith('# '))
            ?.slice(2) || f.replace('.md', '')
        return firstLine
      })

      // Filter by query if provided
      const query = input.query?.toLowerCase()
      const filtered = query ? entries.filter((e) => e.toLowerCase().includes(query)) : entries

      if (filtered.length === 0) return `No memories matching "${input.query}".`
      return `Memories (${filtered.length}):\n${filtered.map((e) => `• ${e}`).join('\n')}`
    }

    case 'forget': {
      if (!input.key) return 'Error: key is required for forget.'
      const file = keyToFile(input.key)
      if (!existsSync(file)) return `No memory found for "${input.key}".`
      unlinkSync(file)
      return `Forgot memory "${input.key}".`
    }

    default:
      return `Error: unknown operation "${input.operation}".`
  }
}
