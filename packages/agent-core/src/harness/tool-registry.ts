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
import { buildAntonCoreTools } from '../tools/factories.js'
import type { IpcToolProvider, McpToolResult, McpToolSchema } from './mcp-ipc-handler.js'

const log = createLogger('tool-registry')

interface ToolDefinition {
  schema: McpToolSchema
  execute(args: Record<string, unknown>, sessionId: string): Promise<McpToolResult>
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
export function agentToolToMcpDefinition(tool: AgentTool): ToolDefinition {
  return {
    schema: {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as unknown as Record<string, unknown>,
    },
    async execute(args) {
      const toolCallId = `mcp-${tool.name}-${Date.now().toString(36)}`
      const result = await tool.execute(toolCallId, args as never, undefined, undefined)
      const chunks: string[] = []
      for (const c of result.content) {
        if (c.type === 'text') {
          chunks.push(c.text)
        } else if (c.type === 'image') {
          chunks.push(`[image: ${c.mimeType ?? 'unknown'}, ${c.data.length} bytes]`)
        }
      }
      const isError = Boolean(
        (result.details as { isError?: boolean } | undefined)?.isError,
      )
      return textResult(chunks.join('\n'), isError)
    },
  }
}

// ── Per-session context + registry ─────────────────────────────────

export interface HarnessSessionContext {
  /** Project attached to this session (if any). Gates project-scoped tools. */
  projectId?: string
  /** Surface label used to filter connector tools (slack, telegram, desktop). */
  surface?: string
  /** Handler for the activate_workflow tool. Leave undefined to hide the tool. */
  onActivateWorkflow?: (projectId: string, workflowId: string) => Promise<string>
  /** Domain used by the publish tool to build the public URL. */
  domain?: string
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
      onActivateWorkflow: ctx?.onActivateWorkflow,
      domain: ctx?.domain,
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
          log.warn(
            { err, name: tool.name, sessionId },
            'failed to adapt connector tool — skipping',
          )
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
  ): Promise<McpToolResult> {
    const map = this.buildToolMap(sessionId)
    const tool = map.get(name)
    if (!tool) {
      log.warn({ name, sessionId }, 'Unknown tool requested')
      return textResult(`Unknown tool: ${name}`, true)
    }

    log.info({ tool: name, sessionId }, 'Executing MCP tool')

    try {
      return await tool.execute(args, sessionId)
    } catch (err) {
      log.error({ err, tool: name, sessionId }, 'Tool execution failed')
      return textResult(`Tool error: ${(err as Error).message}`, true)
    }
  }
}
