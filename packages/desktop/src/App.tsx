import { AnimatePresence } from 'framer-motion'
import { Code, Ticket } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ActivityDock } from './components/ActivityDock.js'
import { CommandPalette } from './components/CommandPalette.js'
import { Connect } from './components/Connect.js'
import { DesktopUpdateBanner } from './components/DesktopUpdateBanner.js'
import { FileBrowser } from './components/FileBrowser.js'
import { ForceUpdateGate } from './components/ForceUpdateGate.js'
import { MachineInfoPanel } from './components/MachineInfoPanel.js'
import { OnboardingTour } from './components/OnboardingTour.js'
import { ProtocolMismatchBanner } from './components/ProtocolMismatchBanner.js'
import { RoutineChat } from './components/RoutineChat.js'
import { SidePanel } from './components/SidePanel.js'
import { Sidebar } from './components/Sidebar.js'
import { Terminal } from './components/Terminal.js'
import { UpdateBanner } from './components/UpdateBanner.js'
import { DebugOverlay } from './components/chat/DebugOverlay.js'
import { SessionFilesBar } from './components/chat/SessionFilesBar.js'
import { WaitingBadge } from './components/chat/WaitingBadge.js'
import { ConnectorsView } from './components/connectors/ConnectorsView.js'
import { CustomizeView } from './components/customize/CustomizeView.js'
import { DeveloperView } from './components/developer/DeveloperView.js'
import { ProjectFilesView } from './components/files/ProjectFilesView.js'
import { StreamHome } from './components/home/StreamHome.js'
import { TasksListView } from './components/home/TasksListView.js'
import { MemoryView } from './components/memory/MemoryView.js'
import { PagesView } from './components/pages/PagesView.js'
import { NewProjectView } from './components/projects/NewProjectView.js'
import { ProjectList } from './components/projects/ProjectList.js'
import { RoutinesView } from './components/routines/RoutinesView.js'
import { SettingsModal } from './components/settings/SettingsModal.js'
import { UsageModal } from './components/settings/UsageModal.js'
import { WorkflowsPage } from './components/workflows/WorkflowsPage.js'
import { connection } from './lib/connection.js'
import { sanitizeTitle } from './lib/conversations.js'
import { initNotifications, setNavigationHandler } from './lib/notifications.js'
import { useConnectionStatus, useStore } from './lib/store.js'
import { artifactStore } from './lib/store/artifactStore.js'
import { connectionStore } from './lib/store/connectionStore.js'
import { projectStore } from './lib/store/projectStore.js'
import { useActiveSessionState } from './lib/store/sessionStore.js'
import { uiStore } from './lib/store/uiStore.js'
import { updateStore } from './lib/store/updateStore.js'

export function App() {
  const [connected, setConnected] = useState(false)
  const [showMachineInfo, setShowMachineInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'general' | 'models'>('general')
  const [showUsage, setShowUsage] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const status = useConnectionStatus()
  const activeView = uiStore((s) => s.activeView)
  const viewSubCrumb = uiStore((s) => s.viewSubCrumb)
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
  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const theme = uiStore((s) => s.theme)
  const devMode = uiStore((s) => s.devMode)
  const onboardingLoaded = uiStore((s) => s.onboardingLoaded)
  const tourCompleted = uiStore((s) => s.tourCompleted)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)
  const setSidePanelView = uiStore((s) => s.setSidePanelView)
  const tasksHidden = uiStore((s) => s.tasksHidden)
  const toggleTasksHidden = uiStore((s) => s.toggleTasksHidden)
  const currentTasks = useActiveSessionState((s) => s.tasks)
  const pendingConfirm = useActiveSessionState((s) => s.pendingConfirm)
  const pendingAskUser = useActiveSessionState((s) => s.pendingAskUser)
  const pendingPlan = useActiveSessionState((s) => s.pendingPlan)
  const hasPendingInteraction = Boolean(pendingConfirm || pendingAskUser || pendingPlan)
  const [tourOpen, setTourOpen] = useState(false)
  const showTour = tourOpen || (onboardingLoaded && !tourCompleted)

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

  // Global keyboard shortcuts — ⌘K palette
  useEffect(() => {
    if (!connected) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connected])

  // "Replay tour" from Settings dispatches this event; open the 6-step tour.
  useEffect(() => {
    const handler = () => setTourOpen(true)
    window.addEventListener('anton:replay-tour', handler)
    return () => window.removeEventListener('anton:replay-tour', handler)
  }, [])

  const handleNewProject = useCallback(() => uiStore.getState().setActiveView('new-project'), [])

  // Request notification permission + wire click-to-navigate on mount
  useEffect(() => {
    initNotifications()
    setNavigationHandler((sessionId) => {
      const store = useStore.getState()
      const conv = store.findConversationBySession(sessionId)
      if (conv) {
        store.switchConversation(conv.id)
        uiStore.getState().setActiveView('chat')
      }
    })
  }, [])

  // All projects (including non-default) land on Home (StreamHome or RoutineChat).

  // Global listener for "New project" from sidebar (works on any view)
  useEffect(() => {
    const handler = () => uiStore.getState().setActiveView('new-project')
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
    } else if (activeView === 'routines') {
      document.title = 'Routines \u2014 anton'
    } else if (activeView === 'developer') {
      document.title = 'Developer \u2014 anton'
    } else if (activeConv?.title && activeConv.title !== 'New conversation') {
      document.title = `${sanitizeTitle(activeConv.title)} \u2014 anton`
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
        // In computer mode (home view), don't auto-navigate to a conversation
        const currentUI = uiStore.getState()
        if (currentUI.activeMode === 'computer' && currentUI.activeView === 'home') {
          return
        }

        // Restore the previously active conversation, or fall back to an empty one
        const currentStore = useStore.getState()
        const restoredId = currentStore.activeConversationId

        if (restoredId) {
          // User had an active conversation before — resume it
          currentStore.switchConversation(restoredId)
        } else {
          // No saved active conversation — pick an empty chat or the most recent one
          const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
          const chatConvs = currentStore.conversations
            .filter((c) => !c.projectId || c.projectId === defaultProject?.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)
          const emptyConv = chatConvs.find((c) => c.messages.length === 0)

          if (emptyConv) {
            currentStore.switchConversation(emptyConv.id)
          } else if (chatConvs[0]) {
            currentStore.switchConversation(chatConvs[0].id)
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
      if (detail?.tab === 'connectors') {
        // Navigate to sidebar connectors view instead of settings modal
        setActiveView('connectors')
        if (detail?.connectorId) {
          // Dispatch a follow-up event so ConnectorsView can select + open the connector
          window.dispatchEvent(
            new CustomEvent('open-connector', { detail: { connectorId: detail.connectorId } }),
          )
        }
        return
      }
      if (detail?.tab === 'usage') {
        setShowUsage(true)
        return
      }
      setSettingsPage(detail?.tab === 'models' ? 'models' : 'general')
      setShowSettings(true)
    }
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [setActiveView])

  const handleDisconnect = () => {
    connection.disconnect()
    useStore.getState().resetForDisconnect()
    localStorage.removeItem('anton.lastMachineId')
    setConnected(false)
  }

  if (!connected) {
    return <Connect onConnected={() => setConnected(true)} />
  }

  const isDisconnected = status === 'disconnected' || status === 'error'
  const isDisconnectedForUpdate =
    isDisconnected &&
    (updateStage === 'stopping' || updateStage === 'starting' || updateStage === 'verifying')

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

  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null
  const projectCrumb = activeProject?.name ?? 'My Computer'
  const viewLabels: Record<string, string> = {
    chat: hasMessages ? sanitizeTitle(activeConv?.title || 'New conversation') : 'New conversation',
    memory: 'Memory',
    routines: 'Routines',
    terminal: 'Terminal',
    files: 'Files',
    workflows: 'Workflows',
    skills: 'Skills',
    connectors: 'Connectors',
    customize: 'Customize',
    pages: 'Pages',
    projects: 'Projects',
  }
  const viewCrumb = viewLabels[activeView] ?? ''

  return (
    <ForceUpdateGate>
      <div className="app-shell">
        <Sidebar
          onDisconnect={handleDisconnect}
          activeView={sidebarView}
          onViewChange={handleSidebarViewChange}
          onOpenSettings={(page) => {
            if (page === 'usage') {
              setShowUsage(true)
              return
            }
            setSettingsPage(page === 'models' ? 'models' : 'general')
            setShowSettings(true)
          }}
          onOpenMachineInfo={() => setShowMachineInfo(true)}
        />

        <div className="workspace-shell">
          {/* Update notification overlay */}
          <UpdateBanner />
          <DesktopUpdateBanner />
          <ProtocolMismatchBanner />

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

          {/* Top bar — breadcrumbs + connection pulse */}
          {showTopbar && (
            <header className="workspace-topbar" data-tauri-drag-region>
              <div className="workspace-topbar__crumbs">
                <span className="workspace-topbar__crumb">{projectCrumb}</span>
                <span className="workspace-topbar__sep">/</span>
                <span
                  className={`workspace-topbar__crumb${viewSubCrumb ? '' : ' workspace-topbar__crumb--active'}`}
                >
                  {viewCrumb}
                </span>
                {viewSubCrumb && (
                  <>
                    <span className="workspace-topbar__sep">/</span>
                    <span className="workspace-topbar__crumb workspace-topbar__crumb--active">
                      {viewSubCrumb}
                    </span>
                  </>
                )}
              </div>

              <div className="workspace-topbar__spacer" data-tauri-drag-region />

              <div className="workspace-topbar__actions">
                {hasPendingInteraction && (
                  <WaitingBadge
                    onClick={() => {
                      // Scroll the message list to the bottom where the pending block lives.
                      const el = document.querySelector('.message-list')
                      if (el) el.scrollTop = el.scrollHeight
                    }}
                  />
                )}
                {activeView === 'chat' && hasMessages && currentTasks.length > 0 && (
                  <button
                    type="button"
                    className="workspace-topbar__hide-tasks-btn"
                    onClick={toggleTasksHidden}
                  >
                    {tasksHidden ? 'Show Tasks' : 'Hide Tasks'}
                  </button>
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
                    <SessionFilesBar />
                    {sessionUsage && (
                      <button
                        type="button"
                        className="workspace-topbar__action-btn workspace-topbar__action-btn--with-label"
                        onClick={() => setShowUsage(true)}
                        aria-label="Usage"
                      >
                        <Ticket size={18} strokeWidth={1.5} />
                        <span>{formatTokens(sessionUsage.totalTokens)}</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </header>
          )}

          <div className="workspace-body">
            {activeView === 'home' &&
              (hasMessages ? <RoutineChat /> : <StreamHome onSkillSelect={() => {}} />)}
            {activeView === 'tasks' && <TasksListView />}
            {activeView === 'chat' && <RoutineChat />}
            {activeView === 'memory' && <MemoryView />}
            {activeView === 'routines' && <RoutinesView />}
            {activeView === 'developer' && <DeveloperView />}
            {activeView === 'terminal' && (
              <>
                <Terminal />
                <FileBrowser />
              </>
            )}
            {activeView === 'files' && <ProjectFilesView />}
            {activeView === 'connectors' && <ConnectorsView />}
            {activeView === 'customize' && <CustomizeView />}
            {activeView === 'workflows' && <WorkflowsPage />}
            {activeView === 'pages' && <PagesView />}
            {activeView === 'projects' && <ProjectList />}
            {activeView === 'new-project' && <NewProjectView />}

            <AnimatePresence>
              {(activeView === 'chat' || activeView === 'home') && sidePanelOpen && <SidePanel />}
            </AnimatePresence>
          </div>
        </div>

        {showMachineInfo && <MachineInfoPanel onClose={() => setShowMachineInfo(false)} />}
        <SettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
          onDisconnect={handleDisconnect}
          initialPage={settingsPage}
          onOpenUsage={() => {
            setShowSettings(false)
            setShowUsage(true)
          }}
        />
        <UsageModal open={showUsage} onClose={() => setShowUsage(false)} />
        <DebugOverlay />
        <OnboardingTour
          open={showTour}
          onClose={() => setTourOpen(false)}
          onOpenPalette={() => {
            setTourOpen(false)
            setPaletteOpen(true)
          }}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={(page) => {
            setPaletteOpen(false)
            if (page === 'usage') {
              setShowUsage(true)
              return
            }
            setSettingsPage(page === 'models' ? 'models' : 'general')
            setShowSettings(true)
          }}
          onNewProject={() => {
            setPaletteOpen(false)
            handleNewProject()
          }}
        />
        {activeView !== 'home' && activeView !== 'chat' && (
          <ActivityDock onCompose={() => setActiveView('home')} />
        )}
      </div>
    </ForceUpdateGate>
  )
}
