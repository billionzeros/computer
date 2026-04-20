/**
 * Tool Registry — serves Anton's tools over MCP to harness CLIs.
 *
 * Tool definitions live in ONE place (`tools/factories.ts` →
 * `buildSharedTools()`) so they cannot drift between the Pi SDK agent
 * and the harness MCP shim. This file does two things only:
 *
 *   1. Adapt `AgentTool` objects into MCP's shape via
 *      `agentToolToMcpDefinition`.
 *   2. Compose per-session tool sets from `buildSharedTools()` +
 *      connector tools, keyed on `HarnessSessionContext`.
 *
 * There is deliberately no hand-rolled tool schema in this file. Adding
 * a new Anton tool must go through `buildSharedTools()`.
 */

import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { AskUserHandler } from '../agent.js'
import type { BrowserCallbacks } from '../tools/browser.js'
import type { DeliverResultHandler } from '../tools/deliver-result.js'
import { buildAntonCoreTools } from '../tools/factories.js'
import type { JobActionHandler } from '../tools/job.js'
import type {
  IpcToolProvider,
  McpToolResult,
  McpToolSchema,
  ProgressCallback,
} from './mcp-ipc-handler.js'

const log = createLogger('tool-registry')

/**
 * Anton-side extension on top of Pi SDK's `AgentTool`: when a tool
 * defines `executeStreaming`, the registry routes MCP calls through it
 * and passes the progress callback so the tool can emit live updates
 * to the MCP caller. Tools without this method fall back to the
 * request/response `execute` path.
 *
 * This is additive — nothing in the Pi SDK path uses it; Pi SDK always
 * calls `execute`. Streaming is only meaningful over the harness MCP
 * bridge.
 */
export interface StreamingCapable {
  executeStreaming(
    toolCallId: string,
    params: unknown,
    onProgress: ProgressCallback,
  ): Promise<import('@mariozechner/pi-agent-core').AgentToolResult<unknown>>
}

export type MaybeStreamingTool = AgentTool & Partial<StreamingCapable>

interface ToolDefinition {
  schema: McpToolSchema
  execute(
    args: Record<string, unknown>,
    sessionId: string,
    onProgress?: ProgressCallback,
  ): Promise<McpToolResult>
}

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: 'text', text }], isError }
}

// ── AgentTool → MCP adapter ────────────────────────────────────────

/**
 * Convert a Pi SDK AgentTool into the MCP tool format the shim expects.
 *
 * TypeBox parameters are already valid JSON Schema, so we pass them
 * through as `inputSchema`. The execute wrapper flattens the AgentTool's
 * structured result (content: (TextContent | ImageContent)[]) into MCP's
 * simpler text-only result shape; image content is stringified as a
 * placeholder so we never silently drop data.
 */
export function agentToolToMcpDefinition(tool: MaybeStreamingTool): ToolDefinition {
  const streaming = typeof tool.executeStreaming === 'function'
  return {
    schema: {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as unknown as Record<string, unknown>,
    },
    async execute(args, _sessionId, onProgress) {
      const toolCallId = `mcp-${tool.name}-${Date.now().toString(36)}`
      const result =
        streaming && onProgress
          ? await tool.executeStreaming!(toolCallId, args as never, onProgress)
          : await tool.execute(toolCallId, args as never, undefined, undefined)
      const chunks: string[] = []
      for (const c of result.content) {
        if (c.type === 'text') {
          chunks.push(c.text)
        } else if (c.type === 'image') {
          chunks.push(`[image: ${c.mimeType ?? 'unknown'}, ${c.data.length} bytes]`)
        }
      }
      const isError = Boolean((result.details as { isError?: boolean } | undefined)?.isError)
      return textResult(chunks.join('\n'), isError)
    },
  }
}

// ── Per-session context + registry ─────────────────────────────────

export interface HarnessSessionContext {
  /** Project attached to this session (if any). Gates project-scoped tools. */
  projectId?: string
  /**
   * Project workspace dir. Inherited by child sessions spawned via
   * `spawn_sub_agent` so local tools land inside the right cwd.
   */
  workspacePath?: string
  /** Surface label used to filter connector tools (slack, telegram, desktop). */
  surface?: string
  /** Handler for the activate_workflow tool. Leave undefined to hide the tool. */
  onActivateWorkflow?: (projectId: string, workflowId: string) => Promise<string>
  /**
   * Handler for the `ask_user` tool. The server wires this so the
   * harness session displays interactive multi-choice questions through
   * the same Channel.AI flow Pi SDK sessions use. Undefined → no
   * ask_user tool exposed.
   */
  onAskUser?: AskUserHandler
  /** Domain used by the publish tool to build the public URL. */
  domain?: string
  /**
   * Browser-state callbacks for the `browser` tool. Server wires per-
   * session callbacks that push browser state events to the desktop
   * sidebar. Without this, `fetch` / `extract` still work but the
   * full-browser path produces no live updates.
   */
  browserCallbacks?: BrowserCallbacks
  /**
   * Handler that delivers an agent's final result back to the
   * conversation that spawned it. The server only sets this for
   * scheduled / sub-agent harness sessions; live user-driven sessions
   * leave it undefined so the `deliver_result` tool stays hidden.
   */
  onDeliverResult?: DeliverResultHandler
  /**
   * Job-action handler used by the project-scoped `routine` tool.
   * Server wires `buildAgentActionHandler(sessionId)` here so harness
   * sessions can create / list / start / stop / delete routines the
   * same way Pi SDK can.
   */
  onJobAction?: JobActionHandler
}

export interface AntonToolRegistryOpts {
  /**
   * Exposes every connected service's tools to harness sessions. The
   * same ConnectorManager the Pi SDK uses — no per-backend duplication.
   */
  connectorManager?: { getAllTools(surface?: string): AgentTool[] }
  /**
   * Called on every tools/list and tools/call to resolve the session's
   * context (projectId, surface, handlers). Returning undefined means
   * only the default (non-project) shared tools are exposed.
   */
  getSessionContext?: (sessionId: string) => HarnessSessionContext | undefined
}

/**
 * AntonToolRegistry — implements IpcToolProvider by adapting the shared
 * tool catalog plus any connected-service tools into MCP's shape.
 */
export class AntonToolRegistry implements IpcToolProvider {
  private connectorManager?: AntonToolRegistryOpts['connectorManager']
  private getSessionContext?: AntonToolRegistryOpts['getSessionContext']

  constructor(opts: AntonToolRegistryOpts = {}) {
    this.connectorManager = opts.connectorManager
    this.getSessionContext = opts.getSessionContext
  }

  /**
   * Compose the per-session tool map on demand. Rebuilt on every
   * tools/list + tools/call, so tools picked up from connectors that
   * come online mid-session appear without a registry restart.
   */
  private buildToolMap(sessionId: string): Map<string, ToolDefinition> {
    const ctx = this.getSessionContext?.(sessionId)

    const coreTools = buildAntonCoreTools({
      conversationId: sessionId,
      projectId: ctx?.projectId,
      workspacePath: ctx?.workspacePath,
      onActivateWorkflow: ctx?.onActivateWorkflow,
      onAskUser: ctx?.onAskUser,
      onDeliverResult: ctx?.onDeliverResult,
      onJobAction: ctx?.onJobAction,
      browserCallbacks: ctx?.browserCallbacks,
      domain: ctx?.domain,
      // Harness path gets spawn_sub_agent with live MCP progress.
      includeHarnessMcpTools: true,
    })

    const map = new Map<string, ToolDefinition>()
    for (const tool of coreTools) {
      map.set(tool.name, agentToolToMcpDefinition(tool))
    }

    if (this.connectorManager) {
      const connectorTools = this.connectorManager.getAllTools(ctx?.surface)
      for (const tool of connectorTools) {
        try {
          const def = agentToolToMcpDefinition(tool)
          if (map.has(def.schema.name)) {
            log.warn(
              { name: def.schema.name, sessionId },
              'connector tool name collides with a shared tool — overriding',
            )
          }
          map.set(def.schema.name, def)
        } catch (err) {
          log.warn({ err, name: tool.name, sessionId }, 'failed to adapt connector tool — skipping')
        }
      }
    }

    return map
  }

  getTools(sessionId: string): McpToolSchema[] {
    const map = this.buildToolMap(sessionId)
    return Array.from(map.values()).map((t) => t.schema)
  }

  async executeTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<McpToolResult> {
    const map = this.buildToolMap(sessionId)
    const tool = map.get(name)
    if (!tool) {
      log.warn({ name, sessionId }, 'Unknown tool requested')
      return textResult(`Unknown tool: ${name}`, true)
    }

    log.info({ tool: name, sessionId, streaming: Boolean(onProgress) }, 'Executing MCP tool')

    try {
      return await tool.execute(args, sessionId, onProgress)
    } catch (err) {
      log.error({ err, tool: name, sessionId }, 'Tool execution failed')
      return textResult(`Tool error: ${(err as Error).message}`, true)
    }
  }
}
