/**
 * MCP Manager — manages multiple MCP server connections.
 *
 * Lifecycle:
 * 1. Server startup → startAll(configs) spawns enabled connectors
 * 2. Session create → getAllTools() merges MCP tools with built-in tools
 * 3. Config change → start/stop/restart individual connectors
 * 4. Server shutdown → stopAll() kills all processes
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { McpClient, type McpServerConfig } from './mcp-client.js'
import { mcpClientToAgentTools } from './mcp-tool-adapter.js'

export interface ConnectorStatus {
  id: string
  name: string
  description?: string
  connected: boolean
  toolCount: number
  tools: string[]
  error?: string
}

export class McpManager {
  private clients = new Map<string, McpClient>()
  private configs = new Map<string, McpServerConfig>()

  /**
   * Start all enabled connectors from config.
   */
  async startAll(configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      this.configs.set(config.id, config)
    }

    const enabled = configs.filter((c) => c.enabled)
    if (enabled.length === 0) return

    console.log(`[mcp-manager] starting ${enabled.length} connectors...`)

    // Start in parallel, don't fail-fast
    const results = await Promise.allSettled(enabled.map((c) => this.start(c.id)))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'rejected') {
        console.error(`[mcp-manager] failed to start "${enabled[i].id}":`, r.reason?.message || r.reason)
      }
    }
  }

  /**
   * Stop all connectors and clean up.
   */
  async stopAll(): Promise<void> {
    console.log("[mcp-manager] stopping all connectors...")
    const promises = Array.from(this.clients.keys()).map((id) => this.stop(id))
    await Promise.allSettled(promises)
  }

  /**
   * Start a single connector by id.
   */
  async start(id: string): Promise<void> {
    const config = this.configs.get(id)
    if (!config) throw new Error(`Unknown connector: ${id}`)

    // Stop existing if running
    if (this.clients.has(id)) {
      await this.stop(id)
    }

    const client = new McpClient(config)

    client.on('disconnected', () => {
      console.log(`[mcp-manager] connector "${id}" disconnected`)
      this.clients.delete(id)
    })

    client.on('error', (err: Error) => {
      console.error(`[mcp-manager] connector "${id}" error:`, err.message)
    })

    await client.connect()
    this.clients.set(id, client)
    console.log(`[mcp-manager] connector "${id}" started with ${client.getTools().length} tools`)
  }

  /**
   * Stop a single connector.
   */
  async stop(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (client) {
      await client.disconnect()
      this.clients.delete(id)
      console.log(`[mcp-manager] connector "${id}" stopped`)
    }
  }

  /**
   * Restart a connector (stop + start).
   */
  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  /**
   * Add a new connector config and optionally start it.
   */
  async addConnector(config: McpServerConfig): Promise<void> {
    this.configs.set(config.id, config)
    if (config.enabled) {
      await this.start(config.id)
    }
  }

  /**
   * Remove a connector — stop it and delete config.
   */
  async removeConnector(id: string): Promise<void> {
    await this.stop(id)
    this.configs.delete(id)
  }

  /**
   * Update a connector's enabled state.
   */
  async toggleConnector(id: string, enabled: boolean): Promise<void> {
    const config = this.configs.get(id)
    if (!config) throw new Error(`Unknown connector: ${id}`)
    config.enabled = enabled
    if (enabled) {
      await this.start(id)
    } else {
      await this.stop(id)
    }
  }

  /**
   * Test a connector — try to connect and discover tools, then disconnect.
   */
  async testConnector(id: string): Promise<{ success: boolean; tools: string[]; error?: string }> {
    const config = this.configs.get(id)
    if (!config) return { success: false, tools: [], error: `Unknown connector: ${id}` }

    const client = new McpClient(config)
    try {
      await client.connect()
      const tools = client.getTools().map((t) => t.name)
      await client.disconnect()
      return { success: true, tools }
    } catch (err) {
      try {
        await client.disconnect()
      } catch {}
      return { success: false, tools: [], error: (err as Error).message }
    }
  }

  /**
   * Get all tools from all connected MCP servers, as pi SDK AgentTools.
   * This is the key method — called by buildTools() to merge MCP tools.
   */
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = []
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        tools.push(...mcpClientToAgentTools(client))
      }
    }
    return tools
  }

  /**
   * Get status of all configured connectors.
   */
  getStatus(): ConnectorStatus[] {
    const statuses: ConnectorStatus[] = []
    for (const config of this.configs.values()) {
      const client = this.clients.get(config.id)
      statuses.push({
        id: config.id,
        name: config.name,
        description: config.description,
        connected: client?.isConnected() ?? false,
        toolCount: client?.getTools().length ?? 0,
        tools: client?.getTools().map((t) => t.name) ?? [],
      })
    }
    return statuses
  }

  /**
   * Check if a specific connector is running.
   */
  isConnected(id: string): boolean {
    return this.clients.get(id)?.isConnected() ?? false
  }
}
