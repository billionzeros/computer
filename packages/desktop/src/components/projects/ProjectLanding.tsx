import { motion } from 'framer-motion'
import { ListChecks, Paperclip, Plus, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Project } from '@anton/protocol'
import type { SessionMeta } from '../../lib/store.js'
import { Skeleton } from '../Skeleton.js'
import { ModelSelector } from '../chat/ModelSelector.js'
import { ProjectConfigPanel } from './ProjectConfigPanel.js'
import { SessionCard } from './SessionCard.js'

interface Props {
  project: Project
  sessions: SessionMeta[]
  sessionsLoading: boolean
  onNewSession: (message?: string) => void
  onOpenSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onBack: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400_000) return 'Updated today'
  if (diff < 604800_000) return `Updated ${Math.floor(diff / 86400_000)}d ago`
  return `Updated ${d.toLocaleDateString()}`
}

export function ProjectLanding({
  project,
  sessions,
  sessionsLoading,
  onNewSession,
  onOpenSession,
  onDeleteSession,
  onBack,
}: Props) {
  const [inputValue, setInputValue] = useState('')
  const [planFirst, setPlanFirst] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const raw = inputValue.trim()
    const msg = planFirst && raw ? `[plan first] ${raw}` : raw
    if (msg) {
      onNewSession(msg)
      setInputValue('')
    } else {
      onNewSession()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="project-landing">
      {/* Main content area */}
      <div className="project-landing__main">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="project-landing__content"
        >
          {/* Project header */}
          <div className="project-landing__header">
            <button
              type="button"
              className="project-landing__back"
              onClick={onBack}
            >
              &larr; Projects
            </button>
            <div className="project-landing__title-row">
              <div
                className="project-landing__icon"
                style={{ backgroundColor: project.color }}
              >
                {project.icon}
              </div>
              <div className="project-landing__info">
                <h1 className="project-landing__name">{project.name}</h1>
                <span className="project-landing__meta">
                  {project.description && `${project.description} · `}
                  {formatDate(project.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Chat input — Manus-style */}
          <div className="project-landing__input-wrap">
            <textarea
              ref={inputRef}
              className="project-landing__input"
              placeholder="Tasks are independent for focus. Use project instructions and files for shared context."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
            />
            <div className="project-landing__input-toolbar">
              <div className="project-landing__input-toolbar-left">
                <button type="button" className="project-landing__toolbar-btn" aria-label="Add attachment">
                  <Plus size={18} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className={`project-landing__toolbar-btn${planFirst ? ' project-landing__toolbar-btn--active' : ''}`}
                  onClick={() => setPlanFirst(!planFirst)}
                  aria-label="Plan first"
                  title={planFirst ? 'Plan mode on' : 'Plan first'}
                >
                  <ListChecks size={18} strokeWidth={1.5} />
                </button>
              </div>
              <div className="project-landing__input-toolbar-right">
                <ModelSelector />
                <button
                  type="button"
                  className="project-landing__send-btn"
                  onClick={handleSubmit}
                  aria-label="Start session"
                >
                  <Send size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>

          {/* Sessions list */}
          <div className="project-landing__sessions">
            <div className="project-landing__sessions-header">
              <h3 className="project-landing__sessions-title">Sessions</h3>
              <span className="project-landing__sessions-hint">
                {sessions.length > 0
                  ? `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
                  : 'Your sessions stay private'}
              </span>
            </div>

            {sessionsLoading ? (
              <div className="project-landing__sessions-skeleton">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="session-card session-card--skeleton">
                    <div className="session-card__content">
                      <Skeleton width={`${60 + i * 10}%`} height={14} />
                      <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                        <Skeleton width={40} height={12} />
                        <Skeleton width={50} height={12} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : sessions.length > 0 ? (
              <div className="project-landing__sessions-list">
                {sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    sessionId={session.id}
                    title={session.title}
                    messageCount={session.messageCount}
                    lastActiveAt={session.lastActiveAt}
                    onClick={() => onOpenSession(session.id)}
                    onDelete={() => onDeleteSession(session.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="project-landing__sessions-empty">
                <Plus size={16} strokeWidth={1.5} />
                <span>Create a new session to get started</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Right config panel */}
      <div className="project-landing__config">
        <ProjectConfigPanel project={project} loading={sessionsLoading} />
      </div>
    </div>
  )
}
