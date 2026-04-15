/**
 * Message handler router — routes messages to domain handlers.
 */

import { type AiMessage, Channel, type ControlMessage, type EventMessage } from '@anton/protocol'
import type { IncomingMessage } from '../../connection'
import { useStore } from '../../store'
import { sessionStore } from '../sessionStore'
import type { ChatMessage } from '../types'
import { handleChatMessage } from './chatHandler'
import { handleControlMessage } from './controlHandler'
import { handleEventsMessage } from './eventsHandler'
import { handleInteractionMessage } from './interactionHandler'
import { handleProjectMessage } from './projectHandler'
import { handleSessionMessage } from './sessionHandler'
import type { MessageContext } from './shared'
import { handleToolMessage } from './toolHandler'

export function handleWsMessage(channel: number, msg: IncomingMessage): void {
  const channelName =
    channel === Channel.CONTROL
      ? 'CTRL'
      : channel === Channel.AI
        ? 'AI'
        : channel === Channel.EVENTS
          ? 'EVT'
          : `CH${channel}`
  const msgType = (msg as { type?: string }).type ?? 'unknown'
  console.log(
    `[WS ← ${channelName}] ${msgType}`,
    'sessionId' in msg ? (msg as Record<string, unknown>).sessionId : '',
  )

  if (channel === Channel.CONTROL) {
    handleControlMessage(msg as ControlMessage)
    return
  }

  if (channel === Channel.EVENTS) {
    handleEventsMessage(msg as EventMessage)
    return
  }

  if (channel !== Channel.AI) return

  const aiMsg = msg as AiMessage

  const store = useStore.getState()
  const msgSessionId: string | undefined =
    'sessionId' in aiMsg ? (aiMsg.sessionId as string) : undefined
  const activeConv = store.getActiveConversation()
  const isForActiveSession = !msgSessionId || activeConv?.sessionId === msgSessionId

  const addMsg = (chatMsg: ChatMessage) => {
    if (isForActiveSession) {
      store.addMessage(chatMsg)
    } else if (msgSessionId) {
      store.addMessageToSession(msgSessionId, chatMsg)
    }
  }
  const appendText = (content: string) => {
    if (isForActiveSession) {
      store.appendAssistantText(content)
    } else if (msgSessionId) {
      store.appendAssistantTextToSession(msgSessionId, content)
    }
  }
  const appendThinking = (content: string) => {
    if (isForActiveSession) {
      store.appendThinkingText(content)
    } else if (msgSessionId) {
      store.appendThinkingTextToSession(msgSessionId, content)
    }
  }

  // Sync-first gate
  const syncExempt = new Set([
    'session_history_response',
    'sessions_sync_response',
    'session_sync',
    'session_created',
    'session_destroyed',
    'context_info',
    'usage_stats_response',
    'project_sessions_list_response',
    'providers_list_response',
  ])
  if (
    msgSessionId &&
    sessionStore.getState().getSessionState(msgSessionId).isSyncing &&
    !syncExempt.has(aiMsg.type)
  ) {
    const ss = sessionStore.getState().getSessionState(msgSessionId)
    sessionStore.getState().updateSessionState(msgSessionId, {
      pendingSyncMessages: [...ss.pendingSyncMessages, aiMsg],
    })
    return
  }

  const ctx: MessageContext = {
    msgSessionId,
    isForActiveSession,
    addMsg,
    appendText,
    appendThinking,
    msg: aiMsg,
  }

  if (handleChatMessage(aiMsg, ctx)) return
  if (handleToolMessage(aiMsg, ctx)) return
  if (handleInteractionMessage(aiMsg, ctx)) return
  if (handleSessionMessage(aiMsg)) return
  if (handleProjectMessage(aiMsg)) return
}
