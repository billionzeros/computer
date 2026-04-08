import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Skill } from '../lib/skills.js'
import type { ChatImageAttachment } from '../lib/store.js'
import { useStore } from '../lib/store.js'
import { connectionStore } from '../lib/store/connectionStore.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore, useSessionState } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import { AgentChatHeader } from './chat/AgentChatHeader.js'
import { AgentEmptyState } from './chat/AgentEmptyState.js'
import { ChatInput } from './chat/ChatInput.js'
import { ConfirmDialog } from './chat/ConfirmDialog.js'
import { ContextIndicator } from './chat/ContextIndicator.js'
import { EmptyState } from './chat/EmptyState.js'
import { MessageList } from './chat/MessageList.js'
import { PlanReviewOverlay } from './chat/PlanReviewOverlay.js'
import { SkillDetail } from './skills/SkillDetail.js'

export function AgentChat() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const agentSession = useStore((s) => s.getActiveAgentSession())
  const addMessage = useStore((s) => s.addMessage)
  const newConversation = useStore((s) => s.newConversation)
  const activeSessionId = activeConv?.sessionId
  const pendingConfirm = useSessionState(activeSessionId, (s) => s.pendingConfirm)
  const pendingAskUser = useSessionState(activeSessionId, (s) => s.pendingAskUser)
  const _currentProvider = sessionStore((s) => s.currentProvider)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  // Extract stable identity props so the effect doesn't re-run on every message change
  const activeConvId = activeConv?.id
  const activeConvProjectId = activeConv?.projectId

  // On mount: resume existing conversation's session, or create a new one
  // When used inside ProjectView, the active conversation will have a projectId —
  // in that case we should NOT switch away from it (the project view manages its own sessions).
  const activeView = uiStore((s) => s.activeView)
  const initReady = connectionStore((s) => s.initPhase === 'ready')
  useEffect(() => {
    // Don't create sessions until the init state machine has completed.
    // Otherwise we race with App.tsx's session sync and create duplicates.
    if (!initReady) return

    const store = useStore.getState()

    const ps = projectStore.getState()

    if (!activeConvId) {
      // If there are existing conversations (from localStorage or sync), switch to one
      // instead of creating a new one. This prevents duplicates on reconnect/re-render.
      // Consider conversations from the default project (or legacy ones without projectId).
      const defaultProject = ps.projects.find((p) => p.isDefault)
      const chatConvs = store.conversations.filter(
        (c) => !c.projectId || c.projectId === defaultProject?.id,
      )
      const emptyConv = chatConvs.find((c) => c.messages.length === 0)
      if (emptyConv) {
        store.switchConversation(emptyConv.id)
        return
      }
      if (chatConvs.length > 0) {
        store.switchConversation(chatConvs[0].id)
        return
      }

      // No conversations at all — create a fresh one
      const sessionId = `sess_${Date.now().toString(36)}`
      const projectId = defaultProject?.id ?? ps.activeProjectId ?? undefined
      store.newConversation(undefined, sessionId, projectId)
      store.registerPendingSession(sessionId)
      const ss = sessionStore.getState()
      sessionStore.getState().createSession(sessionId, {
        provider: ss.currentProvider,
        model: ss.currentModel,
        projectId,
      })
    } else if (activeConvProjectId && activeView === 'chat') {
      // Active conversation belongs to a non-default project but we're in chat mode —
      // switch to a default-project conversation. Only do this in chat mode;
      // in projects mode, ProjectView manages the active conversation.
      const defaultProject = ps.projects.find((p) => p.isDefault)
      const chatConvs = store.conversations.filter(
        (c) => !c.projectId || c.projectId === defaultProject?.id,
      )
      if (chatConvs.length > 0) {
        store.switchConversation(chatConvs[0].id)
      } else {
        const sessionId = `sess_${Date.now().toString(36)}`
        const projectId = defaultProject?.id ?? ps.activeProjectId ?? undefined
        store.newConversation(undefined, sessionId, projectId)
        store.registerPendingSession(sessionId)
        const ss2 = sessionStore.getState()
        sessionStore.getState().createSession(sessionId, {
          provider: ss2.currentProvider,
          model: ss2.currentModel,
          projectId,
        })
      }
    }
  }, [activeConvId, activeConvProjectId, activeView, initReady])

  const handleSend = useCallback(
    async (text: string, attachments: ChatImageAttachment[] = []) => {
      const store = useStore.getState()
      const conv = store.getActiveConversation()
      let sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
      const outboundAttachments = attachments.flatMap((attachment) =>
        attachment.data
          ? [
              {
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                data: attachment.data,
                sizeBytes: attachment.sizeBytes,
              },
            ]
          : [],
      )

      if (!conv) {
        // No conversation at all — create one
        sessionId = `sess_${Date.now().toString(36)}`
        const ps = projectStore.getState()
        const projectId =
          ps.projects.find((p) => p.isDefault)?.id ?? ps.activeProjectId ?? undefined
        newConversation(undefined, sessionId, projectId)
        const waitPromise = store.registerPendingSession(sessionId)
        const ss3 = sessionStore.getState()
        sessionStore.getState().createSession(sessionId, {
          provider: ss3.currentProvider,
          model: ss3.currentModel,
          projectId,
        })
        await waitPromise
      } else if (sessionId && !sessionStore.getState().currentSessionId) {
        // Conversation exists but session hasn't been confirmed yet — wait for it
        const sessionState = sessionStore.getState().getSessionState(sessionId)
        if (sessionState.resolver) {
          await new Promise<void>((resolve) => {
            const existing = sessionState.resolver
            sessionStore.getState().updateSessionState(sessionId!, {
              resolver: () => {
                existing?.()
                resolve()
              },
            })
          })
        }
      }

      // Re-read sessionId after potential await
      sessionId = sessionStore.getState().currentSessionId || sessionId

      addMessage({
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        attachments,
        timestamp: Date.now(),
      })

      // For agent conversations, inject agent context on the first message
      let outboundText = text
      const freshConv = useStore.getState().getActiveConversation()
      if (freshConv?.agentSessionId && freshConv.messages.length <= 1) {
        const agent = projectStore
          .getState()
          .projectAgents.find((a) => a.sessionId === freshConv.agentSessionId)
        if (agent) {
          outboundText = `<agent_context>\nAgent: ${agent.agent.name}\nDescription: ${agent.agent.description}\nInstructions: ${agent.agent.instructions}\n</agent_context>\n\n${text}`
        }
      }

      if (sessionId) {
        sessionStore.getState().sendAiMessageToSession(outboundText, sessionId, outboundAttachments)
      } else {
        // Absolute fallback — should not normally happen
        sessionStore.getState().sendAiMessage(outboundText, outboundAttachments)
      }
    },
    [addMessage, newConversation],
  )

  const handleSteer = useCallback((text: string, attachments: ChatImageAttachment[] = []) => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
    if (!sessionId) return
    const outboundAttachments = attachments.flatMap((attachment) =>
      attachment.data
        ? [
            {
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              data: attachment.data,
              sizeBytes: attachment.sizeBytes,
            },
          ]
        : [],
    )
    sessionStore.getState().sendSteerMessage(text, sessionId, outboundAttachments)
  }, [])

  const handleCancelTurn = useCallback(() => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
    if (!sessionId) return
    // If a plan is pending, reject it and clear it
    const plan = sessionStore.getState().getSessionState(sessionId).pendingPlan
    if (plan) {
      sessionStore.getState().sendPlanResponse(plan.id, false, 'Cancelled by user')
      sessionStore.getState().updateSessionState(sessionId, { pendingPlan: null })
    }
    sessionStore.getState().sendCancelTurn(sessionId)
  }, [])

  const handleConfirm = useCallback(
    (approved: boolean) => {
      if (!pendingConfirm) return
      sessionStore.getState().sendConfirmResponse(pendingConfirm.id, approved)
      addMessage({
        id: `confirm_${Date.now()}`,
        role: 'system',
        content: approved
          ? `Approved: ${pendingConfirm.command}`
          : `Denied: ${pendingConfirm.command}`,
        timestamp: Date.now(),
      })
      if (activeSessionId) {
        sessionStore.getState().updateSessionState(activeSessionId, { pendingConfirm: null })
      }
    },
    [pendingConfirm, addMessage, activeSessionId],
  )

  const handleAskUserSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (!pendingAskUser) return
      sessionStore.getState().sendAskUserResponse(pendingAskUser.id, answers)
      addMessage({
        id: `askuser_${Date.now()}`,
        role: 'system',
        content: '',
        timestamp: Date.now(),
        askUserAnswers: answers,
      })
      if (activeSessionId) {
        sessionStore.getState().updateSessionState(activeSessionId, { pendingAskUser: null })
      }
    },
    [pendingAskUser, addMessage, activeSessionId],
  )

  const messages = activeConv?.messages || []
  const isSyncing = sessionStore((s) => {
    const sid = activeConv?.sessionId
    return sid ? s.getSessionState(sid).isSyncing : false
  })

  return (
    <div className="chat-shell">
      <ContextIndicator contextInfo={activeConv?.contextInfo} sessionId={activeConv?.sessionId} />
      {isSyncing && messages.length === 0 ? (
        /* First load — nothing local to show yet, show a subtle spinner */
        <div className="chat-shell__sync-loader">
          <Loader2 size={20} strokeWidth={1.5} className="chat-shell__sync-spinner" />
        </div>
      ) : messages.length === 0 && agentSession ? (
        <AgentEmptyState agent={agentSession} />
      ) : messages.length === 0 ? (
        <EmptyState onSend={handleSend} onSkillSelect={setSelectedSkill} />
      ) : (
        /* Show existing messages while syncing in background — replaced seamlessly when server responds */
        <>
          {agentSession && <AgentChatHeader agent={agentSession} />}
          <MessageList messages={messages} />
        </>
      )}

      {pendingConfirm && (
        <div className="chat-shell__confirm">
          <ConfirmDialog
            command={pendingConfirm.command}
            reason={pendingConfirm.reason}
            onApprove={() => handleConfirm(true)}
            onDeny={() => handleConfirm(false)}
          />
        </div>
      )}

      <PlanReviewOverlay />

      {(messages.length > 0 || agentSession) && (
        <ChatInput
          onSend={handleSend}
          onSteer={handleSteer}
          onCancelTurn={handleCancelTurn}
          onSkillSelect={setSelectedSkill}
          variant="hero"
          pendingAskUser={pendingAskUser}
          onAskUserSubmit={handleAskUserSubmit}
        />
      )}

      <SkillDetail skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  )
}
