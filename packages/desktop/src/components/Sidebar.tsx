import { motion } from 'framer-motion'
import {
  BarChart3,
  Bot,
  Brain,
  CheckSquare,
  ChevronDown,
  Code,
  Files,
  FolderOpen,
  Link,
  Loader2,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Puzzle,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useConnectionStatus, useStore } from '../lib/store.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import { Skeleton } from './Skeleton.js'

interface Props {
  onDisconnect: () => void
  activeView: string
  onViewChange: (view: 'agent' | 'terminal') => void
  onOpenSettings: (page?: 'general' | 'models' | 'connectors' | 'usage') => void
  onOpenMachineInfo: () => void
}

export function Sidebar({ onViewChange, onOpenSettings }: Props) {
  useConnectionStatus()
  const devMode = uiStore((s) => s.devMode)
  const conversations = useStore((s) => s.conversations)
  const activeId = useStore((s) => s.activeConversationId)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const sidebarCollapsed = uiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = uiStore((s) => s.toggleSidebar)
  const currentView = uiStore((s) => s.activeView)
  const activeMode = uiStore((s) => s.activeMode)
  const setActiveMode = uiStore((s) => s.setActiveMode)
  const setActiveView = uiStore((s) => s.setActiveView)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const pendingConfirm = sessionStore((s) => s.pendingConfirm)
  const pendingAskUser = sessionStore((s) => s.pendingAskUser)
  const pendingPlan = sessionStore((s) => s.pendingPlan)
  const sessionsLoaded = sessionStore((s) => s.sessionsLoaded)

  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)

  const defaultProjectId = projects.find((p) => p.isDefault)?.id
  const chatConversations = conversations.filter(
    (c) => !c.projectId || c.projectId === defaultProjectId,
  )

  // Current project name
  const currentProjectName = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId)?.name ?? 'Unknown')
    : 'My Computer'

  // Lazy-load "Older" conversations when the user scrolls down
  const [showOlder, setShowOlder] = useState(false)
  const olderSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showOlder) return
    const el = olderSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShowOlder(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [showOlder])

  // Group conversations by date
  const groupConversationsByDate = () => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const today: typeof chatConversations = []
    const yesterday: typeof chatConversations = []
    const older: typeof chatConversations = []
    const sorted = [...chatConversations].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
    )
    for (const conv of sorted) {
      const t = conv.updatedAt || conv.createdAt
      if (t >= todayStart) today.push(conv)
      else if (t >= yesterdayStart) yesterday.push(conv)
      else older.push(conv)
    }
    return { today, yesterday, older }
  }

  const grouped = groupConversationsByDate()

  const getConvStatus = (sessionId: string | undefined) => {
    if (!sessionId) return null
    if (
      pendingConfirm?.sessionId === sessionId ||
      pendingAskUser?.sessionId === sessionId ||
      pendingPlan?.sessionId === sessionId
    ) {
      return 'awaiting'
    }
    const status = sessionStates.get(sessionId)
    if (status?.status === 'working') return 'working'
    return null
  }

  const handleNewTask = () => {
    const sessionId = `sess_${Date.now().toString(36)}`
    const ss = sessionStore.getState()
    // In chat mode, always use the default project (My Computer)
    // In computer mode, use the active project
    const projectId = activeMode === 'chat' ? defaultProjectId : (activeProjectId ?? undefined)
    newConversation(undefined, sessionId, projectId)
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    if (activeMode === 'computer') {
      setActiveView('chat')
    }
    onViewChange('agent')
    if (currentView !== 'chat') {
      uiStore.getState().setActiveView('chat')
    }
  }

  const handleDelete = (e: React.MouseEvent, convId: string, sessionId: string) => {
    e.stopPropagation()
    if (sessionId) {
      sessionStore.getState().destroySession(sessionId)
    }
    deleteConversation(convId)
  }

  return (
    <>
      {sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-fab"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
        >
          <PanelLeft size={18} strokeWidth={1.5} />
        </button>
      )}
      <motion.aside
        className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}
        data-tauri-drag-region
        animate={{ width: sidebarCollapsed ? 0 : 240 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        style={{ overflow: 'hidden' }}
      >
        <div className="sidebar__inner">
          {/* Mode switcher: Chat / Computer — side by side toggle */}
          <div className="sidebar-primary">
            <div className="sidebar-mode-toggle">
              <button
                type="button"
                className={`sidebar-mode-toggle__btn${activeMode === 'chat' ? ' sidebar-mode-toggle__btn--active' : ''}`}
                onClick={() => setActiveMode('chat')}
              >
                <MessageSquare size={15} strokeWidth={1.5} />
                <span>Chat</span>
              </button>
              <button
                type="button"
                className={`sidebar-mode-toggle__btn${activeMode === 'computer' ? ' sidebar-mode-toggle__btn--active' : ''}`}
                onClick={() => setActiveMode('computer')}
              >
                <Monitor size={15} strokeWidth={1.5} />
                <span>Computer</span>
              </button>
            </div>
          </div>

          {/* Navigation — different per mode */}
          {activeMode === 'computer' ? (
            // ── Computer mode: project selector + nav items ──
            <>
              {/* Project selector */}
              <div className="sidebar-project-selector">
                <span className="sidebar-project-selector__label">Project</span>
                <button
                  type="button"
                  className="sidebar-project-selector__btn"
                  onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                >
                  <FolderOpen size={15} strokeWidth={1.5} />
                  <span className="sidebar-project-selector__name">{currentProjectName}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    className="sidebar-project-selector__chevron"
                  />
                </button>
                {projectDropdownOpen && (
                  <>
                    <div
                      className="sidebar-project-selector__backdrop"
                      onClick={() => setProjectDropdownOpen(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setProjectDropdownOpen(false)
                      }}
                    />
                    <div className="sidebar-project-selector__dropdown">
                      {[...projects]
                        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
                        .map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            className={`sidebar-project-selector__item${activeProjectId === project.id ? ' sidebar-project-selector__item--active' : ''}`}
                            onClick={() => {
                              setActiveProject(project.id)
                              projectStore.getState().listProjectSessions(project.id)
                              setProjectDropdownOpen(false)
                            }}
                          >
                            {project.isDefault ? (
                              <Monitor size={14} strokeWidth={1.5} />
                            ) : (
                              <FolderOpen size={14} strokeWidth={1.5} />
                            )}
                            <span>{project.name}</span>
                          </button>
                        ))}
                      <div className="sidebar-project-selector__divider" />
                      <button
                        type="button"
                        className="sidebar-project-selector__item sidebar-project-selector__item--new"
                        onClick={() => {
                          setProjectDropdownOpen(false)
                          requestAnimationFrame(() => {
                            window.dispatchEvent(new CustomEvent('anton:create-project'))
                          })
                        }}
                      >
                        <Plus size={14} strokeWidth={1.5} />
                        <span>New project</span>
                      </button>
                      <button
                        type="button"
                        className="sidebar-project-selector__item sidebar-project-selector__item--new"
                        onClick={() => {
                          setProjectDropdownOpen(false)
                          setActiveView('projects')
                        }}
                      >
                        <SlidersHorizontal size={14} strokeWidth={1.5} />
                        <span>Manage projects</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                className="sidebar-primary__item sidebar-primary__new-task"
                onClick={handleNewTask}
              >
                <Plus size={18} strokeWidth={1.5} />
                <span>New task</span>
              </button>

              <div className="sidebar-nav">
                <NavItem
                  icon={CheckSquare}
                  label="Tasks"
                  active={currentView === 'home'}
                  onClick={() => setActiveView('home')}
                />
                <NavItem
                  icon={Brain}
                  label="Memory"
                  active={currentView === 'memory'}
                  onClick={() => setActiveView('memory')}
                />
                <NavItem
                  icon={Bot}
                  label="Agents"
                  active={currentView === 'agents'}
                  onClick={() => setActiveView('agents')}
                />
                <NavItem
                  icon={Files}
                  label="Files"
                  active={currentView === 'files'}
                  onClick={() => setActiveView('files')}
                />

                <div className="sidebar-nav__divider" />

                <NavItem
                  icon={TerminalSquare}
                  label="Terminal"
                  active={currentView === 'terminal'}
                  onClick={() => setActiveView('terminal')}
                />
                <NavItem
                  icon={Link}
                  label="Connectors"
                  active={currentView === 'connectors'}
                  onClick={() => {
                    onOpenSettings('connectors')
                  }}
                />
                <NavItem
                  icon={Puzzle}
                  label="Skills"
                  active={currentView === 'skills'}
                  onClick={() => setActiveView('skills')}
                />
                <NavItem
                  icon={Zap}
                  label="Workflows"
                  active={currentView === 'workflows'}
                  onClick={() => setActiveView('workflows')}
                />
              </div>
            </>
          ) : (
            // ── Chat mode: conversation history ──
            <div className="sidebar-panel">
              <button
                type="button"
                className="sidebar-primary__item sidebar-primary__new-task"
                onClick={handleNewTask}
              >
                <Plus size={18} strokeWidth={1.5} />
                <span>New chat</span>
              </button>
              <div className="sidebar-panel__inner">
                {!sessionsLoaded ? (
                  <div className="sidebar-recent__list">
                    {['skel-0', 'skel-1', 'skel-2', 'skel-3', 'skel-4'].map((id, i) => (
                      <div key={id} className="sidebar-conv-item sidebar-conv-item--skeleton">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Skeleton width={`${50 + (i % 3) * 20}%`} height={13} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : chatConversations.length > 0 ? (
                  <div className="sidebar-recent__list">
                    {grouped.today.length > 0 && (
                      <>
                        <div className="sidebar-section-label">Today</div>
                        {grouped.today.map((conv) => (
                          <ConversationItem
                            key={conv.id}
                            conv={conv}
                            isActive={conv.id === activeId}
                            status={getConvStatus(conv.sessionId)}
                            onSelect={() => {
                              switchConversation(conv.id)
                              if (conv.sessionId) {
                                sessionStore.getState().requestSessionHistory(conv.sessionId)
                              }
                              onViewChange('agent')
                              if (currentView !== 'chat') {
                                uiStore.getState().setActiveView('chat')
                              }
                            }}
                            onDelete={(e) => handleDelete(e, conv.id, conv.sessionId)}
                          />
                        ))}
                      </>
                    )}
                    {grouped.yesterday.length > 0 && (
                      <>
                        <div className="sidebar-section-label">Yesterday</div>
                        {grouped.yesterday.map((conv) => (
                          <ConversationItem
                            key={conv.id}
                            conv={conv}
                            isActive={conv.id === activeId}
                            status={getConvStatus(conv.sessionId)}
                            onSelect={() => {
                              switchConversation(conv.id)
                              if (conv.sessionId) {
                                sessionStore.getState().requestSessionHistory(conv.sessionId)
                              }
                              onViewChange('agent')
                              if (currentView !== 'chat') {
                                uiStore.getState().setActiveView('chat')
                              }
                            }}
                            onDelete={(e) => handleDelete(e, conv.id, conv.sessionId)}
                          />
                        ))}
                      </>
                    )}
                    {grouped.older.length > 0 && !showOlder && (
                      <div ref={olderSentinelRef} style={{ height: 1 }} />
                    )}
                    {grouped.older.length > 0 && showOlder && (
                      <>
                        <div className="sidebar-section-label">Older</div>
                        {grouped.older.map((conv) => (
                          <ConversationItem
                            key={conv.id}
                            conv={conv}
                            isActive={conv.id === activeId}
                            status={getConvStatus(conv.sessionId)}
                            onSelect={() => {
                              switchConversation(conv.id)
                              if (conv.sessionId) {
                                sessionStore.getState().requestSessionHistory(conv.sessionId)
                              }
                              onViewChange('agent')
                              if (currentView !== 'chat') {
                                uiStore.getState().setActiveView('chat')
                              }
                            }}
                            onDelete={(e) => handleDelete(e, conv.id, conv.sessionId)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="sidebar-empty">
                    <MessageSquare className="sidebar-empty__icon" />
                    <p className="sidebar-empty__text">No conversations yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer — bottom bar */}
          <div className="sidebar-bottombar">
            <div className="sidebar-bottombar__icons">
              <button
                type="button"
                className="sidebar-bottombar__btn"
                aria-label="Settings"
                data-tooltip="Settings"
                onClick={() => onOpenSettings()}
              >
                <SlidersHorizontal size={18} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                className="sidebar-bottombar__btn"
                aria-label="Usage"
                data-tooltip="Usage"
                onClick={() => onOpenSettings('usage')}
              >
                <BarChart3 size={18} strokeWidth={1.5} />
              </button>
              {devMode && (
                <button
                  type="button"
                  className="sidebar-bottombar__btn"
                  aria-label="Developer Tools"
                  data-tooltip="Developer"
                  onClick={() => setActiveView('developer')}
                >
                  <Code size={18} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="sidebar-bottombar__btn"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              data-tooltip="Collapse"
            >
              <PanelLeft size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </motion.aside>
    </>
  )
}

// ── Nav item for Computer mode ──

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`sidebar-nav__item${active ? ' sidebar-nav__item--active' : ''}`}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  )
}

// ── Conversation item (for Chat mode) ──

function ConversationItem({
  conv,
  isActive,
  status,
  onSelect,
  onDelete,
}: {
  conv: { id: string; sessionId: string; title: string }
  isActive: boolean
  status: string | null
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      className={`sidebar-recent__item${isActive ? ' sidebar-recent__item--active' : ''}`}
    >
      <span className="sidebar-recent__title">{conv.title}</span>
      {status === 'working' && (
        <Loader2 size={14} strokeWidth={1.5} className="sidebar-status-spinner" />
      )}
      {status === 'awaiting' && <span className="sidebar-status-badge">Needs input</span>}
      <ConversationMenu onDelete={onDelete} />
    </div>
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
          <div
            className="sidebar-conv-menu__backdrop"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="sidebar-conv-menu">
            <button
              type="button"
              className="sidebar-conv-menu__item"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span>Rename</span>
            </button>
            <button
              type="button"
              className="sidebar-conv-menu__item sidebar-conv-menu__item--danger"
              onClick={(e) => {
                onDelete(e)
                setOpen(false)
              }}
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
