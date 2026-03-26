import { execFile } from 'node:child_process'
import type { AgentConfig } from '@anton/agent-config'

export interface ShellToolInput {
  command: string
  timeout_seconds?: number
  working_directory?: string
}

/**
 * Check if a command matches any dangerous patterns that need confirmation.
 */
export function needsConfirmation(command: string, patterns: string[]): boolean {
  const lower = command.toLowerCase()
  return patterns.some((p) => lower.includes(p.toLowerCase()))
}

/**
 * Execute a shell command with timeout.
 * Uses the user's default shell with login profile for full PATH support.
 */
export async function executeShell(input: ShellToolInput, _config: AgentConfig): Promise<string> {
  const { command, timeout_seconds = 30, working_directory } = input
  const timeout = Math.min(timeout_seconds, 300) * 1000

  // Use user's shell for proper PATH and env (npm, node, etc.)
  const userShell = process.env.SHELL || '/bin/sh'

  return new Promise((resolve) => {
    execFile(
      userShell,
      ['-l', '-c', command],
      {
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        cwd: working_directory || process.env.HOME,
        env: {
          ...process.env,
          // Ensure common tool paths are available
          PATH: [
            process.env.PATH,
            '/usr/local/bin',
            '/opt/homebrew/bin',
            `${process.env.HOME}/.nvm/versions/node/current/bin`,
          ]
            .filter(Boolean)
            .join(':'),
        },
      },
      (error, stdout, stderr) => {
        let output = ''
        if (stdout) output += stdout
        if (stderr) output += (output ? '\n' : '') + stderr
        if (error && !output) {
          output = `Error: ${error.message}`
        }
        resolve(output || '(no output)')
      },
    )
  })
}
