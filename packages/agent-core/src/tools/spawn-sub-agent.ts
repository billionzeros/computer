/**
 * `spawn_sub_agent` — exposes Pi SDK's typed sub-agent mechanism
 * (research / execute / verify) to harness CLIs via MCP.
 *
 * The tool is registered in `buildAntonCoreTools()` so every harness
 * (Codex, Claude Code, …) sees it as `anton:spawn_sub_agent` through
 * their MCP server list.
 *
 * Streaming model: the harness MCP shim carries MCP progress
 * notifications back to the parent CLI. On Codex, that becomes
 * `item/mcpToolCall/progress` notifications, which
 * `CodexHarnessSession.onMcpToolCallProgress()` turns into
 * `sub_agent_progress` SessionEvents — rendering inside the existing
 * `SubAgentGroup.tsx` UI card without any UI changes.
 *
 * Scope for v1 (this file):
 *   - Typed sub-agents (research/execute/verify) only. No fork mode —
 *     fork inherits parent conversation context which the MCP path
 *     doesn't transport cleanly.
 *   - Child is always a fresh Pi SDK Session (Anthropic). The parent's
 *     provider is not inherited. Simpler, deterministic; matches how
 *     research works best anyway (Claude is typically stronger for
 *     long-form synthesis than GPT-5.4 in our evals).
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { loadConfig } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import {
  SUB_AGENT_BUDGETS,
  SUB_AGENT_TYPE_PREFIXES,
  type SubAgentType,
} from './sub-agent-config.js'
import { createSession, type SessionEvent } from '../session.js'
import type { ProgressCallback } from '../harness/mcp-ipc-handler.js'
import type { StreamingCapable } from '../harness/tool-registry.js'
import { defineTool, toolResult } from './_helpers.js'

const log = createLogger('spawn-sub-agent')

const DESCRIPTION =
  'Spawn an autonomous sub-agent to handle a delimited sub-task and return its final answer. ' +
  'Pick a `type` to specialize the child:\n' +
  '  • `research` — information gathering, no file writes. 100k token budget, 30 turn max.\n' +
  '  • `execute`  — build/change tasks with verification. Full write access. 200k budget, 50 turns.\n' +
  '  • `verify`   — runs tests/linters/checks, reports PASS/FAIL. Read-only. 100k budget, 30 turns.\n' +
  '\n' +
  'WHEN TO PREFER THIS over doing the work inline:\n' +
  '  • Multi-page research. Spawning `type:"research"` keeps YOUR context clean — the child ' +
  'returns a single synthesized summary instead of dumping 50 URLs into your own history.\n' +
  '  • Running tests or a build. `type:"verify"` lets verification output stay contained.\n' +
  '  • Parallel sub-tasks. You can spawn multiple sub_agents in one response; they run concurrently.\n' +
  '\n' +
  'The child is a fresh Anton Pi SDK session (Anthropic). It has its own tool set, its own token budget, ' +
  'and no access to your conversation history. Pass the full context the child needs in the `task` string. ' +
  'The tool returns the child\'s final report as a single text result.'

export interface SpawnSubAgentParams {
  task: string
  type: SubAgentType
}

export interface SpawnSubAgentContext {
  /** Parent session's project id — inherited by the child. */
  parentProjectId?: string
  /**
   * Parent session's workspace dir — seeded as the child's cwd so
   * local tools (read, grep, shell) land inside the right project.
   */
  parentWorkspacePath?: string
}

/** Build a progress-aware version of the tool for MCP-streaming callers. */
export function buildSpawnSubAgentTool(
  ctx: SpawnSubAgentContext = {},
): AgentTool & StreamingCapable {
  const base = defineTool({
    name: 'spawn_sub_agent',
    label: 'Spawn Sub-Agent',
    description: DESCRIPTION,
    parameters: Type.Object({
      task: Type.String({
        description:
          'A self-contained description of what the child should do. Include any context the ' +
          'child needs — it does not see your conversation history. For research: state the ' +
          'scope and the question. For execute: state the goal and any constraints. For verify: ' +
          'list the specific checks to run.',
      }),
      type: Type.Union(
        [
          Type.Literal('research'),
          Type.Literal('execute'),
          Type.Literal('verify'),
        ],
        { description: 'Specialization. Required — pick one.' },
      ),
    }),
    async execute(_toolCallId, params) {
      // Non-streaming path — used by Pi SDK callers that bypass MCP.
      // No progress callback available; run to completion silently.
      const out = await runSubAgent(params, () => {}, ctx)
      return toolResult(out.text, out.hadError)
    },
  })

  // Attach the streaming variant. Only the harness MCP bridge invokes
  // this path (tool-registry.ts:agentToolToMcpDefinition dispatches based
  // on its presence + a live progress callback).
  const streaming: AgentTool & StreamingCapable = {
    ...base,
    async executeStreaming(
      _toolCallId: string,
      params: unknown,
      onProgress: ProgressCallback,
    ): Promise<AgentToolResult<unknown>> {
      const out = await runSubAgent(params as SpawnSubAgentParams, onProgress, ctx)
      return toolResult(out.text, out.hadError)
    },
  }
  return streaming
}

/**
 * Run a child session to completion, streaming progress updates.
 * Kept as a free function so the non-streaming `execute` path can
 * reuse it by passing a no-op callback.
 */
async function runSubAgent(
  params: SpawnSubAgentParams,
  onProgress: ProgressCallback,
  ctx: SpawnSubAgentContext,
): Promise<{ text: string; hadError: boolean }> {
  const { task, type } = params
  if (!task || !type) {
    return { text: 'spawn_sub_agent: `task` and `type` are required.', hadError: true }
  }
  const budget = SUB_AGENT_BUDGETS[type]
  const prefix = SUB_AGENT_TYPE_PREFIXES[type]
  if (!budget || !prefix) {
    return { text: `spawn_sub_agent: unsupported type "${type}"`, hadError: true }
  }

  let config
  try {
    config = loadConfig()
  } catch (err) {
    return {
      text: `spawn_sub_agent: failed to load Anton config: ${(err as Error).message}`,
      hadError: true,
    }
  }

  const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const emitter = createThrottledProgress(onProgress, 200)
  emitter.push(`↳ spawning ${type} sub-agent`)

  let childSession: ReturnType<typeof createSession>
  try {
    childSession = createSession(id, config, {
      ephemeral: true,
      // Inherit the parent's project scope so local tools and memory
      // look up the right workspace. Missing from v0 and caused
      // research-in-project to run against a neutral cwd.
      projectId: ctx.parentProjectId,
      projectWorkspacePath: ctx.parentWorkspacePath,
      // Hard wall-clock cap. Token + turn caps are advisory today —
      // Pi SDK's Session doesn't expose those as constructor options,
      // so this is our one enforcement lever.
      maxDurationMs: budget.maxDurationMs,
    })
  } catch (err) {
    log.warn({ err: (err as Error).message, type }, 'child session construction failed')
    return {
      text: `spawn_sub_agent: failed to start child: ${(err as Error).message}`,
      hadError: true,
    }
  }

  const accumulated: string[] = []
  let hadError = false

  try {
    for await (const event of childSession.processMessage(`${prefix}${task}`)) {
      const maybeMessage = flattenForProgress(event)
      if (maybeMessage) emitter.push(maybeMessage)
      if (event.type === 'text') {
        accumulated.push(event.content)
      } else if (event.type === 'error') {
        hadError = true
        accumulated.push(`[error] ${event.message}`)
      }
    }
  } catch (err) {
    log.warn({ err: (err as Error).message, type, id }, 'child session threw')
    hadError = true
    accumulated.push(`[error] ${(err as Error).message}`)
  } finally {
    emitter.flush()
  }

  const finalText = accumulated.join('').trim() || '(sub-agent produced no output)'
  onProgress(hadError ? '⚠ sub-agent ended with error' : '✓ sub-agent complete')
  return { text: finalText, hadError }
}

/**
 * Coalesce progress messages within a time window. Unlike "skip if
 * recent", this keeps the LATEST message within the window and flushes
 * on a trailing timer — so bursts don't lose information.
 */
function createThrottledProgress(
  onProgress: ProgressCallback,
  windowMs: number,
): { push: (msg: string) => void; flush: () => void } {
  let pending: string | null = null
  let timer: NodeJS.Timeout | null = null
  let lastEmit = 0

  const emit = () => {
    if (pending !== null) {
      onProgress(pending)
      pending = null
      lastEmit = Date.now()
    }
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    push(msg: string) {
      const now = Date.now()
      const sinceLast = now - lastEmit
      if (sinceLast >= windowMs && !timer) {
        onProgress(msg)
        lastEmit = now
        return
      }
      pending = msg
      if (!timer) {
        const wait = Math.max(0, windowMs - sinceLast)
        timer = setTimeout(emit, wait)
      }
    },
    flush: emit,
  }
}

/**
 * Compress a child SessionEvent into a single progress-message line.
 * Returns null for events we don't want to surface (text deltas, thinking).
 */
function flattenForProgress(event: SessionEvent): string | null {
  switch (event.type) {
    case 'tool_call': {
      const inp = event.input as Record<string, unknown> | undefined
      if (event.name === 'shell' && inp?.command) {
        return `→ shell: ${String(inp.command).slice(0, 80)}`
      }
      if (event.name === 'web_search' && inp?.query) {
        return `→ search: ${String(inp.query).slice(0, 80)}`
      }
      if (event.name === 'browser' && inp?.url) {
        return `→ browse: ${String(inp.url).slice(0, 80)}`
      }
      return `→ ${event.name}`
    }
    case 'tool_result':
      return event.isError ? '← failed' : '← ok'
    case 'artifact':
      return `📄 wrote ${event.filename ?? event.filepath ?? 'file'}`
    case 'sub_agent_start':
      return `↳ nested sub-agent: ${event.task.slice(0, 80)}`
    case 'error':
      return `⚠ ${event.message.slice(0, 160)}`
    default:
      return null
  }
}
