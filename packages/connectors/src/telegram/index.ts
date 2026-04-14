import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConnectorEnv, DirectConnector } from '../types.js'
import { TelegramBotAPI } from './api.js'
import { createTelegramTools } from './tools.js'

export class TelegramConnector implements DirectConnector {
  readonly id = 'telegram'
  readonly name = 'Telegram'

  private api = new TelegramBotAPI()
  private tools: AgentTool[] = []
  private ownerChatId: number | null = null

  configure(config: ConnectorEnv): void {
    this.api.setToken(config.env.TELEGRAM_BOT_TOKEN ?? config.env.BOT_TOKEN ?? '')
    const chatId = Number(config.env.OWNER_CHAT_ID)
    this.ownerChatId = Number.isNaN(chatId) ? null : chatId
    this.tools = createTelegramTools(this.api, this.ownerChatId)
  }

  getTools(): AgentTool[] {
    return this.tools
  }

  async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
    try {
      const me = await this.api.getMe()
      return { success: true, info: `Connected as @${me.username ?? me.first_name}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
