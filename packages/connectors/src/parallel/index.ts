import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { ParallelAPI } from './api.js'
import { createParallelTools } from './tools.js'

export class ParallelConnector implements DirectConnector {
  readonly id = 'parallel-research'
  readonly name = 'Parallel Research'
  readonly capabilitySummary =
    'Deep multi-hop web research with citations, page-level excerpts, and cross-source synthesis'
  readonly capabilityExample = 'parallel_research'
  // Default base URL for the Anton-team-owned research-proxy. See
  // ExaConnector.proxyBaseUrl for the rationale behind this field — same
  // semantics, different proxy.
  readonly proxyBaseUrl = 'https://research.antoncomputer.in'

  private api = new ParallelAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) {
      // Compound format from OAuth proxy: "proxyUrl|proxyToken"
      this.api.setToken(config.env.ACCESS_TOKEN)
    }
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createParallelTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const { results } = await this.api.search('test', {
        numResults: 1,
        mode: 'fast',
      })
      return { success: true, info: `Connected — returned ${results.length} result` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
