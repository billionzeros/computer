import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorFactory, DirectConnector, TokenGetter } from './types.js'

const log = createLogger('connector-manager')

/**
 * Per-tool permission override applied at runtime. Mirrors McpToolPermission
 * — kept in sync intentionally so the session-layer enforcement can treat
 * MCP and direct connectors uniformly.
 */
export type DirectToolPermission = 'auto' | 'ask' | 'never'

/**
 * Manages active direct API connectors.
 * Handles activation/deactivation and tool aggregation.
 */
export class ConnectorManager {
  private connectors = new Map<string, DirectConnector>()
  private factories: Record<string, ConnectorFactory>
  private getToken: TokenGetter
  /**
   * Per-connector tool permission overrides keyed by connector id. Stored
   * here (not on the connector instances) so that permissions survive
   * deactivate/activate cycles and ownership changes.
   */
  private toolPermissions = new Map<string, Record<string, DirectToolPermission>>()
  /**
   * Reverse index: tool name → connector id. Built lazily on first lookup
   * and invalidated whenever connectors or permissions change. Replaces the
   * previous O(n*m) scan in getToolPermission(), which ran on every tool
   * call inside session.beforeToolCall.
   */
  private toolIndex: Map<string, string> | null = null

  constructor(factories: Record<string, ConnectorFactory>, getToken: TokenGetter) {
    this.factories = factories
    this.getToken = getToken
  }

  /**
   * Activate a connector by provider ID. Creates instance and sets token.
   * Returns true on success, false if there is no factory or activation
   * failed (errors are logged). Callers that need to know whether the
   * connector is now usable should check the return value — the previous
   * void signature silently swallowed every failure.
   */
  async activate(providerId: string): Promise<boolean> {
    const factory = this.factories[providerId]
    if (!factory) {
      log.debug({ providerId }, 'no direct connector factory')
      return false
    }

    try {
      const token = await this.getToken(providerId)
      const connector = factory()
      connector.setToken(token) // initial token for immediate use
      // Set lazy token provider so the connector auto-refreshes on each API call
      if (connector.setTokenProvider) {
        connector.setTokenProvider(() => this.getToken(providerId))
      }
      this.connectors.set(providerId, connector)
      this.toolIndex = null
      log.info({ connector: connector.name, toolCount: connector.getTools().length }, 'activated')
      return true
    } catch (err) {
      log.error({ providerId, err }, 'failed to activate')
      return false
    }
  }

  /** Deactivate a connector. */
  deactivate(providerId: string): void {
    const connector = this.connectors.get(providerId)
    if (connector) {
      log.info({ connector: connector.name }, 'deactivated')
      this.connectors.delete(providerId)
      this.toolIndex = null
    }
  }

  /** Check if a provider has a direct connector factory. */
  hasFactory(providerId: string): boolean {
    return providerId in this.factories
  }

  /** Get an active connector instance by ID (for connector-specific configuration). */
  getConnector(providerId: string): DirectConnector | undefined {
    return this.connectors.get(providerId)
  }

  /** Check if a connector is currently active. */
  isActive(providerId: string): boolean {
    return this.connectors.has(providerId)
  }

  /** Get IDs of all currently active connectors. */
  getActiveIds(): string[] {
    return Array.from(this.connectors.keys())
  }

  /**
   * Replace the per-tool permission overrides for a connector. Tools missing
   * from the map (or set to 'auto') execute normally. 'never' tools are
   * filtered from getAllTools() entirely. 'ask' tools require user
   * confirmation via the session confirm handler before each call.
   */
  setToolPermissions(id: string, perms: Record<string, DirectToolPermission> | undefined): void {
    if (!perms || Object.keys(perms).length === 0) {
      this.toolPermissions.delete(id)
    } else {
      this.toolPermissions.set(id, { ...perms })
    }
    // Permissions don't change tool names, but a fresh lookup is the easiest
    // way to keep the cached lookup self-consistent if a future refactor
    // makes the index permission-aware.
    this.toolIndex = null
  }

  /**
   * Look up the runtime permission for a direct-connector tool by name.
   * Returns 'auto' for any tool that does not belong to a known direct
   * connector or has no override. Uses a lazily-built reverse index so the
   * hot path (called once per tool invocation in session.beforeToolCall) is
   * O(1) instead of O(connectors × tools).
   */
  getToolPermission(toolName: string): DirectToolPermission {
    if (!this.toolIndex) this.toolIndex = this.buildToolIndex()
    const connectorId = this.toolIndex.get(toolName)
    if (!connectorId) return 'auto'
    const perms = this.toolPermissions.get(connectorId)
    return perms?.[toolName] ?? 'auto'
  }

  private buildToolIndex(): Map<string, string> {
    const index = new Map<string, string>()
    for (const [connectorId, connector] of this.connectors) {
      for (const tool of connector.getTools()) {
        // First-writer-wins: matches the previous scan's behaviour, where
        // the first connector with a matching tool name shadowed any later
        // duplicates.
        if (!index.has(tool.name)) index.set(tool.name, connectorId)
      }
    }
    return index
  }

  /**
   * Get all tools from all active connectors. Tools the user has marked as
   * `never` are filtered out so the agent never sees them — beforeToolCall in
   * the session is the defence-in-depth check for the same condition.
   */
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = []
    for (const [connectorId, connector] of this.connectors) {
      const perms = this.toolPermissions.get(connectorId)
      for (const tool of connector.getTools()) {
        if (perms?.[tool.name] === 'never') continue
        tools.push(tool)
      }
    }
    return tools
  }

  /** Get status of all active connectors. */
  getStatus(): Array<{
    id: string
    name: string
    connected: boolean
    toolCount: number
    tools: string[]
  }> {
    return Array.from(this.connectors.values()).map((c) => ({
      id: c.id,
      name: c.name,
      connected: true,
      toolCount: c.getTools().length,
      tools: c.getTools().map((t) => t.name),
    }))
  }

  /** Activate a connector with an explicit token (for non-OAuth connectors). */
  activateWithToken(providerId: string, token: string): void {
    const factory = this.factories[providerId]
    if (!factory) return
    const connector = factory()
    connector.setToken(token)
    this.connectors.set(providerId, connector)
    this.toolIndex = null
    log.info({ connector: connector.name, toolCount: connector.getTools().length }, 'activated')
  }

  /** Refresh a connector's token. */
  async refreshToken(providerId: string): Promise<void> {
    const connector = this.connectors.get(providerId)
    if (!connector) return
    try {
      const token = await this.getToken(providerId)
      connector.setToken(token)
    } catch (err) {
      log.error({ providerId, err }, 'failed to refresh token')
    }
  }

  /** Test a specific connector's connection. */
  async testConnection(
    providerId: string,
  ): Promise<{ success: boolean; error?: string; info?: string }> {
    const connector = this.connectors.get(providerId)
    if (!connector) {
      return { success: false, error: `Connector ${providerId} not active` }
    }
    return connector.testConnection()
  }
}
