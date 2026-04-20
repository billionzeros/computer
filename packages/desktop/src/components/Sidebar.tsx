import { motion } from 'framer-motion'
import {
  BarChart3,
  Check,
  ChevronDown,
  CirclePlus,
  Code,
  Folder,
  FolderOpen,
  Globe,
  Monitor,
  Network,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareCheck,
  Terminal as TerminalIcon,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeTitle } from '../lib/conversations.js'
import { formatRelativeTime } from '../lib/agent-utils.js'
import { loadMachines, useStore } from '../lib/store.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'

interface Props {
  onDisconnect: () => void
  activeView: string
  onViewChange: (view: 'agent' | 'terminal') => void
  onOpenSettings: (page?: 'general' | 'models' | 'usage') => void
  onOpenMachineInfo: () => void
}

type NavId =
  | 'tasks'
  | 'memory'
  | 'routines'
  | 'files'
  | 'pages'
  | 'customize'
  | 'workflows'
  | 'skills'

const NAV: { id: NavId; label: string; icon: typeof SquareCheck }[] = [
  { id: 'tasks', label: 'Tasks', icon: SquareCheck },
  { id: 'memory', label: 'Memory', icon: CirclePlus },
  { id: 'routines', label: 'Routines', icon: RefreshCw },
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'pages', label: 'Pages', icon: Globe },
  { id: 'customize', label: 'Customize', icon: Zap },
  { id: 'workflows', label: 'Workflows', icon: Network },
  { id: 'skills', label: 'Patterns', icon: Sparkles },
]

export function Sidebar({ onViewChange, onOpenSettings }: Props) {
  const devMode = uiStore((s) => s.devMode)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const sidebarCollapsed = uiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = uiStore((s) => s.toggleSidebar)
  const currentView = uiStore((s) => s.activeView)
  const setActiveView = uiStore((s) => s.setActiveView)

  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const projectWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!projectMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (projectWrapRef.current && !projectWrapRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjectMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [projectMenuOpen])

  // Active project + the machine we're connected through (for host + TLS hint).
  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null
  const currentProjectName = activeProject?.name ?? 'My Computer'

  const currentMachine = useMemo(() => {
    const machines = loadMachines()
    const lastId = localStorage.getItem('anton.lastMachineId')
    return lastId ? (machines.find((m) => m.id === lastId) ?? null) : null
  }, [])
  const projectHost = currentMachine?.host ?? null
  const projectUsesTLS = currentMachine?.useTLS ?? false

  // Live per-project task counts (more accurate than stats.sessionCount).
  const taskCountByProject = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of conversations) {
      const key = c.projectId ?? '__none__'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [conversations])

  const projectTaskCount = (projectId: string) =>
    taskCountByProject.get(projectId) ??
    (projects.find((p) => p.id === projectId)?.stats.sessionCount ?? 0)

  const projectLastActive = (projectId: string) => {
    const p = projects.find((proj) => proj.id === projectId)
    return p?.stats.lastActive ?? p?.updatedAt ?? 0
  }

  const activeTaskCount = activeProject ? projectTaskCount(activeProject.id) : 0
  const activeLastActive = activeProject ? projectLastActive(activeProject.id) : 0
  const activeLastLabel = activeLastActive ? formatRelativeTime(activeLastActive) : null
  const isJustNow = activeLastActive && Date.now() - activeLastActive < 60_000

  const recentTasks = useMemo(() => {
    return [...conversations]
      .filter((c) => !c.projectId || c.projectId === activeProjectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((c) => ({
        id: c.id,
        title: sanitizeTitle(c.title || 'New conversation'),
        status:
          c.messages.length === 0
            ? ('idle' as const)
            : c.messages.some((m) => m.isError)
              ? ('error' as const)
              : c.messages[c.messages.length - 1]?.role === 'user'
                ? ('working' as const)
                : ('completed' as const),
      }))
  }, [conversations, activeProjectId])

  const handleNewTask = () => {
    // Create a fresh empty conversation and land on Home so StreamHome renders.
    // We must pre-create rather than null out activeConversationId because sync
    // reconciliation (reconcileActiveConversationId) falls back to conversations[0].
    const sessionId = `sess_${Date.now().toString(36)}`
    const ss = sessionStore.getState()
    const projectId = activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    setActiveView('home')
  }

  const handleOpenTask = (id: string) => {
    switchConversation(id)
    setActiveView('chat')
    onViewChange('agent')
  }

  const sidebarWidth = sidebarCollapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)'

  return (
    <motion.aside
      className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}
      data-tauri-drag-region
      animate={{ width: sidebarCollapsed ? 56 : 240 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <div className="sidebar__inner" style={{ width: sidebarWidth }}>
        {/* Brand + collapse */}
        <div className="sb-brand">
          <span className="sb-brand__wordmark">anton</span>
          <button
            type="button"
            className="sb-brand__collapse"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Project picker */}
        <div className="sb-project-wrap" ref={projectWrapRef}>
          <div className="sb-project-label">PROJECT</div>
          <button
            type="button"
            className={`sb-project${projectMenuOpen ? ' open' : ''}`}
            onClick={() => setProjectMenuOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={projectMenuOpen}
          >
            <div className="sb-project__icon">
              {activeProject && !activeProject.isDefault ? (
                <FolderOpen size={13} strokeWidth={1.5} />
              ) : (
                <Monitor size={13} strokeWidth={1.5} />
              )}
            </div>
            <div className="sb-project__body">
              <div className="sb-project__row">
                <span className="pname">{currentProjectName}</span>
              </div>
              <div className="pmeta">
                {activeProject ? (
                  <>
                    <span className="sb-project__host">
                      {activeTaskCount} file{activeTaskCount === 1 ? '' : 's'}
                    </span>
                    {activeLastLabel && (
                      <>
                        <span className="sb-project__sep">·</span>
                        <span
                          className={`sb-project__tls${isJustNow ? ' sb-project__tls--fresh' : ''}`}
                        >
                          {activeLastLabel}
                        </span>
                      </>
                    )}
                  </>
                ) : projectHost ? (
                  <>
                    <span className="sb-project__host">{projectHost}</span>
                    {projectUsesTLS && (
                      <>
                        <span className="sb-project__sep">·</span>
                        <span className="sb-project__tls">TLS</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="sb-project__host">Local</span>
                )}
              </div>
            </div>
            <ChevronDown size={13} strokeWidth={1.5} className="sb-project__chev" />
          </button>

          {projectMenuOpen && (
            <div className="sb-project-menu fade-in">
              <div className="sb-project-menu__label">Projects</div>
              <div className="sb-project-menu__list">
                {[...projects]
                  .sort((a, b) => {
                    if ((b.isDefault ? 1 : 0) !== (a.isDefault ? 1 : 0)) {
                      return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
                    }
                    return projectLastActive(b.id) - projectLastActive(a.id)
                  })
                  .map((p) => {
                    const isActive = p.id === activeProjectId
                    const taskCount = projectTaskCount(p.id)
                    const lastActive = projectLastActive(p.id)
                    const lastLabel = lastActive ? formatRelativeTime(lastActive) : null
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-current={isActive ? 'true' : undefined}
                        className={`sb-project-menu__item${isActive ? ' active' : ''}`}
                        onClick={() => {
                          setActiveProject(p.id)
                          setProjectMenuOpen(false)
                        }}
                      >
                        <div className="sb-project-menu__icon">
                          {p.isDefault ? (
                            <Monitor size={12} strokeWidth={1.5} />
                          ) : (
                            <FolderOpen size={12} strokeWidth={1.5} />
                          )}
                        </div>
                        <div className="sb-project-menu__text">
                          <div className="sb-project-menu__row">
                            <span className="sb-project-menu__name">{p.name}</span>
                          </div>
                          <div className="sb-project-menu__meta">
                            <span>
                              {taskCount} file{taskCount === 1 ? '' : 's'}
                            </span>
                            {lastLabel && (
                              <>
                                <span className="sb-project-menu__sep">·</span>
                                <span>{lastLabel}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {isActive && (
                          <Check size={12} strokeWidth={2} className="sb-project-menu__check" />
                        )}
                      </button>
                    )
                  })}
              </div>
              <div className="sb-project-menu__divider" />
              <button
                type="button"
                className="sb-project-menu__action"
                onClick={() => {
                  setProjectMenuOpen(false)
                  requestAnimationFrame(() => {
                    window.dispatchEvent(new CustomEvent('anton:create-project'))
                  })
                }}
              >
                <Plus size={12} strokeWidth={1.5} />
                <span>New project</span>
                <span className="sb-project-menu__kbd">⇧⌘P</span>
              </button>
              <button
                type="button"
                className="sb-project-menu__action"
                onClick={() => {
                  setProjectMenuOpen(false)
                  setActiveView('projects')
                }}
              >
                <SlidersHorizontal size={12} strokeWidth={1.5} />
                <span>Manage projects</span>
              </button>
            </div>
          )}
        </div>

        {/* New task */}
        <button type="button" className="sb-new" onClick={handleNewTask}>
          <Plus size={14} strokeWidth={1.5} />
          <span>New task</span>
          <span className="kbd">⌘N</span>
        </button>

        {/* Primary nav */}
        <div className="sb-section">
          <div className="sb-nav">
            {NAV.map((n) => {
              const Icon = n.icon
              const active = currentView === n.id
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`sb-item${active ? ' active' : ''}`}
                  onClick={() => setActiveView(n.id)}
                  title={n.label}
                >
                  <Icon size={15} strokeWidth={1.5} />
                  <span>{n.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Recent tasks */}
        <div className="sb-section sb-history">
          <div className="sb-sec-label sb-sec-label--row">
            <span>Recent</span>
            <button type="button" className="sb-sec-more" title="Search">
              <Search size={11} strokeWidth={1.5} />
            </button>
          </div>
          <div className="sb-history-list">
            {recentTasks.length === 0 ? (
              <div className="sb-history-empty">No tasks yet</div>
            ) : (
              recentTasks.map((t) => (
                <div
                  key={t.id}
                  className={`sb-history-item${activeConversationId === t.id ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="sb-history-row"
                    onClick={() => handleOpenTask(t.id)}
                    title={t.title}
                  >
                    <span className={`sb-history-dot ${t.status}`} aria-hidden />
                    <span className="sb-history-title">{t.title}</span>
                  </button>
                  <button
                    type="button"
                    className="sb-history-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(t.id)
                    }}
                    aria-label="Remove task"
                    title="Remove from recent"
                  >
                    <X size={11} strokeWidth={1.75} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer rail */}
        <div className="sb-footer">
          <button
            type="button"
            className={`sb-footer-btn${currentView === 'terminal' ? ' active' : ''}`}
            onClick={() => setActiveView('terminal')}
            title="Terminal"
            aria-label="Terminal"
          >
            <TerminalIcon size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="sb-footer-btn"
            onClick={() => onOpenSettings()}
            title="Settings"
            aria-label="Settings"
          >
            <SlidersHorizontal size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="sb-footer-btn"
            onClick={() => onOpenSettings('usage')}
            title="Usage"
            aria-label="Usage"
          >
            <BarChart3 size={15} strokeWidth={1.5} />
          </button>
          {devMode && (
            <button
              type="button"
              className={`sb-footer-btn${currentView === 'developer' ? ' active' : ''}`}
              onClick={() => setActiveView('developer')}
              title="Developer"
              aria-label="Developer"
            >
              <Code size={15} strokeWidth={1.5} />
            </button>
          )}
          <div className="sb-footer-user" title="Account">
            <div className="sb-avatar">O</div>
            <span className="name">omg</span>
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
