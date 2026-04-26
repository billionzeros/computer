import type { AgentTool } from '@mariozechner/pi-agent-core'

/**
 * Where a connector's tools are visible. Defaults to "everywhere" when
 * unset (the historical behaviour). A connector that only makes sense
 * inside one surface (e.g. the Slack workspace bot connector, whose
 * tools use a workspace bot token and only make sense when Anton is
 * actually replying inside that workspace) declares its surfaces and
 * the ConnectorManager filters its tools out of any other surface.
 *
 * Kept as a string union of the well-known surfaces plus the open
 * `string` escape hatch so a custom surface (`'cli'`, `'discord'`,
 * future stuff) doesn't need a type-system change first.
 */
export type ConnectorSurface = 'desktop' | 'slack' | 'telegram' | (string & {})

/**
 * All config values — tokens, API keys, wallet addresses, settings.
 * Resolved from encrypted store + process.env before being passed in.
 */
export interface ConnectorEnv {
  env: Record<string, string>

  /** Lazy token refresh for OAuth connectors.
   *  Returns a fresh access token. Handles expiry and refresh internally.
   *  API-key connectors don't receive this — they read env.API_KEY directly. */
  refreshToken?: () => Promise<string>
}

/**
 * Interface for direct API connectors.
 * Each connector wraps a service's REST/GraphQL API and exposes tools.
 */
export interface DirectConnector {
  readonly id: string
  readonly name: string

  /**
   * One-line, action-oriented capability summary — fed to a harness CLI
   * at thread-start so it knows what the service CAN do without reading
   * every tool's schema. Short sentences, imperative voice, no trailing
   * period. Example: `"Send/read Gmail, search threads, manage labels"`.
   */
  readonly capabilitySummary?: string

  /**
   * A single concrete tool-call example — surfaces a canonical intent
   * the model can pattern-match on. Example: `"gmail_send_message"`.
   * Should be a tool name this connector actually registers.
   */
  readonly capabilityExample?: string

  /**
   * Optional surface restriction. When set, this connector's tools are
   * only visible to sessions whose surface matches one of these values.
   * When unset, the connector is visible everywhere (the default;
   * matches the existing behaviour for every connector that hasn't
   * opted in).
   *
   * Used by the slack-bot connector to gate its `slack_bot_*` tools to
   * Slack sessions only — desktop sessions never see them, even when
   * the workspace install is active.
   */
  readonly surfaces?: ConnectorSurface[]

  /**
   * For "proxy-style" connectors that route their requests through a
   * Cloudflare Worker (e.g. Exa via search-proxy, Parallel via
   * research-proxy): the canonical base URL of that proxy. Anton's
   * agent-core canonical wrappers (`web_search`, `web_research`) use
   * this — paired with the OAuth-resolved bearer token for the same
   * connector id — to delegate without re-implementing the connector's
   * HTTP layer or learning about credential storage themselves.
   *
   * Connectors that talk to a vendor API directly (Slack, Gmail, etc.)
   * leave this undefined — there is no "proxy" to point Anton-core at.
   */
  readonly proxyBaseUrl?: string

  /** Receive all configuration. Called on activation and on runtime config updates. */
  configure(config: ConnectorEnv): void

  /** Get all tools this connector provides. */
  getTools(): AgentTool[]

  /** Test the connection by making a lightweight API call. */
  testConnection(): Promise<{ success: boolean; error?: string; info?: string }>
}

/** Factory type for creating connector instances. */
export type ConnectorFactory = () => DirectConnector
