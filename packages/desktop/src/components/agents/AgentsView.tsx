import type { AgentRunRecord } from '@anton/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { WorkflowPipelineView } from '../workflows/WorkflowPipelineView.js'
import { AgentDetailView } from './AgentDetailView.js'
import { AgentListView } from './AgentListView.js'
import { AgentRunView } from './AgentRunView.js'

type RightPanel = { view: 'home' } | { view: 'run'; run: AgentRunRecord }
type DetailTab = 'flow' | 'agent'

export function AgentsView() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ view: 'home' })
  const [detailTab, setDetailTab] = useState<DetailTab>('flow')
  const [leftWidth, setLeftWidth] = useState(340)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const projectAgents = projectStore((s) => s.projectAgents)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)

  const selectedAgent = selectedAgentId
    ? projectAgents.find((a) => a.sessionId === selectedAgentId)
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

  // Check if selected agent belongs to a workflow with pipeline data
  const selectedWorkflow = selectedAgentId
    ? projectWorkflows.find((w) => w.agentSessionId === selectedAgentId)
    : null
  const pipelineSteps = selectedWorkflow?.manifest?.pipeline

  const handleSelect = useCallback((id: string) => {
    setSelectedAgentId(id)
    setRightPanel({ view: 'home' })
    setDetailTab('flow')
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
            <>
              {pipelineSteps && pipelineSteps.length > 0 && (
                <div className="wf-tab-bar">
                  <button
                    type="button"
                    className={`wf-tab-bar__tab${detailTab === 'flow' ? ' wf-tab-bar__tab--active' : ''}`}
                    onClick={() => setDetailTab('flow')}
                  >
                    Flow
                  </button>
                  <button
                    type="button"
                    className={`wf-tab-bar__tab${detailTab === 'agent' ? ' wf-tab-bar__tab--active' : ''}`}
                    onClick={() => setDetailTab('agent')}
                  >
                    Agent
                  </button>
                </div>
              )}
              {pipelineSteps && pipelineSteps.length > 0 && detailTab === 'flow' ? (
                <div className="wf-pipeline-scroll">
                  <WorkflowPipelineView steps={pipelineSteps} />
                </div>
              ) : (
                <AgentDetailView
                  agentId={selectedAgentId!}
                  onBack={() => setSelectedAgentId(null)}
                  onViewRun={handleViewRun}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
