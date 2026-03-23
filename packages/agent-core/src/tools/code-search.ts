/**
 * Code search tool — intelligent code search using ripgrep.
 * Better than raw grep: supports regex, file type filtering, context lines, result limits.
 */

import { execSync } from 'node:child_process'

export interface CodeSearchInput {
  query: string
  path?: string
  file_type?: string
  context_lines?: number
  max_results?: number
}

export function executeCodeSearch(input: CodeSearchInput): string {
  const { query, path = '.', file_type, context_lines = 2, max_results = 20 } = input

  const args: string[] = [
    '--color=never',
    '--line-number',
    '--no-heading',
    `--max-count=${max_results}`,
  ]

  if (context_lines > 0) {
    args.push(`-C ${context_lines}`)
  }

  if (file_type) {
    // Support both "ts" and ".ts" formats
    const ext = file_type.startsWith('.') ? file_type : `.${file_type}`
    args.push(`--glob="*${ext}"`)
  }

  // Exclude common noise directories
  args.push(
    '--glob=!node_modules',
    '--glob=!.git',
    '--glob=!dist',
    '--glob=!build',
    '--glob=!*.min.*',
  )

  const cmd = `rg ${args.join(' ')} "${query.replace(/"/g, '\\"')}" "${path}"`

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 512 * 1024,
      cwd: process.cwd(),
    }).trim()

    if (!output) return 'No matches found.'

    const lines = output.split('\n')
    if (lines.length > 200) {
      return `${lines.slice(0, 200).join('\n')}\n\n... (${lines.length - 200} more lines, refine your search)`
    }
    return output
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; message: string }
    // rg exits with 1 when no matches found
    if (e.status === 1) return 'No matches found.'
    return `Error: ${e.stderr?.trim() || e.message}`
  }
}
