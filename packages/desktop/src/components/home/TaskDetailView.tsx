import { ArrowLeft, BarChart3, Files, ListChecks, Lock, MoreHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { Skeleton } from '../Skeleton.js'
import { ChatInput } from '../chat/ChatInput.js'
import { ConfirmDialog } from '../chat/ConfirmDialog.js'
import { MessageList } from '../chat/MessageList.js'
import { PlanReviewOverlay } from '../chat/PlanReviewOverlay.js'

export function TaskDetailView() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const addMessage = useStore((s) => s.addMessage)
  const currentTasks = sessionStore((s) => s.currentTasks)
  const [todoOpen, setTodoOpen] = useState(false)

  const activeSessionId = activeConv?.sessionId
  const pendingConfirm = sessionStore((s) => s.getPendingConfirmForSession(activeSessionId))
  const setPendingConfirm = sessionStore((s) => s.setPendingConfirm)

  const pendingAskUser = sessionStore((s) => s.getPendingAskUserForSession(activeSessionId))
  const setPendingAskUser = sessionStore((s) => s.setPendingAskUser)

  const messages = activeConv?.messages || []
  const isSyncing = sessionStore((s) =>
    activeSessionId ? s.getSessionState(activeSessionId).isSyncing : false,
  )

  const artifacts = artifactStore((s) => s.artifacts)

  const handleSend = useCallback(
    async (text: string, attachments: ChatImageAttachment[] = []) => {
      const store = useStore.getState()
      const conv = store.getActiveConversation()
      const sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
      if (!sessionId) return

      const outboundAttachments = attachments.flatMap((a) =>
        a.data
          ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
          : [],
      )

      addMessage({
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        attachments,
        timestamp: Date.now(),
      })

      sessionStore.getState().sendAiMessageToSession(text, sessionId, outboundAttachments)
    },
    [addMessage],
  )

  const handleSteer = useCallback((text: string) => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
    if (!sessionId) return
    sessionStore.getState().sendSteerMessage(text, sessionId)
  }, [])

  const handleCancelTurn = useCallback(() => {
    const store = useStore.getState()
    const conv = store.getActiveConversation()
    const sessionId = conv?.sessionId || sessionStore.getState().currentSessionId
    if (!sessionId) return
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
      setPendingConfirm(null)
    },
    [pendingConfirm, addMessage, setPendingConfirm],
  )

  const handleAskUserSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (!pendingAskUser) return
      sessionStore.getState().sendAskUserResponse(pendingAskUser.id, answers)
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

  const handleSkillSelect = (_skill: Skill) => {}

  // No conversation selected — don't render (parent shows full-width task list)
  if (!activeConv || messages.length === 0) {
    return null
  }

  return (
    <div className="conv-panel">
      {/* Top bar — Perplexity style: back + title | icon buttons */}
      <div className="conv-panel__topbar">
        <button
          type="button"
          className="conv-panel__back"
          onClick={() => {
            useStore.getState().switchConversation('')
          }}
          aria-label="Back to all tasks"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="conv-panel__title">{activeConv?.title || 'New task'}</div>

        <div className="conv-panel__actions">
          <button type="button" className="conv-panel__action-btn" aria-label="More options">
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
          {artifacts.length > 0 && (
            <button
              type="button"
              className="conv-panel__action-btn conv-panel__action-btn--label"
              aria-label="Files"
            >
              <Files size={15} strokeWidth={1.5} />
              <span>{artifacts.length}</span>
            </button>
          )}
          <button type="button" className="conv-panel__action-btn" aria-label="Usage">
            <BarChart3 size={18} strokeWidth={1.5} />
          </button>
          {currentTasks.length > 0 && (
            <div className="conv-panel__todo-wrap">
              <button
                type="button"
                className="conv-panel__action-btn"
                onClick={() => setTodoOpen(!todoOpen)}
                aria-label="Todo"
              >
                <ListChecks size={18} strokeWidth={1.5} />
              </button>
              {todoOpen && (
                <>
                  <div
                    className="conv-panel__todo-backdrop"
                    onClick={() => setTodoOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTodoOpen(false)
                    }}
                  />
                  <div className="conv-panel__todo-dropdown">
                    <div className="conv-panel__todo-title">{activeConv?.title || 'Tasks'}</div>
                    {currentTasks.map((task) => (
                      <div key={task.content} className="conv-panel__todo-item">
                        <span
                          className={`conv-panel__todo-icon conv-panel__todo-icon--${task.status}`}
                        >
                          {task.status === 'completed'
                            ? '✓'
                            : task.status === 'in_progress'
                              ? '◎'
                              : '○'}
                        </span>
                        <span
                          className={`conv-panel__todo-text${task.status === 'completed' ? ' conv-panel__todo-text--done' : ''}`}
                        >
                          {task.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button type="button" className="conv-panel__action-btn" aria-label="Share">
            <Lock size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="conv-panel__messages">
        {isSyncing && messages.length === 0 ? (
          <div className="conv-panel__loading">
            <div className="conv-panel__skeleton-messages">
              {/* User message skeleton */}
              <div className="conv-panel__skeleton-msg conv-panel__skeleton-msg--user">
                <Skeleton width="60%" height={14} />
              </div>
              {/* Assistant message skeleton */}
              <div className="conv-panel__skeleton-msg conv-panel__skeleton-msg--assistant">
                <Skeleton width="80%" height={14} />
                <Skeleton width="95%" height={14} />
                <Skeleton width="45%" height={14} />
              </div>
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}

        {pendingConfirm && (
          <div className="conv-panel__confirm">
            <ConfirmDialog
              command={pendingConfirm.command}
              reason={pendingConfirm.reason}
              onApprove={() => handleConfirm(true)}
              onDeny={() => handleConfirm(false)}
            />
          </div>
        )}

        <PlanReviewOverlay />
      </div>

      {/* Chat input */}
      <div className="conv-panel__input">
        <ChatInput
          onSend={handleSend}
          onSteer={handleSteer}
          onCancelTurn={handleCancelTurn}
          onSkillSelect={handleSkillSelect}
          pendingAskUser={pendingAskUser}
          onAskUserSubmit={handleAskUserSubmit}
          variant="minimal"
        />
      </div>
    </div>
  )
}
