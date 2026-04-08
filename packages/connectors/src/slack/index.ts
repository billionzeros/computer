import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorSurface, DirectConnector } from '../types.js'
import { SlackAPI } from './api.js'
import { createSlackTools } from './tools.js'

/**
 * Slack (user) connector — backed by an xoxp- user token.
 *
 * Acts on behalf of the human who installed it: searches their workspace,
 * reads channels they belong to, and posts as them. This is the personal
 * delegate model — one of these per user/Anton install.
 */
export class SlackUserConnector implements DirectConnector {
  readonly id = 'slack'
  readonly name = 'Slack'

  private api = new SlackAPI()
  private tools: AgentTool[] = createSlackTools(this.api, { mode: 'user' })

  setToken(accessToken: string): void {
    this.api.setToken(accessToken)
  }

  setTokenProvider(getToken: () => Promise<string>): void {
    this.api.setTokenProvider(getToken)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const auth = await this.api.authTest()
      return {
        success: true,
        info: `Connected as ${auth.user} to ${auth.team}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}

/**
 * Slack (bot) connector — backed by an xoxb- bot token.
 *
 * Workspace-level Anton bot: receives @mentions, replies in threads, can
 * use chat:write.customize to post under a custom display name + avatar.
 * Exactly ONE Anton install per Slack workspace owns this; ownership is
 * brokered by the OAuth proxy. Cannot call search.* (Slack rejects bot
 * tokens for those endpoints) so the search tool is filtered out.
 */
export class SlackBotConnector implements DirectConnector {
  readonly id = 'slack-bot'
  readonly name = 'Slack (Anton Bot)'
  /**
   * Bot tools are gated to Slack sessions only. They use the workspace
   * bot token (xoxb-) to post inside *this specific workspace*; exposing
   * them in a desktop session would mean Anton offering to "send a
   * message in #eng" from a context that has nothing to do with that
   * workspace, which is incoherent. ConnectorManager.getAllTools(surface)
   * filters this connector out for any non-Slack surface.
   */
  readonly surfaces: ConnectorSurface[] = ['slack']

  private api = new SlackAPI()
  private tools: AgentTool[] = createSlackTools(this.api, { mode: 'bot' })

  setToken(accessToken: string): void {
    this.api.setToken(accessToken)
  }

  setTokenProvider(getToken: () => Promise<string>): void {
    this.api.setTokenProvider(getToken)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const auth = await this.api.authTest()
      return {
        success: true,
        info: `Bot connected as ${auth.user} to ${auth.team}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
