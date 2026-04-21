import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { LinearAPI } from './api.js'
import { createLinearTools } from './tools.js'

export class LinearConnector implements DirectConnector {
  readonly id = 'linear'
  readonly name = 'Linear'
  readonly capabilitySummary =
    'Create/list/update Linear issues, add comments, browse teams/states/projects'
  readonly capabilityExample = 'linear_create_issue'

  private api = new LinearAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createLinearTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const user = await this.api.getViewer()
      return {
        success: true,
        info: `Connected as ${user.displayName || user.name} (${user.email})`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
