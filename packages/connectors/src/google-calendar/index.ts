import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GoogleCalendarAPI } from './api.js'
import { createGoogleCalendarTools } from './tools.js'

export class GoogleCalendarConnector implements DirectConnector {
  readonly id = 'google-calendar'
  readonly name = 'Google Calendar'

  private api = new GoogleCalendarAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGoogleCalendarTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const result = await this.api.listCalendars()
      const primary = result.items.find((c) => c.primary)
      return {
        success: true,
        info: `Connected — ${result.items.length} calendar(s), primary: ${primary?.summary ?? 'unknown'}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
