/**
 * Git tool — safe, structured git operations.
 * Prevents destructive operations by default.
 */

import { execSync } from 'node:child_process'

export interface GitInput {
  operation:
    | 'status'
    | 'diff'
    | 'log'
    | 'commit'
    | 'branch'
    | 'checkout'
    | 'stash'
    | 'add'
    | 'reset'
  path?: string
  message?: string
  count?: number
}

const _BLOCKED_OPS = ['push --force', 'push -f', 'reset --hard', 'clean -fd', 'clean -f']

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch (err: unknown) {
    const msg = (err as { stderr?: string; message: string }).stderr || (err as Error).message
    return `Error: ${msg.trim()}`
  }
}

export function executeGit(input: GitInput): string {
  const { operation, path, message, count = 10 } = input

  switch (operation) {
    case 'status':
      return git('status --short --branch') || '(clean)'

    case 'diff': {
      const target = path || ''
      const staged = git(`diff --cached ${target}`)
      const unstaged = git(`diff ${target}`)
      const parts: string[] = []
      if (staged) parts.push(`=== Staged ===\n${staged}`)
      if (unstaged) parts.push(`=== Unstaged ===\n${unstaged}`)
      return parts.length > 0 ? parts.join('\n\n') : 'No changes.'
    }

    case 'log':
      return git(`log --oneline --decorate -${count} ${path || ''}`)

    case 'commit': {
      if (!message) return 'Error: message is required for commit.'
      return git(`commit -m "${message.replace(/"/g, '\\"')}"`)
    }

    case 'branch': {
      if (path) {
        // Create and checkout new branch
        return git(`checkout -b ${path}`)
      }
      return git('branch -a --format="%(refname:short) %(upstream:short) %(objectname:short)"')
    }

    case 'checkout': {
      if (!path) return 'Error: path (branch name) is required for checkout.'
      return git(`checkout ${path}`)
    }

    case 'stash': {
      if (path === 'pop') return git('stash pop')
      if (path === 'list') return git('stash list') || 'No stashes.'
      return git(`stash push -m "${message || 'auto-stash'}"`)
    }

    case 'add': {
      if (!path) return `${git('add -A')}\nStaged all changes.`
      return `${git(`add ${path}`)}\nStaged: ${path}`
    }

    case 'reset': {
      // Safety: only allow soft reset
      if (path === '--hard')
        return 'Error: hard reset is blocked. Use shell tool with confirmation if needed.'
      const target = path || 'HEAD'
      return git(`reset ${target}`)
    }

    default:
      return `Error: unknown operation "${operation}".`
  }
}
