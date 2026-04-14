import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GranolaAPI } from './api.js'
import { createGranolaTools } from './tools.js'

export class GranolaConnector implements DirectConnector {
  readonly id = 'granola'
  readonly name = 'Granola'

  private api = new GranolaAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    this.api.setToken(config.env.GRANOLA_API_KEY ?? config.env.API_KEY ?? '')
    this.tools = createGranolaTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const result = await this.api.listNotes({ pageSize: 1 })
      return {
        success: true,
        info: `Connected — ${result.has_more ? 'multiple' : result.notes.length} note(s) available`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
