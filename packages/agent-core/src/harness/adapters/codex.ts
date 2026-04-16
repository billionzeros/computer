/**
 * CodexAdapter — bridges OpenAI Codex CLI (`codex`) into Anton's harness system.
 *
 * Spawns `codex exec --json`, parses JSONL output,
 * and maps Codex events to SessionEvent types.
 */

import { execFile } from 'node:child_process'
import type { SessionEvent } from '../../session.js'
import type { DetectResult, EnvOpts, HarnessAdapter, SpawnOpts } from '../adapter.js'
import type {
  CodexCommandExecutionItem,
  CodexItem,
  CodexItemCompletedEvent,
  CodexItemStartedEvent,
  CodexMcpCallItem,
  CodexStreamEvent,
} from '../codex-events.js'

export class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex'
  readonly name = 'ChatGPT Codex'
  readonly command = 'codex'

  async detect(): Promise<DetectResult> {
    // Step 1: Check if CLI is installed
    const installed = await new Promise<boolean>((resolve) => {
      execFile('which', ['codex'], (err) => resolve(!err))
    })

    if (!installed) {
      return { installed: false }
    }

    // Step 2: Get version
    const version = await new Promise<string | undefined>((resolve) => {
      execFile('codex', ['--version'], { timeout: 5_000 }, (err, stdout) => {
        resolve(err ? undefined : stdout.trim())
      })
    })

    // Step 3: Check auth status via `codex login status`
    // Note: codex outputs status to stderr, not stdout
    const auth = await new Promise<DetectResult['auth']>((resolve) => {
      execFile('codex', ['login', 'status'], { timeout: 5_000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ loggedIn: false })
          return
        }
        const output = (stdout.trim() || stderr.trim())
        // Output is like "Logged in using ChatGPT" or "Logged in using API key"
        const loggedIn = output.toLowerCase().includes('logged in')
        resolve({
          loggedIn,
          subscriptionType: loggedIn ? output.replace(/^Logged in using\s*/i, '') : undefined,
        })
      })
    })

    return { installed: true, version, auth }
  }

  buildSpawnArgs(opts: SpawnOpts): string[] {
    // For resume, use the `exec resume` subcommand
    // Note: resume does NOT support --color, only --json/--full-auto/--skip-git-repo-check
    if (opts.resumeSessionId) {
      const args: string[] = [
        'exec',
        'resume',
        opts.resumeSessionId,
        opts.message,
        '--json',
        '--full-auto',
        '--skip-git-repo-check',
      ]

      if (opts.model) {
        args.push('-m', opts.model)
      }

      // Re-register MCP shim for resumed sessions
      if (opts.shimPath && opts.socketPath && opts.sessionId) {
        args.push('-c', `mcp_servers.anton.command="node"`)
        args.push('-c', `mcp_servers.anton.args=["${opts.shimPath}"]`)
        args.push('-c', `mcp_servers.anton.env.ANTON_SOCK="${opts.socketPath}"`)
        args.push('-c', `mcp_servers.anton.env.ANTON_SESSION="${opts.sessionId}"`)
      }

      return args
    }

    const args: string[] = [
      'exec',
      opts.message,
      '--json',
      '--color',
      'never',
      '--full-auto',
      '--skip-git-repo-check',
    ]

    if (opts.model) {
      args.push('-m', opts.model)
    }

    if (opts.cwd) {
      args.push('-C', opts.cwd)
    }

    if (opts.systemPrompt) {
      args.push('-c', `instructions="${opts.systemPrompt.replace(/"/g, '\\"')}"`)
    }

    // Register Anton MCP shim via inline config overrides
    // Codex doesn't support --mcp-config, so we use -c to set mcp_servers
    if (opts.shimPath && opts.socketPath && opts.sessionId) {
      args.push('-c', `mcp_servers.anton.command="node"`)
      args.push('-c', `mcp_servers.anton.args=["${opts.shimPath}"]`)
      args.push('-c', `mcp_servers.anton.env.ANTON_SOCK="${opts.socketPath}"`)
      args.push('-c', `mcp_servers.anton.env.ANTON_SESSION="${opts.sessionId}"`)
    }

    return args
  }

  buildEnv(opts: EnvOpts): Record<string, string> {
    return {
      ANTON_SOCK: opts.socketPath,
      ANTON_SESSION: opts.sessionId,
    }
  }

  parseEvent(line: string): SessionEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let event: CodexStreamEvent
    try {
      event = JSON.parse(trimmed)
    } catch {
      return []
    }

    switch (event.type) {
      case 'thread.started':
        // Metadata only — session ID extracted separately
        return []

      case 'turn.started':
        return []

      case 'item.started':
        return this.parseItemStarted(event)

      case 'item.completed':
        return this.parseItemCompleted(event)

      case 'turn.completed':
        return [
          {
            type: 'done',
            usage: {
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
              totalTokens: event.usage.input_tokens + event.usage.output_tokens,
              cacheReadTokens: event.usage.cached_input_tokens ?? 0,
              cacheWriteTokens: 0,
            },
          },
        ]

      case 'error':
        return [{ type: 'error', message: event.message }]

      default:
        return []
    }
  }

  extractSessionId(event: unknown): string | null {
    const e = event as { type?: string; thread_id?: string }
    if (e.type === 'thread.started' && e.thread_id) {
      return e.thread_id
    }
    return null
  }

  // ── Private parsers ─────────────────────────────────────────────

  private parseItemStarted(event: CodexItemStartedEvent): SessionEvent[] {
    const item = event.item

    switch (item.type) {
      case 'command_execution':
        return this.parseCommandStart(item)
      case 'mcp_call':
        return this.parseMcpCallStart(item)
      default:
        return []
    }
  }

  private parseItemCompleted(event: CodexItemCompletedEvent): SessionEvent[] {
    const item = event.item

    switch (item.type) {
      case 'agent_message':
        return [{ type: 'text', content: item.text }]
      case 'command_execution':
        return this.parseCommandResult(item)
      case 'mcp_call':
        return this.parseMcpCallResult(item)
      default:
        return []
    }
  }

  private parseCommandStart(item: CodexCommandExecutionItem): SessionEvent[] {
    return [
      {
        type: 'tool_call',
        id: item.id,
        name: 'shell',
        input: { command: item.command },
      },
    ]
  }

  private parseCommandResult(item: CodexCommandExecutionItem): SessionEvent[] {
    return [
      {
        type: 'tool_result',
        id: item.id,
        output: item.aggregated_output || `exit code: ${item.exit_code}`,
        isError: item.exit_code !== 0 && item.exit_code !== null,
      },
    ]
  }

  private parseMcpCallStart(item: CodexMcpCallItem): SessionEvent[] {
    return [
      {
        type: 'tool_call',
        id: item.id,
        name: `${item.server_label}:${item.tool_name}`,
        input: this.safeParseJson(item.arguments),
      },
    ]
  }

  private parseMcpCallResult(item: CodexMcpCallItem): SessionEvent[] {
    return [
      {
        type: 'tool_result',
        id: item.id,
        output: item.result ?? item.error ?? '',
        isError: Boolean(item.error),
      },
    ]
  }

  private safeParseJson(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str)
    } catch {
      return { raw: str }
    }
  }
}
