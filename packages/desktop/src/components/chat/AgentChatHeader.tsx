import type { AgentSession } from '@anton/protocol'
import { Calendar, Play, Square } from 'lucide-react'
import { cronToHuman } from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

interface Props {
  agent: AgentSession
}

export function AgentChatHeader({ agent }: Props) {
  const meta = agent.agent
  const isRunning = meta.status === 'running'
  const isError = meta.status === 'error'

  const statusLabel = isRunning ? 'Running' : isError ? 'Error' : 'Idle'

  return (
    <div className="agent-chat-header">
      <div className="agent-chat-header__left">
        <span
          className={`agent-chat-header__dot${isRunning ? ' agent-chat-header__dot--running' : isError ? ' agent-chat-header__dot--error' : ''}`}
        />
        <span className="agent-chat-header__name">{meta.name}</span>
        {meta.description && <span className="agent-chat-header__desc">{meta.description}</span>}
      </div>
      <div className="agent-chat-header__right">
        {meta.schedule?.cron && (
          <span className="agent-chat-header__schedule">
            <Calendar size={11} strokeWidth={1.5} />
            {cronToHuman(meta.schedule.cron)}
          </span>
        )}
        <span className={`agent-chat-header__status agent-chat-header__status--${meta.status}`}>
          {statusLabel}
        </span>
        <button
          type="button"
          className="agent-chat-header__action"
          onClick={() => {
            projectStore
              .getState()
              .sendAgentAction(agent.projectId, agent.sessionId, isRunning ? 'stop' : 'start')
          }}
          aria-label={isRunning ? 'Stop agent' : 'Run agent'}
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
