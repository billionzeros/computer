import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorFactory, DirectConnector, TokenGetter } from './types.js'

/**
 * Manages active direct API connectors.
 * Handles activation/deactivation and tool aggregation.
 */
export class ConnectorManager {
  private connectors = new Map<string, DirectConnector>()
  private factories: Record<string, ConnectorFactory>
  private getToken: TokenGetter

  constructor(factories: Record<string, ConnectorFactory>, getToken: TokenGetter) {
    this.factories = factories
    this.getToken = getToken
  }

  /** Activate a connector by provider ID. Creates instance and sets token. */
  async activate(providerId: string): Promise<void> {
    const factory = this.factories[providerId]
    if (!factory) {
      console.log(`[ConnectorManager] No direct connector for: ${providerId}`)
      return
    }

    try {
      const token = await this.getToken(providerId)
      const connector = factory()
      connector.setToken(token)
      this.connectors.set(providerId, connector)
      console.log(
        `[ConnectorManager] Activated: ${connector.name} (${connector.getTools().length} tools)`,
      )
    } catch (err) {
      console.error(`[ConnectorManager] Failed to activate ${providerId}:`, err)
    }
  }

  /** Deactivate a connector. */
  deactivate(providerId: string): void {
    const connector = this.connectors.get(providerId)
    if (connector) {
      console.log(`[ConnectorManager] Deactivated: ${connector.name}`)
      this.connectors.delete(providerId)
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

  /** Get all tools from all active connectors. */
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = []
    for (const connector of this.connectors.values()) {
      tools.push(...connector.getTools())
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
    console.log(
      `[ConnectorManager] Activated: ${connector.name} (${connector.getTools().length} tools)`,
    )
  }

  /** Refresh a connector's token. */
  async refreshToken(providerId: string): Promise<void> {
    const connector = this.connectors.get(providerId)
    if (!connector) return
    try {
      const token = await this.getToken(providerId)
      connector.setToken(token)
    } catch (err) {
      console.error(`[ConnectorManager] Failed to refresh token for ${providerId}:`, err)
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
