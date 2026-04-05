import type { AgentRunLogEntry, AgentRunRecord, AgentSession } from '@anton/protocol'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  Loader2,
  Play,
  Square,
  Terminal,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import {
  cronToHuman,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
} from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

interface Props {
  agent: AgentSession
}

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

function RunEntry({ run, onViewLogs }: { run: AgentRunRecord; onViewLogs: () => void }) {
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

export function AgentEmptyState({ agent }: Props) {
  const [showInstructions, setShowInstructions] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const agentRunLogs = projectStore((s) => s.agentRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.agentRunLogsLoading)
  const meta = agent.agent
  const isRunning = meta.status === 'running'
  const isError = meta.status === 'error'

  const handleViewRunLogs = (run: AgentRunRecord) => {
    if (!run.completedAt) return
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
  }

  const handleRunStop = () => {
    if (isRunning) {
      projectStore.getState().agentAction(agent.projectId, agent.sessionId, 'stop')
    } else {
      projectStore.getState().agentAction(agent.projectId, agent.sessionId, 'start')
    }
  }

  return (
    <div className="agent-empty-state">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="agent-empty-state__inner"
      >
        {/* Identity */}
        <div className="agent-empty-state__identity">
          <div className="agent-empty-state__name-row">
            <span
              className={`agent-empty-state__dot${isRunning ? ' agent-empty-state__dot--running' : isError ? ' agent-empty-state__dot--error' : ''}`}
            />
            <h2 className="agent-empty-state__name">{meta.name}</h2>
          </div>
          {meta.description && <p className="agent-empty-state__description">{meta.description}</p>}
          {meta.schedule?.cron && (
            <span className="agent-empty-state__schedule">
              <Calendar size={12} strokeWidth={1.5} />
              {cronToHuman(meta.schedule.cron)}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="agent-empty-state__stats">
          <div className="agent-empty-state__stat">
            <Clock size={14} strokeWidth={1.5} />
            <div className="agent-empty-state__stat-content">
              <span className="agent-empty-state__stat-value">
                {meta.lastRunAt ? formatRelativeTime(meta.lastRunAt) : 'Never'}
              </span>
              <span className="agent-empty-state__stat-label">Last run</span>
            </div>
          </div>
          <div className="agent-empty-state__stat">
            <Calendar size={14} strokeWidth={1.5} />
            <div className="agent-empty-state__stat-content">
              <span className="agent-empty-state__stat-value">
                {meta.nextRunAt ? formatRelativeTime(meta.nextRunAt) : 'Manual'}
              </span>
              <span className="agent-empty-state__stat-label">Next run</span>
            </div>
          </div>
          <div className="agent-empty-state__stat">
            <Hash size={14} strokeWidth={1.5} />
            <div className="agent-empty-state__stat-content">
              <span className="agent-empty-state__stat-value">{meta.runCount}</span>
              <span className="agent-empty-state__stat-label">Total runs</span>
            </div>
          </div>
          <div className="agent-empty-state__stat">
            <Zap size={14} strokeWidth={1.5} />
            <div className="agent-empty-state__stat-content">
              <span className="agent-empty-state__stat-value">
                {meta.tokenBudget
                  ? `${Math.round(meta.tokenBudget.usedThisMonth / 1000)}k`
                  : 'Unlimited'}
              </span>
              <span className="agent-empty-state__stat-label">Tokens used</span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        {meta.instructions && (
          <div className="agent-empty-state__instructions">
            <button
              type="button"
              className="agent-empty-state__instructions-toggle"
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
              <pre className="agent-empty-state__instructions-body">{meta.instructions}</pre>
            )}
          </div>
        )}

        {/* Run History */}
        <div className="agent-empty-state__run-history">
          <button
            type="button"
            className="agent-empty-state__instructions-toggle"
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
            <div className="agent-empty-state__run-list">
              {!meta.runHistory?.length ? (
                <div className="agent-empty-state__run-empty">No runs yet</div>
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

        {/* Actions */}
        <div className="agent-empty-state__actions">
          <button
            type="button"
            className={`agent-empty-state__run-btn${isRunning ? ' agent-empty-state__run-btn--stop' : ''}`}
            onClick={handleRunStop}
          >
            {isRunning ? (
              <>
                <Square size={14} strokeWidth={1.5} />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play size={14} strokeWidth={1.5} />
                <span>Run now</span>
              </>
            )}
          </button>
        </div>
      </motion.div>

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
