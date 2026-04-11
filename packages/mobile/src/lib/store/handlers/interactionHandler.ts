/**
 * AI channel: confirm, plan_confirm, ask_user, tasks_update, done, error, title_update, token_update.
 */

import type { AiMessage } from '@anton/protocol'
import { useStore } from '../../store'
import { projectStore } from '../projectStore'
import { sessionStore } from '../sessionStore'
import type { SessionState } from '../types'
import type { SessionMeta } from '../types'
import type { MessageContext } from './shared'

export function handleInteractionMessage(msg: AiMessage, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'confirm': {
      const sid = ctx.msgSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, {
          pendingConfirm: {
            id: msg.id,
            command: msg.command,
            reason: msg.reason,
            sessionId: sid,
          },
        })
      }
      return true
    }

    case 'plan_confirm': {
      const sid = ctx.msgSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, {
          pendingPlan: {
            id: msg.id,
            title: msg.title,
            content: msg.content,
            sessionId: sid,
          },
        })
      }
      return true
    }

    case 'ask_user': {
      const sid = ctx.msgSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, {
          pendingAskUser: {
            id: msg.id,
            questions: msg.questions,
            sessionId: sid,
          },
        })
      }
      return true
    }

    case 'error': {
      const ss = sessionStore.getState()
      const sid = ctx.msgSessionId
      console.error('[Handler] Error from server:', msg.message, 'session:', sid)

      if (sid && ss.getSessionState(sid).isSyncing) {
        ss.updateSessionState(sid, { isSyncing: false, pendingSyncMessages: [] })
      }

      if (sid) {
        ctx.addMsg({
          id: `err_${Date.now()}`,
          role: 'system',
          content: msg.message,
          isError: true,
          timestamp: Date.now(),
        })
        ss.updateSessionState(sid, { isStreaming: false, status: 'error' })
      }
      return true
    }

    case 'title_update': {
      if (msg.sessionId) {
        useStore.getState().updateConversationTitle(msg.sessionId, msg.title)
        const ps = projectStore.getState()
        if (ps.projectSessions.some((s: SessionMeta) => s.id === msg.sessionId)) {
          ps.setProjectSessions(
            ps.projectSessions.map((s: SessionMeta) =>
              s.id === msg.sessionId ? { ...s, title: msg.title } : s,
            ),
          )
        }
      }
      return true
    }

    case 'tasks_update': {
      if (msg.tasks && ctx.msgSessionId) {
        sessionStore.getState().updateSessionState(ctx.msgSessionId, { tasks: msg.tasks })
      }
      return true
    }

    case 'token_update': {
      const sid = ctx.msgSessionId
      if (sid && msg.usage) {
        sessionStore.getState().updateSessionState(sid, { turnUsage: msg.usage })
      }
      return true
    }

    case 'done': {
      const ss = sessionStore.getState()
      const store = useStore.getState()
      const activeConv = store.getActiveConversation()
      const doneConv = ctx.msgSessionId
        ? store.findConversationBySession(ctx.msgSessionId)
        : activeConv
      const doneSessionId = ctx.msgSessionId || activeConv?.sessionId

      if (doneSessionId) {
        const currentState = ss.getSessionState(doneSessionId)
        const alreadyWorking = currentState.status === 'working'

        const updates: Partial<SessionState> = {
          status: alreadyWorking ? 'working' : 'idle',
          statusDetail: alreadyWorking ? currentState.statusDetail : null,
          isStreaming: false,
          assistantMsgId: null,
          agentSteps: alreadyWorking ? currentState.agentSteps : [],
          needsHistoryRefresh: !ctx.isForActiveSession,
        }
        if (msg.usage) {
          updates.turnUsage = msg.usage
          updates.sessionUsage = msg.cumulativeUsage || null
        }
        if (msg.provider && msg.model) {
          updates.lastResponseProvider = msg.provider
          updates.lastResponseModel = msg.model
        }
        ss.updateSessionState(doneSessionId, updates)

        store._sessionAssistantMsgIds.delete(doneSessionId)
        store._sessionThinkingMsgIds.delete(doneSessionId)
      }

      // Close pending tool calls without results
      if (doneConv) {
        const resultIds = new Set(
          doneConv.messages.filter((m) => m.id.startsWith('tr_')).map((m) => m.id.slice(3)),
        )
        const pendingCalls = doneConv.messages.filter(
          (m) => m.id.startsWith('tc_') && !resultIds.has(m.id.slice(3)),
        )
        for (const call of pendingCalls) {
          const baseId = call.id.slice(3)
          ctx.addMsg({
            id: `tr_${baseId}`,
            role: 'tool',
            content: '',
            timestamp: Date.now(),
            parentToolCallId: call.parentToolCallId,
          })
        }
      }
      return true
    }

    case 'compaction_start':
      ctx.addMsg({
        id: `compact_${Date.now()}`,
        role: 'system',
        content: 'Compacting context...',
        timestamp: Date.now(),
      })
      return true

    case 'compaction_complete':
      ctx.addMsg({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${msg.compactedMessages} messages summarized`,
        timestamp: Date.now(),
      })
      return true

    default:
      return false
  }
}
