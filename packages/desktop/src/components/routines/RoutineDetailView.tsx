import type { RoutineRunLogEntry, RoutineRunRecord, RoutineSession } from '@anton/protocol'
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
}: { logs: RoutineRunLogEntry[] | null; loading: boolean; onClose: () => void }) {
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
  run: RoutineRunRecord
  onViewLogs: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isErr = run.status === 'error'
  const hasLogs = run.completedAt != null && run.durationMs != null && run.durationMs > 100

  return (
    <div className={`routine-run-entry${isErr ? ' routine-run-entry--error' : ''}`}>
      <button
        type="button"
        className="routine-run-entry__row"
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
            className="routine-run-entry__icon routine-run-entry__icon--error"
          />
        ) : (
          <CheckCircle2
            size={12}
            strokeWidth={1.5}
            className="routine-run-entry__icon routine-run-entry__icon--success"
          />
        )}
        <span className="routine-run-entry__time">{formatAbsoluteTime(run.startedAt)}</span>
        <span className={`routine-run-entry__trigger routine-run-entry__trigger--${run.trigger}`}>
          {run.trigger}
        </span>
        {run.durationMs != null && (
          <span className="routine-run-entry__duration">{formatDuration(run.durationMs)}</span>
        )}
        {hasLogs && <Terminal size={10} strokeWidth={1.5} className="routine-run-entry__logs-icon" />}
      </button>
      {expanded && run.error && <div className="routine-run-entry__error">{run.error}</div>}
    </div>
  )
}

// ── Agent Detail View ──────────────────────────────────────────────

interface Props {
  agentId: string
  onBack: () => void
  onViewRun?: (run: RoutineRunRecord) => void
}

export function RoutineDetailView({ agentId, onBack, onViewRun }: Props) {
  const projectAgents = projectStore((s) => s.projectRoutines)
  const agentRunLogs = projectStore((s) => s.routineRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.routineRunLogsLoading)
  const addMessage = useStore((s) => s.addMessage)

  const [showInstructions, setShowInstructions] = useState(false)
  const [showHistory, setShowHistory] = useState(true)
  const [showLogsModal, setShowLogsModal] = useState(false)

  const agent = projectAgents.find((a: RoutineSession) => a.sessionId === agentId)

  const handleViewRunLogs = useCallback(
    (run: RoutineRunRecord) => {
      if (!run.completedAt || !agent) return
      if (onViewRun) {
        onViewRun(run)
        return
      }
      projectStore.setState({ routineRunLogs: null, routineRunLogsLoading: true })
      setShowLogsModal(true)
      projectStore
        .getState()
        .getRoutineRunLogs(
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
      projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'stop')
    } else {
      projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'start')
    }
  }, [agent])

  const handleSend = useCallback(
    async (text: string, attachments: ChatImageAttachment[] = []) => {
      if (!agent) return
      const outboundAttachments = attachments.flatMap((a) =>
        a.data
          ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
          : [],
      )
      addMessage({
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: Date.now(),
      })
      sessionStore.getState().sendAiMessageToSession(text, agent.sessionId, outboundAttachments)
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
          <div className="conv-panel__title">Routine not found</div>
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
          aria-label="Back to routines"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="conv-panel__title">{meta.name}</div>
        <div className="conv-panel__actions">
          <button
            type="button"
            className={`conv-panel__action-btn conv-panel__action-btn--label${isRunning ? ' conv-panel__action-btn--danger' : ''}`}
            onClick={handleRunStop}
            aria-label={isRunning ? 'Stop routine' : 'Run routine'}
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
      <div className="routine-home">
        {/* Agent identity */}
        <div className="routine-home__identity">
          <div className="routine-home__status-row">
            <span
              className={`routine-home__dot${isRunning ? ' routine-home__dot--running' : isError ? ' routine-home__dot--error' : ''}`}
            />
            <span className="routine-home__status-text">
              {isRunning
                ? 'Running'
                : isError
                  ? 'Error'
                  : meta.schedule?.cron
                    ? 'Scheduled'
                    : 'Idle'}
            </span>
            {meta.schedule?.cron && (
              <span className="routine-home__schedule">
                <Calendar size={12} strokeWidth={1.5} />
                {cronToHuman(meta.schedule.cron)}
              </span>
            )}
          </div>
          {meta.description && <p className="routine-home__desc">{meta.description}</p>}
        </div>

        {/* Stats row */}
        <div className="routine-home__stats">
          <div className="routine-home__stat">
            <Clock size={13} strokeWidth={1.5} />
            <span>{meta.lastRunAt ? formatRelativeTime(meta.lastRunAt) : 'Never'}</span>
            <span className="routine-home__stat-label">last run</span>
          </div>
          <div className="routine-home__stat">
            <Calendar size={13} strokeWidth={1.5} />
            <span>{meta.nextRunAt ? formatRelativeTime(meta.nextRunAt) : 'Manual'}</span>
            <span className="routine-home__stat-label">next run</span>
          </div>
          <div className="routine-home__stat">
            <Hash size={13} strokeWidth={1.5} />
            <span>{meta.runCount}</span>
            <span className="routine-home__stat-label">runs</span>
          </div>
          <div className="routine-home__stat">
            <Zap size={13} strokeWidth={1.5} />
            <span>
              {meta.tokenBudget ? `${Math.round(meta.tokenBudget.usedThisMonth / 1000)}k` : '—'}
            </span>
            <span className="routine-home__stat-label">tokens</span>
          </div>
        </div>

        {/* Instructions (collapsible) */}
        {meta.instructions && (
          <div className="routine-home__section">
            <button
              type="button"
              className="routine-home__section-toggle"
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
              <pre className="routine-home__instructions-body">{meta.instructions}</pre>
            )}
          </div>
        )}

        {/* Run History */}
        <div className="routine-home__section">
          <button
            type="button"
            className="routine-home__section-toggle"
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
            <div className="routine-home__run-list">
              {!meta.runHistory?.length ? (
                <div className="routine-home__run-empty">
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
          placeholder="Chat with this routine..."
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
