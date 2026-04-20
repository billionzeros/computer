/**
 * ClaudeAdapter — bridges Claude Code CLI (`claude`) into Anton's harness system.
 *
 * Spawns `claude` with `--output-format stream-json`, parses NDJSON output,
 * and maps Claude Code events to SessionEvent types.
 */

import { execFile } from 'node:child_process'
import type { SessionEvent } from '../../session.js'
import type { DetectResult, EnvOpts, HarnessAdapter, SpawnOpts } from '../adapter.js'
import type {
  ClaudeAssistantEvent,
  ClaudeContentBlock,
  ClaudeResultEvent,
  ClaudeStreamEvent,
  ClaudeSystemEvent,
} from '../claude-events.js'

export class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  readonly command = 'claude'

  async detect(): Promise<DetectResult> {
    // Step 1: Check if CLI is installed
    const installed = await new Promise<boolean>((resolve) => {
      execFile('which', ['claude'], (err) => resolve(!err))
    })

    if (!installed) {
      return { installed: false }
    }

    // Step 2: Get version
    const version = await new Promise<string | undefined>((resolve) => {
      execFile('claude', ['--version'], { timeout: 5_000 }, (err, stdout) => {
        resolve(err ? undefined : stdout.trim())
      })
    })

    // Step 3: Check auth status
    const auth = await new Promise<DetectResult['auth']>((resolve) => {
      execFile('claude', ['auth', 'status'], { timeout: 5_000 }, (err, stdout) => {
        if (err) {
          resolve({ loggedIn: false })
          return
        }
        try {
          const status = JSON.parse(stdout.trim())
          resolve({
            loggedIn: Boolean(status.loggedIn),
            email: status.email,
            subscriptionType: status.subscriptionType,
            authMethod: status.authMethod,
          })
        } catch {
          resolve({ loggedIn: false })
        }
      })
    })

    return { installed: true, version, auth }
  }

  buildSpawnArgs(opts: SpawnOpts): string[] {
    const args: string[] = [
      '-p',
      opts.message,
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-input',
      '--permission-mode',
      'bypassPermissions',
    ]

    if (opts.mcpConfigPath) {
      args.push('--mcp-config', opts.mcpConfigPath)
    }

    if (opts.model) {
      args.push('--model', opts.model)
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId)
    }

    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt)
    }

    if (opts.maxBudgetUsd) {
      args.push('--max-turns', '50')
    }

    return args
  }

  buildEnv(opts: EnvOpts): Record<string, string> {
    return {
      ANTON_SOCK: opts.socketPath,
      ANTON_SESSION: opts.sessionId,
      ANTON_AUTH: opts.authToken,
    }
  }

  parseEvent(line: string): SessionEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let event: ClaudeStreamEvent
    try {
      event = JSON.parse(trimmed)
    } catch {
      return []
    }

    switch (event.type) {
      case 'system':
        return this.parseSystemEvent(event)
      case 'assistant':
        return this.parseAssistantEvent(event)
      case 'result':
        return this.parseResultEvent(event)
      default:
        return []
    }
  }

  extractSessionId(event: unknown): string | null {
    const e = event as { type?: string; session_id?: string }
    if (e.type === 'system' || e.type === 'result') {
      return e.session_id ?? null
    }
    return null
  }

  // ── Private parsers ─────────────────────────────────────────────

  private parseSystemEvent(_event: ClaudeSystemEvent): SessionEvent[] {
    // System/init events are metadata — no user-visible session events needed
    return []
  }

  private parseAssistantEvent(event: ClaudeAssistantEvent): SessionEvent[] {
    const events: SessionEvent[] = []

    for (const block of event.message.content) {
      events.push(...this.parseContentBlock(block))
    }

    return events
  }

  private parseContentBlock(block: ClaudeContentBlock): SessionEvent[] {
    switch (block.type) {
      case 'text':
        return [{ type: 'text', content: block.text }]

      case 'thinking':
        return [{ type: 'thinking', text: block.thinking }]

      case 'tool_use': {
        const events: SessionEvent[] = [
          {
            type: 'tool_call',
            id: block.id,
            name: block.name,
            input: block.input,
          },
        ]
        // Mirror Pi SDK's Session.detectArtifact / emitTasksUpdate for
        // Anton-owned tools whose side effects are protocol-level
        // SessionEvents on top of the normal tool_call. Claude Code
        // prefixes MCP tools as `mcp__<server>__<tool>`, so our anton
        // factory tools land here as `mcp__anton__<name>`.
        if (block.name === 'mcp__anton__artifact') {
          const artifactEvent = buildArtifactEvent(block.id, block.input)
          if (artifactEvent) events.push(artifactEvent)
        } else if (block.name === 'mcp__anton__task_tracker') {
          const tasksEvent = buildTasksUpdateEvent(block.input)
          if (tasksEvent) events.push(tasksEvent)
        }
        return events
      }

      case 'tool_result':
        return [
          {
            type: 'tool_result',
            id: block.tool_use_id,
            output:
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            isError: block.is_error,
          },
        ]

      default:
        return []
    }
  }

  private parseResultEvent(event: ClaudeResultEvent): SessionEvent[] {
    const events: SessionEvent[] = []

    if (event.is_error && event.error) {
      const m = event.error.toLowerCase()
      const code =
        m.includes('authentication') || m.includes('unauthorized') || m.includes('not logged in')
          ? ('not_authed' as const)
          : ('runtime' as const)
      events.push({ type: 'error', message: event.error, code })
    }

    events.push({
      type: 'done',
      usage: {
        inputTokens: event.usage.input_tokens,
        outputTokens: event.usage.output_tokens,
        totalTokens: event.usage.input_tokens + event.usage.output_tokens,
        cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: event.usage.cache_creation_input_tokens ?? 0,
      },
    })

    return events
  }
}

/**
 * Translate `mcp__anton__artifact` input into the SessionEvent shape Pi
 * SDK emits via `Session.detectArtifact`. Returns null if the input is
 * malformed (no content) so the desktop side panel doesn't render an
 * empty artifact.
 */
/**
 * Translate `mcp__anton__task_tracker` input into the `tasks_update`
 * SessionEvent. Mirrors Pi SDK's `Session.emitTasksUpdate` shape.
 */
function buildTasksUpdateEvent(rawInput: unknown): SessionEvent | null {
  const input = (rawInput ?? {}) as {
    tasks?: Array<{
      content?: string
      activeForm?: string
      status?: 'pending' | 'in_progress' | 'completed'
    }>
  }
  if (!Array.isArray(input.tasks)) return null
  const tasks = input.tasks
    .filter((t) => typeof t?.content === 'string' && typeof t.status === 'string')
    .map((t) => ({
      content: t.content as string,
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : (t.content as string),
      status: t.status as 'pending' | 'in_progress' | 'completed',
    }))
  if (tasks.length === 0) return null
  return { type: 'tasks_update', tasks }
}

function buildArtifactEvent(toolCallId: string, rawInput: unknown): SessionEvent | null {
  const input = (rawInput ?? {}) as {
    type?: string
    title?: string
    content?: string
    filename?: string
    language?: string
  }
  if (typeof input.content !== 'string' || !input.content) return null
  const artType = (input.type as 'html' | 'code' | 'markdown' | 'svg' | 'mermaid') || 'code'
  const language = artType === 'code' ? (input.language ?? 'text') : artType
  return {
    type: 'artifact',
    id: `artifact_${toolCallId}_${Date.now()}`,
    toolCallId,
    artifactType: 'artifact',
    renderType: artType,
    title: input.title,
    filename: input.filename,
    filepath: input.filename,
    language,
    content: input.content,
  }
}
