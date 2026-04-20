import type { InstalledWorkflow, RoutineSession } from '@anton/protocol'
import { Clock, Pause, Play, Zap } from 'lucide-react'
import { projectStore } from '../../lib/store/projectStore.js'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const absDiff = Math.abs(diff)
  const isFuture = diff < 0
  if (absDiff < 60_000) return isFuture ? 'in less than a minute' : 'just now'
  if (absDiff < 3600_000) {
    const mins = Math.floor(absDiff / 60_000)
    return isFuture ? `in ${mins}m` : `${mins}m ago`
  }
  if (absDiff < 86400_000) {
    const hours = Math.floor(absDiff / 3600_000)
    return isFuture ? `in ${hours}h` : `${hours}h ago`
  }
  const days = Math.floor(absDiff / 86400_000)
  return isFuture ? `in ${days}d` : `${days}d ago`
}

export function WorkflowStatusBanner({
  workflow,
  agent,
}: {
  workflow: InstalledWorkflow
  agent: RoutineSession | undefined
}) {
  const status = agent?.agent.status || 'idle'
  const lastRun = agent?.agent.lastRunAt
  const nextRun = agent?.agent.nextRunAt
  const runCount = agent?.agent.runCount || 0
  const schedule = agent?.agent.schedule?.cron

  const handleRunNow = () => {
    if (agent)
      projectStore.getState().sendRoutineAction(workflow.projectId, agent.sessionId, 'start')
  }
  const handlePause = () => {
    if (agent) {
      projectStore
        .getState()
        .sendRoutineAction(
          workflow.projectId,
          agent.sessionId,
          status === 'paused' ? 'resume' : 'pause',
        )
    }
  }

  const statusLabel =
    status === 'running'
      ? 'Running'
      : status === 'paused'
        ? 'Paused'
        : status === 'error'
          ? 'Error'
          : 'Active'
  const statusColor =
    status === 'running'
      ? 'text-amber-400'
      : status === 'paused'
        ? 'text-zinc-500'
        : status === 'error'
          ? 'text-red-400'
          : 'text-emerald-400'

  return (
    <div className="mx-0 mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Zap size={14} strokeWidth={1.5} className={statusColor} />
          <span className={`text-[12.5px] font-medium ${statusColor}`}>{statusLabel}</span>
          {schedule && <span className="text-[11.5px] text-zinc-600">· Runs every 2 hours</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunNow}
            disabled={status === 'running'}
            className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-zinc-200 disabled:opacity-40"
          >
            <Play size={12} strokeWidth={1.5} />
            Run Now
          </button>
          <button
            type="button"
            onClick={handlePause}
            className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-zinc-200"
          >
            <Pause size={12} strokeWidth={1.5} />
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
      {(lastRun || nextRun) && (
        <div className="mt-2.5 flex items-center gap-4 text-[11px] text-zinc-600">
          {lastRun && (
            <span className="flex items-center gap-1">
              <Clock size={11} strokeWidth={1.5} />
              Last run: {formatRelativeTime(lastRun)}
              {runCount > 0 && ` · ${runCount} runs total`}
            </span>
          )}
          {nextRun && status !== 'paused' && <span>Next: {formatRelativeTime(nextRun)}</span>}
        </div>
      )}
    </div>
  )
}
