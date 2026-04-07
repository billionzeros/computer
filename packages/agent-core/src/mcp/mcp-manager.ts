/**
 * MCP Manager — manages multiple MCP server connections.
 *
 * Lifecycle:
 * 1. Server startup → startAll(configs) spawns enabled connectors
 * 2. Session create → getAllTools() merges MCP tools with built-in tools
 * 3. Config change → start/stop/restart individual connectors
 * 4. Server shutdown → stopAll() kills all processes
 */

import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { McpClient, type McpServerConfig } from './mcp-client.js'
import { mcpClientToAgentTools } from './mcp-tool-adapter.js'

const log = createLogger('mcp-manager')

export interface ConnectorStatus {
  id: string
  name: string
  description?: string
  connected: boolean
  toolCount: number
  tools: string[]
  error?: string
}

/** Per-tool permission override applied at runtime. Anything missing from the map defaults to 'auto'. */
export type McpToolPermission = 'auto' | 'ask' | 'never'

export class McpManager {
  private clients = new Map<string, McpClient>()
  private configs = new Map<string, McpServerConfig>()
  private healthTimer: NodeJS.Timeout | null = null
  /** Per-connector tool permission overrides. */
  private toolPermissions = new Map<string, Record<string, McpToolPermission>>()

  /**
   * Replace the per-tool permission overrides for a connector. Tools missing
   * from the map (or set to 'auto') execute normally. 'never' tools are
   * filtered from getAllTools() entirely. 'ask' tools require user confirmation
   * via the session confirm handler before each call.
   */
  setToolPermissions(id: string, perms: Record<string, McpToolPermission> | undefined): void {
    if (!perms || Object.keys(perms).length === 0) {
      this.toolPermissions.delete(id)
    } else {
      this.toolPermissions.set(id, { ...perms })
    }
  }

  /**
   * Look up the runtime permission for an agent-facing tool name. Returns 'auto'
   * for any tool that does not belong to a known MCP connector or has no override.
   *
   * Agent tool names produced by mcp-tool-adapter are `mcp_${connectorId}_${toolName}`.
   * Connector ids may themselves contain underscores, so we match by prefix against
   * each known connector id.
   */
  getToolPermission(agentToolName: string): McpToolPermission {
    if (!agentToolName.startsWith('mcp_')) return 'auto'
    for (const [connectorId, perms] of this.toolPermissions) {
      const prefix = `mcp_${connectorId}_`
      if (agentToolName.startsWith(prefix)) {
        const rawName = agentToolName.slice(prefix.length)
        return perms[rawName] ?? 'auto'
      }
    }
    return 'auto'
  }

  /**
   * Start all enabled connectors from config.
   */
  async startAll(configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      this.configs.set(config.id, config)
    }

    const enabled = configs.filter((c) => c.enabled)
    if (enabled.length === 0) return

    log.info({ count: enabled.length }, 'starting connectors')

    // Start in parallel, don't fail-fast
    const results = await Promise.allSettled(enabled.map((c) => this.start(c.id)))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'rejected') {
        log.error({ connector: enabled[i].id, err: r.reason }, 'failed to start connector')
      }
    }
  }

  /**
   * Stop all connectors and clean up.
   */
  async stopAll(): Promise<void> {
    log.info('stopping all connectors')
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
      log.info({ connector: id }, 'connector disconnected')
      this.clients.delete(id)
      // Auto-reconnect after a randomised 5-10s delay. The jitter prevents a
      // thundering-herd respawn when multiple MCP processes drop together
      // (e.g. after the agent host briefly loses power or sleeps).
      const delayMs = 5_000 + Math.floor(Math.random() * 5_000)
      setTimeout(async () => {
        if (this.configs.has(id) && this.configs.get(id)?.enabled !== false) {
          try {
            log.info({ connector: id, delayMs }, 'auto-reconnecting')
            await this.start(id)
          } catch (err) {
            log.error({ connector: id, err }, 'auto-reconnect failed')
          }
        }
      }, delayMs)
    })

    client.on('error', (err: Error) => {
      log.error({ connector: id, err }, 'connector error')
    })

    await client.connect()
    this.clients.set(id, client)
    log.info({ connector: id, toolCount: client.getTools().length }, 'connector started')
  }

  /**
   * Stop a single connector.
   */
  async stop(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (client) {
      await client.disconnect()
      this.clients.delete(id)
      log.info({ connector: id }, 'connector stopped')
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
      if (!client.isConnected()) continue
      const connectorPerms = this.toolPermissions.get(client.config.id)
      for (const tool of mcpClientToAgentTools(client)) {
        // Filter 'never' tools — agent should not even see them
        if (connectorPerms) {
          const prefix = `mcp_${client.config.id}_`
          const rawName = tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name
          if (connectorPerms[rawName] === 'never') continue
        }
        tools.push(tool)
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

  /** Start periodic health checks for all connected MCP servers. */
  startHealthChecks(intervalMs = 60_000): void {
    this.stopHealthChecks()
    this.healthTimer = setInterval(async () => {
      for (const [id, client] of this.clients) {
        const ok = await client.ping()
        if (!ok) {
          log.warn({ connector: id }, 'health check failed, restarting')
          try {
            await this.restart(id)
          } catch (err) {
            log.error({ connector: id, err }, 'restart failed')
          }
        }
      }
    }, intervalMs)
  }

  /** Stop health check loop. */
  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }
}
