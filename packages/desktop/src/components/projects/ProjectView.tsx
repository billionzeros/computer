import type { AgentSession } from '@anton/protocol'
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Settings, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore, useSessionState } from '../../lib/store/sessionStore.js'
import { AgentChat } from '../AgentChat.js'
import { SidePanel } from '../SidePanel.js'
import { CodeModePanel } from '../code-mode/CodeModePanel.js'
import { ProjectLanding } from './ProjectLanding.js'

export function ProjectView() {
  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const activeSessionId = projectStore((s) => s.activeProjectSessionId)
  const setActiveSessionId = projectStore((s) => s.setActiveProjectSession)
  const projectSessions = projectStore((s) => s.projectSessions)
  const projectSessionsLoading = projectStore((s) => s.projectSessionsLoading)
  const artifactPanelOpen = artifactStore((s) => s.artifactPanelOpen)
  const pendingPlan = useSessionState(activeSessionId ?? undefined, (s) => s.pendingPlan)
  const agentSession: AgentSession | null = useStore((s) => s.getActiveAgentSession())
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

  const [codeModeOpen, setCodeModeOpen] = useState(true)
  const isCodeProject = project?.type === 'code' || project?.type === 'clone'
  const sidePanelOpen = artifactPanelOpen || pendingPlan !== null

  // ── Handlers ──

  const handleNewSession = (initialMessage?: string) => {
    const sessionId = `proj_${project.id}_sess_${Date.now().toString(36)}`
    const store = useStore.getState()
    const ss = sessionStore.getState()

    store.newConversation(undefined, sessionId, project.id)

    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId: project.id,
    })

    // Optimistically add to projectSessions so sidebar updates immediately
    const ps = projectStore.getState()
    ps.setProjectSessions([
      {
        id: sessionId,
        title: 'New conversation',
        provider: ss.currentProvider,
        model: ss.currentModel,
        messageCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      },
      ...ps.projectSessions,
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
        sessionStore.getState().sendAiMessageToSession(initialMessage, sessionId)
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

    // Always fetch history from server — server is authoritative.
    // switchConversation handles _sessionsNeedingHistoryRefresh for background-completed sessions
    useStore.getState().requestSessionHistory(sessionId)
    setActiveSessionId(sessionId)
  }

  const handleOpenAgent = (agentSessionId: string) => {
    // Show the agent info panel (AgentEmptyState) with stats, scheduler debug, run history.
    // Run logs are accessed via the modal when clicking a run entry.
    const store = useStore.getState()
    const agent = projectStore.getState().projectAgents.find((a) => a.sessionId === agentSessionId)
    const title = agent ? agent.agent.name : 'Agent'

    // Check if an agent info conversation already exists — don't create duplicates
    const existing = store.conversations.find(
      (c) => c.agentSessionId === agentSessionId && c.projectId === project.id,
    )
    if (existing) {
      store.switchConversation(existing.id)
      setActiveSessionId(existing.sessionId)
    } else {
      const sessionId = `proj_${project.id}_sess_${Date.now().toString(36)}`
      store.newConversation(title, sessionId, project.id, agentSessionId)
      const ss2 = sessionStore.getState()
      sessionStore.getState().createSession(sessionId, {
        provider: ss2.currentProvider,
        model: ss2.currentModel,
        projectId: project.id,
      })
      setActiveSessionId(sessionId)
    }
  }

  const handleDeleteSession = (sessionId: string) => {
    const store = useStore.getState()
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      // deleteConversation also calls destroySession on the backend
      store.deleteConversation(conv.id)
    } else {
      // Session exists on disk without a local conversation — destroy directly
      sessionStore.getState().destroySession(sessionId)
    }
    // Optimistically remove from projectSessions so UI updates instantly
    const ps2 = projectStore.getState()
    ps2.setProjectSessions(ps2.projectSessions.filter((s) => s.id !== sessionId))
    if (activeSessionId === sessionId) {
      setActiveSessionId(null)
    }
    projectStore.getState().listProjectSessions(project.id)
  }

  const handleBackToLanding = () => {
    setActiveSessionId(null)
    projectStore.getState().listProjectSessions(project.id)
  }

  const handleBackToProjects = () => {
    // Switch back to the default project so HomeView shows the task list
    const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
    if (defaultProject) {
      setActiveProject(defaultProject.id)
    } else {
      setActiveProject(null)
    }
  }

  const handleDelete = () => {
    projectStore.getState().deleteProject(project.id)
    const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
    setActiveProject(defaultProject?.id ?? null)
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
          onOpenAgent={handleOpenAgent}
          onDeleteSession={handleDeleteSession}
          onBack={handleBackToProjects}
        />

        {showDeleteConfirm && (
          <div
            className="modal-overlay"
            onClick={() => setShowDeleteConfirm(false)}
            onKeyDown={(e) => e.key === 'Escape' && setShowDeleteConfirm(false)}
          >
            <div
              className="modal-card modal-card--sm"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div className="modal-card__body">
                <h3>Delete "{project.name}"?</h3>
                <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                  This will delete all sessions, jobs, and data. This cannot be undone.
                </p>
              </div>
              <div className="modal-card__footer">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                >
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
          <div className="project-chat-view__icon" style={{ backgroundColor: project.color }}>
            {project.icon}
          </div>
          <span className="project-chat-view__sep">/</span>
          <span className="project-chat-view__name">{project.name}</span>
          {agentSession && (
            <>
              <span className="project-chat-view__sep">/</span>
              <Bot size={13} strokeWidth={1.5} />
              <span className="project-chat-view__name">{agentSession.agent.name}</span>
            </>
          )}
        </button>

        <div className="project-chat-view__actions">
          {project.stats.activeAgents > 0 && (
            <span className="project-chat-view__badge">
              <Zap size={12} strokeWidth={1.5} />
              {project.stats.activeAgents}
            </span>
          )}
          <button type="button" className="project-chat-view__btn" data-tooltip="Settings">
            <Settings size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="project-chat-view__btn project-chat-view__btn--danger"
            onClick={() => setShowDeleteConfirm(true)}
            data-tooltip="Delete project"
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
            {isCodeProject && codeModeOpen ? (
              <motion.div
                key="code-mode"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <CodeModePanel onClose={() => setCodeModeOpen(false)} />
              </motion.div>
            ) : sidePanelOpen ? (
              <SidePanel />
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="modal-overlay"
          onClick={() => setShowDeleteConfirm(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowDeleteConfirm(false)}
        >
          <div
            className="modal-card modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="modal-card__body">
              <h3>Delete "{project.name}"?</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                This will delete all sessions, jobs, and data. This cannot be undone.
              </p>
            </div>
            <div className="modal-card__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setShowDeleteConfirm(false)}
              >
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
