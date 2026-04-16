/**
 * Tool Registry — wraps Anton's existing tool implementations into MCP
 * JSON Schema format for use by harness sessions via the MCP shim.
 *
 * Phase 1 tools: memory_save, memory_recall, memory_list, notify, database_query
 */

import { createLogger } from '@anton/logger'
import { executeMemory, type MemoryInput } from '../tools/memory.js'
import { executeNotification, type NotificationInput } from '../tools/notification.js'
import { executeDatabase, type DatabaseInput } from '../tools/database.js'
import type { IpcToolProvider, McpToolResult, McpToolSchema } from './mcp-ipc-handler.js'

const log = createLogger('tool-registry')

interface ToolDefinition {
  schema: McpToolSchema
  execute(args: Record<string, unknown>, sessionId: string): Promise<McpToolResult>
}

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: 'text', text }], isError }
}

const TOOLS: ToolDefinition[] = [
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
      description:
        'List all saved memories, optionally filtered by a search query.',
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
]

const toolMap = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.schema.name, t]))

/**
 * AntonToolRegistry — implements IpcToolProvider by wrapping
 * existing tool implementations into the MCP format.
 */
export class AntonToolRegistry implements IpcToolProvider {
  getTools(_sessionId: string): McpToolSchema[] {
    return TOOLS.map((t) => t.schema)
  }

  async executeTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const tool = toolMap.get(name)
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
