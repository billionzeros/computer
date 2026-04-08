import {
  ArrowLeft,
  BarChart3,
  Braces,
  FileCode,
  Files,
  ListChecks,
  Lock,
  MoreHorizontal,
  Network,
  Sparkles,
  SquareCode,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ArtifactRenderType } from '../../lib/artifacts.js'
import { getArtifactTypeLabel } from '../../lib/artifacts.js'
import { sanitizeTitle } from '../../lib/conversations.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'

const ARTIFACT_TYPE_ICONS: Record<ArtifactRenderType, typeof Sparkles> = {
  html: Sparkles,
  code: Braces,
  markdown: FileCode,
  svg: SquareCode,
  mermaid: Network,
}
import {
  sessionStore,
  useActiveSessionState,
  useSessionState,
} from '../../lib/store/sessionStore.js'
import { Skeleton } from '../Skeleton.js'
import { ChatInput } from '../chat/ChatInput.js'
import { ConfirmDialog } from '../chat/ConfirmDialog.js'
import { MessageList } from '../chat/MessageList.js'
import { PlanReviewOverlay } from '../chat/PlanReviewOverlay.js'

export function TaskDetailView() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const addMessage = useStore((s) => s.addMessage)
  const currentTasks = useActiveSessionState((s) => s.tasks)
  const [todoOpen, setTodoOpen] = useState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)

  const activeSessionId = activeConv?.sessionId
  const pendingConfirm = useSessionState(activeSessionId, (s) => s.pendingConfirm)
  const pendingAskUser = useSessionState(activeSessionId, (s) => s.pendingAskUser)

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

  const handleSkillSelect = (_skill: Skill) => {}

  // No conversation selected — don't render (parent shows full-width task list)
  if (!activeConv) {
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
        <div className="conv-panel__title">{sanitizeTitle(activeConv?.title || 'New task')}</div>

        <div className="conv-panel__actions">
          <button type="button" className="conv-panel__action-btn" aria-label="More options">
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
          {artifacts.length > 0 && (
            <div className="conv-panel__artifacts-wrap">
              <button
                type="button"
                className="conv-panel__action-btn conv-panel__action-btn--label"
                aria-label="Files"
                onClick={() => setArtifactsOpen(!artifactsOpen)}
              >
                <Files size={15} strokeWidth={1.5} />
                <span>{artifacts.length}</span>
              </button>
              {artifactsOpen && (
                <>
                  <div
                    className="conv-panel__artifacts-backdrop"
                    onClick={() => setArtifactsOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setArtifactsOpen(false)
                    }}
                  />
                  <div className="conv-panel__artifacts-dropdown">
                    <div className="conv-panel__artifacts-header">
                      <span className="conv-panel__artifacts-title">Artifacts</span>
                      <span className="conv-panel__artifacts-count">{artifacts.length}</span>
                    </div>
                    <div className="conv-panel__artifacts-list">
                      {[...artifacts].reverse().map((artifact) => {
                        const Icon = ARTIFACT_TYPE_ICONS[artifact.renderType] || Braces
                        const title = artifact.title || artifact.filename || 'Untitled'
                        return (
                          <button
                            key={artifact.id}
                            type="button"
                            className="conv-panel__artifacts-item"
                            onClick={() => {
                              setArtifactsOpen(false)
                              artifactStore.getState().setActiveArtifact(artifact.id)
                              const el = document.querySelector(
                                `[data-artifact-id="${artifact.id}"]`,
                              )
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            }}
                          >
                            <Icon
                              size={14}
                              strokeWidth={1.5}
                              className="conv-panel__artifacts-item-icon"
                            />
                            <span className="conv-panel__artifacts-item-title">{title}</span>
                            <span className="conv-panel__artifacts-item-badge">
                              {getArtifactTypeLabel(artifact.renderType)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
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
