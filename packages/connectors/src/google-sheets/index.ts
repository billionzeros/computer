import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GoogleSheetsAPI } from './api.js'
import { createGoogleSheetsTools } from './tools.js'

export class GoogleSheetsConnector implements DirectConnector {
  readonly id = 'google-sheets'
  readonly name = 'Google Sheets'

  private api = new GoogleSheetsAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGoogleSheetsTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const sheets = await this.api.listSpreadsheets(1)
      return {
        success: true,
        info: `Connected — found ${sheets.length > 0 ? 'spreadsheets' : 'no spreadsheets yet'}`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
