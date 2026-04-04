import type { AgentRunRecord } from '@anton/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { AgentDetailView } from './AgentDetailView.js'
import { AgentListView } from './AgentListView.js'
import { AgentRunView } from './AgentRunView.js'

type RightPanel = { view: 'home' } | { view: 'run'; run: AgentRunRecord }

export function AgentsView() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ view: 'home' })
  const [leftWidth, setLeftWidth] = useState(340)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const allAgents = projectStore((s) => s.allAgents)

  const selectedAgent = selectedAgentId
    ? allAgents.find((a) => a.sessionId === selectedAgentId)
    : null

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: leftWidth }
      setIsDragging(true)
    },
    [leftWidth],
  )

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const maxW = window.innerWidth - 200
      setLeftWidth(Math.min(maxW, Math.max(140, dragRef.current.startW + delta)))
    }
    const onUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  const handleSelect = useCallback((id: string) => {
    setSelectedAgentId(id)
    setRightPanel({ view: 'home' })
  }, [])

  const handleViewRun = useCallback((run: AgentRunRecord) => {
    setRightPanel({ view: 'run', run })
  }, [])

  const hasOpen = !!selectedAgentId

  return (
    <div className="home-layout">
      <div
        className="home-layout__left"
        style={{
          width: hasOpen ? leftWidth : '100%',
          flexShrink: hasOpen ? 0 : 1,
        }}
      >
        <AgentListView
          mode={hasOpen ? 'compact' : 'full'}
          selectedId={selectedAgentId}
          onSelect={handleSelect}
        />
      </div>

      {hasOpen && (
        <div
          className={`home-layout__divider${isDragging ? ' home-layout__divider--active' : ''}`}
          onMouseDown={handleDragStart}
        />
      )}

      {hasOpen && (
        <div className="home-layout__right">
          {rightPanel.view === 'run' && selectedAgent ? (
            <AgentRunView
              agentSessionId={selectedAgent.sessionId}
              projectId={selectedAgent.projectId}
              run={rightPanel.run}
              onBack={() => setRightPanel({ view: 'home' })}
            />
          ) : (
            <AgentDetailView
              agentId={selectedAgentId!}
              onBack={() => setSelectedAgentId(null)}
              onViewRun={handleViewRun}
            />
          )}
        </div>
      )}
    </div>
  )
}
