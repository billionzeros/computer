import { useCallback, useEffect, useMemo, useState } from 'react'
import { connection } from '../lib/connection.js'
import type { Skill } from '../lib/skills.js'
import type { ChatImageAttachment } from '../lib/store.js'
import { useAgentStatus, useStore } from '../lib/store.js'
import { ChatInput } from './chat/ChatInput.js'
import { ConfirmDialog } from './chat/ConfirmDialog.js'
import { EmptyState } from './chat/EmptyState.js'
import { MessageList } from './chat/MessageList.js'
import { TaskProgressBar } from './chat/TaskProgressBar.js'
import { groupMessages } from './chat/groupMessages.js'
import { SkillDialog } from './skills/SkillDialog.js'

export function AgentChat() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const addMessage = useStore((s) => s.addMessage)
  const newConversation = useStore((s) => s.newConversation)
  const pendingConfirm = useStore((s) => s.pendingConfirm)
  const setPendingConfirm = useStore((s) => s.setPendingConfirm)
  const pendingAskUser = useStore((s) => s.pendingAskUser)
  const setPendingAskUser = useStore((s) => s.setPendingAskUser)
  const _currentProvider = useStore((s) => s.currentProvider)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  // On mount: resume existing conversation's session, or create a new one
  useEffect(() => {
    if (!activeConv) {
      const store = useStore.getState()

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
      newConversation(undefined, sessionId)
      store.registerPendingSession(sessionId)
      connection.sendSessionCreate(sessionId, {
        provider: store.currentProvider,
        model: store.currentModel,
      })
    } else if (activeConv.projectId) {
      // Active conversation belongs to a project — don't resume it in chat mode.
      // Switch to a non-project conversation or create a fresh one.
      const store = useStore.getState()
      const chatConvs = store.conversations.filter((c) => !c.projectId)
      if (chatConvs.length > 0) {
        store.switchConversation(chatConvs[0].id)
      } else {
        const sessionId = `sess_${Date.now().toString(36)}`
        newConversation(undefined, sessionId)
        store.registerPendingSession(sessionId)
        connection.sendSessionCreate(sessionId, {
          provider: store.currentProvider,
          model: store.currentModel,
        })
      }
    } else if (activeConv.sessionId && !useStore.getState().currentSessionId) {
      // Restored conversation — resume its server session
      connection.sendSessionResume(activeConv.sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id])

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

      if (sessionId) {
        connection.sendAiMessageToSession(text, sessionId, outboundAttachments)
      } else {
        // Absolute fallback — should not normally happen
        connection.sendAiMessage(text, outboundAttachments)
      }
    },
    [addMessage, newConversation],
  )

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
  const agentStatus = useAgentStatus()
  const grouped = useMemo(() => groupMessages(messages), [messages])
  const isWorking = agentStatus === 'working'

  return (
    <div className="chat-shell">
      {messages.length === 0 ? (
        <EmptyState onSend={handleSend} onSkillSelect={setSelectedSkill} />
      ) : (
        <MessageList messages={messages} />
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

      {isWorking && <TaskProgressBar grouped={grouped} />}

      {messages.length > 0 && (
        <ChatInput
          onSend={handleSend}
          onSkillSelect={setSelectedSkill}
          pendingAskUser={pendingAskUser}
          onAskUserSubmit={handleAskUserSubmit}
        />
      )}

      <SkillDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  )
}
