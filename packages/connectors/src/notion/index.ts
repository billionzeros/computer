import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { NotionAPI } from './api.js'
import { createNotionTools } from './tools.js'

export class NotionConnector implements DirectConnector {
  readonly id = 'notion'
  readonly name = 'Notion'

  private api = new NotionAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createNotionTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const user = await this.api.getCurrentUser()
      return { success: true, info: `Connected as ${user.name}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
