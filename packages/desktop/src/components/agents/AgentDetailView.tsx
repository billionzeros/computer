import type { AgentRunLogEntry, AgentRunRecord } from '@anton/protocol'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  Loader2,
  MoreHorizontal,
  Play,
  Square,
  Terminal,
  Timer,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  cronToHuman,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
} from '../../lib/agent-utils.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { ChatInput } from '../chat/ChatInput.js'

// ── Run Logs Modal ─────────────────────────────────────────────────

function RunLogsModal({
  logs,
  loading,
  onClose,
}: { logs: AgentRunLogEntry[] | null; loading: boolean; onClose: () => void }) {
  return (
    <div
      className="run-logs-modal__backdrop"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="run-logs-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="run-logs-modal__header">
          <Terminal size={14} strokeWidth={1.5} />
          <span>Run Logs</span>
          <button type="button" className="run-logs-modal__close" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="run-logs-modal__body">
          {loading ? (
            <div className="run-logs-modal__loading">
              <Loader2 size={16} strokeWidth={1.5} className="run-logs-modal__spinner" />
              <span>Loading logs...</span>
            </div>
          ) : !logs?.length ? (
            <div className="run-logs-modal__empty">No logs found for this run</div>
          ) : (
            logs.map((log, i) => (
              <div
                key={`${log.ts}-${i}`}
                className={`run-logs-modal__entry run-logs-modal__entry--${log.role}`}
              >
                <span className="run-logs-modal__role">
                  {log.role === 'tool_call'
                    ? 'tool'
                    : log.role === 'tool_result'
                      ? 'result'
                      : log.role}
                </span>
                {log.toolName && <span className="run-logs-modal__tool-name">{log.toolName}</span>}
                <pre className="run-logs-modal__content">
                  {log.isError ? `ERROR: ${log.content}` : log.content}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Run Entry Row ──────────────────────────────────────────────────

function RunEntry({
  run,
  onViewLogs,
}: {
  run: AgentRunRecord
  onViewLogs: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isErr = run.status === 'error'
  const hasLogs = run.completedAt != null && run.durationMs != null && run.durationMs > 100

  return (
    <div className={`agent-run-entry${isErr ? ' agent-run-entry--error' : ''}`}>
      <button
        type="button"
        className="agent-run-entry__row"
        onClick={() => {
          if (hasLogs) {
            onViewLogs()
          } else if (isErr && run.error) {
            setExpanded(!expanded)
          }
        }}
        disabled={!hasLogs && (!isErr || !run.error)}
      >
        {isErr ? (
          <AlertCircle
            size={12}
            strokeWidth={1.5}
            className="agent-run-entry__icon agent-run-entry__icon--error"
          />
        ) : (
          <CheckCircle2
            size={12}
            strokeWidth={1.5}
            className="agent-run-entry__icon agent-run-entry__icon--success"
          />
        )}
        <span className="agent-run-entry__time">{formatAbsoluteTime(run.startedAt)}</span>
        <span className={`agent-run-entry__trigger agent-run-entry__trigger--${run.trigger}`}>
          {run.trigger}
        </span>
        {run.durationMs != null && (
          <span className="agent-run-entry__duration">{formatDuration(run.durationMs)}</span>
        )}
        {hasLogs && <Terminal size={10} strokeWidth={1.5} className="agent-run-entry__logs-icon" />}
      </button>
      {expanded && run.error && <div className="agent-run-entry__error">{run.error}</div>}
    </div>
  )
}

// ── Agent Detail View ──────────────────────────────────────────────

interface Props {
  agentId: string
  onBack: () => void
  onViewRun?: (run: AgentRunRecord) => void
}

export function AgentDetailView({ agentId, onBack, onViewRun }: Props) {
  const projectAgents = projectStore((s) => s.projectAgents)
  const agentRunLogs = projectStore((s) => s.agentRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.agentRunLogsLoading)
  const addMessage = useStore((s) => s.addMessage)

  const [showInstructions, setShowInstructions] = useState(false)
  const [showHistory, setShowHistory] = useState(true)
  const [showLogsModal, setShowLogsModal] = useState(false)

  const agent = projectAgents.find((a) => a.sessionId === agentId)

  const handleViewRunLogs = useCallback(
    (run: AgentRunRecord) => {
      if (!run.completedAt || !agent) return
      if (onViewRun) {
        onViewRun(run)
        return
      }
      projectStore.setState({ agentRunLogs: null, agentRunLogsLoading: true })
      setShowLogsModal(true)
      projectStore
        .getState()
        .getAgentRunLogs(
          agent.projectId,
          agent.sessionId,
          run.startedAt,
          run.completedAt,
          run.runSessionId,
        )
    },
    [agent, onViewRun],
  )

  const handleRunStop = useCallback(() => {
    if (!agent) return
    if (agent.agent.status === 'running') {
      projectStore.getState().agentAction(agent.projectId, agent.sessionId, 'stop')
    } else {
      projectStore.getState().agentAction(agent.projectId, agent.sessionId, 'start')
    }
  }, [agent])

  const handleSend = useCallback(
    async (text: string, _attachments: ChatImageAttachment[] = []) => {
      if (!agent) return
      // Send message to the agent's session
      addMessage({
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })
      sessionStore.getState().sendAiMessageToSession(text, agent.sessionId)
    },
    [agent, addMessage],
  )

  const handleSkillSelect = (_skill: Skill) => {}

  if (!agent) {
    return (
      <div className="conv-panel">
        <div className="conv-panel__topbar">
          <button type="button" className="conv-panel__back" onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.5} />
          </button>
          <div className="conv-panel__title">Agent not found</div>
        </div>
      </div>
    )
  }

  const meta = agent.agent
  const isRunning = meta.status === 'running'
  const isError = meta.status === 'error'

  return (
    <div className="conv-panel">
      {/* Top bar */}
      <div className="conv-panel__topbar">
        <button
          type="button"
          className="conv-panel__back"
          onClick={onBack}
          aria-label="Back to agents"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="conv-panel__title">{meta.name}</div>
        <div className="conv-panel__actions">
          <button
            type="button"
            className={`conv-panel__action-btn conv-panel__action-btn--label${isRunning ? ' conv-panel__action-btn--danger' : ''}`}
            onClick={handleRunStop}
            aria-label={isRunning ? 'Stop agent' : 'Run agent'}
          >
            {isRunning ? (
              <>
                <Square size={15} strokeWidth={1.5} />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play size={15} strokeWidth={1.5} />
                <span>Run</span>
              </>
            )}
          </button>
          <button type="button" className="conv-panel__action-btn" aria-label="More options">
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="agent-home">
        {/* Agent identity */}
        <div className="agent-home__identity">
          <div className="agent-home__status-row">
            <span
              className={`agent-home__dot${isRunning ? ' agent-home__dot--running' : isError ? ' agent-home__dot--error' : ''}`}
            />
            <span className="agent-home__status-text">
              {isRunning
                ? 'Running'
                : isError
                  ? 'Error'
                  : meta.schedule?.cron
                    ? 'Scheduled'
                    : 'Idle'}
            </span>
            {meta.schedule?.cron && (
              <span className="agent-home__schedule">
                <Calendar size={12} strokeWidth={1.5} />
                {cronToHuman(meta.schedule.cron)}
              </span>
            )}
          </div>
          {meta.description && <p className="agent-home__desc">{meta.description}</p>}
        </div>

        {/* Stats row */}
        <div className="agent-home__stats">
          <div className="agent-home__stat">
            <Clock size={13} strokeWidth={1.5} />
            <span>{meta.lastRunAt ? formatRelativeTime(meta.lastRunAt) : 'Never'}</span>
            <span className="agent-home__stat-label">last run</span>
          </div>
          <div className="agent-home__stat">
            <Calendar size={13} strokeWidth={1.5} />
            <span>{meta.nextRunAt ? formatRelativeTime(meta.nextRunAt) : 'Manual'}</span>
            <span className="agent-home__stat-label">next run</span>
          </div>
          <div className="agent-home__stat">
            <Hash size={13} strokeWidth={1.5} />
            <span>{meta.runCount}</span>
            <span className="agent-home__stat-label">runs</span>
          </div>
          <div className="agent-home__stat">
            <Zap size={13} strokeWidth={1.5} />
            <span>
              {meta.tokenBudget ? `${Math.round(meta.tokenBudget.usedThisMonth / 1000)}k` : '—'}
            </span>
            <span className="agent-home__stat-label">tokens</span>
          </div>
        </div>

        {/* Instructions (collapsible) */}
        {meta.instructions && (
          <div className="agent-home__section">
            <button
              type="button"
              className="agent-home__section-toggle"
              onClick={() => setShowInstructions(!showInstructions)}
            >
              <span>Instructions</span>
              {showInstructions ? (
                <ChevronUp size={14} strokeWidth={1.5} />
              ) : (
                <ChevronDown size={14} strokeWidth={1.5} />
              )}
            </button>
            {showInstructions && (
              <pre className="agent-home__instructions-body">{meta.instructions}</pre>
            )}
          </div>
        )}

        {/* Scheduler info */}
        {meta.schedule?.cron && (
          <div className="agent-home__scheduler">
            <div className="agent-home__scheduler-row">
              <Timer size={12} strokeWidth={1.5} />
              <code>{meta.schedule.cron}</code>
              <span
                className={`agent-home__scheduler-status agent-home__scheduler-status--${meta.status}`}
              >
                {meta.status}
              </span>
            </div>
          </div>
        )}

        {/* Run History */}
        <div className="agent-home__section">
          <button
            type="button"
            className="agent-home__section-toggle"
            onClick={() => setShowHistory(!showHistory)}
          >
            <span>Run History ({meta.runHistory?.length ?? 0})</span>
            {showHistory ? (
              <ChevronUp size={14} strokeWidth={1.5} />
            ) : (
              <ChevronDown size={14} strokeWidth={1.5} />
            )}
          </button>
          {showHistory && (
            <div className="agent-home__run-list">
              {!meta.runHistory?.length ? (
                <div className="agent-home__run-empty">
                  No runs yet. Click Run to trigger the first execution.
                </div>
              ) : (
                [...meta.runHistory]
                  .reverse()
                  .map((run) => (
                    <RunEntry
                      key={run.startedAt}
                      run={run}
                      onViewLogs={() => handleViewRunLogs(run)}
                    />
                  ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat input at bottom */}
      <div className="conv-panel__input">
        <ChatInput
          onSend={handleSend}
          onSkillSelect={handleSkillSelect}
          variant="minimal"
          placeholder="Chat with this agent..."
        />
      </div>

      {showLogsModal && (
        <RunLogsModal
          logs={agentRunLogs}
          loading={agentRunLogsLoading}
          onClose={() => setShowLogsModal(false)}
        />
      )}
    </div>
  )
}
