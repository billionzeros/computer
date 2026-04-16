/**
 * Tool Registry — wraps Anton's existing tool implementations into MCP
 * JSON Schema format for use by harness sessions via the MCP shim.
 *
 * Static tools (always available): memory_save, memory_recall, memory_list,
 * notify, database_query, publish.
 *
 * Dynamic per-session tools (composed via session context):
 *   • connector tools (Slack/GitHub/Linear/etc. — one per connected service,
 *     auto-registered from ConnectorManager.getAllTools())
 *   • activate_workflow (when projectId + onActivateWorkflow handler present)
 *   • update_project_context (when projectId present)
 *
 * Tool descriptions and parameter schemas are reused verbatim from the
 * Pi SDK agent definitions — both backends show the model the same shape.
 */

import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { executeMemory, type MemoryInput } from '../tools/memory.js'
import { executeNotification, type NotificationInput } from '../tools/notification.js'
import { executeDatabase, type DatabaseInput } from '../tools/database.js'
import { executePublish, type PublishInput } from '../tools/publish.js'
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

// ── Static tools (unchanged from Phase 1) ──────────────────────────

const STATIC_TOOLS: ToolDefinition[] = [
  {
    schema: {
      name: 'memory_save',
      description:
        'Save a piece of information to persistent memory. Memories are stored as markdown files and persist across sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'A short identifier for this memory' },
          content: { type: 'string', description: 'The content to save' },
          scope: {
            type: 'string',
            enum: ['global', 'conversation'],
            description: 'Storage scope (default: global)',
          },
        },
        required: ['key', 'content'],
      },
    },
    async execute(args, sessionId) {
      const input: MemoryInput = {
        operation: 'save',
        key: args.key as string,
        content: args.content as string,
        scope: (args.scope as 'global' | 'conversation') || 'global',
      }
      const result = executeMemory(input, sessionId)
      return textResult(result)
    },
  },
  {
    schema: {
      name: 'memory_recall',
      description: 'Recall a previously saved memory by key.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key of the memory to recall' },
        },
        required: ['key'],
      },
    },
    async execute(args, sessionId) {
      const input: MemoryInput = {
        operation: 'recall',
        key: args.key as string,
      }
      const result = executeMemory(input, sessionId)
      return textResult(result)
    },
  },
  {
    schema: {
      name: 'memory_list',
      description: 'List all saved memories, optionally filtered by a search query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional search query to filter memories',
          },
        },
      },
    },
    async execute(args, sessionId) {
      const input: MemoryInput = {
        operation: 'list',
        query: args.query as string | undefined,
      }
      const result = executeMemory(input, sessionId)
      return textResult(result)
    },
  },
  {
    schema: {
      name: 'notify',
      description: 'Send a desktop notification to the user.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notification title' },
          message: { type: 'string', description: 'Notification message body' },
          sound: { type: 'boolean', description: 'Play notification sound (default: true)' },
        },
        required: ['title', 'message'],
      },
    },
    async execute(args) {
      const input: NotificationInput = {
        title: args.title as string,
        message: args.message as string,
        sound: args.sound as boolean | undefined,
      }
      const result = executeNotification(input)
      return textResult(result)
    },
  },
  {
    schema: {
      name: 'database_query',
      description:
        'Execute a SQL query against the Anton SQLite database. Supports query, execute, tables, and schema operations.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['query', 'execute', 'tables', 'schema'],
            description: 'The database operation to perform',
          },
          sql: {
            type: 'string',
            description: 'SQL query to execute (required for query/execute, table name for schema)',
          },
          db_path: {
            type: 'string',
            description: 'Path to SQLite database file (default: ~/.anton/data.db)',
          },
        },
        required: ['operation'],
      },
    },
    async execute(args) {
      const input: DatabaseInput = {
        operation: args.operation as DatabaseInput['operation'],
        sql: args.sql as string | undefined,
        db_path: args.db_path as string | undefined,
      }
      const result = executeDatabase(input)
      const isError = result.startsWith('Error:')
      return textResult(result, isError)
    },
  },
  {
    // Reused verbatim from Pi SDK's agent.ts `publish` tool description.
    schema: {
      name: 'publish',
      description:
        'Publish content as a self-contained HTML page accessible via a public URL. ' +
        'Use for sharing rendered markdown docs, code snippets, SVG graphics, mermaid diagrams, or full HTML pages. ' +
        'Returns the URL where the content is hosted.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page title shown in the browser tab and header' },
          content: { type: 'string', description: 'Raw content to publish (in the format specified by `type`)' },
          type: {
            type: 'string',
            enum: ['html', 'markdown', 'svg', 'mermaid', 'code'],
            description: 'Content format — html passes through, markdown/svg/mermaid/code are rendered to HTML',
          },
          language: {
            type: 'string',
            description: 'For type="code": language for syntax highlighting (e.g. "typescript")',
          },
          slug: {
            type: 'string',
            description: 'Optional URL slug (alphanumeric, _, -). Auto-generated if omitted.',
          },
        },
        required: ['title', 'content', 'type'],
      },
    },
    async execute(args) {
      const input: PublishInput = {
        title: args.title as string,
        content: args.content as string,
        type: args.type as PublishInput['type'],
        language: args.language as string | undefined,
        slug: args.slug as string | undefined,
      }
      const result = executePublish(input)
      return textResult(result)
    },
  },
]

// ── Per-session context + dynamic tools ─────────────────────────────

export interface HarnessSessionContext {
  /** Project attached to this session (if any). Gates project-scoped tools. */
  projectId?: string
  /** Surface label used to filter connector tools (slack, telegram, desktop). */
  surface?: string
  /** Handler for the activate_workflow tool. Leave undefined to hide the tool. */
  onActivateWorkflow?: (projectId: string, workflowId: string) => Promise<string>
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
   * only static tools are exposed.
   */
  getSessionContext?: (sessionId: string) => HarnessSessionContext | undefined
}

function buildActivateWorkflowTool(
  projectId: string,
  handler: (projectId: string, workflowId: string) => Promise<string>,
): ToolDefinition {
  return {
    // Name + description copied verbatim from Pi SDK's agent.ts.
    schema: {
      name: 'activate_workflow',
      description:
        'Activate a workflow by creating all its agents. Call this ONLY after the user has approved the final configuration plan. ' +
        'This creates the scheduled agents defined in the workflow manifest and starts them running.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow_id: {
            type: 'string',
            description: 'The workflow ID to activate (e.g. "lead-qualification")',
          },
        },
        required: ['workflow_id'],
      },
    },
    async execute(args) {
      try {
        const output = await handler(projectId, args.workflow_id as string)
        return textResult(output)
      } catch (err) {
        return textResult(`Failed to activate workflow: ${(err as Error).message}`, true)
      }
    },
  }
}

function buildUpdateProjectContextTool(): ToolDefinition {
  // Name + description + schema reused from Pi SDK's agent.ts. For the
  // harness, we just echo the structured JSON back as the tool result —
  // the server's turn loop captures it from tool_result events (same as
  // the Pi SDK path) to persist project summary updates.
  return {
    schema: {
      name: 'update_project_context',
      description:
        'Update the project context with a summary of what was accomplished in this session. ' +
        'Call this once per session when meaningful work has been done (feature implemented, bug fixed, significant decision made). ' +
        'This persists the summary so future sessions have context about past work.',
      inputSchema: {
        type: 'object',
        properties: {
          session_summary: {
            type: 'string',
            description: '1-2 sentence summary of what was accomplished in this session',
          },
          project_summary: {
            type: 'string',
            description:
              'Updated overall project summary incorporating new info. Only provide if something significant changed.',
          },
        },
        required: ['session_summary'],
      },
    },
    async execute(args) {
      return textResult(
        JSON.stringify({
          sessionSummary: args.session_summary,
          projectSummary: args.project_summary,
        }),
      )
    },
  }
}

/**
 * AntonToolRegistry — implements IpcToolProvider by composing static tool
 * definitions with per-session dynamic tools (connectors, workflow
 * activation, project-context updates).
 */
export class AntonToolRegistry implements IpcToolProvider {
  private connectorManager?: AntonToolRegistryOpts['connectorManager']
  private getSessionContext?: AntonToolRegistryOpts['getSessionContext']

  constructor(opts: AntonToolRegistryOpts = {}) {
    this.connectorManager = opts.connectorManager
    this.getSessionContext = opts.getSessionContext
  }

  /**
   * Compose the per-session tool map. Static tools are always present;
   * dynamic tools are added based on session context and live connector
   * state. Last-write-wins on name collision — we warn in that case.
   */
  private buildToolMap(sessionId: string): Map<string, ToolDefinition> {
    const map = new Map<string, ToolDefinition>()
    for (const t of STATIC_TOOLS) map.set(t.schema.name, t)

    const ctx = this.getSessionContext?.(sessionId)

    if (this.connectorManager) {
      const connectorTools = this.connectorManager.getAllTools(ctx?.surface)
      for (const tool of connectorTools) {
        try {
          const def = agentToolToMcpDefinition(tool)
          if (map.has(def.schema.name)) {
            log.warn(
              { name: def.schema.name, sessionId },
              'connector tool name collides with an existing tool — overriding',
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

    if (ctx?.projectId) {
      if (ctx.onActivateWorkflow) {
        const def = buildActivateWorkflowTool(ctx.projectId, ctx.onActivateWorkflow)
        map.set(def.schema.name, def)
      }
      const updateDef = buildUpdateProjectContextTool()
      map.set(updateDef.schema.name, updateDef)
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
