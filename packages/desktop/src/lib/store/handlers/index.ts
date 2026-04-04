/**
 * Message handler router.
 *
 * Routes messages by channel, then by message type to domain handlers.
 * Uses protocol discriminated unions — handlers get properly typed messages
 * with zero unsafe casts.
 */

import { type AiMessage, Channel, type ControlMessage, type EventMessage } from '@anton/protocol'
import type { IncomingMessage } from '../../connection.js'
import { useStore } from '../../store.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'
import { handleChatMessage } from './chatHandler.js'
import { handleConnectorMessage } from './connectorHandler.js'
import { handleControlMessage } from './controlHandler.js'
import { handleEventsMessage } from './eventsHandler.js'
import { handleInteractionMessage } from './interactionHandler.js'
import { handleProjectMessage } from './projectHandler.js'
import { handleProviderMessage } from './providerHandler.js'
import { handleSessionMessage } from './sessionHandler.js'
import type { MessageContext } from './shared.js'
import { handleToolMessage } from './toolHandler.js'

export function handleWsMessage(channel: number, msg: IncomingMessage): void {
  console.log(`[WS] ch=${channel} type=${msg.type}`, msg)

  // ── CONTROL channel ──
  if (channel === Channel.CONTROL) {
    handleControlMessage(msg as ControlMessage)
    return
  }

  // ── EVENTS channel ──
  if (channel === Channel.EVENTS) {
    handleEventsMessage(msg as EventMessage)
    return
  }

  // ── AI channel only from here ──
  if (channel !== Channel.AI) {
    console.log(`[WS] Ignoring non-AI channel: ${channel}`)
    return
  }

  const aiMsg = msg as AiMessage

  // ── Session-aware message routing ──
  const store = useStore.getState()
  const msgSessionId: string | undefined =
    'sessionId' in aiMsg ? (aiMsg.sessionId as string) : undefined
  const activeConv = store.getActiveConversation()
  const isForActiveSession = !msgSessionId || activeConv?.sessionId === msgSessionId

  const addMsg = (chatMsg: import('../types.js').ChatMessage) => {
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

  // ── Sync-first gate ──
  const syncExempt = new Set([
    'session_history_response',
    'sessions_list_response',
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
    console.log(`[Sync] Queued ${aiMsg.type} for ${msgSessionId} (syncing)`)
    return
  }

  // ── Dev event logging ──
  {
    let summary: string | null = null
    switch (aiMsg.type) {
      case 'tool_call':
        summary = `Tool call: ${aiMsg.name || 'unknown'}`
        break
      case 'done':
        summary = `Turn complete${aiMsg.usage ? ` (${aiMsg.usage.totalTokens} tokens)` : ''}`
        break
      case 'error':
        summary = `Error: ${aiMsg.message || 'unknown'}`
        break
      case 'thinking':
        summary = 'Thinking...'
        break
      case 'session_created':
        summary = `Session created: ${aiMsg.id?.slice(0, 12) || ''}`
        break
      case 'session_destroyed':
        summary = `Session destroyed: ${aiMsg.id?.slice(0, 12) || ''}`
        break
    }
    if (summary) {
      uiStore.getState().appendEventLog(aiMsg.type, summary)
    }
  }

  // ── Build message context for AI channel handlers ──
  const ctx: MessageContext = {
    msgSessionId,
    isForActiveSession,
    addMsg,
    appendText,
    msg: aiMsg,
  }

  // ── Dispatch to domain handlers (first match wins) ──
  if (handleChatMessage(aiMsg, ctx)) return
  if (handleToolMessage(aiMsg, ctx)) return
  if (handleInteractionMessage(aiMsg, ctx)) return
  if (handleSessionMessage(aiMsg)) return
  if (handleProviderMessage(aiMsg)) return
  if (handleProjectMessage(aiMsg)) return
  if (handleConnectorMessage(aiMsg)) return
}
