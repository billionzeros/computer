import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { connection } from '../lib/connection.js'
import type { Skill } from '../lib/skills.js'
import type { ChatImageAttachment } from '../lib/store.js'
import { useStore } from '../lib/store.js'
import { AgentChatHeader } from './chat/AgentChatHeader.js'
import { AgentEmptyState } from './chat/AgentEmptyState.js'
import { ChatInput } from './chat/ChatInput.js'
import { ConfirmDialog } from './chat/ConfirmDialog.js'
import { ContextIndicator } from './chat/ContextIndicator.js'
import { EmptyState } from './chat/EmptyState.js'
import { MessageList } from './chat/MessageList.js'
import { PlanReviewOverlay } from './chat/PlanReviewOverlay.js'
import { SkillDialog } from './skills/SkillDialog.js'

export function AgentChat() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const agentSession = useStore((s) => s.getActiveAgentSession())
  const addMessage = useStore((s) => s.addMessage)
  const newConversation = useStore((s) => s.newConversation)
  const pendingConfirm = useStore((s) => {
    const confirm = s.pendingConfirm
    if (!confirm) return null
    const active = s.getActiveConversation()
    // Show confirm only for the active session (or if no sessionId for backward compat)
    return !confirm.sessionId || confirm.sessionId === active?.sessionId ? confirm : null
  })
  const setPendingConfirm = useStore((s) => s.setPendingConfirm)
  const pendingAskUser = useStore((s) => {
    const ask = s.pendingAskUser
    if (!ask) return null
    const active = s.getActiveConversation()
    return !ask.sessionId || ask.sessionId === active?.sessionId ? ask : null
  })
  const setPendingAskUser = useStore((s) => s.setPendingAskUser)
  const _currentProvider = useStore((s) => s.currentProvider)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  // Extract stable identity props so the effect doesn't re-run on every message change
  const activeConvId = activeConv?.id
  const activeConvProjectId = activeConv?.projectId

  // On mount: resume existing conversation's session, or create a new one
  // When used inside ProjectView, the active conversation will have a projectId —
  // in that case we should NOT switch away from it (the project view manages its own sessions).
  const activeView = useStore((s) => s.activeView)
  useEffect(() => {
    const store = useStore.getState()

    if (!activeConvId) {
      // If there are existing conversations (from localStorage or sync), switch to one
      // instead of creating a new one. This prevents duplicates on reconnect/re-render.
      // Only consider non-project conversations — project ones belong in ProjectView.
      const chatConvs = store.conversations.filter((c) => !c.projectId)
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
      store.newConversation(undefined, sessionId)
      store.registerPendingSession(sessionId)
      connection.sendSessionCreate(sessionId, {
        provider: store.currentProvider,
        model: store.currentModel,
      })
    } else if (activeConvProjectId && activeView === 'chat') {
      // Active conversation belongs to a project but we're in chat mode —
      // switch to a non-project conversation. Only do this in chat mode;
      // in projects mode, ProjectView manages the active conversation.
      const chatConvs = store.conversations.filter((c) => !c.projectId)
      if (chatConvs.length > 0) {
        store.switchConversation(chatConvs[0].id)
      } else {
        const sessionId = `sess_${Date.now().toString(36)}`
        store.newConversation(undefined, sessionId)
        store.registerPendingSession(sessionId)
        connection.sendSessionCreate(sessionId, {
          provider: store.currentProvider,
          model: store.currentModel,
        })
      }
    }
  }, [activeConvId, activeConvProjectId, activeView])

  const handleSend = useCallback(
    async (text: string, attachments: ChatImageAttachment[] = []) => {
      const store = useStore.getState()
      const conv = store.getActiveConversation()
      let sessionId = conv?.sessionId || store.currentSessionId
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
        newConversation(undefined, sessionId)
        const waitPromise = store.registerPendingSession(sessionId)
        connection.sendSessionCreate(sessionId, {
          provider: store.currentProvider,
          model: store.currentModel,
        })
        await waitPromise
      } else if (sessionId && !store.currentSessionId) {
        // Conversation exists but session hasn't been confirmed yet — wait for it
        const resolvers = store._sessionResolvers
        if (resolvers.has(sessionId)) {
          await new Promise<void>((resolve) => {
            const existing = resolvers.get(sessionId!)
            // Chain: resolve the original AND our new waiter
            resolvers.set(sessionId!, () => {
              existing?.()
              resolve()
            })
          })
        }
      }

      // Re-read sessionId after potential await
      const freshStore = useStore.getState()
      sessionId = freshStore.currentSessionId || sessionId

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
        const agent = useStore
          .getState()
          .projectAgents.find((a) => a.sessionId === freshConv.agentSessionId)
        if (agent) {
          outboundText = `<agent_context>\nAgent: ${agent.agent.name}\nDescription: ${agent.agent.description}\nInstructions: ${agent.agent.instructions}\n</agent_context>\n\n${text}`
        }
      }

      if (sessionId) {
        connection.sendAiMessageToSession(outboundText, sessionId, outboundAttachments)
      } else {
        // Absolute fallback — should not normally happen
        connection.sendAiMessage(outboundText, outboundAttachments)
      }
    },
    [addMessage, newConversation],
  )

  const handleSteer = useCallback((text: string) => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || store.currentSessionId
    if (!sessionId) return
    connection.sendSteerMessage(text, sessionId)
  }, [])

  const handleCancelTurn = useCallback(() => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || store.currentSessionId
    if (!sessionId) return
    // If a plan is pending, reject it and clear it
    const plan = store.pendingPlan
    if (plan && (!plan.sessionId || plan.sessionId === sessionId)) {
      connection.sendPlanResponse(plan.id, false, 'Cancelled by user')
      store.setPendingPlan(null)
    }
    connection.sendCancelTurn(sessionId)
  }, [])

  const handleConfirm = useCallback(
    (approved: boolean) => {
      if (!pendingConfirm) return
      connection.sendConfirmResponse(pendingConfirm.id, approved)
      addMessage({
        id: `confirm_${Date.now()}`,
        role: 'system',
        content: approved
          ? `Approved: ${pendingConfirm.command}`
          : `Denied: ${pendingConfirm.command}`,
        timestamp: Date.now(),
      })
      setPendingConfirm(null)
    },
    [pendingConfirm, addMessage, setPendingConfirm],
  )

  const handleAskUserSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (!pendingAskUser) return
      connection.sendAskUserResponse(pendingAskUser.id, answers)
      // Show a summary of answers in the chat
      const summary = Object.entries(answers)
        .map(([q, a]) => `**${q}** → ${a}`)
        .join('\n')
      addMessage({
        id: `askuser_${Date.now()}`,
        role: 'system',
        content: summary,
        timestamp: Date.now(),
      })
      setPendingAskUser(null)
    },
    [pendingAskUser, addMessage, setPendingAskUser],
  )

  const messages = activeConv?.messages || []
  const isSyncing = useStore((s) => {
    const sid = s.getActiveConversation()?.sessionId
    return sid ? s._syncingSessionIds.has(sid) : false
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
          pendingAskUser={pendingAskUser}
          onAskUserSubmit={handleAskUserSubmit}
        />
      )}

      <SkillDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  )
}
