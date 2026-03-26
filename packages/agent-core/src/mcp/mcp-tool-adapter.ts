/**
 * Adapts MCP tools into pi SDK AgentTool format.
 *
 * Each MCP tool is namespaced as `mcp_{serverId}_{toolName}` to avoid
 * collisions with built-in tools or tools from other MCP servers.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { TextContent } from '@mariozechner/pi-ai'
import type { McpClient, McpTool } from './mcp-client.js'
import { jsonSchemaToTypebox } from './json-schema-to-typebox.js'

function toolResult(output: string, isError = false) {
  const content: TextContent[] = [{ type: 'text', text: output }]
  return { content, details: { raw: output, isError } }
}

/**
 * Convert a single MCP tool to a pi SDK AgentTool.
 */
export function mcpToolToAgentTool(mcpTool: McpTool, client: McpClient): AgentTool {
  const serverId = client.config.id
  const serverName = client.config.name

  return {
    name: `mcp_${serverId}_${mcpTool.name}`,
    label: mcpTool.name,
    description: `[${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: jsonSchemaToTypebox(mcpTool.inputSchema),
    async execute(_toolCallId, params) {
      try {
        const result = await client.callTool(mcpTool.name, params as Record<string, unknown>)
        const textParts = (result.content || [])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text as string)
        const output = textParts.join('\n') || '(no output)'
        return toolResult(output, result.isError)
      } catch (err) {
        return toolResult(`MCP tool error: ${(err as Error).message}`, true)
      }
    },
  }
}

/**
 * Convert all tools from an MCP client to pi SDK AgentTools.
 */
export function mcpClientToAgentTools(client: McpClient): AgentTool[] {
  return client.getTools().map((tool) => mcpToolToAgentTool(tool, client))
}
