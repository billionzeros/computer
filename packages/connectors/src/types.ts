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
 * Interface for direct API connectors.
 * Each connector wraps a service's REST/GraphQL API and exposes tools.
 */
export interface DirectConnector {
  readonly id: string
  readonly name: string

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

  /** Set the access token. Called on activation and token refresh. */
  setToken(accessToken: string): void

  /** Set a lazy token provider that returns a fresh token on each API call.
   *  When set, connectors call this instead of using the static token from setToken().
   *  The provider should handle caching and refresh internally (e.g. OAuthFlow.getToken). */
  setTokenProvider?(getToken: () => Promise<string>): void

  /** Get all tools this connector provides. */
  getTools(): AgentTool[]

  /** Test the connection by making a lightweight API call. */
  testConnection(): Promise<{ success: boolean; error?: string; info?: string }>
}

/** Factory type for creating connector instances. */
export type ConnectorFactory = () => DirectConnector

/** Token getter function — resolves to a valid access token, handling refresh. */
export type TokenGetter = (provider: string) => Promise<string>
