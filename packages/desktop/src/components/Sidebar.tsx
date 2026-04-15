import { motion } from 'framer-motion'
import {
  BarChart3,
  Repeat,
  Brain,
  CheckSquare,
  ChevronDown,
  Code,
  Files,
  FolderOpen,
  Globe,
  Link,
  Monitor,
  PanelLeft,
  Plus,
  Puzzle,
  SlidersHorizontal,
  TerminalSquare,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useConnectionStatus, useStore } from '../lib/store.js'
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

export function Sidebar({ onViewChange, onOpenSettings }: Props) {
  useConnectionStatus()
  const devMode = uiStore((s) => s.devMode)
  const newConversation = useStore((s) => s.newConversation)
  const sidebarCollapsed = uiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = uiStore((s) => s.toggleSidebar)
  const currentView = uiStore((s) => s.activeView)
  const setActiveView = uiStore((s) => s.setActiveView)

  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)

  // Current project name
  const currentProjectName = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId)?.name ?? 'Unknown')
    : 'My Computer'

  const handleNewTask = () => {
    const sessionId = `sess_${Date.now().toString(36)}`
    const ss = sessionStore.getState()
    const projectId = activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    setActiveView('chat')
    onViewChange('agent')
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
          {/* Branding */}
          <div className="sidebar-brand">
            <span className="sidebar-brand__text">anton.computer</span>
          </div>

          {/* Navigation */}
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
                  icon={Repeat}
                  label="Routines"
                  active={currentView === 'routines'}
                  onClick={() => setActiveView('routines')}
                />
                <NavItem
                  icon={Files}
                  label="Files"
                  active={currentView === 'files'}
                  onClick={() => setActiveView('files')}
                />
                <NavItem
                  icon={Globe}
                  label="Pages"
                  active={currentView === 'pages'}
                  onClick={() => setActiveView('pages')}
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
                  onClick={() => setActiveView('connectors')}
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

