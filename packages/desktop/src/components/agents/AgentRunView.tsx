import type { AgentRunLogEntry } from '@anton/protocol'
import { ArrowLeft, Loader2, Terminal } from 'lucide-react'
import { useEffect } from 'react'
import { formatAbsoluteTime, formatDuration } from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

interface RunInfo {
  startedAt: number
  completedAt: number | null
  status: 'success' | 'error' | 'timeout'
  durationMs?: number
  trigger: 'cron' | 'manual'
  runSessionId?: string
  error?: string
}

interface Props {
  agentSessionId: string
  projectId: string
  run: RunInfo
  onBack: () => void
}

function LogEntry({ log }: { log: AgentRunLogEntry }) {
  const roleLabel =
    log.role === 'tool_call' ? 'tool' : log.role === 'tool_result' ? 'result' : log.role

  return (
    <div className={`agent-run-log agent-run-log--${log.role}`}>
      <div className="agent-run-log__header">
        <span className={`agent-run-log__role agent-run-log__role--${log.role}`}>{roleLabel}</span>
        {log.toolName && <span className="agent-run-log__tool">{log.toolName}</span>}
        <span className="agent-run-log__time">{formatAbsoluteTime(log.ts)}</span>
      </div>
      <pre
        className={`agent-run-log__content${log.isError ? ' agent-run-log__content--error' : ''}`}
      >
        {log.isError ? `ERROR: ${log.content}` : log.content}
      </pre>
    </div>
  )
}

export function AgentRunView({ agentSessionId, projectId, run, onBack }: Props) {
  const agentRunLogs = projectStore((s) => s.agentRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.agentRunLogsLoading)

  useEffect(() => {
    if (!run.completedAt) return
    projectStore.setState({ agentRunLogs: null, agentRunLogsLoading: true })
    projectStore
      .getState()
      .getAgentRunLogs(projectId, agentSessionId, run.startedAt, run.completedAt, run.runSessionId)
  }, [projectId, agentSessionId, run.startedAt, run.completedAt, run.runSessionId])

  const isError = run.status === 'error'

  return (
    <div className="conv-panel">
      <div className="conv-panel__topbar">
        <button
          type="button"
          className="conv-panel__back"
          onClick={onBack}
          aria-label="Back to agent"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="conv-panel__title">
          <Terminal size={14} strokeWidth={1.5} />
          <span>Run at {formatAbsoluteTime(run.startedAt)}</span>
        </div>
        <div className="conv-panel__actions">
          <span className={`agent-run-view__status agent-run-view__status--${run.status}`}>
            {run.status}
          </span>
          {run.durationMs != null && (
            <span className="agent-run-view__duration">{formatDuration(run.durationMs)}</span>
          )}
          <span className={`agent-run-view__trigger agent-run-view__trigger--${run.trigger}`}>
            {run.trigger}
          </span>
        </div>
      </div>

      <div className="agent-run-view__body">
        {agentRunLogsLoading ? (
          <div className="agent-run-view__loading">
            <Loader2 size={20} strokeWidth={1.5} className="agent-run-view__spinner" />
            <span>Loading run logs...</span>
          </div>
        ) : !agentRunLogs?.length ? (
          <div className="agent-run-view__empty">
            {isError && run.error ? (
              <div className="agent-run-view__error-msg">
                <span className="agent-run-view__error-label">Error</span>
                <pre>{run.error}</pre>
              </div>
            ) : (
              <span>No logs found for this run.</span>
            )}
          </div>
        ) : (
          <div className="agent-run-view__logs">
            {agentRunLogs.map((log, i) => (
              <LogEntry key={`${log.ts}-${i}`} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
