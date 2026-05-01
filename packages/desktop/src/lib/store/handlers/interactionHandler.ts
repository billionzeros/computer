/**
 * AI channel: confirm, plan_confirm, ask_user, browser_*, tasks_update, done, error, title_update, token_update, compaction.
 */

import type { AiMessage } from '@anton/protocol'
import { updateCacheEntry } from '../../conversationCache.js'
import { notify } from '../../notifications.js'
import { useStore } from '../../store.js'
import { artifactStore } from '../artifactStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import type { SessionMeta } from '../types.js'
import { uiStore } from '../uiStore.js'
import type { MessageContext } from './shared.js'

/** Guard: only fire notification if notifications are enabled in settings. */
function maybeNotify(event: Parameters<typeof notify>[0]) {
  if (uiStore.getState().notificationsEnabled) {
    notify(event)
  }
}

/**
 * Harness errors ship a `code` field that classifies the failure. Surface
 * the code as a short actionable prefix so users can tell "re-auth needed"
 * apart from "install the CLI" apart from "something crashed".
 */
function decorateHarnessError(code: string | undefined, message: string): string {
  switch (code) {
    case 'not_installed':
      return `**CLI not installed.** ${message}\n\nInstall the provider's CLI and try again.`
    case 'not_authed':
      return `**Authentication required.** ${message}\n\nSign in to the provider from Settings → Providers and try again.`
    case 'startup_timeout':
      return `**CLI failed to start.** ${message}\n\nThis is usually an auth or version issue. Check Settings → Providers.`
    default:
      return message
  }
}

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
        maybeNotify({ type: 'confirm', command: msg.command, sessionId: sid })
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
        maybeNotify({ type: 'plan_confirm', planTitle: msg.title, sessionId: sid })
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
        const firstQuestion = msg.questions?.[0]?.question || 'Anton needs your input'
        maybeNotify({ type: 'ask_user', question: firstQuestion, sessionId: sid })
      }
      return true
    }

    case 'error': {
      const ss = sessionStore.getState()
      const sid = ctx.msgSessionId

      if (sid && ss.getSessionState(sid).isSyncing) {
        ss.updateSessionState(sid, { isSyncing: false, pendingSyncMessages: [] })
      }

      if (msg.code === 'session_not_found' && sid) {
        // Don't auto-delete — the session may reappear after a server restart/update.
        // Just mark the session as error so the user sees feedback.
        console.warn(`[SessionSync] session_not_found for ${sid} — marking as error, not deleting`)
        ss.updateSessionState(sid, { isStreaming: false, status: 'error' })
        ctx.addMsg({
          id: `err_session_${Date.now()}`,
          role: 'system',
          content:
            'Session not found on server. It may have been lost during an update. You can start a new conversation or try again after the server reconnects.',
          isError: true,
          timestamp: Date.now(),
        })
        return true
      }

      if (sid) {
        ctx.addMsg({
          id: `err_${Date.now()}`,
          role: 'system',
          content: decorateHarnessError(msg.code, msg.message),
          isError: true,
          timestamp: Date.now(),
        })
        ss.updateSessionState(sid, { isStreaming: false, status: 'error' })
        maybeNotify({ type: 'error', message: msg.message, sessionId: sid })
      } else {
        console.warn(
          '[WS] Received error without sessionId, not adding to conversation:',
          msg.message,
        )
      }
      return true
    }

    case 'title_update': {
      if (msg.sessionId) {
        const store = useStore.getState()
        store.updateConversationTitle(msg.sessionId, msg.title)
        updateCacheEntry(msg.sessionId as string, { title: msg.title as string })
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

      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = doneSessionId
        ? ss.getSessionState(doneSessionId).status === 'working'
        : false
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

      // Notify on successful completion
      if (wasWorking && !noResponse) {
        maybeNotify({ type: 'done', title: doneConv?.title, sessionId: doneSessionId })
      }

      if (doneSessionId) {
        // If the session already started a new turn (status is 'working'),
        // don't override it back to idle — this done event is from the previous turn.
        const currentState = ss.getSessionState(doneSessionId)
        const alreadyWorking = currentState.status === 'working'

        // Update all per-session state in one call
        const updates: Partial<import('../sessionStore.js').SessionState> = {
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

        // Update cache with latest timestamp
        updateCacheEntry(doneSessionId, { updatedAt: Date.now() })

        // Adopt the server-assigned message id (used to correlate thumbs
        // up/down feedback with Braintrust spans) BEFORE we clear the
        // tracking map — the action keys off `_sessionAssistantMsgIds`
        // to find the in-progress assistant message.
        if (typeof msg.messageId === 'string' && msg.messageId.length > 0) {
          store.adoptAssistantMessageId(doneSessionId, msg.messageId)
        }

        // Clear per-session message tracking in app store
        store._sessionAssistantMsgIds.delete(doneSessionId)
        store._sessionThinkingMsgIds.delete(doneSessionId)
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
