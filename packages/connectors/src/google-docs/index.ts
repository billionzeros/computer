import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GoogleDocsAPI } from './api.js'
import { createGoogleDocsTools } from './tools.js'

export class GoogleDocsConnector implements DirectConnector {
  readonly id = 'google-docs'
  readonly name = 'Google Docs'
  readonly capabilitySummary = 'List/read/create Google Docs, append or insert text'
  readonly capabilityExample = 'gdocs_create_document'

  private api = new GoogleDocsAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGoogleDocsTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const docs = await this.api.listDocuments(1)
      return {
        success: true,
        info: `Connected — found ${docs.length > 0 ? 'documents' : 'no documents yet'}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
