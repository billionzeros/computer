import { Bell, Settings, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
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
    connection.sendSessionHistory(sessionId)
    setActiveSessionId(sessionId)
  }

  const handleDeleteSession = (sessionId: string) => {
    const store = useStore.getState()
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      connection.sendSessionDestroy(sessionId)
      store.deleteConversation(conv.id)
    }
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
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
            <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()}>
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
