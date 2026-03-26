import { AnimatePresence } from 'framer-motion'
import { FolderOpen, PanelLeft, Share2, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentChat } from './components/AgentChat.js'
import { Connect } from './components/Connect.js'
import { MachineInfoPanel } from './components/MachineInfoPanel.js'
import { ModeSelector } from './components/ModeSelector.js'
import { SidePanel } from './components/SidePanel.js'
import { Sidebar } from './components/Sidebar.js'
import { SettingsModal } from './components/settings/SettingsModal.js'
import { Terminal } from './components/Terminal.js'
import { ProjectList } from './components/projects/ProjectList.js'
import { ProjectView } from './components/projects/ProjectView.js'
import { connection } from './lib/connection.js'
import { useConnectionStatus, useStore } from './lib/store.js'

export function App() {
  const [connected, setConnected] = useState(false)
  const [showMachineInfo, setShowMachineInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const status = useConnectionStatus()
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)
  const sessionUsage = useStore((s) => s.sessionUsage)
  const activeConv = useStore((s) => s.getActiveConversation())
  const hasMessages = (activeConv?.messages?.length || 0) > 0
  const artifactPanelOpen = useStore((s) => s.artifactPanelOpen)
  const pendingPlan = useStore((s) => s.pendingPlan)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const sidePanelOpen = artifactPanelOpen || pendingPlan !== null
  const machineName = connection.currentConfig?.host?.replace('.antoncomputer.in', '') ?? ''
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projects = useStore((s) => s.projects)

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
    }
  }, [status])

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.sessions.length > 0 && prev.sessions.length === 0) {
        const store = useStore.getState()

        // Sync server sessions → local conversations
        // Only create conversations for sessions that don't already have one locally
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
          }
        }

        // If no active conversation, activate the latest non-project session
        const currentStore = useStore.getState()
        if (!currentStore.activeConversationId) {
          // Prefer a non-project session for the default chat view
          const chatSession = state.sessions.find((s) => !s.id.match(/^proj_/))
          const latest = chatSession || state.sessions[0]
          if (latest) {
            const latestConv = currentStore.findConversationBySession(latest.id)
            if (latestConv) {
              currentStore.switchConversation(latestConv.id)
            }
          }
        }

        // Resume the active conversation's session (only if it's not a project session
        // while we're in chat mode — project sessions are handled by ProjectView)
        const activeConv = useStore.getState().getActiveConversation()
        if (activeConv?.sessionId && !activeConv.projectId) {
          connection.sendSessionResume(activeConv.sessionId)
          connection.sendSessionHistory(activeConv.sessionId)
        }
      }
    })
    return unsub
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

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  // For sidebar compatibility — map store view to sidebar view
  const sidebarView = activeView === 'chat' ? 'agent' : activeView === 'terminal' ? 'terminal' : 'agent'
  const handleSidebarViewChange = (view: 'agent' | 'terminal') => {
    setActiveView(view === 'agent' ? 'chat' : 'terminal')
  }

  return (
    <div className="app-shell">
      <Sidebar
        onDisconnect={handleDisconnect}
        activeView={sidebarView}
        onViewChange={handleSidebarViewChange}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="workspace-shell">
        {/* Reconnecting banner — non-blocking overlay */}
        {isDisconnected && (
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
            <button
              type="button"
              className="workspace-topbar__connection"
              onClick={() => setShowMachineInfo(true)}
            >
              <span className="workspace-topbar__connectionDot" />
              <span className="workspace-topbar__connectionLabel">
                {machineName || 'Connected'}
              </span>
            </button>
            {sessionUsage && activeView === 'chat' && (
              <div className="workspace-topbar__credits">
                <Ticket size={14} strokeWidth={1.5} className="workspace-topbar__creditsIcon" />
                <span>{formatTokens(sessionUsage.totalTokens)}</span>
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
          {activeView === 'projects' && (
            activeProjectId ? <ProjectView /> : <ProjectList />
          )}
          {activeView === 'terminal' && <Terminal />}
          <AnimatePresence>
            {activeView === 'chat' && sidePanelOpen && <SidePanel />}
          </AnimatePresence>
        </div>
      </div>

      {showMachineInfo && <MachineInfoPanel onClose={() => setShowMachineInfo(false)} />}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
