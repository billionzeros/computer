/**
 * Message handler router.
 *
 * Replaces the monolithic handleWsMessage switch statement in store.ts.
 * Routes messages by channel, then by message type to domain handlers.
 */

import { Channel } from '@anton/protocol'
import type { WsPayload } from '../../connection.js'
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

export function handleWsMessage(channel: number, msg: WsPayload): void {
  console.log(`[WS] ch=${channel} type=${msg.type}`, msg)

  // ── CONTROL channel ──
  if (channel === Channel.CONTROL) {
    handleControlMessage(msg)
    return
  }

  // ── EVENTS channel ──
  if (channel === Channel.EVENTS) {
    handleEventsMessage(msg)
    return
  }

  // ── AI channel only from here ──
  if (channel !== Channel.AI) {
    console.log(`[WS] Ignoring non-AI channel: ${channel}`)
    return
  }

  // ── Session-aware message routing ──
  const store = useStore.getState()
  const msgSessionId: string | undefined = msg.sessionId as string | undefined
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
    !syncExempt.has(msg.type)
  ) {
    const ss = sessionStore.getState().getSessionState(msgSessionId)
    sessionStore.getState().updateSessionState(msgSessionId, {
      pendingSyncMessages: [...ss.pendingSyncMessages, msg],
    })
    console.log(`[Sync] Queued ${msg.type} for ${msgSessionId} (syncing)`)
    return
  }

  // ── Dev event logging ──
  if (
    ['tool_call', 'done', 'error', 'thinking', 'session_created', 'session_destroyed'].includes(
      msg.type,
    )
  ) {
    const m = msg as Record<string, unknown>
    const summary =
      msg.type === 'tool_call'
        ? `Tool call: ${(m.name as string) || 'unknown'}`
        : msg.type === 'done'
          ? `Turn complete${m.usage ? ` (${(m.usage as { totalTokens: number }).totalTokens} tokens)` : ''}`
          : msg.type === 'error'
            ? `Error: ${(m.message as string) || (m.content as string) || 'unknown'}`
            : msg.type === 'thinking'
              ? 'Thinking...'
              : msg.type === 'session_created'
                ? `Session created: ${(m.sessionId as string)?.slice(0, 12) || ''}`
                : `Session destroyed: ${(m.sessionId as string)?.slice(0, 12) || ''}`
    uiStore.getState().appendEventLog(msg.type, summary)
  }

  // ── Build message context for AI channel handlers ──
  const ctx: MessageContext = {
    msgSessionId,
    isForActiveSession,
    addMsg,
    appendText,
    msg,
  }

  // ── Dispatch to domain handlers (first match wins) ──
  if (handleChatMessage(msg, ctx)) return
  if (handleToolMessage(msg, ctx)) return
  if (handleInteractionMessage(msg, ctx)) return
  if (handleSessionMessage(msg)) return
  if (handleProviderMessage(msg)) return
  if (handleProjectMessage(msg)) return
  if (handleConnectorMessage(msg)) return
}
