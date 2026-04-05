import { AnimatePresence } from 'framer-motion'
import { Code, FolderOpen, MoreHorizontal, Ticket, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentChat } from './components/AgentChat.js'
import { Connect } from './components/Connect.js'
import { FileBrowser } from './components/FileBrowser.js'
import { ForceUpdateGate } from './components/ForceUpdateGate.js'
import { MachineInfoPanel } from './components/MachineInfoPanel.js'
import { SidePanel } from './components/SidePanel.js'
import { Sidebar } from './components/Sidebar.js'
import { Terminal } from './components/Terminal.js'
import { UpdateBanner } from './components/UpdateBanner.js'
import { WelcomeModal } from './components/WelcomeModal.js'
import { AgentsView } from './components/agents/AgentsView.js'
import { DebugOverlay } from './components/chat/DebugOverlay.js'
import { DeveloperView } from './components/developer/DeveloperView.js'
import { ProjectFilesView } from './components/files/ProjectFilesView.js'
import { HomeView } from './components/home/HomeView.js'
import { MemoryView } from './components/memory/MemoryView.js'
import { CreateProjectModal } from './components/projects/CreateProjectModal.js'
import { ProjectList } from './components/projects/ProjectList.js'
import { SettingsModal } from './components/settings/SettingsModal.js'
import { SkillsPanel } from './components/skills/SkillsPanel.js'
import { WorkflowsPage } from './components/workflows/WorkflowsPage.js'
import { connection } from './lib/connection.js'
import { useConnectionStatus, useStore } from './lib/store.js'
import { artifactStore } from './lib/store/artifactStore.js'
import { connectionStore } from './lib/store/connectionStore.js'
import { projectStore } from './lib/store/projectStore.js'
import { sessionStore, useActiveSessionState } from './lib/store/sessionStore.js'
import { uiStore } from './lib/store/uiStore.js'
import { updateStore } from './lib/store/updateStore.js'

export function App() {
  const [connected, setConnected] = useState(false)
  const [showMachineInfo, setShowMachineInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'general' | 'models' | 'connectors' | 'usage'>(
    'general',
  )
  const [settingsConnectorId, setSettingsConnectorId] = useState<string | undefined>()
  const [showCreateProject, setShowCreateProject] = useState(false)
  const status = useConnectionStatus()
  const activeView = uiStore((s) => s.activeView)
  // Subscribe to reactive state for re-renders
  uiStore((s) => s.activeMode)
  const setActiveView = uiStore((s) => s.setActiveView)
  const sessionUsage = useActiveSessionState((s) => s.sessionUsage)
  const activeConv = useStore((s) => s.getActiveConversation())
  const hasMessages = (activeConv?.messages?.length || 0) > 0
  const artifactPanelOpen = artifactStore((s) => s.artifactPanelOpen)
  uiStore((s) => s.sidebarCollapsed)
  uiStore((s) => s.toggleSidebar)
  const updateStage = updateStore((s) => s.updateStage)
  const sidePanelOpen = artifactPanelOpen
  projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const theme = uiStore((s) => s.theme)
  const devMode = uiStore((s) => s.devMode)
  const onboardingLoaded = uiStore((s) => s.onboardingLoaded)
  const onboardingCompleted = uiStore((s) => s.onboardingCompleted)
  const setOnboardingCompleted = uiStore((s) => s.setOnboardingCompleted)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)
  const setSidePanelView = uiStore((s) => s.setSidePanelView)
  const tasksHidden = uiStore((s) => s.tasksHidden)
  const toggleTasksHidden = uiStore((s) => s.toggleTasksHidden)
  const currentTasks = useActiveSessionState((s) => s.tasks)
  const showWelcome = onboardingLoaded && !onboardingCompleted

  // Apply theme on mount + listen for system preference changes
  useEffect(() => {
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    document.documentElement.setAttribute('data-theme', resolved)

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
        uiStore.setState({ resolvedTheme: e.matches ? 'dark' : 'light' })
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  // If the active conversation belongs to a project, find the project
  const activeConvProjectId = activeConv?.projectId
  const activeConvProject = activeConvProjectId
    ? projects.find((p) => p.id === activeConvProjectId)
    : null

  // Global listener for "New project" from sidebar (works on any view)
  useEffect(() => {
    const handler = () => setShowCreateProject(true)
    window.addEventListener('anton:create-project', handler)
    return () => window.removeEventListener('anton:create-project', handler)
  }, [])

  // Dynamic page title
  useEffect(() => {
    if (!connected) {
      document.title = 'anton'
    } else if (activeView === 'home') {
      document.title = 'Tasks \u2014 anton'
    } else if (activeView === 'terminal') {
      document.title = 'Terminal \u2014 anton'
    } else if (activeView === 'memory') {
      document.title = 'Memory \u2014 anton'
    } else if (activeView === 'agents') {
      document.title = 'Agents \u2014 anton'
    } else if (activeView === 'developer') {
      document.title = 'Developer \u2014 anton'
    } else if (activeConv?.title && activeConv.title !== 'New conversation') {
      document.title = `${activeConv.title} \u2014 anton`
    } else {
      document.title = 'anton'
    }
  }, [connected, activeView, activeConv?.title])

  // ── Init state machine: all list requests are fired by connectionStore.startSyncing()
  // on auth_ok. We subscribe to initPhase === 'ready' to do post-sync setup.
  useEffect(() => {
    const unsub = connectionStore.subscribe((state, prev) => {
      // When init transitions to 'ready', do post-sync session/conversation setup
      if (state.initPhase === 'ready' && prev.initPhase !== 'ready') {
        const store = useStore.getState()
        const ss = sessionStore.getState()

        // Sync server sessions to local conversations
        for (const session of ss.sessions) {
          const existing = store.findConversationBySession(session.id)
          if (!existing) {
            let projectId: string | undefined
            const projMatch = session.id.match(/^proj_([^_]+(?:_[^_]+)?)_sess_/)
            if (projMatch) {
              projectId = projMatch[1]
            }
            store.appendConversation(session.title || 'New conversation', session.id, projectId)
          } else if (
            session.title &&
            session.title !== 'New conversation' &&
            existing.title === 'New conversation'
          ) {
            store.updateConversationTitle(session.id, session.title)
          }
        }

        // In computer mode (home view), don't auto-navigate to a conversation
        const currentUI = uiStore.getState()
        if (currentUI.activeMode === 'computer' && currentUI.activeView === 'home') {
          return
        }

        // In chat mode, land on a fresh empty conversation
        const currentStore = useStore.getState()
        const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
        const chatConvs = currentStore.conversations.filter(
          (c) => !c.projectId || c.projectId === defaultProject?.id,
        )
        const emptyConv = chatConvs.find((c) => c.messages.length === 0)

        if (emptyConv) {
          currentStore.switchConversation(emptyConv.id)
        } else if (!currentStore.activeConversationId) {
          const chatSession = ss.sessions.find((s) => !s.id.match(/^proj_/))
          const latest = chatSession || ss.sessions[0]
          if (latest) {
            const latestConv = currentStore.findConversationBySession(latest.id)
            if (latestConv) {
              currentStore.switchConversation(latestConv.id)
            }
          }
        }

        // Fetch history for the active conversation
        const activeConv = useStore.getState().getActiveConversation()
        if (activeConv?.sessionId && !activeConv.projectId) {
          useStore.getState().requestSessionHistory(activeConv.sessionId)
        }
      }
    })
    return unsub
  }, [])

  // Listen for 'open-settings' events from ConnectorToolbar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setSettingsPage(detail?.tab ?? 'general')
      setSettingsConnectorId(detail?.connectorId)
      setShowSettings(true)
    }
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  const handleDisconnect = () => {
    connection.disconnect()
    useStore.getState().resetForDisconnect()
    setConnected(false)
  }

  if (!connected) {
    return <Connect onConnected={() => setConnected(true)} />
  }

  const isDisconnected = status === 'disconnected' || status === 'error'
  const isDisconnectedForUpdate = isDisconnected && updateStage === 'restarting'

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  // For sidebar compatibility
  const sidebarView =
    activeView === 'chat' ? 'agent' : activeView === 'terminal' ? 'terminal' : 'agent'
  const handleSidebarViewChange = (view: 'agent' | 'terminal') => {
    setActiveView(view === 'agent' ? 'chat' : 'terminal')
  }

  const showTopbar = activeView !== 'home' && activeView !== 'developer'

  return (
    <ForceUpdateGate>
      <div className="app-shell">
        <Sidebar
          onDisconnect={handleDisconnect}
          activeView={sidebarView}
          onViewChange={handleSidebarViewChange}
          onOpenSettings={(page) => {
            setSettingsPage(page ?? 'general')
            setShowSettings(true)
          }}
          onOpenMachineInfo={() => setShowMachineInfo(true)}
        />

        <div className="workspace-shell">
          {/* Update notification overlay */}
          <UpdateBanner />

          {/* Reconnecting banner */}
          {isDisconnected && !isDisconnectedForUpdate && (
            <div className="reconnect-banner">
              <span className="reconnect-banner__dot" />
              <span>Reconnecting to your machine...</span>
              <button type="button" onClick={handleDisconnect} className="reconnect-banner__btn">
                Switch machine
              </button>
            </div>
          )}

          {/* Top bar — flat toolbar */}
          {showTopbar && (
            <header className="workspace-topbar" data-tauri-drag-region>
              <div className="workspace-topbar__left">
                {activeView === 'chat' && hasMessages && currentTasks.length > 0 && (
                  <button
                    type="button"
                    className="workspace-topbar__hide-tasks-btn"
                    onClick={toggleTasksHidden}
                  >
                    {tasksHidden ? 'Show Tasks' : 'Hide Tasks'}
                  </button>
                )}
                <h2 className="workspace-topbar__title">
                  {activeView === 'chat'
                    ? hasMessages
                      ? activeConv?.title || 'New conversation'
                      : 'New conversation'
                    : activeView === 'memory'
                      ? 'Memory'
                      : activeView === 'agents'
                        ? 'Agents'
                        : activeView === 'terminal'
                          ? 'Terminal'
                          : activeView === 'files'
                            ? 'Files'
                            : activeView === 'workflows'
                              ? 'Workflows'
                              : activeView === 'skills'
                                ? 'Skills'
                                : ''}
                </h2>
              </div>

              <div className="workspace-topbar__center" data-tauri-drag-region />

              <div className="workspace-topbar__actions">
                {activeView === 'chat' && activeConvProject && (
                  <span className="workspace-topbar__project-pill">
                    <FolderOpen size={14} strokeWidth={1.5} />
                    {activeConvProject.name}
                  </span>
                )}
                {devMode && activeView === 'chat' && (
                  <button
                    type="button"
                    className="workspace-topbar__action-btn"
                    onClick={() => {
                      setSidePanelView('devmode')
                      setArtifactPanelOpen(true)
                    }}
                    aria-label="Developer Tools"
                  >
                    <Code size={18} strokeWidth={1.5} />
                  </button>
                )}
                {activeView === 'chat' && hasMessages && (
                  <>
                    {sessionUsage && (
                      <button
                        type="button"
                        className="workspace-topbar__action-btn workspace-topbar__action-btn--with-label"
                        onClick={() => {
                          const event = new CustomEvent('open-settings', {
                            detail: { tab: 'usage' },
                          })
                          window.dispatchEvent(event)
                        }}
                        aria-label="Usage"
                      >
                        <Ticket size={18} strokeWidth={1.5} />
                        <span>{formatTokens(sessionUsage.totalTokens)}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="workspace-topbar__action-btn"
                      onClick={() => setShowMachineInfo(true)}
                      aria-label="More options"
                    >
                      <MoreHorizontal size={18} strokeWidth={1.5} />
                    </button>
                  </>
                )}
                {activeView === 'chat' && (
                  <button
                    type="button"
                    className="workspace-topbar__action-btn"
                    onClick={() => setActiveView('home')}
                    aria-label="Close conversation"
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </header>
          )}

          <div className="workspace-body">
            {activeView === 'home' && <HomeView />}
            {activeView === 'chat' && <AgentChat />}
            {activeView === 'memory' && <MemoryView />}
            {activeView === 'agents' && <AgentsView />}
            {activeView === 'developer' && <DeveloperView />}
            {activeView === 'terminal' && (
              <>
                <Terminal />
                <FileBrowser />
              </>
            )}
            {activeView === 'files' && <ProjectFilesView />}
            {activeView === 'skills' && <SkillsPanel />}
            {activeView === 'workflows' && <WorkflowsPage />}
            {activeView === 'projects' && <ProjectList />}

            <AnimatePresence>
              {activeView === 'chat' && sidePanelOpen && <SidePanel />}
            </AnimatePresence>
          </div>
        </div>

        {showMachineInfo && <MachineInfoPanel onClose={() => setShowMachineInfo(false)} />}
        {showCreateProject && <CreateProjectModal onClose={() => setShowCreateProject(false)} />}
        <SettingsModal
          open={showSettings}
          onClose={() => {
            setShowSettings(false)
            setSettingsConnectorId(undefined)
          }}
          initialPage={settingsPage}
          initialConnectorId={settingsConnectorId}
        />
        <DebugOverlay />
        <WelcomeModal
          open={showWelcome}
          onClose={(role) => setOnboardingCompleted(role)}
          onOpenSettings={(role) => {
            setOnboardingCompleted(role)
            setSettingsPage('models')
            setShowSettings(true)
          }}
        />
      </div>
    </ForceUpdateGate>
  )
}
