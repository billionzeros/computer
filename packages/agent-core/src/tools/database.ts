/**
 * Database tool — SQLite operations via the sqlite3 CLI.
 * Default database at ~/.anton/data.db.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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

function sqlite(sql: string, dbPath: string, mode = 'column'): string {
  try {
    return execSync(`sqlite3 -${mode} -header "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string }
    return `Error: ${e.stderr?.trim() || e.message}`
  }
}

export function executeDatabase(input: DatabaseInput): string {
  const dbPath = input.db_path || DEFAULT_DB
  ensureDbDir(dbPath)

  switch (input.operation) {
    case 'query': {
      if (!input.sql) return 'Error: sql is required for query.'
      return sqlite(input.sql, dbPath) || '(no results)'
    }

    case 'execute': {
      if (!input.sql) return 'Error: sql is required for execute.'
      // Use line mode for non-select statements
      const result = sqlite(input.sql, dbPath, 'line')
      return result || 'OK'
    }

    case 'tables': {
      return sqlite('.tables', dbPath) || '(no tables)'
    }

    case 'schema': {
      const table = input.sql // Reuse sql field for table name
      if (table) {
        return sqlite(`.schema ${table}`, dbPath) || `No table "${table}".`
      }
      return sqlite('.schema', dbPath) || '(no schema)'
    }

    default:
      return `Error: unknown operation "${input.operation}".`
  }
}
