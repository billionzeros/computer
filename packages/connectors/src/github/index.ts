import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GitHubAPI } from './api.js'
import { createGitHubTools } from './tools.js'

export class GitHubConnector implements DirectConnector {
  readonly id = 'github'
  readonly name = 'GitHub'

  private api = new GitHubAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGitHubTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const user = await this.api.getAuthenticatedUser()
      return {
        success: true,
        info: `Connected as ${user.login}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
