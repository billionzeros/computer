import type { RoutineSession } from '@anton/protocol'
import {
  Repeat,
  Calendar,
  GitPullRequest,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Shield,
  Trash2,
  Zap,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { formatRelativeTime } from '../../lib/agent-utils.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { ChatInput } from '../chat/ChatInput.js'

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

const STATUS_LABELS: Record<DisplayStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  error: 'Error',
  idle: 'Idle',
  scheduled: 'Scheduled',
}

function RoutineStatusIcon({ status }: { status: DisplayStatus }) {
  if (status === 'completed' || status === 'scheduled') {
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
  if (status === 'running') {
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
  return (
    <svg
      className="status-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="var(--text-subtle)" strokeWidth="1" opacity="0.4" />
    </svg>
  )
}

function RoutineMenu({ onDelete }: { onDelete: () => void }) {
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
  mode: 'full' | 'compact'
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RoutineListView({ mode, selectedId, onSelect }: Props) {
  const projectRoutines = projectStore((s) => s.projectRoutines)
  const projects = projectStore((s) => s.projects)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const setActiveView = useStore((s) => s.setActiveView)

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

  const handleNewRoutine = (text: string, attachments?: ChatImageAttachment[]) => {
    // Create a new conversation that will guide routine creation
    const store = useStore.getState()
    const sessionId = `sess_${Date.now().toString(36)}`
    const projectId = projectStore.getState().activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    const ss = sessionStore.getState()
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    const conv = store.findConversationBySession(sessionId)
    if (conv) {
      switchConversation(conv.id)
    }
    setActiveView('chat')
    const outboundAttachments = attachments?.flatMap((a) =>
      a.data
        ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
        : [],
    )
    requestAnimationFrame(() => {
      const conv = useStore.getState().findConversationBySession(sessionId)
      if (conv) {
        useStore.getState().switchConversation(conv.id)
        const prompt = `I want to create a routine: ${text}\n\nPlease help me set this up as a routine. Ask me any clarifying questions about what it should do, when it should run, and what tools/connectors it needs.`
        useStore.getState().addMessage({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          content: prompt,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
          timestamp: Date.now(),
        })
        sessionStore.getState().sendAiMessageToSession(prompt, sessionId, outboundAttachments)
      }
    })
  }

  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined)

  const handleSkillSelect = (_skill: Skill) => {}

  const ROUTINE_CARDS = [
    {
      icon: <GitPullRequest size={20} strokeWidth={1.5} />,
      title: 'Code review routine',
      description: 'Automatically review PRs, catch bugs, and suggest improvements before merge.',
      prompt:
        'Review my PRs every morning — catch bugs, suggest improvements, and flag any security issues before merge',
    },
    {
      icon: <Calendar size={20} strokeWidth={1.5} />,
      title: 'Scheduled reports',
      description:
        'Generate daily standups, weekly summaries, or custom reports on a cron schedule.',
      prompt:
        'Generate a daily standup summary every morning at 9am from my recent commits and open PRs',
    },
    {
      icon: <Shield size={20} strokeWidth={1.5} />,
      title: 'Security monitor',
      description: 'Scan dependencies for vulnerabilities and alert you when issues are found.',
      prompt:
        'Scan my dependencies daily for known vulnerabilities and alert me when new issues are found',
    },
    {
      icon: <Mail size={20} strokeWidth={1.5} />,
      title: 'Inbox triage',
      description:
        'Classify, prioritize, and draft responses for incoming messages and notifications.',
      prompt:
        'Triage my incoming messages — classify by priority, draft responses for routine ones, and flag anything urgent',
    },
    {
      icon: <Zap size={20} strokeWidth={1.5} />,
      title: 'CI/CD automation',
      description: 'Monitor builds, auto-fix linting errors, and keep your pipeline green.',
      prompt: 'Monitor my CI/CD pipeline — auto-fix linting errors and notify me when builds fail',
    },
    {
      icon: <MessageSquare size={20} strokeWidth={1.5} />,
      title: 'Customer support',
      description:
        'Answer common questions, route tickets, and escalate issues that need human attention.',
      prompt:
        'Answer common support questions, route tickets to the right team, and escalate issues that need human attention',
    },
  ]

  if (mode === 'full') {
    return (
      <div className="task-list-full">
        <div className="task-list-full__inner">
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

          {/* Hero input for creating new routines */}
          <div className="task-list-full__hero">
            <ChatInput
              onSend={handleNewRoutine}
              onSkillSelect={handleSkillSelect}
              variant="hero"
              placeholder="Describe a routine... e.g. 'Review my PRs every morning'"
              initialValue={prefillPrompt}
            />
          </div>

          <div className="task-table">
            <div className="task-table__header">
              <div className="task-table__col task-table__col--status">Status</div>
              <div className="task-table__col task-table__col--name">Routine</div>
              <div className="task-table__col task-table__col--project">Project</div>
              <div className="task-table__col task-table__col--updated">Last run</div>
              <div className="task-table__col task-table__col--actions" />
            </div>
            <div className="task-table__body">
              {filtered.length === 0 ? (
                <div className="task-table__empty">
                  <Repeat size={18} strokeWidth={1.5} style={{ opacity: 0.4 }} />
                  <span>No routines yet. Describe one above to get started.</span>
                </div>
              ) : (
                filtered.map((routine) => {
                  const status = getDisplayStatus(routine)
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: table row selection
                    <div
                      key={routine.sessionId}
                      className={`task-table__row${selectedId === routine.sessionId ? ' task-table__row--selected' : ''}`}
                      onClick={() => onSelect(routine.sessionId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="task-table__col task-table__col--status">
                        <RoutineStatusIcon status={status} />
                        <span
                          className={`task-table__status-label task-table__status-label--${status === 'running' ? 'working' : status === 'scheduled' ? 'completed' : status}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      <div className="task-table__col task-table__col--name task-table__col--clickable">
                        <span className="task-table__task-title">{routine.agent.name}</span>
                      </div>
                      <div className="task-table__col task-table__col--project">
                        <span className="routine-project-pill">
                          {projects.find((p) => p.id === routine.projectId)?.name || routine.projectId}
                        </span>
                      </div>
                      <div className="task-table__col task-table__col--updated">
                        {routine.agent.lastRunAt
                          ? formatRelativeTime(routine.agent.lastRunAt)
                          : 'Never'}
                      </div>
                      <div className="task-table__col task-table__col--actions">
                        <RoutineMenu onDelete={() => handleDelete(routine)} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Feature cards */}
          <div className="routine-features">
            <div className="routine-features__header">Try a routine template</div>
            <div className="routine-features__grid">
              {ROUTINE_CARDS.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  className="routine-features__card"
                  onClick={() => setPrefillPrompt(card.prompt)}
                >
                  <div className="routine-features__icon">{card.icon}</div>
                  <div className="routine-features__title">{card.title}</div>
                  <div className="routine-features__desc">{card.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Compact mode
  return (
    <div className="task-panel">
      <div className="task-panel__header">
        <h2 className="task-panel__title">Routines</h2>
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

      <div className="task-panel__list">
        {filtered.map((routine) => {
          const status = getDisplayStatus(routine)
          const projectName =
            projects.find((p) => p.id === routine.projectId)?.name || routine.projectId
          return (
            <div
              key={routine.sessionId}
              className={`task-row${selectedId === routine.sessionId ? ' task-row--active' : ''}`}
            >
              <button
                type="button"
                className="task-row__clickable"
                onClick={() => onSelect(routine.sessionId)}
              >
                <RoutineStatusIcon status={status} />
                <div className="task-row__content">
                  <span className="task-row__name">{routine.agent.name}</span>
                  <span className="task-row__detail">
                    <span
                      className={`task-row__status-label task-row__status-label--${status === 'running' ? 'working' : status === 'scheduled' ? 'completed' : status}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                    <span className="task-row__detail-sep">&middot;</span>
                    <span>{projectName}</span>
                  </span>
                </div>
                <span className="task-row__time">
                  {routine.agent.lastRunAt ? formatRelativeTime(routine.agent.lastRunAt) : 'Never'}
                </span>
              </button>
              <RoutineMenu onDelete={() => handleDelete(routine)} />
            </div>
          )
        })}
        {filtered.length === 0 && <div className="task-panel__empty">No routines yet</div>}
      </div>
    </div>
  )
}
