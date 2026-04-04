/**
 * AI channel: text, thinking, text_replace, steer_ack, sub_agent_* messages.
 */

import type { WsPayload } from '../../connection.js'
import { useStore } from '../../store.js'
import type {
  WsSteerAck,
  WsSubAgentEnd,
  WsSubAgentProgress,
  WsSubAgentStart,
  WsText,
  WsTextReplace,
  WsThinking,
} from '../../ws-messages.js'
import { sessionStore } from '../sessionStore.js'
import type { MessageContext } from './shared.js'

export function handleChatMessage(msg: WsPayload, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'steer_ack': {
      const m = msg as unknown as WsSteerAck
      ctx.addMsg({
        id: `steer_${Date.now()}`,
        role: 'user',
        content: m.content,
        timestamp: Date.now(),
        isSteering: true,
      })
      return true
    }

    case 'text': {
      const m = msg as unknown as WsText
      const textContent = m.content ?? ''
      if (!textContent) return true
      const textSessionId =
        ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId
      if (textSessionId) {
        const ss = sessionStore.getState()
        if (!ss.getSessionState(textSessionId).isStreaming) {
          ss.updateSessionState(textSessionId, { isStreaming: true })
        }
      }
      ctx.appendText(textContent)
      return true
    }

    case 'thinking': {
      const m = msg as unknown as WsThinking
      ctx.addMsg({
        id: `think_${Date.now()}`,
        role: 'system',
        content: m.text,
        timestamp: Date.now(),
      })
      sessionStore.getState().setAgentStatus('working', ctx.msgSessionId)
      return true
    }

    case 'text_replace': {
      const m = msg as unknown as WsTextReplace
      if (m.remove) {
        useStore.getState().replaceAssistantText(m.remove, '', ctx.msgSessionId)
      }
      return true
    }

    case 'sub_agent_start': {
      const m = msg as unknown as WsSubAgentStart
      ctx.addMsg({
        id: `sa_start_${m.toolCallId}`,
        role: 'tool',
        content: m.task,
        toolName: 'sub_agent',
        toolInput: { task: m.task },
        timestamp: Date.now(),
      })
      return true
    }

    case 'sub_agent_end': {
      const m = msg as unknown as WsSubAgentEnd
      ctx.addMsg({
        id: `sa_end_${m.toolCallId}`,
        role: 'tool',
        content: m.success ? 'Sub-agent completed' : 'Sub-agent failed',
        isError: !m.success,
        timestamp: Date.now(),
        parentToolCallId: m.toolCallId,
      })
      return true
    }

    case 'sub_agent_progress': {
      const m = msg as unknown as WsSubAgentProgress
      ctx.addMsg({
        id: `sa_progress_${m.toolCallId}_${Date.now()}`,
        role: 'assistant',
        content: m.content,
        timestamp: Date.now(),
        parentToolCallId: m.toolCallId,
      })
      return true
    }

    default:
      return false
  }
}
