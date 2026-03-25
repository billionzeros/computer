import { AnimatePresence } from 'framer-motion'
import { PanelLeft, Settings, Share2, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentChat } from './components/AgentChat.js'
import { Connect } from './components/Connect.js'
import { SidePanel } from './components/SidePanel.js'
import { Sidebar } from './components/Sidebar.js'
import { Terminal } from './components/Terminal.js'
import { connection } from './lib/connection.js'
import { useConnectionStatus, useStore } from './lib/store.js'

type View = 'agent' | 'terminal'

export function App() {
  const [connected, setConnected] = useState(false)
  const [activeView, setActiveView] = useState<View>('agent')
  const status = useConnectionStatus()
  const sessionUsage = useStore((s) => s.sessionUsage)
  const activeConv = useStore((s) => s.getActiveConversation())
  const hasMessages = (activeConv?.messages?.length || 0) > 0
  const artifactPanelOpen = useStore((s) => s.artifactPanelOpen)
  const pendingPlan = useStore((s) => s.pendingPlan)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const sidePanelOpen = artifactPanelOpen || pendingPlan !== null

  // Dynamic page title
  useEffect(() => {
    if (!connected) {
      document.title = 'anton'
    } else if (activeView === 'terminal') {
      document.title = 'Terminal — anton'
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
    }
  }, [status])

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.sessions.length > 0 && prev.sessions.length === 0) {
        const latest = state.sessions[0]
        const existing = state.findConversationBySession(latest.id)
        if (existing) {
          useStore.getState().switchConversation(existing.id)
        } else {
          useStore.getState().newConversation(latest.title, latest.id)
        }
        connection.sendSessionResume(latest.id)
        connection.sendSessionHistory(latest.id)
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

  if (status === 'disconnected' || status === 'error') {
    return (
      <div className="connection-screen">
        <div className="connection-card">
          <p className="connection-card__title">Connection paused</p>
          <p className="connection-card__copy">
            We lost contact with your machine. You can reconnect in one click.
          </p>
          <button type="button" onClick={handleDisconnect} className="button button--primary">
            Connect to a machine
          </button>
        </div>
      </div>
    )
  }

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  return (
    <div className="app-shell">
      <Sidebar
        onDisconnect={handleDisconnect}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      <div className="workspace-shell">
        {/* Top bar — only show when in a conversation */}
        {hasMessages && activeView === 'agent' && (
          <header className="workspace-topbar" data-tauri-drag-region>
            <div className="workspace-topbar__title-area">
              {sidebarCollapsed && (
                <button
                  type="button"
                  className="workspace-topbar__sidebarToggle"
                  onClick={toggleSidebar}
                  aria-label="Open sidebar"
                >
                  <PanelLeft size={18} />
                </button>
              )}
              <h2 className="workspace-topbar__title">{activeConv?.title || 'New conversation'}</h2>
            </div>

            <div className="workspace-topbar__actions">
              <div className="workspace-topbar__connection">
                <span className="workspace-topbar__connectionDot" />
                <span className="workspace-topbar__connectionLabel">Connected</span>
              </div>
              {sessionUsage && (
                <div className="workspace-topbar__credits">
                  <Ticket className="workspace-topbar__creditsIcon" />
                  <span>{formatTokens(sessionUsage.totalTokens)}</span>
                </div>
              )}
              <button type="button" className="topbar-share-btn">
                <Share2 className="topbar-share-btn__icon" />
                <span>Share</span>
              </button>
            </div>
          </header>
        )}

        {/* Empty state top bar — minimal with just connection status + settings */}
        {(!hasMessages || activeView === 'terminal') && (
          <header className="workspace-topbar workspace-topbar--minimal" data-tauri-drag-region>
            <div className="workspace-topbar__spacer">
              {sidebarCollapsed && (
                <button
                  type="button"
                  className="workspace-topbar__sidebarToggle"
                  onClick={toggleSidebar}
                  aria-label="Open sidebar"
                >
                  <PanelLeft size={18} />
                </button>
              )}
            </div>
            <div className="workspace-topbar__actions">
              <div className="workspace-topbar__connection">
                <span className="workspace-topbar__connectionDot" />
                <span className="workspace-topbar__connectionLabel">Connected</span>
              </div>
              {sessionUsage && (
                <div className="workspace-topbar__credits">
                  <Ticket className="workspace-topbar__creditsIcon" />
                  <span>{formatTokens(sessionUsage.totalTokens)}</span>
                </div>
              )}
              <button type="button" className="workspace-topbar__settingsBtn" aria-label="Settings">
                <Settings className="workspace-topbar__settingsIcon" />
              </button>
            </div>
          </header>
        )}

        <div className="workspace-body">
          {activeView === 'agent' && <AgentChat />}
          {activeView === 'terminal' && <Terminal />}
          <AnimatePresence>
            {activeView === 'agent' && sidePanelOpen && <SidePanel />}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
