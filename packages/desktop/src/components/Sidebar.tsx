import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  FolderOpen,
  MessageSquareText,
  PanelLeft,
  Plus,
  TerminalSquare,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { connection } from '../lib/connection.js'
import { useConnectionStatus, useStore } from '../lib/store.js'
import { AntonLogo } from './AntonLogo.js'
import { FileBrowser } from './FileBrowser.js'
import { SidebarSkillsPanel } from './SidebarSkillsPanel.js'

interface Props {
  onDisconnect: () => void
  activeView: 'agent' | 'terminal'
  onViewChange: (view: 'agent' | 'terminal') => void
}

type SidebarPanel = 'recent' | 'files' | 'skills'

export function Sidebar({ onDisconnect: _onDisconnect, activeView, onViewChange }: Props) {
  useConnectionStatus()
  const conversations = useStore((s) => s.conversations)
  const activeId = useStore((s) => s.activeConversationId)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const [panel, setPanel] = useState<SidebarPanel>('recent')

  const handleNewTask = () => {
    // If the active conversation is already empty (no messages), just reuse it
    const activeConv = conversations.find((c) => c.id === activeId)
    if (activeConv && activeConv.messages.length === 0) {
      onViewChange('agent')
      setPanel('recent')
      return
    }

    const sessionId = `sess_${Date.now().toString(36)}`
    const store = useStore.getState()
    newConversation(undefined, sessionId)
    connection.sendSessionCreate(sessionId, {
      provider: store.currentProvider,
      model: store.currentModel,
    })
    onViewChange('agent')
    setPanel('recent')
  }

  const handleDelete = (e: React.MouseEvent, convId: string, sessionId: string) => {
    e.stopPropagation()
    // Destroy the session on the VM
    if (sessionId) {
      connection.sendSessionDestroy(sessionId)
    }
    deleteConversation(convId)
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
            <PanelLeft size={16} />
          </button>
        </div>

        {/* Primary nav */}
        <div className="sidebar-primary">
          <NavItem icon={<Plus />} label="New thread" onClick={handleNewTask} />
          <NavItem
            icon={<FolderOpen />}
            label="Files"
            active={panel === 'files'}
            onClick={() => setPanel(panel === 'files' ? 'recent' : 'files')}
          />
          <NavItem
            icon={<TerminalSquare />}
            label="Terminal"
            active={activeView === 'terminal'}
            onClick={() => onViewChange(activeView === 'terminal' ? 'agent' : 'terminal')}
          />
          <NavItem
            icon={<Zap />}
            label="Skills"
            active={panel === 'skills'}
            onClick={() => setPanel(panel === 'skills' ? 'recent' : 'skills')}
          />
        </div>

        {/* Panel content */}
        <div className="sidebar-panel">
          <AnimatePresence mode="wait">
            {panel === 'skills' ? (
              <motion.div
                key="skills"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="sidebar-panel__inner"
              >
                <SidebarSkillsPanel />
              </motion.div>
            ) : panel === 'files' ? (
              <motion.div
                key="files"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="sidebar-panel__inner"
              >
                <FileBrowser />
              </motion.div>
            ) : (
              <motion.div
                key="recent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="sidebar-panel__inner"
              >
                {conversations.length > 0 && (
                  <>
                    <div className="sidebar-section-label">Recent</div>
                    <div className="sidebar-recent__list">
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          onClick={() => {
                            switchConversation(conv.id)
                            if (conv.sessionId) {
                              connection.sendSessionResume(conv.sessionId)
                              connection.sendSessionHistory(conv.sessionId)
                            }
                            onViewChange('agent')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              switchConversation(conv.id)
                              if (conv.sessionId) {
                                connection.sendSessionResume(conv.sessionId)
                                connection.sendSessionHistory(conv.sessionId)
                              }
                              onViewChange('agent')
                            }
                          }}
                          className={`sidebar-recent__item${conv.id === activeId ? ' sidebar-recent__item--active' : ''}`}
                        >
                          <span className="sidebar-recent__title">{conv.title}</span>
                          <button
                            type="button"
                            className="sidebar-recent__delete"
                            onClick={(e) => handleDelete(e, conv.id, conv.sessionId)}
                            aria-label="Delete conversation"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {conversations.length === 0 && (
                  <div className="sidebar-empty">
                    <MessageSquareText className="sidebar-empty__icon" />
                    <p className="sidebar-empty__text">No conversations yet</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User profile */}
        <div className="sidebar-profile">
          <div className="sidebar-profile__left">
            <div className="sidebar-profile__avatar">O</div>
            <span className="sidebar-profile__name">Om Gupta</span>
            <span className="sidebar-profile__badge">Pro</span>
          </div>
          <button type="button" className="sidebar-profile__bell" aria-label="Notifications">
            <Bell />
          </button>
        </div>
      </div>
    </motion.aside>
  )
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sidebar-nav-item${active ? ' sidebar-nav-item--active' : ''}`}
    >
      <span className="sidebar-nav-item__icon">{icon}</span>
      <span className="sidebar-nav-item__label">{label}</span>
    </button>
  )
}
