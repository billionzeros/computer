import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Monitor,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { connection } from '../lib/connection.js'
import { useConnectionStatus, useStore } from '../lib/store.js'
import { AntonLogo } from './AntonLogo.js'

interface Props {
  onDisconnect: () => void
  activeView: 'agent' | 'terminal'
  onViewChange: (view: 'agent' | 'terminal') => void
  onOpenSettings: () => void
}

export function Sidebar({ onViewChange, onOpenSettings }: Props) {
  useConnectionStatus()
  const conversations = useStore((s) => s.conversations)
  const activeId = useStore((s) => s.activeConversationId)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const currentView = useStore((s) => s.activeView)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const projectSessions = useStore((s) => s.projectSessions)
  const sessionStatuses = useStore((s) => s.sessionStatuses)
  const pendingConfirm = useStore((s) => s.pendingConfirm)
  const pendingAskUser = useStore((s) => s.pendingAskUser)
  const pendingPlan = useStore((s) => s.pendingPlan)

  const chatConversations = conversations.filter((c) => !c.projectId)

  const getConvStatus = (sessionId: string | undefined) => {
    if (!sessionId) return null
    // Check if awaiting user input (confirm, ask_user, or plan review)
    if (
      pendingConfirm?.sessionId === sessionId ||
      pendingAskUser?.sessionId === sessionId ||
      pendingPlan?.sessionId === sessionId
    ) {
      return 'awaiting'
    }
    // Check if working
    const status = sessionStatuses.get(sessionId)
    if (status?.status === 'working') return 'working'
    return null
  }

  const handleNewTask = () => {
    const sessionId = `sess_${Date.now().toString(36)}`
    const store = useStore.getState()
    newConversation(undefined, sessionId)
    connection.sendSessionCreate(sessionId, {
      provider: store.currentProvider,
      model: store.currentModel,
    })
    onViewChange('agent')
    if (currentView !== 'chat') {
      store.setActiveView('chat')
    }
  }

  const handleDelete = (e: React.MouseEvent, convId: string, sessionId: string) => {
    e.stopPropagation()
    if (sessionId) {
      connection.sendSessionDestroy(sessionId)
    }
    deleteConversation(convId)
  }

  const handleProjectClick = (projectId: string) => {
    setActiveProject(projectId)
    connection.sendProjectSessionsList(projectId)
  }

  return (
    <motion.aside
      className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}
      data-tauri-drag-region
      animate={{ width: sidebarCollapsed ? 0 : 240 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <div className="sidebar__inner">
        {/* Brand */}
        <div className="sidebar-brand">
          <AntonLogo size={20} />
          <span className="sidebar-brand__text">anton.computer</span>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
          >
            <PanelLeft size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* New thread button — only in chat mode */}
        {currentView === 'chat' && (
          <div className="sidebar-primary">
            <button
              type="button"
              className="sidebar-new-thread"
              onClick={handleNewTask}
            >
              <Plus size={14} strokeWidth={1.5} />
              <span>New thread</span>
            </button>
          </div>
        )}

        {/* New project button — only in projects mode */}
        {currentView === 'projects' && (
          <div className="sidebar-primary">
            <button
              type="button"
              className="sidebar-new-thread"
              onClick={() => {
                const store = useStore.getState()
                if (store.activeProjectId) {
                  store.setActiveProject(null)
                  requestAnimationFrame(() => {
                    window.dispatchEvent(new CustomEvent('anton:create-project'))
                  })
                } else {
                  window.dispatchEvent(new CustomEvent('anton:create-project'))
                }
              }}
            >
              <Plus size={14} strokeWidth={1.5} />
              <span>New project</span>
            </button>
          </div>
        )}

        {/* Panel content — changes based on mode */}
        <div className="sidebar-panel">
          <div className="sidebar-panel__inner">
            {currentView === 'chat' ? (
              // ── Chat mode: show only non-project conversations ──
              chatConversations.length > 0 ? (
                <>
                  <div className="sidebar-section-label">Recent</div>
                  <div className="sidebar-recent__list">
                    {chatConversations.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => {
                          switchConversation(conv.id)
                          if (conv.sessionId) {
                            connection.sendSessionResume(conv.sessionId)
                            if (conv.messages.length === 0) {
                              connection.sendSessionHistory(conv.sessionId)
                            }
                          }
                          onViewChange('agent')
                          if (currentView !== 'chat') {
                            useStore.getState().setActiveView('chat')
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            switchConversation(conv.id)
                            if (conv.sessionId) {
                              connection.sendSessionResume(conv.sessionId)
                              if (conv.messages.length === 0) {
                                connection.sendSessionHistory(conv.sessionId)
                              }
                            }
                            onViewChange('agent')
                          }
                        }}
                        className={`sidebar-recent__item${conv.id === activeId ? ' sidebar-recent__item--active' : ''}`}
                      >
                        <span className="sidebar-recent__title">{conv.title}</span>
                        {getConvStatus(conv.sessionId) === 'working' && (
                          <Loader2 size={14} strokeWidth={1.5} className="sidebar-status-spinner" />
                        )}
                        {getConvStatus(conv.sessionId) === 'awaiting' && (
                          <span className="sidebar-status-badge">Needs input</span>
                        )}
                        <ConversationMenu
                          onDelete={(e) => handleDelete(e, conv.id, conv.sessionId)}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="sidebar-empty">
                  <MessageSquareText className="sidebar-empty__icon" />
                  <p className="sidebar-empty__text">No conversations yet</p>
                </div>
              )
            ) : currentView === 'projects' ? (
              // ── Projects mode: show project folders with threads ──
              projects.length > 0 ? (
                <div className="sidebar-projects">
                  {projects.map((project) => (
                    <ProjectFolder
                      key={project.id}
                      projectId={project.id}
                      name={project.name}
                      icon={project.icon}
                      isActive={project.id === activeProjectId}
                      sessions={project.id === activeProjectId ? projectSessions : []}
                      onClick={() => handleProjectClick(project.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="sidebar-empty">
                  <FolderOpen className="sidebar-empty__icon" />
                  <p className="sidebar-empty__text">No projects yet</p>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Footer — Manus-style bottom bar */}
        <div className="sidebar-bottombar">
          <div className="sidebar-bottombar__icons">
            <button
              type="button"
              className="sidebar-bottombar__btn"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <SlidersHorizontal size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="sidebar-bottombar__btn"
              aria-label="Dashboard"
            >
              <LayoutGrid size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="sidebar-bottombar__btn"
              aria-label="Machine"
            >
              <Monitor size={18} strokeWidth={1.5} />
            </button>
          </div>
          <div className="sidebar-bottombar__brand">
            <span className="sidebar-bottombar__from">from</span>
            <AntonLogo size={16} />
          </div>
        </div>
      </div>
    </motion.aside>
  )
}

// ── Conversation context menu (3-dot) ──

function ConversationMenu({ onDelete }: { onDelete: (e: React.MouseEvent) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="sidebar-conv-menu-wrap">
      <button
        type="button"
        className="sidebar-conv-menu__trigger"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        aria-label="Conversation options"
      >
        <MoreHorizontal size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="sidebar-conv-menu__backdrop" onClick={(e) => { e.stopPropagation(); setOpen(false) }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }} />
          <div className="sidebar-conv-menu">
            <button
              type="button"
              className="sidebar-conv-menu__item"
              onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span>Rename</span>
            </button>
            <button
              type="button"
              className="sidebar-conv-menu__item sidebar-conv-menu__item--danger"
              onClick={(e) => { onDelete(e); setOpen(false) }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              <span>Delete</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Project folder component (like Codex sidebar) ──

interface ProjectFolderProps {
  projectId: string
  name: string
  icon: string
  isActive: boolean
  sessions: { id: string; title: string; lastActiveAt: number }[]
  onClick: () => void
}

function ProjectFolder({ projectId, name, isActive, sessions, onClick }: ProjectFolderProps) {
  const activeProjectSessionId = useStore((s) => s.activeProjectSessionId)
  const setActiveProjectSession = useStore((s) => s.setActiveProjectSession)
  const deleteConversation = useStore((s) => s.deleteConversation)

  const handleThreadClick = (sessionId: string) => {
    const store = useStore.getState()

    // Ensure local conversation exists
    let conv = store.findConversationBySession(sessionId)
    if (!conv) {
      store.newConversation(undefined, sessionId, projectId)
      conv = store.findConversationBySession(sessionId)
    }

    if (conv) {
      store.switchConversation(conv.id)
    }

    // Resume on server
    connection.sendSessionResume(sessionId)
    // Only fetch history if no local messages (switchConversation handles background-completed refresh)
    if (!conv || conv.messages.length === 0) {
      connection.sendSessionHistory(sessionId)
    }

    // Set the active project session (triggers embedded chat in ProjectView)
    setActiveProjectSession(sessionId)
  }

  const handleDeleteThread = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    const store = useStore.getState()
    // Always tell the server to destroy — session may exist on disk without a local conversation
    connection.sendSessionDestroy(sessionId)
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      deleteConversation(conv.id)
    }
    // If this was the active session, clear it
    if (activeProjectSessionId === sessionId) {
      store.setActiveProjectSession(null)
    }
    // Refresh project sessions
    connection.sendProjectSessionsList(projectId)
  }

  return (
    <div className="sidebar-project-folder">
      <div className="sidebar-project-folder__header-row">
        <button
          type="button"
          className={`sidebar-project-folder__header${isActive ? ' sidebar-project-folder__header--active' : ''}`}
          onClick={onClick}
        >
          {isActive ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
          <FolderOpen size={14} strokeWidth={1.5} />
          <span className="sidebar-project-folder__name">{name}</span>
        </button>
        {isActive && (
          <button
            type="button"
            className="sidebar-project-folder__add"
            onClick={(e) => {
              e.stopPropagation()
              // Create a new session in this project
              const store = useStore.getState()
              const sessionId = `proj_${projectId}_sess_${Date.now().toString(36)}`
              store.newConversation(undefined, sessionId, projectId)
              connection.sendSessionCreate(sessionId, {
                provider: store.currentProvider,
                model: store.currentModel,
                projectId,
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
              setActiveProjectSession(sessionId)
            }}
            aria-label="New session"
            title="New session"
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {isActive && (
        <div className="sidebar-project-folder__threads">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleThreadClick(session.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleThreadClick(session.id) }}
                className={`sidebar-recent__item${activeProjectSessionId === session.id ? ' sidebar-recent__item--active' : ''}`}
              >
                <span className="sidebar-recent__title">
                  {session.title || 'New conversation'}
                </span>
                <button
                  type="button"
                  className="sidebar-recent__delete"
                  onClick={(e) => handleDeleteThread(e, session.id)}
                  aria-label="Delete conversation"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </div>
            ))
          ) : (
            <div className="sidebar-project-folder__empty">No threads</div>
          )}
        </div>
      )}
    </div>
  )
}
