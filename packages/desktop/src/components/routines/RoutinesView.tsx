import type { RoutineRunRecord, RoutineSession } from '@anton/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { WorkflowPipelineView } from '../workflows/WorkflowPipelineView.js'
import { RoutineDetailView } from './RoutineDetailView.js'
import { RoutineListView } from './RoutineListView.js'
import { RoutineRunView } from './RoutineRunView.js'

type RightPanel = { view: 'home' } | { view: 'run'; run: RoutineRunRecord }
type DetailTab = 'flow' | 'agent'

export function RoutinesView() {
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ view: 'home' })
  const [detailTab, setDetailTab] = useState<DetailTab>('flow')
  const [leftWidth, setLeftWidth] = useState(340)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const projectRoutines = projectStore((s) => s.projectRoutines)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const connectionStatus = connectionStore((s) => s.initPhase)

  // Fetch routines when view mounts or project/connection changes
  useEffect(() => {
    if (activeProjectId && connectionStatus === 'ready') {
      projectStore.getState().listRoutines(activeProjectId)
    }
  }, [activeProjectId, connectionStatus])

  const selectedRoutine = selectedRoutineId
    ? projectRoutines.find((a: RoutineSession) => a.sessionId === selectedRoutineId)
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

  // Check if selected routine belongs to a workflow with pipeline data
  const selectedWorkflow = selectedRoutineId
    ? projectWorkflows.find((w) => w.agentSessionId === selectedRoutineId)
    : null
  const pipelineSteps = selectedWorkflow?.manifest?.pipeline

  const handleSelect = useCallback((id: string) => {
    setSelectedRoutineId(id)
    setRightPanel({ view: 'home' })
    setDetailTab('flow')
  }, [])

  const handleViewRun = useCallback((run: RoutineRunRecord) => {
    setRightPanel({ view: 'run', run })
  }, [])

  const hasOpen = !!selectedRoutineId

  return (
    <div className="home-layout">
      <div
        className="home-layout__left"
        style={{
          width: hasOpen ? leftWidth : '100%',
          flexShrink: hasOpen ? 0 : 1,
        }}
      >
        <RoutineListView
          mode={hasOpen ? 'compact' : 'full'}
          selectedId={selectedRoutineId}
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
          {rightPanel.view === 'run' && selectedRoutine ? (
            <RoutineRunView
              agentSessionId={selectedRoutine.sessionId}
              projectId={selectedRoutine.projectId}
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
                    Routine
                  </button>
                </div>
              )}
              {pipelineSteps && pipelineSteps.length > 0 && detailTab === 'flow' ? (
                <div className="wf-pipeline-scroll">
                  <WorkflowPipelineView steps={pipelineSteps} />
                </div>
              ) : (
                <RoutineDetailView
                  agentId={selectedRoutineId!}
                  onBack={() => setSelectedRoutineId(null)}
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
