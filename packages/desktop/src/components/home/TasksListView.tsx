import { Pause, Pencil, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeTitle } from '../../lib/conversations.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { ChatInput } from '../chat/ChatInput.js'

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function TasksListView() {
  const allConversations = useStore((s) => s.conversations)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const switchConversation = useStore((s) => s.switchConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const renameConversation = useStore((s) => s.renameConversation)
  const setActiveView = uiStore((s) => s.setActiveView)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const sendCancelTurn = sessionStore((s) => s.sendCancelTurn)
  const newConversation = useStore((s) => s.newConversation)
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const cancelEditRef = useRef(false)

  const rows = useMemo(() => {
    const inProject = allConversations.filter(
      (c) => !c.projectId || c.projectId === activeProjectId,
    )

    return inProject
      .map((c) => {
        const state = c.sessionId ? sessionStates.get(c.sessionId) : undefined
        const lastAssistant = [...c.messages]
          .reverse()
          .find((m) => m.role === 'assistant' || m.role === 'system')
        const errored = !!lastAssistant?.isError
        const working = state?.status === 'working'
        const status: 'working' | 'errored' | 'completed' = working
          ? 'working'
          : errored
            ? 'errored'
            : 'completed'
        return {
          id: c.id,
          sessionId: c.sessionId,
          title: sanitizeTitle(c.title || 'New task'),
          updatedAt: c.updatedAt || c.createdAt,
          status,
        }
      })
      .filter((r) =>
        query.trim() === '' ? true : r.title.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [allConversations, activeProjectId, query, sessionStates])

  const handleOpen = (id: string) => {
    switchConversation(id)
    setActiveView('chat')
  }

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const startEdit = (id: string, currentTitle: string) => {
    cancelEditRef.current = false
    setEditingId(id)
    setEditingValue(currentTitle)
  }

  const cancelEdit = () => {
    cancelEditRef.current = true
    setEditingId(null)
    setEditingValue('')
  }

  const commitEdit = () => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      return
    }
    const id = editingId
    if (!id) return
    const trimmed = editingValue.trim()
    const original = rows.find((r) => r.id === id)?.title
    if (trimmed && trimmed !== original) {
      // Optimistic local update + WebSocket persist to the server.
      renameConversation(id, trimmed)
    }
    setEditingId(null)
    setEditingValue('')
  }

  const startNewTask = (text: string, attachments?: ChatImageAttachment[]) => {
    const sessionId = `sess_${Date.now().toString(36)}`
    const ps = projectStore.getState()
    const projectId = ps.projects.find((p) => p.isDefault)?.id ?? ps.activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    const ss = sessionStore.getState()
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    const store = useStore.getState()
    const conv = store.findConversationBySession(sessionId)
    if (!conv) return
    switchConversation(conv.id)
    store.addMessage({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    })
    const outbound = attachments?.flatMap((a) =>
      a.data
        ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
        : [],
    )
    sessionStore.getState().sendAiMessageToSession(text, sessionId, outbound)
    setActiveView('home')
  }

  return (
    <div className="tasks-view">
      <div className="tasks-view__head">
        <h1 className="tasks-view__title">All tasks</h1>
        <button
          type="button"
          className="tasks-view__icon-btn"
          onClick={() => setShowSearch((v) => !v)}
          aria-label="Search tasks"
          title="Search tasks"
        >
          <Search size={14} strokeWidth={1.5} />
        </button>
      </div>

      {showSearch && (
        <label className="tasks-search tasks-search--bar">
          <Search size={13} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      <div className="tasks-composer">
        <ChatInput
          onSend={startNewTask}
          onSkillSelect={() => {}}
          variant="hero"
          placeholder="Start a task"
          ignoreWorkingState
        />
      </div>

      <div className="tasks-list">
        {rows.length === 0 ? (
          <div className="tasks-empty">No tasks yet. Start one from the composer above.</div>
        ) : (
          rows.map((r) => {
            const working = r.status === 'working'
            const isEditing = editingId === r.id
            return (
              <div
                key={r.id}
                className={`tasks-row${working ? ' tasks-row--working' : ''}${isEditing ? ' tasks-row--editing' : ''}`}
              >
                {isEditing ? (
                  <div className="tasks-row__main tasks-row__main--editing">
                    <span className={`tasks-row__dot tasks-row__dot--${r.status}`} aria-hidden />
                    <input
                      ref={editInputRef}
                      type="text"
                      className="tasks-row__edit-input"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          editInputRef.current?.blur()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                      onBlur={commitEdit}
                      maxLength={120}
                      aria-label="Rename task"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="tasks-row__main"
                    onClick={() => handleOpen(r.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      startEdit(r.id, r.title)
                    }}
                  >
                    <span className={`tasks-row__dot tasks-row__dot--${r.status}`} aria-hidden />
                    <span className="tasks-row__title">{r.title}</span>
                    {working && (
                      <>
                        <span className="tasks-row__sep" aria-hidden>
                          ›
                        </span>
                        <span className="tasks-row__status">Running now</span>
                      </>
                    )}
                  </button>
                )}
                {!isEditing && (
                  <span className="tasks-row__time">{formatRelative(r.updatedAt)}</span>
                )}
                {!isEditing && (
                  <div className="tasks-row__actions">
                    {working && r.sessionId && (
                      <button
                        type="button"
                        className="tasks-row__action"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (r.sessionId) sendCancelTurn(r.sessionId)
                        }}
                        aria-label="Pause task"
                        title="Pause task"
                      >
                        <Pause size={14} strokeWidth={1.5} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="tasks-row__action"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEdit(r.id, r.title)
                      }}
                      aria-label="Rename task"
                      title="Rename task"
                    >
                      <Pencil size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className="tasks-row__action"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(r.id)
                      }}
                      aria-label="Delete task"
                      title="Delete task"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
