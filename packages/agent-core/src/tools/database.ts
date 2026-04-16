/**
 * Database tool — SQLite operations via the sqlite3 CLI.
 * Default database at ~/.anton/data.db.
 *
 * Security: All SQL is passed via stdin pipe (not shell interpolation)
 * to prevent command injection.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface DatabaseInput {
  operation: 'query' | 'execute' | 'schema' | 'tables'
  db_path?: string
  sql?: string
}

const DEFAULT_DB = join(homedir(), '.anton', 'data.db')

function ensureDbDir(dbPath: string) {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Validate and normalize the database path.
 * Prevents path traversal to sensitive system files.
 */
function validateDbPath(dbPath: string): string {
  const resolved = resolve(dbPath)
  // Must be under home directory or /tmp
  const home = homedir()
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
    throw new Error(`Database path must be under home directory or /tmp. Got: ${resolved}`)
  }
  return resolved
}

/**
 * Execute SQL via sqlite3 CLI using stdin pipe (safe from injection).
 * Arguments are passed as an array to execFileSync — no shell interpolation.
 */
function sqlite(sql: string, dbPath: string, mode = 'column'): string {
  try {
    return execFileSync('sqlite3', [`-${mode}`, '-header', dbPath], {
      input: sql,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string }
    return `Error: ${e.stderr?.trim() || e.message}`
  }
}

/**
 * Validate a table name to prevent injection in .schema commands.
 * Only allows alphanumeric, underscores, and dots (for schema.table).
 */
function validateTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)
}

export function executeDatabase(input: DatabaseInput): string {
  const dbPath = input.db_path || DEFAULT_DB

  try {
    const validPath = validateDbPath(dbPath)
    ensureDbDir(validPath)

    switch (input.operation) {
      case 'query': {
        if (!input.sql) return 'Error: sql is required for query.'
        return sqlite(input.sql, validPath) || '(no results)'
      }

      case 'execute': {
        if (!input.sql) return 'Error: sql is required for execute.'
        const result = sqlite(input.sql, validPath, 'line')
        return result || 'OK'
      }

      case 'tables': {
        return sqlite('.tables', validPath) || '(no tables)'
      }

      case 'schema': {
        const table = input.sql // Reuse sql field for table name
        if (table) {
          if (!validateTableName(table)) {
            return `Error: invalid table name "${table}". Only alphanumeric characters and underscores allowed.`
          }
          return sqlite(`.schema ${table}`, validPath) || `No table "${table}".`
        }
        return sqlite('.schema', validPath) || '(no schema)'
      }

      default:
        return `Error: unknown operation "${input.operation}".`
    }
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`
  }
}

// ── Tool factory ────────────────────────────────────────────────────

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { defineTool, toolResult } from './_helpers.js'

/**
 * Build the `database` tool definition. Shared between the Pi SDK agent
 * and the harness MCP shim — do not duplicate this schema elsewhere.
 */
export function buildDatabaseTool(): AgentTool {
  return defineTool({
    name: 'database',
    label: 'Database',
    description:
      'SQLite database operations. Use for structured data storage, queries, and analysis. ' +
      'Default database at ~/.anton/data.db. Can also work with any SQLite file. ' +
      'Operations: query (SELECT), execute (INSERT/UPDATE/DELETE/CREATE), tables, schema.',
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal('query'),
          Type.Literal('execute'),
          Type.Literal('schema'),
          Type.Literal('tables'),
        ],
        { description: 'Database operation' },
      ),
      db_path: Type.Optional(
        Type.String({ description: 'SQLite database path (default: ~/.anton/data.db)' }),
      ),
      sql: Type.Optional(
        Type.String({ description: 'SQL statement, or table name for schema operation' }),
      ),
    }),
    async execute(_toolCallId, params) {
      return toolResult(executeDatabase(params))
    },
  })
}
