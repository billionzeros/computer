import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { ExaAPI } from './api.js'
import { createExaTools } from './tools.js'

export class ExaConnector implements DirectConnector {
  readonly id = 'exa-search'
  readonly name = 'Exa Search'
  readonly capabilitySummary =
    'Web search with citations, page-content extraction, structured answers'
  readonly capabilityExample = 'exa_search'

  private api = new ExaAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) {
      // Legacy compound format from OAuth proxy
      this.api.setToken(config.env.ACCESS_TOKEN)
    }
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createExaTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const { results } = await this.api.search('test', {
        numResults: 1,
        text: false,
        highlights: false,
        summary: false,
      })
      return { success: true, info: `Connected — returned ${results.length} result` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
