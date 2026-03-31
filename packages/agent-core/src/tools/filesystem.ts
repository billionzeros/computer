/**
 * Filesystem tool — read, write, list, search, tree files.
 *
 * Security:
 * - Forbidden path enforcement blocks access to sensitive system/credential files
 * - Path validation prevents traversal to critical system directories
 */

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkForbiddenPath } from './security.js'

export interface FsToolInput {
  operation: 'read' | 'write' | 'list' | 'search' | 'tree'
  path: string
  content?: string
  pattern?: string
  maxDepth?: number
}

export const fsToolDefinition = {
  name: 'filesystem',
  description:
    'Read, write, list, search, or tree files on the server. ' +
    "Use 'read' to view file contents, 'write' to create/modify files, " +
    "'list' to see directory contents, 'search' to find files by name pattern, " +
    "'tree' to see directory structure.",
  parameters: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'write', 'list', 'search', 'tree'],
      },
      path: {
        type: 'string',
        description: 'File or directory path (absolute or relative to home)',
      },
      content: {
        type: 'string',
        description: 'Content to write (for write operation)',
      },
      pattern: {
        type: 'string',
        description: 'Glob or grep pattern (for search operation)',
      },
      maxDepth: {
        type: 'number',
        description: 'Max depth for tree/search (default: 3)',
      },
    },
    required: ['operation', 'path'],
  },
}

/** Forbidden paths from config — set by the tool builder. */
let _forbiddenPaths: string[] = []

/** Set forbidden paths from config. Called during tool initialization. */
export function setForbiddenPaths(paths: string[]): void {
  _forbiddenPaths = paths
}

export function executeFilesystem(input: FsToolInput): string {
  const { operation, path, content, pattern, maxDepth = 3 } = input

  try {
    // Enforce forbidden path restrictions on read and write operations
    if (operation === 'read' || operation === 'write') {
      const forbidden = checkForbiddenPath(path, _forbiddenPaths)
      if (forbidden) return `Error: ${forbidden}`
    }

    switch (operation) {
      case 'read': {
        const data = readFileSync(path, 'utf-8')
        if (data.length > 100_000) {
          return `${data.slice(0, 100_000)}\n\n... (truncated, file is ${data.length} bytes)`
        }
        return data
      }

      case 'write': {
        if (!content && content !== '') {
          return 'Error: content is required for write operation'
        }
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content, 'utf-8')
        return `Wrote ${content.length} bytes to ${path}`
      }

      case 'list': {
        const entries = readdirSync(path, { withFileTypes: true })
        const lines = entries.map((e) => {
          try {
            const stat = statSync(join(path, e.name))
            const type = e.isDirectory() ? 'dir' : 'file'
            const size = e.isDirectory() ? '-' : formatSize(stat.size)
            return `${type}\t${size}\t${e.name}`
          } catch {
            return `?\t?\t${e.name}`
          }
        })
        return lines.join('\n') || '(empty directory)'
      }

      case 'search': {
        if (!pattern) return 'Error: pattern is required for search'
        try {
          // Use grep for content search, find for filename search
          const isContentSearch = !pattern.includes('*') && !pattern.includes('?')
          const cmd = isContentSearch
            ? `grep -rl --include='*' "${pattern}" "${path}" 2>/dev/null | head -50`
            : `find "${path}" -maxdepth ${maxDepth} -name "${pattern}" 2>/dev/null | head -50`
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 10_000 })
          return result || 'No matches found'
        } catch {
          return 'No matches found'
        }
      }

      case 'tree': {
        try {
          const result = execSync(
            `find "${path}" -maxdepth ${maxDepth} -print 2>/dev/null | head -200 | sort`,
            { encoding: 'utf-8', timeout: 5_000 },
          )
          return result || '(empty)'
        } catch {
          return `Error: could not list ${path}`
        }
      }

      default:
        return `Unknown operation: ${operation}`
    }
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`
}
