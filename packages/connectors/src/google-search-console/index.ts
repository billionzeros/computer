import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GoogleSearchConsoleAPI } from './api.js'
import { createGoogleSearchConsoleTools } from './tools.js'

export class GoogleSearchConsoleConnector implements DirectConnector {
  readonly id = 'google-search-console'
  readonly name = 'Google Search Console'

  private api = new GoogleSearchConsoleAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGoogleSearchConsoleTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const sites = await this.api.listSites()
      return {
        success: true,
        info: `Connected — ${sites.length} verified site(s): ${sites.map((s) => s.siteUrl).join(', ') || 'none'}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
