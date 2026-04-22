/**
 * AI channel: text, thinking, text_replace, steer_ack, sub_agent_* messages.
 */

import type { AiMessage } from '@anton/protocol'
import { useStore } from '../../store.js'
import { sessionStore } from '../sessionStore.js'
import type { MessageContext } from './shared.js'

// Track ended sub-agents to drop late-arriving progress messages.
// Capped to prevent unbounded growth over long-running sessions.
const _endedSubAgents = new Set<string>()
const _MAX_ENDED_TRACKING = 100

export function handleChatMessage(msg: AiMessage, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'steer_ack': {
      ctx.addMsg({
        id: `steer_${Date.now()}`,
        role: 'user',
        content: msg.content,
        timestamp: Date.now(),
        isSteering: true,
        attachments: msg.attachments?.map(
          (a: {
            id: string
            name: string
            mimeType: string
            sizeBytes: number
            data?: string
          }) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            data: a.data,
          }),
        ),
      })
      return true
    }

    case 'text': {
      // Invariant: text rendering must agree with the webhook runner and mirror.
      // See packages/agent-core/src/harness/__fixtures__/check.ts cross-surface test.
      const textContent = msg.content ?? ''
      if (!textContent) return true
      const textSessionId =
        ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId
      if (textSessionId) {
        const ss = sessionStore.getState()
        if (!ss.getSessionState(textSessionId).isStreaming) {
          ss.updateSessionState(textSessionId, { isStreaming: true })
        }
      }
      // Reset thinking message tracking — text arriving means thinking phase is done
      if (textSessionId) {
        useStore.getState()._sessionThinkingMsgIds.delete(textSessionId)
      }
      ctx.appendText(textContent)
      return true
    }

    case 'thinking': {
      const thinkContent = msg.text ?? ''
      if (thinkContent) {
        ctx.appendThinking(thinkContent)
      }
      const sid = ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId
      if (sid) {
        sessionStore.getState().setSessionStatus(sid, 'working')
      }
      return true
    }

    case 'text_replace': {
      if (msg.remove) {
        useStore.getState().replaceAssistantText(msg.remove, '', ctx.msgSessionId)
      }
      return true
    }

    case 'sub_agent_start': {
      ctx.addMsg({
        id: `sa_start_${msg.toolCallId}`,
        role: 'tool',
        content: msg.task,
        toolName: 'sub_agent',
        toolInput: { task: msg.task, ...(msg.agentType && { type: msg.agentType }) },
        timestamp: Date.now(),
      })
      return true
    }

    case 'sub_agent_end': {
      // Mark this sub-agent as ended so late progress messages are dropped
      if (_endedSubAgents.size >= _MAX_ENDED_TRACKING) _endedSubAgents.clear()
      _endedSubAgents.add(msg.toolCallId)
      useStore.getState()._subAgentProgressMsgIds.delete(msg.toolCallId)
      ctx.addMsg({
        id: `sa_end_${msg.toolCallId}`,
        role: 'tool',
        content: msg.success ? 'Sub-agent completed' : 'Sub-agent failed',
        isError: !msg.success,
        timestamp: Date.now(),
        parentToolCallId: msg.toolCallId,
      })
      return true
    }

    case 'sub_agent_progress': {
      // Drop late progress messages that arrive after sub_agent_end
      if (_endedSubAgents.has(msg.toolCallId)) return true
      const store = useStore.getState()
      if (ctx.isForActiveSession) {
        store.appendSubAgentProgress(msg.toolCallId, msg.content, msg.toolCallId)
      } else if (ctx.msgSessionId) {
        store.appendSubAgentProgressToSession(
          ctx.msgSessionId,
          msg.toolCallId,
          msg.content,
          msg.toolCallId,
        )
      }
      return true
    }

    default:
      return false
  }
}
