import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { UnipileLinkedInAPI } from './api.js'
import { createLinkedInTools } from './tools.js'

export class LinkedInConnector implements DirectConnector {
  readonly id = 'linkedin'
  readonly name = 'LinkedIn'

  private api = new UnipileLinkedInAPI()
  private tools: AgentTool[] = []

  configure(config: ConnectorEnv): void {
    if (config.env.ACCESS_TOKEN) {
      // Compound format from OAuth proxy: "apiKey|dsn|accountId"
      const parts = config.env.ACCESS_TOKEN.split('|')
      const apiKey = parts[0] ?? ''
      const dsn = parts[1] ?? ''
      const accountId = parts[2] ?? ''
      this.api.setCredentials(apiKey, dsn, accountId)
    }
    if (config.refreshToken) {
      this.api.setTokenProvider(config.refreshToken)
    }
    this.tools = createLinkedInTools(this.api)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const profile = await this.api.getMyProfile()
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ')
      return {
        success: true,
        info: name ? `Connected as ${name}` : 'Connected to LinkedIn',
      }
    } catch (_err) {
      // Fall back to listing accounts if profile fails
      try {
        const accounts = await this.api.listAccounts()
        const linkedin = (accounts.items ?? []).filter((a) => a.type?.toUpperCase() === 'LINKEDIN')
        if (!linkedin.length) {
          return { success: false, error: 'No LinkedIn accounts found.' }
        }
        // Auto-select first if none set
        if (!this.api.getAccountId() && linkedin[0]) {
          this.api.setAccountId(linkedin[0].id)
        }
        const names = linkedin.map((a) => a.name ?? a.id).join(', ')
        return { success: true, info: `Connected. Accounts: ${names}` }
      } catch (innerErr) {
        return { success: false, error: (innerErr as Error).message }
      }
    }
  }
}
