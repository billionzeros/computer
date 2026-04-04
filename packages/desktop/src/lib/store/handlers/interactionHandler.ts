/**
 * AI channel: confirm, plan_confirm, ask_user, browser_*, tasks_update, done, error, title_update, token_update, compaction.
 */

import type { WsPayload } from '../../connection.js'
import { useStore } from '../../store.js'
import type {
  WsAskUser,
  WsBrowserState,
  WsCompactionComplete,
  WsConfirm,
  WsDone,
  WsError,
  WsPlanConfirm,
  WsTasksUpdate,
  WsTitleUpdate,
  WsTokenUpdate,
} from '../../ws-messages.js'
import { artifactStore } from '../artifactStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import type { SessionMeta } from '../types.js'
import { uiStore } from '../uiStore.js'
import type { MessageContext } from './shared.js'

export function handleInteractionMessage(msg: WsPayload, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'confirm': {
      const m = msg as unknown as WsConfirm
      sessionStore.getState().setPendingConfirm({
        id: m.id,
        command: m.command,
        reason: m.reason,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'plan_confirm': {
      const m = msg as unknown as WsPlanConfirm
      sessionStore.getState().setPendingPlan({
        id: m.id,
        title: m.title,
        content: m.content,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'ask_user': {
      const m = msg as unknown as WsAskUser
      sessionStore.getState().setPendingAskUser({
        id: m.id,
        questions: m.questions,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'error': {
      const m = msg as unknown as WsError
      const ss = sessionStore.getState()
      if (ctx.msgSessionId && ss.getSessionState(ctx.msgSessionId).isSyncing) {
        ss.updateSessionState(ctx.msgSessionId, { isSyncing: false, pendingSyncMessages: [] })
      }

      if (m.code === 'session_not_found' && ctx.msgSessionId) {
        const store = useStore.getState()
        const staleConv = store.conversations.find((c) => c.sessionId === ctx.msgSessionId)
        if (staleConv) {
          store.deleteConversation(staleConv.id)
        }
        return true
      }

      if (ctx.msgSessionId) {
        ctx.addMsg({
          id: `err_${Date.now()}`,
          role: 'system',
          content: m.message,
          isError: true,
          timestamp: Date.now(),
        })
      } else {
        console.warn(
          '[WS] Received error without sessionId, not adding to conversation:',
          m.message,
        )
      }
      if (ctx.isForActiveSession && ctx.msgSessionId) {
        ss.setAgentStatus('error', ctx.msgSessionId)
      }
      const errSessionId =
        ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId
      if (errSessionId) {
        ss.updateSessionState(errSessionId, { isStreaming: false, status: 'error' })
      }
      return true
    }

    case 'title_update': {
      const m = msg as unknown as WsTitleUpdate
      if (m.sessionId) {
        const store = useStore.getState()
        store.updateConversationTitle(m.sessionId, m.title)
        const ps = projectStore.getState()
        if (ps.projectSessions.some((s: SessionMeta) => s.id === m.sessionId)) {
          ps.setProjectSessions(
            ps.projectSessions.map((s: SessionMeta) =>
              s.id === m.sessionId ? { ...s, title: m.title } : s,
            ),
          )
        }
      }
      return true
    }

    case 'tasks_update': {
      const m = msg as unknown as WsTasksUpdate
      if (m.tasks) {
        const ss = sessionStore.getState()
        if (ctx.msgSessionId) {
          ss.updateSessionState(ctx.msgSessionId, { tasks: m.tasks })
        }
        if (ctx.isForActiveSession) {
          ss.setCurrentTasks(m.tasks)
        }
      }
      return true
    }

    case 'browser_state': {
      const m = msg as unknown as WsBrowserState
      if (ctx.isForActiveSession) {
        const as = artifactStore.getState()
        const wasActive = as.browserState?.active
        as.setBrowserState({
          url: m.url,
          title: m.title,
          screenshot: m.screenshot,
          lastAction: m.lastAction,
          elementCount: m.elementCount,
        })
        if (!wasActive) {
          uiStore.setState({ sidePanelView: 'browser' })
          artifactStore.setState({ artifactPanelOpen: true })
        }
      }
      return true
    }

    case 'browser_close': {
      if (ctx.isForActiveSession) {
        artifactStore.getState().clearBrowserState()
      }
      return true
    }

    case 'token_update': {
      const m = msg as unknown as WsTokenUpdate
      if (ctx.isForActiveSession && m.usage) {
        sessionStore.getState().setUsage(m.usage, null)
      }
      return true
    }

    case 'done': {
      const m = msg as unknown as WsDone
      const ss = sessionStore.getState()
      const store = useStore.getState()
      const activeConv = store.getActiveConversation()

      const doneConv = ctx.msgSessionId
        ? store.findConversationBySession(ctx.msgSessionId)
        : activeConv
      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = ss.agentStatus === 'working'
      const noResponse = wasWorking && lastMsg?.role === 'user'
      const zeroTokens = m.usage && m.usage.inputTokens === 0 && m.usage.outputTokens === 0

      if (noResponse && zeroTokens) {
        ctx.addMsg({
          id: `err_silent_${Date.now()}`,
          role: 'system',
          content:
            'No response from the agent. The LLM was never called (0 tokens used). Check that a valid API key is configured on the server.',
          isError: true,
          timestamp: Date.now(),
        })
      } else if (noResponse) {
        ctx.addMsg({
          id: `err_empty_${Date.now()}`,
          role: 'system',
          content: 'Agent finished but produced no response.',
          isError: true,
          timestamp: Date.now(),
        })
      }

      const doneSessionId = ctx.msgSessionId || activeConv?.sessionId
      if (doneSessionId) {
        ss.updateSessionState(doneSessionId, {
          status: 'idle',
          isStreaming: false,
          assistantMsgId: null,
          needsHistoryRefresh: !ctx.isForActiveSession,
        })
      }

      if (ctx.isForActiveSession || !ctx.msgSessionId) {
        ss.setAgentStatus('idle')
        ss.clearAgentSteps()
        ss.setAgentStatusDetail(null)
      }

      // Close out pending tool calls that never got a result
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

      // Clear assistant message tracking
      useStore.setState({ _currentAssistantMsgId: null })
      if (ctx.msgSessionId) {
        store._sessionAssistantMsgIds.delete(ctx.msgSessionId)
      }

      if (m.usage) {
        ss.setUsage(m.usage, m.cumulativeUsage || null)
      }
      if (m.provider && m.model) {
        ss.setLastResponseModel(m.provider, m.model)
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

    case 'compaction_complete': {
      const m = msg as unknown as WsCompactionComplete
      ctx.addMsg({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${m.compactedMessages} messages summarized (compaction #${m.totalCompactions})`,
        timestamp: Date.now(),
      })
      return true
    }

    default:
      return false
  }
}
