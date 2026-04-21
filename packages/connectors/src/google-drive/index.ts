import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { GoogleDriveAPI } from './api.js'
import { createGoogleDriveTools } from './tools.js'

export class GoogleDriveConnector implements DirectConnector {
  readonly id = 'google-drive'
  readonly name = 'Google Drive'
  readonly capabilitySummary =
    'Browse/search Drive files, read contents, upload/delete, create folders'
  readonly capabilityExample = 'gdrive_search_files'

  private api = new GoogleDriveAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createGoogleDriveTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const about = await this.api.getAbout()
      return {
        success: true,
        info: `Connected as ${about.user.displayName} (${about.user.emailAddress})`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
