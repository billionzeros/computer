import type { RoutineRunLogEntry, RoutineRunRecord, RoutineSession } from '@anton/protocol'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  Folder,
  Loader2,
  Play,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  cronToHuman,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
} from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

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

// ── Routine Detail View ────────────────────────────────────────────

interface Props {
  agentId: string
  onBack: () => void
  onViewRun?: (run: RoutineRunRecord) => void
  onEdit?: () => void
  onToast?: (msg: string) => void
}

export function RoutineDetailView({ agentId, onBack, onViewRun, onEdit, onToast }: Props) {
  const projectAgents = projectStore((s) => s.projectRoutines)
  const agentRunLogs = projectStore((s) => s.routineRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.routineRunLogsLoading)

  const [showLogsModal, setShowLogsModal] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

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

  const handleRunNow = useCallback(() => {
    if (!agent) return
    projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'start')
  }, [agent])

  const handleStop = useCallback(() => {
    if (!agent) return
    projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'stop')
  }, [agent])

  const handleTogglePause = useCallback(() => {
    if (!agent) return
    const action = agent.agent.status === 'paused' ? 'resume' : 'pause'
    projectStore.getState().routineAction(agent.projectId, agent.sessionId, action)
  }, [agent])

  const handleDelete = useCallback(() => {
    if (!agent) return
    projectStore.getState().routineAction(agent.projectId, agent.sessionId, 'delete')
    onToast?.('Routine deleted')
    onBack()
  }, [agent, onBack, onToast])

  if (!agent) {
    return (
      <div className="rt-detail">
        <button type="button" className="conv-back" onClick={onBack}>
          <ChevronLeft size={14} strokeWidth={1.5} /> All routines
        </button>
        <div className="rt-head__title">Routine not found</div>
      </div>
    )
  }

  const meta = agent.agent
  const isRunning = meta.status === 'running'
  const isPaused = meta.status === 'paused'
  const hasCron = !!meta.schedule?.cron
  const active = !isPaused
  const scheduleLabel = meta.schedule?.cron ? cronToHuman(meta.schedule.cron) : 'Run on demand'
  const nextRunLabel = !active
    ? '—'
    : meta.nextRunAt
      ? formatRelativeTime(meta.nextRunAt)
      : scheduleLabel
  const recentRuns = meta.runHistory?.slice().reverse() ?? []
  const hasRuns = recentRuns.length > 0

  return (
    <div className="rt-detail">
      <button type="button" className="conv-back" onClick={onBack}>
        <ChevronLeft size={14} strokeWidth={1.5} /> All
      </button>

      <div className="rt-head">
        <div className="rt-head__text">
          <h1 className="rt-head__title">{meta.name}</h1>
          {meta.description && <div className="rt-head__blurb">{meta.description}</div>}
          <div className="rt-head__row">
            <button
              type="button"
              className={`rt-badge rt-badge--clickable ${active ? 'rt-badge--active' : 'rt-badge--paused'}`}
              onClick={handleTogglePause}
              title={active ? 'Pause this routine' : 'Resume this routine'}
            >
              <span className="rt-badge__dot" />
              {isRunning ? 'Running' : active ? 'Active' : 'Paused'}
            </button>
            <span className="rt-head__next">
              Next run: <strong>{nextRunLabel}</strong>
            </span>
          </div>
        </div>
        <div className="rt-head__actions">
          {onEdit && (
            <button type="button" className="btn btn--icon" title="Edit" onClick={onEdit}>
              <Edit3 size={14} strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            className="btn btn--icon rt-btn-danger"
            title="Delete"
            onClick={() => setConfirmDel(true)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
          {isRunning ? (
            <button
              type="button"
              className="btn btn--primary"
              style={{ fontSize: 12 }}
              onClick={handleStop}
            >
              <Square size={12} strokeWidth={1.5} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              style={{ fontSize: 12 }}
              onClick={handleRunNow}
            >
              <Play size={12} strokeWidth={1.5} /> Run now
            </button>
          )}
        </div>
      </div>

      {confirmDel && (
        <div className="rt-confirm">
          <div className="rt-confirm__text">
            Delete <strong>{meta.name}</strong>? This can't be undone.
          </div>
          <div className="rt-confirm__actions">
            <button type="button" className="btn" onClick={() => setConfirmDel(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn rt-btn-danger-solid"
              onClick={() => {
                setConfirmDel(false)
                handleDelete()
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {meta.instructions && (
        <div className="rt-field">
          <div className="rt-field__label">Instructions</div>
          <div className="rt-field__value rt-field__value--prose">{meta.instructions}</div>
        </div>
      )}

      <div className="rt-field">
        <div className="rt-field__label">Folder</div>
        <div className="rt-field__value rt-field__folder">
          <Folder size={13} strokeWidth={1.5} />
          <span>Project folder</span>
        </div>
      </div>

      <div className="rt-field">
        <div className="rt-field__label">Repeats</div>
        <div className="rt-field__value rt-field__repeats">
          <span className={`toggle${hasCron ? ' on' : ''}`} />
          <span>{scheduleLabel}</span>
        </div>
      </div>

      <div className="rt-field">
        <div className="rt-field__label">
          Always allowed <CheckCircle2 size={11} className="rt-field__label-icon" />
        </div>
        <div className="rt-field__value rt-field__value--muted">
          Approvals you grant during a run appear here.
        </div>
      </div>

      <div className="rt-field">
        <div className="rt-field__label">Recent runs {hasRuns ? `(${recentRuns.length})` : ''}</div>
        {hasRuns ? (
          <div className="rt-runs">
            {recentRuns.slice(0, 6).map((run) => {
              const isErr = run.status === 'error'
              return (
                <div key={`${run.startedAt}-${run.runSessionId ?? ''}`} className="rt-run">
                  <div className={`rt-run__status${isErr ? ' rt-run__status--error' : ''}`}>
                    {isErr ? (
                      <AlertCircle size={11} strokeWidth={1.5} />
                    ) : (
                      <CheckCircle2 size={11} strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="rt-run__body">
                    <div className="rt-run__title">{formatAbsoluteTime(run.startedAt)}</div>
                    <div className="rt-run__meta">
                      {run.trigger}
                      {run.durationMs != null && (
                        <>
                          {' · '}
                          {formatDuration(run.durationMs)}
                        </>
                      )}
                      {isErr && run.error && <> · {run.error}</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rt-run__open"
                    onClick={() => handleViewRunLogs(run)}
                    disabled={!run.completedAt}
                  >
                    View
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rt-runs-empty">
            Not run yet.{' '}
            <button type="button" className="rt-link" onClick={handleRunNow} disabled={isRunning}>
              {isRunning ? 'Running…' : 'Run it now'}
            </button>{' '}
            to see output here.
          </div>
        )}
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
