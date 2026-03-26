import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../lib/store.js'
import type { GroupedItem } from './groupMessages.js'

interface Props {
  grouped: GroupedItem[]
}

export function TaskProgressBar({ grouped }: Props) {
  const agentStatus = useStore((s) => s.agentStatus)
  const agentStatusDetail = useStore((s) => s.agentStatusDetail)
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)

  // Timer
  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, startTime])

  if (agentStatus !== 'working') return null

  // Collect task sections for progress display
  const taskSections = useMemo(() => {
    return grouped
      .filter((item) => item.type === 'task_section')
      .map((item) => {
        if (item.type !== 'task_section') return null
        return { title: item.title, done: item.done }
      })
      .filter(Boolean) as { title: string; done: boolean }[]
  }, [grouped])

  // Also count actions groups that aren't in task sections
  const standaloneActions = useMemo(() => {
    return grouped.filter((item) => item.type === 'actions' || item.type === 'sub_agent')
  }, [grouped])

  const totalTasks = taskSections.length
  const doneTasks = taskSections.filter((t) => t.done).length

  // Current activity from status detail or last active task
  const currentActivity = agentStatusDetail
    || (taskSections.length > 0
      ? taskSections[taskSections.length - 1].title
      : standaloneActions.length > 0
        ? 'Working'
        : 'Thinking')

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60)
    const sec = s % 60
    return min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="task-progress-bar">
      <button
        type="button"
        className="task-progress-bar__main"
        onClick={() => totalTasks > 0 && setExpanded(!expanded)}
      >
        <div className="task-progress-bar__left">
          <Loader2 size={14} strokeWidth={1.5} className="actions-pill__spin" />
          <span className="task-progress-bar__task">{currentActivity}</span>
        </div>
        <div className="task-progress-bar__right">
          {totalTasks > 0 && (
            <span className="task-progress-bar__steps">
              {doneTasks}/{totalTasks}
            </span>
          )}
          {totalTasks > 0 && (
            expanded
              ? <ChevronDown size={14} strokeWidth={1.5} />
              : <ChevronUp size={14} strokeWidth={1.5} />
          )}
        </div>
      </button>

      {/* Expanded task checklist — Manus-style */}
      {expanded && totalTasks > 0 && (
        <div className="task-progress-bar__checklist">
          {taskSections.map((task, i) => (
            <div key={`${task.title}-${i}`} className="task-progress-bar__item">
              <span className={`task-progress-bar__item-check${task.done ? ' task-progress-bar__item-check--done' : ''}`}>
                {task.done ? (
                  <Check size={12} strokeWidth={2} />
                ) : (
                  <Loader2 size={12} strokeWidth={1.5} className="actions-pill__spin" />
                )}
              </span>
              <span className="task-progress-bar__item-text">{task.title}</span>
            </div>
          ))}
        </div>
      )}

      <div className="task-progress-bar__meta">
        <span className="task-progress-bar__time">{formatTime(elapsed)}</span>
        <span className="task-progress-bar__activity">{currentActivity}</span>
      </div>
    </div>
  )
}
