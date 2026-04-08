import { createLogger } from '@anton/logger'
import type { TSchema } from '@sinclair/typebox'
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
   * Maps instance ID → registryId for multi-account grouping.
   * For single-account connectors, registryId === instanceId.
   */
  private registryMap = new Map<string, string>()
  /**
   * Maps instance ID → display name (accountEmail/accountLabel) for the
   * account selector param injected into merged tools.
   */
  private accountDisplayNames = new Map<string, string>()
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
  async activate(
    providerId: string,
    opts?: { registryId?: string; accountDisplayName?: string },
  ): Promise<boolean> {
    const factoryId = opts?.registryId ?? providerId
    const factory = this.factories[factoryId]
    if (!factory) {
      log.debug({ providerId, factoryId }, 'no direct connector factory')
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
      this.registryMap.set(providerId, factoryId)
      if (opts?.accountDisplayName) {
        this.accountDisplayNames.set(providerId, opts.accountDisplayName)
      }
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
      this.registryMap.delete(providerId)
      this.accountDisplayNames.delete(providerId)
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
   *
   * When `surface` is provided, connectors that declare a `surfaces`
   * restriction only contribute their tools when the requested surface
   * matches. Connectors with no `surfaces` field are always visible
   * (the existing behaviour for every connector that hasn't opted in).
   * When `surface` is omitted, no surface filtering happens — that's
   * the desktop default and what every existing call site expects.
   */
  getAllTools(surface?: string): AgentTool[] {
    // Group active connectors by registryId for multi-account merging
    const grouped = new Map<string, Array<{ instanceId: string; connector: DirectConnector }>>()
    for (const [instanceId, connector] of this.connectors) {
      // Surface gate
      if (
        surface &&
        connector.surfaces &&
        connector.surfaces.length > 0 &&
        !connector.surfaces.includes(surface)
      ) {
        continue
      }
      const regId = this.registryMap.get(instanceId) ?? instanceId
      let group = grouped.get(regId)
      if (!group) {
        group = []
        grouped.set(regId, group)
      }
      group.push({ instanceId, connector })
    }

    const tools: AgentTool[] = []
    for (const [, instances] of grouped) {
      if (instances.length === 1) {
        // Single account — tools unchanged (backward compat)
        const { instanceId, connector } = instances[0]
        const perms = this.toolPermissions.get(instanceId)
        for (const tool of connector.getTools()) {
          if (perms?.[tool.name] === 'never') continue
          tools.push(tool)
        }
      } else {
        // Multiple accounts — merge into one toolset with account param
        const baseInstance = instances[0]
        // Collect permissions across all instances — only hide a tool if
        // ALL instances have it set to 'never'.
        const allPerms = instances.map(({ instanceId }) => this.toolPermissions.get(instanceId))
        for (const baseTool of baseInstance.connector.getTools()) {
          const allNever = allPerms.length > 0 && allPerms.every((p) => p?.[baseTool.name] === 'never')
          if (allNever) continue
          // Filter account enum to only instances that haven't disabled this tool
          const activeInstances = instances.filter(({ instanceId }) => {
            const p = this.toolPermissions.get(instanceId)
            return p?.[baseTool.name] !== 'never'
          })
          const activeAccountEnum = activeInstances.map(
            ({ instanceId }) => this.accountDisplayNames.get(instanceId) ?? instanceId,
          )
          const capturedInstances = activeInstances
          tools.push({
            ...baseTool,
            parameters: injectAccountParam(baseTool.parameters, activeAccountEnum),
            execute: (id: string, params: unknown, signal?: AbortSignal) => {
              const p = params as Record<string, unknown>
              const accountParam = p.account as string | undefined
              const target = resolveInstance(capturedInstances, accountParam, this.accountDisplayNames)
              const { account: _, ...rest } = p
              // Get the tool from the target instance and execute
              const targetTool = target.connector.getTools().find((t) => t.name === baseTool.name)
              if (!targetTool) {
                return Promise.reject(new Error(`Tool ${baseTool.name} not found on target account`))
              }
              return targetTool.execute(id, rest, signal)
            },
          })
        }
      }
    }
    return tools
  }

  /** Get status of all active connectors. Uses the Map key (instanceId) as id,
   *  not connector.id, so multi-account UUID instances are correctly matched. */
  getStatus(): Array<{
    id: string
    name: string
    connected: boolean
    toolCount: number
    tools: string[]
  }> {
    return Array.from(this.connectors.entries()).map(([instanceId, c]) => ({
      id: instanceId,
      name: c.name,
      connected: true,
      toolCount: c.getTools().length,
      tools: c.getTools().map((t) => t.name),
    }))
  }

  /** Activate a connector with an explicit token (for non-OAuth connectors). */
  activateWithToken(
    providerId: string,
    token: string,
    opts?: { registryId?: string; accountDisplayName?: string },
  ): void {
    const factoryId = opts?.registryId ?? providerId
    const factory = this.factories[factoryId]
    if (!factory) return
    const connector = factory()
    connector.setToken(token)
    this.connectors.set(providerId, connector)
    this.registryMap.set(providerId, factoryId)
    if (opts?.accountDisplayName) {
      this.accountDisplayNames.set(providerId, opts.accountDisplayName)
    }
    this.toolIndex = null
    log.info({ connector: connector.name, toolCount: connector.getTools().length }, 'activated')
  }

  /** Update the display name for an active connector instance. */
  setAccountDisplayName(instanceId: string, displayName: string): void {
    this.accountDisplayNames.set(instanceId, displayName)
  }

  /** Get the registryId for an active connector instance. */
  getRegistryId(instanceId: string): string | undefined {
    return this.registryMap.get(instanceId)
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

// ── Multi-account helpers ─────────────────────────────────────────────

/**
 * Inject an `account` enum parameter into a tool's JSON Schema parameters.
 * The account param defaults to the first enum value (primary account).
 *
 * We deep-clone the schema and mutate the copy. The result is still a valid
 * JSON Schema object — we cast to TSchema since TypeBox schemas are just
 * plain JSON Schema objects at runtime.
 */
function injectAccountParam(
  parameters: TSchema,
  accountEnum: string[],
): TSchema {
  // Clone the schema and inject the account property
  const cloned = JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>
  const props = (cloned.properties ?? {}) as Record<string, unknown>
  props.account = {
    type: 'string',
    enum: accountEnum,
    default: accountEnum[0],
    description: `Which account to use. Defaults to "${accountEnum[0]}" if omitted.`,
  }
  cloned.properties = props
  if (!cloned.type) cloned.type = 'object'
  return cloned as unknown as TSchema
}

/**
 * Resolve which connector instance to use based on the `account` param value.
 * Falls back to the first instance if account is not specified or not found.
 */
function resolveInstance(
  instances: Array<{ instanceId: string; connector: DirectConnector }>,
  accountParam: string | undefined,
  displayNames: Map<string, string>,
): { instanceId: string; connector: DirectConnector } {
  if (!accountParam) return instances[0]
  const match = instances.find(
    ({ instanceId }) => (displayNames.get(instanceId) ?? instanceId) === accountParam,
  )
  return match ?? instances[0]
}
