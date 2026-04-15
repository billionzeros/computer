import type { RoutineSession } from '@anton/protocol'
import { Calendar, Play, Square } from 'lucide-react'
import { cronToHuman } from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

interface Props {
  agent: RoutineSession
}

export function RoutineChatHeader({ agent }: Props) {
  const meta = agent.agent
  const isRunning = meta.status === 'running'
  const isError = meta.status === 'error'

  const statusLabel = isRunning ? 'Running' : isError ? 'Error' : 'Idle'

  return (
    <div className="routine-chat-header">
      <div className="routine-chat-header__left">
        <span
          className={`routine-chat-header__dot${isRunning ? ' routine-chat-header__dot--running' : isError ? ' routine-chat-header__dot--error' : ''}`}
        />
        <span className="routine-chat-header__name">{meta.name}</span>
        {meta.description && <span className="routine-chat-header__desc">{meta.description}</span>}
      </div>
      <div className="routine-chat-header__right">
        {meta.schedule?.cron && (
          <span className="routine-chat-header__schedule">
            <Calendar size={11} strokeWidth={1.5} />
            {cronToHuman(meta.schedule.cron)}
          </span>
        )}
        <span className={`routine-chat-header__status routine-chat-header__status--${meta.status}`}>
          {statusLabel}
        </span>
        <button
          type="button"
          className="routine-chat-header__action"
          onClick={() => {
            projectStore
              .getState()
              .sendRoutineAction(agent.projectId, agent.sessionId, isRunning ? 'stop' : 'start')
          }}
          aria-label={isRunning ? 'Stop routine' : 'Run routine'}
        >
          {isRunning ? (
            <Square size={13} strokeWidth={1.5} />
          ) : (
            <Play size={13} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  )
}
