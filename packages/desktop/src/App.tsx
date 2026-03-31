import { AnimatePresence } from 'framer-motion'
import { Code, FolderOpen, PanelLeft, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentChat } from './components/AgentChat.js'
import { Connect } from './components/Connect.js'
import { FileBrowser } from './components/FileBrowser.js'
import { MachineInfoPanel } from './components/MachineInfoPanel.js'
import { ModeSelector } from './components/ModeSelector.js'
import { SidePanel } from './components/SidePanel.js'
import { Sidebar } from './components/Sidebar.js'
import { Terminal } from './components/Terminal.js'
import { DebugOverlay } from './components/chat/DebugOverlay.js'
import { ProjectList } from './components/projects/ProjectList.js'
import { ProjectView } from './components/projects/ProjectView.js'
import { ForceUpdateGate } from './components/ForceUpdateGate.js'
import { UpdateBanner } from './components/UpdateBanner.js'
import { SettingsModal } from './components/settings/SettingsModal.js'
import { WelcomeModal } from './components/WelcomeModal.js'
import { connection } from './lib/connection.js'
import { useConnectionStatus, useStore } from './lib/store.js'

export function App() {
  const [connected, setConnected] = useState(false)
  const [showMachineInfo, setShowMachineInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'general' | 'models' | 'connectors' | 'usage'>(
    'general',
  )
  const [settingsConnectorId, setSettingsConnectorId] = useState<string | undefined>()
  const status = useConnectionStatus()
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)
  const sessionUsage = useStore((s) => s.sessionUsage)
  const activeConv = useStore((s) => s.getActiveConversation())
  const hasMessages = (activeConv?.messages?.length || 0) > 0
  const artifactPanelOpen = useStore((s) => s.artifactPanelOpen)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const updateStage = useStore((s) => s.updateStage)
  const sidePanelOpen = artifactPanelOpen
  const _machineName = connection.currentConfig?.host?.replace('.antoncomputer.in', '') ?? ''
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projects = useStore((s) => s.projects)
  const theme = useStore((s) => s.theme)
  const devMode = useStore((s) => s.devMode)
  const onboardingLoaded = useStore((s) => s.onboardingLoaded)
  const onboardingCompleted = useStore((s) => s.onboardingCompleted)
  const setOnboardingCompleted = useStore((s) => s.setOnboardingCompleted)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)
  const setSidePanelView = useStore((s) => s.setSidePanelView)
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
        useStore.setState({ resolvedTheme: e.matches ? 'dark' : 'light' })
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

  // Dynamic page title
  useEffect(() => {
    if (!connected) {
      document.title = 'anton'
    } else if (activeView === 'terminal') {
      document.title = 'Terminal — anton'
    } else if (activeView === 'projects') {
      document.title = 'Projects — anton'
    } else if (activeConv?.title && activeConv.title !== 'New conversation') {
      document.title = `${activeConv.title} — anton`
    } else {
      document.title = 'anton'
    }
  }, [connected, activeView, activeConv?.title])

  useEffect(() => {
    if (status === 'connected') {
      connection.sendProvidersList()
      connection.sendSessionsList()
      connection.sendProjectsList()
      connection.sendConnectorsList()
      connection.sendConnectorRegistryList()

      // If there's a persisted active project, fetch its sessions so
      // landing directly on a project view shows up-to-date data
      const store = useStore.getState()
      if (store.activeProjectId) {
        useStore.setState({ projectSessionsLoading: true })
        connection.sendProjectSessionsList(store.activeProjectId)
      }
    }
  }, [status])

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.sessions.length > 0 && prev.sessions.length === 0) {
        const store = useStore.getState()

        // Sync server sessions → local conversations
        // Create conversations for sessions that don't exist locally,
        // and sync titles for existing ones that are still "New conversation"
        for (const session of state.sessions) {
          const existing = store.findConversationBySession(session.id)
          if (!existing) {
            // Extract projectId from session ID format (proj_{projectId}_sess_...)
            // so project conversations don't leak into the main chat sidebar
            let projectId: string | undefined
            const projMatch = session.id.match(/^proj_([^_]+(?:_[^_]+)?)_sess_/)
            if (projMatch) {
              projectId = projMatch[1]
            }

            // Use appendConversation to add at end (not top) so they don't
            // displace the user's current/new conversation
            store.appendConversation(session.title || 'New conversation', session.id, projectId)
          } else if (
            session.title &&
            session.title !== 'New conversation' &&
            existing.title === 'New conversation'
          ) {
            // Existing conversation has stale default title — sync from server
            store.updateConversationTitle(session.id, session.title)
          }
        }

        // On connect, always land on a fresh empty conversation.
        // If one already exists, switch to it; otherwise create one.
        const currentStore = useStore.getState()
        const chatConvs = currentStore.conversations.filter((c) => !c.projectId)
        const emptyConv = chatConvs.find((c) => c.messages.length === 0)

        if (emptyConv) {
          currentStore.switchConversation(emptyConv.id)
        } else if (!currentStore.activeConversationId) {
          // No empty conversation and nothing active — pick the latest
          const chatSession = state.sessions.find((s) => !s.id.match(/^proj_/))
          const latest = chatSession || state.sessions[0]
          if (latest) {
            const latestConv = currentStore.findConversationBySession(latest.id)
            if (latestConv) {
              currentStore.switchConversation(latestConv.id)
            }
          }
        }

        // Fetch history for the active conversation (if it's not a project session —
        // project sessions are handled by ProjectView)
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

  // For sidebar compatibility — map store view to sidebar view
  const sidebarView =
    activeView === 'chat' ? 'agent' : activeView === 'terminal' ? 'terminal' : 'agent'
  const handleSidebarViewChange = (view: 'agent' | 'terminal') => {
    setActiveView(view === 'agent' ? 'chat' : 'terminal')
  }

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

        {/* Reconnecting banner — hidden when disconnecting for an update */}
        {isDisconnected && !isDisconnectedForUpdate && (
          <div className="reconnect-banner">
            <span className="reconnect-banner__dot" />
            <span>Reconnecting to your machine...</span>
            <button type="button" onClick={handleDisconnect} className="reconnect-banner__btn">
              Switch machine
            </button>
          </div>
        )}

        {/* Top bar with mode selector */}
        <header className="workspace-topbar" data-tauri-drag-region>
          <div className="workspace-topbar__title-area">
            {sidebarCollapsed && (
              <button
                type="button"
                className="workspace-topbar__sidebarToggle"
                onClick={toggleSidebar}
                aria-label="Open sidebar"
              >
                <PanelLeft size={18} strokeWidth={1.5} />
              </button>
            )}
            {activeView === 'chat' && activeConvProject && (
              <button
                type="button"
                className="workspace-topbar__project-badge"
                onClick={() => {
                  setActiveView('projects')
                  useStore.getState().setActiveProject(activeConvProject.id)
                  connection.sendProjectSessionsList(activeConvProject.id)
                }}
                title={`Project: ${activeConvProject.name}`}
              >
                <FolderOpen size={12} strokeWidth={1.5} />
                <span>{activeConvProject.name}</span>
              </button>
            )}
          </div>

          <ModeSelector />

          <div className="workspace-topbar__actions">
            {devMode && (
              <button
                type="button"
                className="workspace-topbar__devmode"
                onClick={() => {
                  setSidePanelView('devmode')
                  setArtifactPanelOpen(true)
                }}
                title="Developer Tools"
              >
                <Code size={18} strokeWidth={1.5} />
              </button>
            )}
            <button
              type="button"
              className="workspace-topbar__connection"
              onClick={() => setShowMachineInfo(true)}
            >
              <span className="workspace-topbar__connectionDot" />
              <span className="workspace-topbar__connectionLabel">
                {status === 'connected'
                  ? 'Connected'
                  : status === 'connecting'
                    ? 'Connecting...'
                    : status === 'authenticating'
                      ? 'Verifying...'
                      : status === 'error'
                        ? 'Error'
                        : 'Disconnected'}
              </span>
            </button>
            {sessionUsage && activeView === 'chat' && (
              <div className="workspace-topbar__credits">
                <Ticket size={14} strokeWidth={1.5} className="workspace-topbar__creditsIcon" />
                <span>{formatTokens(sessionUsage.outputTokens)}</span>
              </div>
            )}
          </div>
        </header>

        {activeView === 'chat' && hasMessages && (
          <div className="workspace-titlebar">
            <h2 className="workspace-titlebar__title">{activeConv?.title || 'New conversation'}</h2>
          </div>
        )}

        <div className="workspace-body">
          {activeView === 'chat' && <AgentChat />}
          {activeView === 'projects' && (activeProjectId ? <ProjectView /> : <ProjectList />)}
          {activeView === 'terminal' && (
            <>
              <Terminal />
              <FileBrowser />
            </>
          )}

          <AnimatePresence>
            {activeView === 'chat' && sidePanelOpen && <SidePanel />}
          </AnimatePresence>
        </div>
      </div>

      {showMachineInfo && <MachineInfoPanel onClose={() => setShowMachineInfo(false)} />}
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
