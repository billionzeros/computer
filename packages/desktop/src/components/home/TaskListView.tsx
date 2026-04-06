import { AlertCircle, MoreHorizontal, Pencil, Pin, Search, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { sanitizeTitle } from '../../lib/conversations.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { Skeleton } from '../Skeleton.js'
import { ChatInput } from '../chat/ChatInput.js'
import { EmptyState } from '../chat/EmptyState.js'

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type TaskStatus = 'working' | 'completed' | 'error' | 'idle'

function getTaskStatus(
  sessionId: string | undefined,
  sessionStates: Map<string, { status: string; statusDetail?: string | null }>,
  messages: { role: string; isError?: boolean }[],
): TaskStatus {
  if (!sessionId) return 'idle'
  const state = sessionStates.get(sessionId)
  if (state?.status === 'working') return 'working'
  if (messages.length === 0) return 'idle'
  const lastMsg = [...messages].reverse().find((m) => m.role === 'assistant' || m.role === 'system')
  if (lastMsg?.isError) return 'error'
  return 'completed'
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  working: 'Working',
  completed: 'Completed',
  error: 'Error',
  idle: 'Idle',
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'completed') {
    return (
      <svg
        className="status-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" fill="var(--success)" opacity="0.15" />
        <circle cx="8" cy="8" r="7" stroke="var(--success)" strokeWidth="1" />
        <path
          d="M5 8.5L7 10.5L11 5.5"
          stroke="var(--success)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (status === 'working') {
    return <span className="status-icon status-icon--working" />
  }
  if (status === 'error') {
    return (
      <svg
        className="status-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" fill="var(--danger)" opacity="0.15" />
        <circle cx="8" cy="8" r="7" stroke="var(--danger)" strokeWidth="1" />
        <path
          d="M6 6L10 10M10 6L6 10"
          stroke="var(--danger)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  // idle
  return (
    <svg
      className="status-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="var(--text-subtle)" strokeWidth="1.2" opacity="0.6" />
    </svg>
  )
}

function getStatusDetail(
  sessionId: string | undefined,
  sessionStates: Map<string, { status: string; statusDetail?: string | null }>,
  status: TaskStatus,
): string | null {
  if (!sessionId) return null
  const s = sessionStates.get(sessionId)
  if (s?.statusDetail) return s.statusDetail
  if (status === 'working') return 'Working...'
  if (status === 'error') return 'Error'
  return null
}

// ── Task context menu (three-dot) ──

function TaskMenu({
  onDelete,
  onRename,
  onPin,
}: {
  onDelete: (e: React.MouseEvent) => void
  onRename: (e: React.MouseEvent) => void
  onPin: (e: React.MouseEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 2,
        right: window.innerWidth - rect.right,
      })
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
        aria-label="Task options"
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
                onPin(e)
                setOpen(false)
              }}
            >
              <Pin size={14} strokeWidth={1.5} />
              <span>Pin task</span>
            </button>
            <button
              type="button"
              className="task-menu__item"
              onClick={(e) => {
                e.stopPropagation()
                onRename(e)
                setOpen(false)
              }}
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span>Rename task</span>
            </button>
            <button
              type="button"
              className="task-menu__item task-menu__item--danger"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(e)
                setOpen(false)
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              <span>Delete task</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Bulk selection bar ──

function SelectionBar({
  count,
  onDelete,
  onCancel,
}: {
  count: number
  onDelete: () => void
  onCancel: () => void
}) {
  return (
    <div className="task-selection-bar">
      <span className="task-selection-bar__count">
        {count} task{count !== 1 ? 's' : ''} selected
      </span>
      <div className="task-selection-bar__actions">
        <button
          type="button"
          className="task-selection-bar__btn task-selection-bar__btn--danger"
          onClick={onDelete}
        >
          <Trash2 size={14} strokeWidth={1.5} />
          Delete
        </button>
        <button type="button" className="task-selection-bar__btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Selection checkbox ──

function SelectionCheckbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      className={`task-select-check${checked ? ' task-select-check--active' : ''}`}
      onClick={onChange}
      aria-label={checked ? 'Deselect task' : 'Select task'}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
          <path
            d="M1 4L3.5 6.5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

function TaskTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="task-table__body">
      {Array.from({ length: rows }, (_, i) => `skel-${i}`).map((id, i) => (
        <div key={id} className="task-table__row task-table__row--skeleton">
          <div className="task-table__col task-table__col--check">
            <Skeleton variant="rect" width={16} height={16} borderRadius={4} />
          </div>
          <div className="task-table__col task-table__col--status">
            <Skeleton variant="circle" width={16} height={16} />
            <Skeleton width={52} height={12} />
          </div>
          <div className="task-table__col task-table__col--name">
            <Skeleton width={`${55 + (i % 3) * 15}%`} height={14} />
          </div>
          <div className="task-table__col task-table__col--updated">
            <Skeleton width={56} height={12} />
          </div>
          <div className="task-table__col task-table__col--actions" />
        </div>
      ))}
    </div>
  )
}

function TaskRowSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => `row-skel-${i}`).map((id, i) => (
        <div key={id} className="task-row task-row--skeleton">
          <div className="task-row__clickable">
            <Skeleton variant="circle" width={16} height={16} />
            <div className="task-row__content">
              <Skeleton width={`${50 + (i % 3) * 18}%`} height={14} />
            </div>
            <Skeleton width={40} height={12} />
          </div>
        </div>
      ))}
    </>
  )
}

interface Props {
  mode: 'full' | 'compact'
}

export function TaskListView({ mode }: Props) {
  const allConversations = useStore((s) => s.conversations)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)
  const sessionsLoaded = sessionStore((s) => s.sessionsLoaded)
  const switchConversation = useStore((s) => s.switchConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const newConversation = useStore((s) => s.newConversation)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if this project has an unbootstrapped workflow
  const pendingWorkflow = projectWorkflows.find(
    (w) => w.projectId === activeProjectId && !w.bootstrapped,
  )

  const selectionMode = selectedIds.size > 0

  // Filter conversations to the active project
  const defaultProjectId = projects.find((p) => p.isDefault)?.id
  const conversations = useMemo(() => {
    if (!activeProjectId) return allConversations
    return allConversations.filter((c) => {
      // For the default project, also include legacy conversations without projectId
      if (activeProjectId === defaultProjectId) {
        return !c.projectId || c.projectId === activeProjectId
      }
      return c.projectId === activeProjectId
    })
  }, [allConversations, activeProjectId, defaultProjectId])

  const tasks = useMemo(() => {
    const sorted = [...conversations].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
    )
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.toLowerCase()
    return sorted.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const handleTaskClick = (conv: (typeof conversations)[0]) => {
    if (selectionMode) {
      toggleSelection(conv.id)
      return
    }
    switchConversation(conv.id)
    if (conv.sessionId) {
      useStore.getState().requestSessionHistory(conv.sessionId)
    }
  }

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleBulkDelete = useCallback(() => {
    for (const id of selectedIds) {
      deleteConversation(id)
    }
    setSelectedIds(new Set())
  }, [selectedIds, deleteConversation])

  const handleCancelSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleDeleteTask = useCallback(
    (id: string) => {
      deleteConversation(id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [deleteConversation],
  )

  const handleNewTask = (text: string, attachments?: ChatImageAttachment[]) => {
    const store = useStore.getState()
    const sStore = sessionStore.getState()
    const sessionId = `sess_${Date.now().toString(36)}`
    const projectId = projectStore.getState().activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    sessionStore.getState().createSession(sessionId, {
      provider: sStore.currentProvider,
      model: sStore.currentModel,
      projectId,
    })
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      switchConversation(conv.id)
    }
    const outboundAttachments = attachments?.flatMap((a) =>
      a.data
        ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
        : [],
    )
    requestAnimationFrame(() => {
      const conv = useStore.getState().findConversationBySession(sessionId)
      if (conv) {
        useStore.getState().switchConversation(conv.id)
        useStore.getState().addMessage({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          content: text,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
          timestamp: Date.now(),
        })
        sessionStore.getState().sendAiMessageToSession(text, sessionId, outboundAttachments)
      }
    })
  }

  const handleSkillSelect = (_skill: Skill) => {}

  const isLoading = !sessionsLoaded

  // ── Full mode: Perplexity-style table (no task selected) ──
  if (mode === 'full') {
    // No tasks and done loading → show centered empty state (like chat)
    if (tasks.length === 0 && !isLoading) {
      return <EmptyState onSend={handleNewTask} onSkillSelect={handleSkillSelect} />
    }

    return (
      <div className="task-list-full">
        {/* Fixed top bar */}
        {selectionMode ? (
          <SelectionBar
            count={selectedIds.size}
            onDelete={handleBulkDelete}
            onCancel={handleCancelSelection}
          />
        ) : (
          <div className="task-panel__header">
            <h2 className="task-panel__title">All tasks</h2>
            <div className="task-panel__header-actions">
              <button
                type="button"
                className="task-panel__icon-btn"
                onClick={() => {
                  setSearchOpen(!searchOpen)
                  if (!searchOpen) requestAnimationFrame(() => inputRef.current?.focus())
                }}
              >
                <Search size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {searchOpen && !selectionMode && (
          <div className="task-panel__search">
            <Search size={14} strokeWidth={1.5} className="task-panel__search-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Filter tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="task-panel__search-input"
            />
          </div>
        )}

        <div className="task-list-full__inner">
          {/* Setup incomplete banner */}
          {pendingWorkflow && (
            <button
              type="button"
              className="setup-incomplete-banner"
              onClick={() => handleNewTask(`Continue setting up ${pendingWorkflow.manifest.name}`)}
            >
              <AlertCircle size={16} strokeWidth={1.5} />
              <div className="setup-incomplete-banner__text">
                <span className="setup-incomplete-banner__title">
                  {pendingWorkflow.manifest.name} setup incomplete
                </span>
                <span className="setup-incomplete-banner__desc">
                  Click to continue the setup conversation
                </span>
              </div>
            </button>
          )}

          {/* Hero input */}
          <div className="task-list-full__hero">
            <ChatInput
              onSend={handleNewTask}
              onSkillSelect={handleSkillSelect}
              variant="hero"
              ignoreWorkingState
            />
          </div>

          {/* Task table */}
          <div className="task-table">
            <div className="task-table__header">
              <div className="task-table__col task-table__col--check" />
              <div className="task-table__col task-table__col--status">Status</div>
              <div className="task-table__col task-table__col--name">Task</div>
              <div className="task-table__col task-table__col--updated">Updated</div>
              <div className="task-table__col task-table__col--actions" />
            </div>
            {isLoading ? (
              <TaskTableSkeleton />
            ) : (
              <div className="task-table__body">
                {tasks.map((conv) => {
                  const status = getTaskStatus(conv.sessionId, sessionStates, conv.messages)
                  const isSelected = selectedIds.has(conv.id)
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: table row selection
                    <div
                      key={conv.id}
                      className={`task-table__row${isSelected ? ' task-table__row--selected' : ''}`}
                      onClick={() => handleTaskClick(conv)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="task-table__col task-table__col--check">
                        <SelectionCheckbox
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation()
                            toggleSelection(conv.id)
                          }}
                        />
                      </div>
                      <div className="task-table__col task-table__col--status">
                        <span
                          className={`task-table__status-label task-table__status-label--${status}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="task-table__col task-table__col--name task-table__col--clickable"
                        onClick={() => handleTaskClick(conv)}
                      >
                        <span className="task-table__task-title">
                          {sanitizeTitle(conv.title || 'New task')}
                        </span>
                      </button>
                      <div className="task-table__col task-table__col--updated">
                        {formatRelativeTime(conv.updatedAt || conv.createdAt)}
                      </div>
                      <div className="task-table__col task-table__col--actions">
                        <TaskMenu
                          onDelete={() => handleDeleteTask(conv.id)}
                          onRename={() => {}}
                          onPin={() => {}}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Compact mode: sidebar-style list (task is open on right) ──
  return (
    <div className="task-panel">
      {selectionMode ? (
        <SelectionBar
          count={selectedIds.size}
          onDelete={handleBulkDelete}
          onCancel={handleCancelSelection}
        />
      ) : (
        <div className="task-panel__header">
          <h2 className="task-panel__title">All tasks</h2>
          <div className="task-panel__header-actions">
            <button
              type="button"
              className="task-panel__icon-btn"
              onClick={() => {
                setSearchOpen(!searchOpen)
                if (!searchOpen) requestAnimationFrame(() => inputRef.current?.focus())
              }}
            >
              <Search size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {searchOpen && !selectionMode && (
        <div className="task-panel__search">
          <Search size={14} strokeWidth={1.5} className="task-panel__search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="task-panel__search-input"
          />
        </div>
      )}

      <div className="task-panel__input">
        <ChatInput
          onSend={handleNewTask}
          onSkillSelect={handleSkillSelect}
          variant="hero"
          ignoreWorkingState
        />
      </div>

      <div className="task-panel__list">
        {isLoading ? (
          <TaskRowSkeleton />
        ) : (
          <>
            {tasks.map((conv) => {
              const status = getTaskStatus(conv.sessionId, sessionStates, conv.messages)
              const detail = getStatusDetail(conv.sessionId, sessionStates, status)
              const isActive = conv.id === activeConversationId
              const isSelected = selectedIds.has(conv.id)
              return (
                <div
                  key={conv.id}
                  className={`task-row${isActive ? ' task-row--active' : ''}${isSelected ? ' task-row--selected' : ''}`}
                >
                  <button
                    type="button"
                    className="task-row__clickable"
                    onClick={() => handleTaskClick(conv)}
                  >
                    <StatusIcon status={status} />
                    <div className="task-row__content">
                      <span className="task-row__name">
                        {sanitizeTitle(conv.title || 'New task')}
                      </span>
                      {detail && <span className="task-row__detail">{detail}</span>}
                    </div>
                    <span className="task-row__time">
                      {formatRelativeTime(conv.updatedAt || conv.createdAt)}
                    </span>
                  </button>
                  <TaskMenu
                    onDelete={() => handleDeleteTask(conv.id)}
                    onRename={() => {}}
                    onPin={() => {}}
                  />
                </div>
              )
            })}
            {tasks.length === 0 && <div className="task-panel__empty">No tasks yet</div>}
          </>
        )}
      </div>
    </div>
  )
}
