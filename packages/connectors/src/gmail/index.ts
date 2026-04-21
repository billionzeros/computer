import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GmailAPI } from './api.js'
import { createGmailTools } from './tools.js'

export class GmailConnector implements DirectConnector {
  readonly id = 'gmail'
  readonly name = 'Gmail'
  readonly capabilitySummary = 'Send/draft emails, search threads, read/trash messages, mark read'
  readonly capabilityExample = 'gmail_send_email'

  private api = new GmailAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGmailTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const profile = await this.api.getProfile()
      return { success: true, info: `Connected as ${profile.emailAddress}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
