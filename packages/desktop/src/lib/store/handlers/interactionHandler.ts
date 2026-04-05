/**
 * AI channel: confirm, plan_confirm, ask_user, browser_*, tasks_update, done, error, title_update, token_update, compaction.
 */

import type { AiMessage } from '@anton/protocol'
import { useStore } from '../../store.js'
import { artifactStore } from '../artifactStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import type { SessionMeta } from '../types.js'
import { uiStore } from '../uiStore.js'
import type { MessageContext } from './shared.js'

export function handleInteractionMessage(msg: AiMessage, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'confirm': {
      sessionStore.getState().setPendingConfirm({
        id: msg.id,
        command: msg.command,
        reason: msg.reason,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'plan_confirm': {
      sessionStore.getState().setPendingPlan({
        id: msg.id,
        title: msg.title,
        content: msg.content,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'ask_user': {
      sessionStore.getState().setPendingAskUser({
        id: msg.id,
        questions: msg.questions,
        sessionId: ctx.msgSessionId,
      })
      return true
    }

    case 'error': {
      const ss = sessionStore.getState()
      if (ctx.msgSessionId && ss.getSessionState(ctx.msgSessionId).isSyncing) {
        ss.updateSessionState(ctx.msgSessionId, { isSyncing: false, pendingSyncMessages: [] })
      }

      if (msg.code === 'session_not_found' && ctx.msgSessionId) {
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
          content: msg.message,
          isError: true,
          timestamp: Date.now(),
        })
      } else {
        console.warn(
          '[WS] Received error without sessionId, not adding to conversation:',
          msg.message,
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
      if (msg.sessionId) {
        const store = useStore.getState()
        store.updateConversationTitle(msg.sessionId, msg.title)
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
      if (msg.tasks) {
        const ss = sessionStore.getState()
        if (ctx.msgSessionId) {
          ss.updateSessionState(ctx.msgSessionId, { tasks: msg.tasks })
        }
        if (ctx.isForActiveSession) {
          ss.setCurrentTasks(msg.tasks)
        }
      }
      return true
    }

    case 'browser_state': {
      if (ctx.isForActiveSession) {
        const as = artifactStore.getState()
        const wasActive = as.browserState?.active
        as.setBrowserState({
          url: msg.url,
          title: msg.title,
          screenshot: msg.screenshot,
          lastAction: msg.lastAction,
          elementCount: msg.elementCount,
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
      if (ctx.isForActiveSession && msg.usage) {
        sessionStore.getState().setUsage(msg.usage, null)
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
      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = ss.agentStatus === 'working'
      const noResponse = wasWorking && lastMsg?.role === 'user'
      const zeroTokens = msg.usage && msg.usage.inputTokens === 0 && msg.usage.outputTokens === 0

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

      // Clear per-session message tracking
      if (doneSessionId) {
        store._sessionAssistantMsgIds.delete(doneSessionId)
        store._sessionThinkingMsgIds.delete(doneSessionId)
      }

      if (msg.usage) {
        ss.setUsage(msg.usage, msg.cumulativeUsage || null)
      }
      if (msg.provider && msg.model) {
        ss.setLastResponseModel(msg.provider, msg.model)
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
      ctx.addMsg({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${msg.compactedMessages} messages summarized (compaction #${msg.totalCompactions})`,
        timestamp: Date.now(),
      })
      return true
    }

    default:
      return false
  }
}
