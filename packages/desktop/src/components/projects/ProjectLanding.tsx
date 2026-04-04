import type { AgentSession } from '@anton/protocol'
import type { Project } from '@anton/protocol'
import { motion } from 'framer-motion'
import { Bot, ListChecks, MoreHorizontal, Play, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cronToHuman, formatRelativeTime } from '../../lib/agent-utils.js'
import type { SessionMeta } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { Skeleton } from '../Skeleton.js'
import { ConnectorBanner, ConnectorPill } from '../chat/ConnectorToolbar.js'
import { ModelSelector } from '../chat/ModelSelector.js'
import { WorkflowStatusBanner } from '../workflows/WorkflowStatusBanner.js'
import { ProjectConfigPanel } from './ProjectConfigPanel.js'
import { SessionCard } from './SessionCard.js'

interface Props {
  project: Project
  sessions: SessionMeta[]
  sessionsLoading: boolean
  onNewSession: (message?: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenAgent: (agentSessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onBack: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────

// ── Description with 3-line clamp, bottom blur, and "show more" on hover ──

function DescriptionClamp({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight)
  }, [text])

  return (
    <div
      className={`project-landing__desc-wrap${clamped && !expanded ? ' project-landing__desc-wrap--clamped' : ''}`}
      onMouseEnter={() => clamped && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <p
        ref={ref}
        className={`project-landing__desc${expanded ? '' : ' project-landing__desc--clamp'}`}
      >
        {text}
      </p>
      {clamped && !expanded && <span className="project-landing__desc-more">Show more</span>}
    </div>
  )
}

// ── Agent Card (clickable — opens conversation) ─────────────────────

function AgentCard({
  agent,
  projectId,
  onOpenAgent,
}: {
  agent: AgentSession
  projectId: string
  onOpenAgent: (agentSessionId: string) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const isRunning = agent.agent.status === 'running'
  const isError = agent.agent.status === 'error'
  const isPaused = agent.agent.status === 'paused'

  const hasSchedule = !!agent.agent.schedule?.cron
  const statusLabel = isRunning
    ? 'Running'
    : isError
      ? 'Error'
      : isPaused
        ? 'Paused'
        : hasSchedule
          ? 'Scheduled'
          : 'Idle'

  const metaParts: string[] = []
  if (hasSchedule) metaParts.push(cronToHuman(agent.agent.schedule!.cron))
  metaParts.push(statusLabel)
  if (!isRunning && agent.agent.lastRunAt) metaParts.push(formatRelativeTime(agent.agent.lastRunAt))

  return (
    <button
      type="button"
      className={`agent-row${isRunning ? ' agent-row--running' : ''}`}
      onClick={() => onOpenAgent(agent.sessionId)}
    >
      <div className="agent-row__content">
        <div className="agent-row__name-row">
          <span
            className={`agent-row__dot${isRunning ? ' agent-row__dot--running' : isError ? ' agent-row__dot--error' : ''}`}
          />
          <span className="agent-row__name">{agent.agent.name}</span>
        </div>
        <span className="agent-row__meta-text">{metaParts.join('  ·  ')}</span>
      </div>

      <div className="agent-row__actions">
        {isRunning ? (
          <button
            type="button"
            className="agent-row__icon-btn agent-row__icon-btn--visible"
            onClick={(e) => {
              e.stopPropagation()
              projectStore.getState().agentAction(projectId, agent.sessionId, 'stop')
            }}
            aria-label="Stop agent"
          >
            <Square size={14} strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            className="agent-row__icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              projectStore.getState().agentAction(projectId, agent.sessionId, 'start')
            }}
            aria-label="Run agent"
          >
            <Play size={14} strokeWidth={1.5} />
          </button>
        )}

        <button
          type="button"
          className="agent-row__icon-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          aria-label="Agent options"
        >
          <MoreHorizontal size={14} strokeWidth={1.5} />
        </button>

        {showMenu && (
          <>
            <div
              className="agent-row__menu-backdrop"
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(false)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setShowMenu(false)
              }}
            />
            <div className="agent-row__menu">
              <button
                type="button"
                className="agent-row__menu-item agent-row__menu-item--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  projectStore.getState().agentAction(projectId, agent.sessionId, 'delete')
                  setShowMenu(false)
                }}
              >
                <Trash2 size={14} strokeWidth={1.5} />
                <span>Delete</span>
              </button>
            </div>
          </>
        )}
      </div>
    </button>
  )
}

// ── Sessions + Agents sections ───────────────────────────────────────

function SessionsAndAgents({
  sessions,
  sessionsLoading,
  projectId,
  onOpenSession,
  onOpenAgent,
  onDeleteSession,
}: {
  sessions: SessionMeta[]
  sessionsLoading: boolean
  projectId: string
  onOpenSession: (id: string) => void
  onOpenAgent: (agentSessionId: string) => void
  onDeleteSession: (id: string) => void
}) {
  const agents = projectStore((s) => s.projectAgents)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const runningCount = agents.filter((a) => a.agent.status === 'running').length

  // Fetch agents and workflows on mount, when projectId changes, and on reconnect
  useEffect(() => {
    if (connectionStatus === 'connected') {
      projectStore.getState().listAgents(projectId)
      projectStore.getState().listWorkflows(projectId)
    }
  }, [projectId, connectionStatus])

  return (
    <div className="project-landing__sections">
      {/* Recent sessions */}
      {(sessionsLoading || sessions.length > 0) && (
        <div className="project-landing__section">
          <div className="project-landing__section-header">
            <span className="project-landing__section-label">Recent</span>
            {sessions.length > 0 && (
              <span className="project-landing__section-count">{sessions.length}</span>
            )}
          </div>
          {sessionsLoading ? (
            <div className="project-landing__sessions-skeleton">
              {[
                { id: 'skel-1', w: '60%' },
                { id: 'skel-2', w: '70%' },
              ].map((skel) => (
                <div key={skel.id} className="session-card session-card--skeleton">
                  <div className="session-card__content">
                    <Skeleton width={skel.w} height={14} />
                    <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                      <Skeleton width={40} height={12} />
                      <Skeleton width={50} height={12} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
          )}
        </div>
      )}

      {/* Agents */}
      {agents.length > 0 ? (
        <div className="project-landing__section">
          <div className="project-landing__section-header">
            <span className="project-landing__section-label">Agents</span>
            <span
              className={`project-landing__section-count${runningCount > 0 ? ' project-landing__section-count--active' : ''}`}
            >
              {agents.length}
            </span>
          </div>
          <div className="project-landing__agents-list">
            {agents.map((agent) => (
              <AgentCard
                key={agent.sessionId}
                agent={agent}
                projectId={projectId}
                onOpenAgent={onOpenAgent}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="project-landing__agent-hint">
          <Bot size={14} strokeWidth={1.5} />
          <span>Automate tasks with agents</span>
        </div>
      )}
    </div>
  )
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
  onOpenAgent,
  onDeleteSession,
  onBack,
}: Props) {
  const [inputValue, setInputValue] = useState('')
  const [planFirst, setPlanFirst] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const projectWorkflows = projectStore((s) => s.projectWorkflows)
  const projectAgents = projectStore((s) => s.projectAgents)
  const activeWorkflow = projectWorkflows.find((w) => w.projectId === project.id)
  const workflowAgent = activeWorkflow
    ? projectAgents.find((a) => a.sessionId === activeWorkflow.agentSessionId)
    : undefined

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
            <button type="button" className="project-landing__back" onClick={onBack}>
              &larr; Projects
            </button>
            <div className="project-landing__title-row">
              <div className="project-landing__icon" style={{ backgroundColor: project.color }}>
                {project.icon}
              </div>
              <div className="project-landing__info">
                <h1 className="project-landing__name">{project.name}</h1>
                {project.description && <DescriptionClamp text={project.description} />}
                <span className="project-landing__meta">{formatDate(project.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* Workflow status banner (if this is a workflow project) */}
          {activeWorkflow && (
            <WorkflowStatusBanner workflow={activeWorkflow} agent={workflowAgent} />
          )}

          {/* Chat input — Manus-style */}
          <div className="project-landing__input-wrap">
            <textarea
              ref={inputRef}
              className="project-landing__input"
              placeholder="What would you like to work on?"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
            />
            <div className="project-landing__input-toolbar">
              <div className="project-landing__input-toolbar-left">
                <button
                  type="button"
                  className="project-landing__toolbar-btn"
                  aria-label="Add attachment"
                  data-tooltip="Attach images"
                >
                  <Plus size={18} strokeWidth={1.5} />
                </button>
                <ConnectorPill />
                <button
                  type="button"
                  className={`project-landing__toolbar-btn${planFirst ? ' project-landing__toolbar-btn--active' : ''}`}
                  onClick={() => setPlanFirst(!planFirst)}
                  aria-label="Plan first"
                  data-tooltip={planFirst ? 'Plan mode on' : 'Plan first'}
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
                  data-tooltip="Start session"
                >
                  <Send size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
          <ConnectorBanner />

          {/* Sessions / Agents tabs */}
          <SessionsAndAgents
            sessions={sessions}
            sessionsLoading={sessionsLoading}
            projectId={project.id}
            onOpenSession={onOpenSession}
            onOpenAgent={onOpenAgent}
            onDeleteSession={onDeleteSession}
          />
        </motion.div>
      </div>

      {/* Right config panel */}
      <div className="project-landing__config">
        <ProjectConfigPanel project={project} loading={sessionsLoading} />
      </div>
    </div>
  )
}
