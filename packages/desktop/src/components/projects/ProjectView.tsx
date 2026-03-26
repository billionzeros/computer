import { Settings, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { AgentChat } from '../AgentChat.js'
import { SidePanel } from '../SidePanel.js'
import { ProjectLanding } from './ProjectLanding.js'

export function ProjectView() {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const activeSessionId = useStore((s) => s.activeProjectSessionId)
  const setActiveSessionId = useStore((s) => s.setActiveProjectSession)
  const projectSessions = useStore((s) => s.projectSessions)
  const projectSessionsLoading = useStore((s) => s.projectSessionsLoading)
  const artifactPanelOpen = useStore((s) => s.artifactPanelOpen)
  const pendingPlan = useStore((s) => s.pendingPlan)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Ensure activeConversationId matches the project session when viewing a session.
  // This handles the case where the user switched to Chat (which changed activeConversationId
  // to a chat conversation) and then switched back to Projects.
  useEffect(() => {
    if (!activeSessionId) return
    const store = useStore.getState()
    const activeConv = store.getActiveConversation()
    if (activeConv?.sessionId === activeSessionId) return // already correct
    const projConv = store.findConversationBySession(activeSessionId)
    if (projConv) {
      store.switchConversation(projConv.id)
    }
  }, [activeSessionId])

  const project = projects.find((p) => p.id === activeProjectId)
  if (!project) return null

  const sidePanelOpen = artifactPanelOpen || pendingPlan !== null

  // ── Handlers ──

  const handleNewSession = (initialMessage?: string) => {
    const sessionId = `proj_${project.id}_sess_${Date.now().toString(36)}`
    const store = useStore.getState()

    store.newConversation(undefined, sessionId, project.id)

    connection.sendSessionCreate(sessionId, {
      provider: store.currentProvider,
      model: store.currentModel,
      projectId: project.id,
    })

    // Optimistically add to projectSessions so sidebar updates immediately
    store.setProjectSessions([
      {
        id: sessionId,
        title: 'New conversation',
        provider: store.currentProvider,
        model: store.currentModel,
        messageCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      },
      ...store.projectSessions,
    ])

    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      store.switchConversation(conv.id)
    }

    setActiveSessionId(sessionId)

    // If there's an initial message, send it after a tick
    if (initialMessage) {
      setTimeout(() => {
        const s = useStore.getState()
        s.addMessage({
          id: `user_${Date.now()}`,
          role: 'user',
          content: initialMessage,
          timestamp: Date.now(),
        })
        connection.sendAiMessageToSession(initialMessage, sessionId)
      }, 100)
    }
  }

  const handleOpenSession = (sessionId: string) => {
    const store = useStore.getState()

    let conv = store.findConversationBySession(sessionId)
    if (!conv) {
      store.newConversation(undefined, sessionId, project.id)
      conv = store.findConversationBySession(sessionId)
    }

    if (conv) {
      store.switchConversation(conv.id)
    }

    connection.sendSessionResume(sessionId)
    // Only fetch history if we have no local messages (first open or cleared localStorage)
    // switchConversation handles _sessionsNeedingHistoryRefresh for background-completed sessions
    if (!conv || conv.messages.length === 0) {
      connection.sendSessionHistory(sessionId)
    }
    setActiveSessionId(sessionId)
  }

  const handleDeleteSession = (sessionId: string) => {
    const store = useStore.getState()
    // Always tell the server to destroy — session may exist on disk without a local conversation
    connection.sendSessionDestroy(sessionId)
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      store.deleteConversation(conv.id)
    }
    // Optimistically remove from projectSessions so UI updates instantly
    store.setProjectSessions(store.projectSessions.filter((s) => s.id !== sessionId))
    if (activeSessionId === sessionId) {
      setActiveSessionId(null)
    }
    connection.sendProjectSessionsList(project.id)
  }

  const handleBackToLanding = () => {
    setActiveSessionId(null)
    connection.sendProjectSessionsList(project.id)
  }

  const handleBackToProjects = () => {
    setActiveProject(null)
  }

  const handleDelete = () => {
    connection.sendProjectDelete(project.id)
    setActiveProject(null)
  }

  // ── State 1: Landing (no active session) ──

  if (!activeSessionId) {
    return (
      <>
        <ProjectLanding
          project={project}
          sessions={projectSessions}
          sessionsLoading={projectSessionsLoading}
          onNewSession={handleNewSession}
          onOpenSession={handleOpenSession}
          onDeleteSession={handleDeleteSession}
          onBack={handleBackToProjects}
        />

        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)} onKeyDown={(e) => e.key === 'Escape' && setShowDeleteConfirm(false)}>
            <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <div className="modal-card__body">
                <h3>Delete "{project.name}"?</h3>
                <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                  This will delete all sessions, jobs, and data. This cannot be undone.
                </p>
              </div>
              <div className="modal-card__footer">
                <button type="button" className="button button--ghost" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </button>
                <button type="button" className="button button--danger" onClick={handleDelete}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── State 2: Active session (chat view) ──

  return (
    <div className="project-chat-view">
      {/* Slim breadcrumb header */}
      <div className="project-chat-view__header">
        <button
          type="button"
          className="project-chat-view__breadcrumb"
          onClick={handleBackToLanding}
        >
          <div
            className="project-chat-view__icon"
            style={{ backgroundColor: project.color }}
          >
            {project.icon}
          </div>
          <span className="project-chat-view__sep">/</span>
          <span className="project-chat-view__name">{project.name}</span>
        </button>

        <div className="project-chat-view__actions">
          {project.stats.activeJobs > 0 && (
            <span className="project-chat-view__badge">
              <Zap size={12} strokeWidth={1.5} />
              {project.stats.activeJobs}
            </span>
          )}
          <button
            type="button"
            className="project-chat-view__btn"
            title="Settings"
          >
            <Settings size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="project-chat-view__btn project-chat-view__btn--danger"
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete project"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div className="project-chat-view__body">
        <div className="project-chat-view__chat">
          <AgentChat />
          <AnimatePresence>
            {sidePanelOpen && <SidePanel />}
          </AnimatePresence>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)} onKeyDown={(e) => e.key === 'Escape' && setShowDeleteConfirm(false)}>
          <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="modal-card__body">
              <h3>Delete "{project.name}"?</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                This will delete all sessions, jobs, and data. This cannot be undone.
              </p>
            </div>
            <div className="modal-card__footer">
              <button type="button" className="button button--ghost" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="button button--danger" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
