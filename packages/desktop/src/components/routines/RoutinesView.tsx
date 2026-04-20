import type { RoutineRunRecord, RoutineSession } from '@anton/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { WorkflowPipelineView } from '../workflows/WorkflowPipelineView.js'
import { RoutineCreateForm, type RoutineDraft, type RoutineTemplate } from './RoutineCreateForm.js'
import { RoutineDetailView } from './RoutineDetailView.js'
import { RoutineListView } from './RoutineListView.js'
import { RoutineRunView } from './RoutineRunView.js'
import { RoutinesIntro } from './RoutinesIntro.js'
import { cronForPreset } from './schedulePresets.js'

type RightPanel = { view: 'home' } | { view: 'run'; run: RoutineRunRecord }
type DetailTab = 'flow' | 'agent'
type CreateMode = true | RoutineTemplate

export function RoutinesView() {
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [creating, setCreating] = useState<CreateMode | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ view: 'home' })
  const [detailTab, setDetailTab] = useState<DetailTab>('flow')
  const [leftWidth, setLeftWidth] = useState(320)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const projectRoutines = projectStore((s) => s.projectRoutines)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null
  const folderPath = activeProject?.workspacePath ?? '~/Anton'
  const connectionStatus = connectionStore((s) => s.initPhase)

  useEffect(() => {
    if (activeProjectId && connectionStatus === 'ready') {
      projectStore.getState().listRoutines(activeProjectId)
    }
  }, [activeProjectId, connectionStatus])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const crumb = creating !== null ? 'New routine' : editingId ? 'Edit routine' : null
    uiStore.getState().setViewSubCrumb(crumb)
    return () => uiStore.getState().setViewSubCrumb(null)
  }, [creating, editingId])

  const selectedRoutine = selectedRoutineId
    ? projectRoutines.find((a: RoutineSession) => a.sessionId === selectedRoutineId)
    : null
  const editingRoutine = editingId
    ? projectRoutines.find((a: RoutineSession) => a.sessionId === editingId)
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
      const maxW = window.innerWidth - 320
      setLeftWidth(Math.min(maxW, Math.max(240, dragRef.current.startW + delta)))
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

  const selectedWorkflow = selectedRoutineId
    ? projectWorkflows.find((w) => w.agentSessionId === selectedRoutineId)
    : null
  const pipelineSteps = selectedWorkflow?.manifest?.pipeline

  const handleSelect = useCallback((id: string) => {
    setSelectedRoutineId(id)
    setCreating(null)
    setEditingId(null)
    setRightPanel({ view: 'home' })
    setDetailTab('flow')
  }, [])

  const handleDeselect = useCallback(() => {
    setSelectedRoutineId(null)
    setRightPanel({ view: 'home' })
  }, [])

  const handleViewRun = useCallback((run: RoutineRunRecord) => {
    setRightPanel({ view: 'run', run })
  }, [])

  const startCreate = useCallback(() => {
    setCreating(true)
    setEditingId(null)
    setSelectedRoutineId(null)
  }, [])

  const startEdit = useCallback((id: string) => {
    setEditingId(id)
    setCreating(null)
    setSelectedRoutineId(id)
  }, [])

  const handleUseTemplate = useCallback((tpl: RoutineTemplate) => {
    setCreating(tpl)
    setEditingId(null)
    setSelectedRoutineId(null)
  }, [])

  const handleCreateSave = useCallback((draft: RoutineDraft) => {
    const projectId = projectStore.getState().activeProjectId
    if (!projectId) return
    const schedule = cronForPreset(draft.presetId)
    projectStore.getState().createRoutine(projectId, {
      name: draft.name.trim() || 'Untitled routine',
      description: draft.description.trim() || undefined,
      instructions: draft.instructions.trim(),
      schedule: schedule ?? undefined,
    })
    setCreating(null)
    setToast('Routine created')
  }, [])

  const handleEditSave = useCallback(
    (draft: RoutineDraft) => {
      const projectId = projectStore.getState().activeProjectId
      if (!projectId || !editingId) return
      const schedule = cronForPreset(draft.presetId)
      projectStore.getState().updateRoutine(projectId, editingId, {
        name: draft.name.trim() || undefined,
        description: draft.description.trim() || undefined,
        instructions: draft.instructions.trim() || undefined,
        schedule,
      })
      setEditingId(null)
      setSelectedRoutineId(editingId)
      setToast('Changes saved')
    },
    [editingId],
  )

  const handleCreateCancel = useCallback(() => {
    setCreating(null)
    if (projectRoutines[0]) setSelectedRoutineId(projectRoutines[0].sessionId)
  }, [projectRoutines])

  const handleEditCancel = useCallback(() => {
    const id = editingId
    setEditingId(null)
    if (id) setSelectedRoutineId(id)
  }, [editingId])

  const hasRoutines = projectRoutines.length > 0

  return (
    <div className={`rt-wrap${hasRoutines ? '' : ' rt-wrap--solo'}`}>
      {hasRoutines && (
        <>
          <div className="rt-list" style={{ width: leftWidth, flexShrink: 0 }}>
            <RoutineListView
              selectedId={creating !== null ? null : (editingId ?? selectedRoutineId)}
              draftingNew={creating !== null}
              editingId={editingId}
              onSelect={handleSelect}
              onNew={startCreate}
              onEdit={startEdit}
            />
          </div>
          <div
            className={`home-layout__divider${isDragging ? ' home-layout__divider--active' : ''}`}
            onMouseDown={handleDragStart}
          />
        </>
      )}

      <div className="rt-detail-scroll" style={{ flex: 1, minWidth: 0 }}>
        {creating !== null ? (
          <RoutineCreateForm
            mode="create"
            initial={creating === true ? null : creating}
            isFirst={!hasRoutines}
            folderLabel={folderPath}
            onCancel={handleCreateCancel}
            onSave={handleCreateSave}
          />
        ) : editingRoutine ? (
          <RoutineCreateForm
            mode="edit"
            initial={editingRoutine}
            folderLabel={folderPath}
            onCancel={handleEditCancel}
            onSave={handleEditSave}
          />
        ) : !selectedRoutine ? (
          <RoutinesIntro onCreate={startCreate} onUseTemplate={handleUseTemplate} />
        ) : rightPanel.view === 'run' ? (
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
                onBack={handleDeselect}
                onViewRun={handleViewRun}
                onEdit={() => startEdit(selectedRoutineId!)}
                onToast={(msg) => setToast(msg)}
              />
            )}
          </>
        )}
      </div>

      {toast && <div className="rt-toast">{toast}</div>}
    </div>
  )
}
