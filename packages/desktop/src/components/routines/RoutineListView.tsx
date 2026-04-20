import type { RoutineSession } from '@anton/protocol'
import { MoreHorizontal, Pencil, Plus, Repeat, Search, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { formatRelativeTime } from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

type DisplayStatus = 'running' | 'completed' | 'error' | 'idle' | 'scheduled'

function getDisplayStatus(agent: RoutineSession): DisplayStatus {
  const s = agent.agent.status
  if (s === 'running') return 'running'
  if (s === 'error') return 'error'
  if (s === 'paused') return 'idle'
  if (s === 'idle' && agent.agent.schedule?.cron) return 'scheduled'
  if (s === 'idle' && agent.agent.runCount > 0) return 'completed'
  return 'idle'
}

function RoutineMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 2, right: window.innerWidth - rect.right })
    }
    setOpen(!open)
  }

  return (
    <div className="task-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="task-menu__trigger"
        onClick={handleOpen}
        aria-label="Routine options"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div
            className="task-menu__backdrop"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="task-menu" style={{ top: pos.top, right: pos.right }}>
            <button
              type="button"
              className="task-menu__item"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
                setOpen(false)
              }}
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span>Edit routine</span>
            </button>
            <button
              type="button"
              className="task-menu__item task-menu__item--danger"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
                setOpen(false)
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              <span>Delete routine</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface Props {
  selectedId: string | null
  draftingNew?: boolean
  editingId?: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onEdit: (id: string) => void
}

export function RoutineListView({
  selectedId,
  draftingNew,
  editingId,
  onSelect,
  onNew,
  onEdit,
}: Props) {
  const projectRoutines = projectStore((s) => s.projectRoutines)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const sorted = [...projectRoutines].sort((a, b) => {
      const aTime = a.agent.lastRunAt || a.agent.createdAt
      const bTime = b.agent.lastRunAt || b.agent.createdAt
      return bTime - aTime
    })
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.toLowerCase()
    return sorted.filter(
      (a) =>
        a.agent.name.toLowerCase().includes(q) ||
        a.projectId.toLowerCase().includes(q) ||
        a.agent.description?.toLowerCase().includes(q),
    )
  }, [projectRoutines, searchQuery])

  const handleDelete = (agent: RoutineSession) => {
    projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'delete')
  }

  const activeCount = projectRoutines.filter((r) => {
    const s = getDisplayStatus(r)
    return s === 'running' || s === 'scheduled'
  }).length

  return (
    <>
      <div className="rt-list__head">
        <div>
          <h2 className="rt-list__title">Routines</h2>
          <div className="rt-list__sub">
            {projectRoutines.length} total · {activeCount} active
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="mem-iconbtn"
            aria-label="Search routines"
            onClick={() => {
              setSearchOpen(!searchOpen)
              if (!searchOpen) requestAnimationFrame(() => inputRef.current?.focus())
            }}
          >
            <Search size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ fontSize: 12, padding: '5px 10px', gap: 4 }}
            onClick={onNew}
          >
            <Plus size={12} strokeWidth={1.5} /> New
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="task-panel__search">
          <Search size={14} strokeWidth={1.5} className="task-panel__search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter routines..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="task-panel__search-input"
          />
        </div>
      )}

      <div className="rt-list__body">
        {draftingNew && (
          <div className="rt-item rt-item--drafting">
            <span className="rt-item__glyph">
              <Plus size={13} strokeWidth={1.5} />
            </span>
            <div className="rt-item__body">
              <div className="rt-item__name">New routine</div>
              <div className="rt-item__meta">
                <span className="rt-item__dot rt-item__dot--off" aria-hidden />
                <span>Draft</span>
              </div>
            </div>
          </div>
        )}
        {filtered.length === 0 && !draftingNew ? (
          <div className="rt-list__empty">
            <Repeat size={18} strokeWidth={1.5} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div>No routines yet</div>
          </div>
        ) : (
          filtered.map((routine) => {
            const status = getDisplayStatus(routine)
            const on = status === 'running' || status === 'scheduled'
            const nextRun = routine.agent.nextRunAt
              ? formatRelativeTime(routine.agent.nextRunAt)
              : null
            const isActive = selectedId === routine.sessionId
            const isEditing = editingId === routine.sessionId
            return (
              <button
                type="button"
                key={routine.sessionId}
                className={`rt-item${isActive ? ' active' : ''}${isEditing ? ' rt-item--editing' : ''}`}
                onClick={() => onSelect(routine.sessionId)}
              >
                <span className="rt-item__glyph">
                  <Repeat size={13} strokeWidth={1.5} />
                </span>
                <div className="rt-item__body">
                  <div className="rt-item__name">{routine.agent.name}</div>
                  <div className="rt-item__meta">
                    <span className={`rt-item__dot${on ? '' : ' rt-item__dot--off'}`} aria-hidden />
                    {on ? (
                      <span>Active{nextRun ? ` · next ${nextRun}` : ''}</span>
                    ) : (
                      <span>Paused</span>
                    )}
                  </div>
                </div>
                <RoutineMenu
                  onEdit={() => onEdit(routine.sessionId)}
                  onDelete={() => handleDelete(routine)}
                />
              </button>
            )
          })
        )}
      </div>
    </>
  )
}
