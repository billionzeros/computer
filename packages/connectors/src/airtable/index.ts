import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { DirectConnector } from '../types.js'
import { AirtableAPI } from './api.js'
import { createAirtableTools } from './tools.js'

export class AirtableConnector implements DirectConnector {
  readonly id = 'airtable'
  readonly name = 'Airtable'

  private api = new AirtableAPI()
  private tools: AgentTool[] = []

  setToken(accessToken: string): void {
    this.api.setToken(accessToken)
    this.tools = createAirtableTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const user = await this.api.whoami()
      return { success: true, info: `Connected as ${user.email ?? user.id}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
