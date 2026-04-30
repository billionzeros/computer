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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquareCheck,
  Terminal as TerminalIcon,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRelativeTime } from '../lib/agent-utils.js'
import { sanitizeTitle } from '../lib/conversations.js'
import { loadMachines, useStore } from '../lib/store.js'
import { accountColorValue, accountStore, avatarInitial } from '../lib/store/accountStore.js'
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

type NavId = 'tasks' | 'memory' | 'routines' | 'files' | 'pages' | 'customize' | 'workflows'

const NAV: { id: NavId; label: string; icon: typeof SquareCheck }[] = [
  { id: 'tasks', label: 'Tasks', icon: SquareCheck },
  { id: 'memory', label: 'Memory', icon: CirclePlus },
  { id: 'routines', label: 'Routines', icon: RefreshCw },
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'pages', label: 'Pages', icon: Globe },
  { id: 'customize', label: 'Customize', icon: Zap },
  { id: 'workflows', label: 'Workflows', icon: Network },
]

export function Sidebar({ onViewChange, onOpenSettings }: Props) {
  const devMode = uiStore((s) => s.devMode)
  const displayName = accountStore((s) => s.displayName)
  const avatarColor = accountStore((s) => s.avatarColor)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const renameConversation = useStore((s) => s.renameConversation)
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
  const projectMenuRef = useRef<HTMLDivElement | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{ top: number; left: number } | null>(null)

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskValue, setEditingTaskValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const cancelEditRef = useRef(false)

  useLayoutEffect(() => {
    if (!projectMenuOpen) {
      setProjectMenuPos(null)
      return
    }
    const computePos = () => {
      const el = projectWrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setProjectMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    computePos()
    window.addEventListener('resize', computePos)
    window.addEventListener('scroll', computePos, true)
    return () => {
      window.removeEventListener('resize', computePos)
      window.removeEventListener('scroll', computePos, true)
    }
  }, [projectMenuOpen])

  useEffect(() => {
    if (!projectMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      const inWrap = projectWrapRef.current?.contains(target)
      const inMenu = projectMenuRef.current?.contains(target)
      if (!inWrap && !inMenu) {
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
  // Mirrors the Recent filter: only count conversations the user has actually
  // worked on (has messages OR a real title), so empty scratch buffers from
  // repeated "New task" clicks don't inflate the per-project file count.
  const taskCountByProject = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of conversations) {
      if (c.messages.length === 0 && c.title === 'New conversation') continue
      const key = c.projectId ?? '__none__'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [conversations])

  const projectTaskCount = (projectId: string) =>
    taskCountByProject.get(projectId) ??
    projects.find((p) => p.id === projectId)?.stats.sessionCount ??
    0

  const projectLastActive = (projectId: string) => {
    const p = projects.find((proj) => proj.id === projectId)
    return p?.stats.lastActive ?? p?.updatedAt ?? 0
  }

  const activeTaskCount = activeProject ? projectTaskCount(activeProject.id) : 0
  const activeLastActive = activeProject ? projectLastActive(activeProject.id) : 0
  const activeLastLabel = activeLastActive ? formatRelativeTime(activeLastActive) : null
  const isJustNow = activeLastActive && Date.now() - activeLastActive < 60_000

  const recentTasks = useMemo(() => {
    return (
      [...conversations]
        .filter((c) => !c.projectId || c.projectId === activeProjectId)
        // Hide *truly* empty scratch conversations from Recent. After a reload,
        // saveConversations strips messages from storage, so messages.length
        // alone isn't a reliable "is empty" signal — fall back to the title:
        // a fresh conversation has the default 'New conversation' title until
        // the first user message triggers autoTitle().
        .filter((c) => c.messages.length > 0 || c.title !== 'New conversation')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12)
        .map((c) => ({
          id: c.id,
          title: sanitizeTitle(c.title || 'New conversation'),
          status: c.messages.some((m) => m.isError)
            ? ('error' as const)
            : c.messages[c.messages.length - 1]?.role === 'user'
              ? ('working' as const)
              : ('completed' as const),
        }))
    )
  }, [conversations, activeProjectId])

  const handleNewTask = () => {
    // Always create a fresh empty conversation and land on Home so StreamHome
    // renders. Empty conversations are filtered out of Recent so they don't
    // pollute the sidebar — the home composer is the source of truth for
    // "what's the new task".
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
    // Empty conversations should land on the home composer (default page),
    // not a blank chat view. Mirror the Recent filter: after a reload,
    // saveConversations strips messages from storage, so messages.length
    // alone isn't a reliable "is empty" signal — fall back to the title.
    const target = conversations.find((c) => c.id === id)
    const isEmpty = !!target && target.messages.length === 0 && target.title === 'New conversation'
    setActiveView(isEmpty ? 'home' : 'chat')
    onViewChange('agent')
  }

  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTaskId])

  const startEditTask = (id: string, currentTitle: string) => {
    cancelEditRef.current = false
    setEditingTaskId(id)
    setEditingTaskValue(currentTitle)
  }

  const cancelEditTask = () => {
    cancelEditRef.current = true
    setEditingTaskId(null)
    setEditingTaskValue('')
  }

  const commitEditTask = () => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      return
    }
    const id = editingTaskId
    if (!id) return
    const trimmed = editingTaskValue.trim()
    const original = recentTasks.find((t) => t.id === id)?.title
    if (trimmed && trimmed !== original) {
      // Optimistic local update + WebSocket persist to the server.
      renameConversation(id, trimmed)
    }
    setEditingTaskId(null)
    setEditingTaskValue('')
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

          {projectMenuOpen &&
            projectMenuPos &&
            createPortal(
              <div
                ref={projectMenuRef}
                className="sb-project-menu fade-in"
                style={{ position: 'fixed', top: projectMenuPos.top, left: projectMenuPos.left }}
              >
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
              </div>,
              document.body,
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
              recentTasks.map((t) => {
                const isEditing = editingTaskId === t.id
                return (
                  <div
                    key={t.id}
                    className={`sb-history-item${activeConversationId === t.id ? ' active' : ''}${isEditing ? ' editing' : ''}`}
                  >
                    {isEditing ? (
                      <div className="sb-history-row sb-history-row--editing">
                        <span className={`sb-history-dot ${t.status}`} aria-hidden />
                        <input
                          ref={editInputRef}
                          type="text"
                          className="sb-history-edit-input"
                          value={editingTaskValue}
                          onChange={(e) => setEditingTaskValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              editInputRef.current?.blur()
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEditTask()
                            }
                          }}
                          onBlur={commitEditTask}
                          maxLength={120}
                          aria-label="Rename task"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="sb-history-row"
                        onClick={() => handleOpenTask(t.id)}
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          startEditTask(t.id, t.title)
                        }}
                        title={t.title}
                      >
                        <span className={`sb-history-dot ${t.status}`} aria-hidden />
                        <span className="sb-history-title">{t.title}</span>
                      </button>
                    )}
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          className="sb-history-edit"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditTask(t.id, t.title)
                          }}
                          aria-label="Rename task"
                          title="Rename"
                        >
                          <Pencil size={11} strokeWidth={1.75} />
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
                      </>
                    )}
                  </div>
                )
              })
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
          <button
            type="button"
            className="sb-footer-user"
            onClick={() => onOpenSettings()}
            title="Account"
            aria-label="Account"
          >
            <div className="sb-avatar" style={{ color: accountColorValue(avatarColor) }}>
              {avatarInitial(displayName)}
            </div>
            <span className="name">{displayName}</span>
          </button>
        </div>
      </div>
    </motion.aside>
  )
}
