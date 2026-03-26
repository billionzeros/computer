import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../lib/store.js'
import type { GroupedItem } from './groupMessages.js'

const VIBES = [
  'Thinking',
  'Computing',
  'Cerebrating',
  'Antoning',
  'Cooking',
  'Conjuring',
  'Pondering',
  'Manifesting',
  'Brewing',
  'Assembling',
  'Weaving',
  'Forging',
  'Composing',
  'Dreaming',
  'Sculpting',
  'Channeling',
]

function pickVibe(prev: string): string {
  const pool = VIBES.filter((v) => v !== prev)
  return pool[Math.floor(Math.random() * pool.length)]
}

function SparkStar({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className="thinking-indicator__star"
    >
      <path d="M8 0l1.8 5.2L16 8l-6.2 2.8L8 16l-1.8-5.2L0 8l6.2-2.8z" />
    </svg>
  )
}

interface Props {
  grouped: GroupedItem[]
}

export function TaskProgressBar({ grouped }: Props) {
  const agentStatus = useStore((s) => s.agentStatus)
  const currentTasks = useStore((s) => s.currentTasks)
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const [vibe, setVibe] = useState(() => pickVibe(''))

  // Timer
  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, startTime])

  // Always rotate vibe words — task info lives in the checklist above
  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setVibe((prev) => pickVibe(prev))
    }, 3000)
    return () => clearInterval(interval)
  }, [agentStatus])

  if (agentStatus !== 'working') return null

  // Collect task sections for progress display (from heuristic grouping)
  const taskSections = useMemo(() => {
    return grouped
      .filter((item) => item.type === 'task_section')
      .map((item) => {
        if (item.type !== 'task_section') return null
        return { title: item.title, done: item.done }
      })
      .filter(Boolean) as { title: string; done: boolean }[]
  }, [grouped])

  // Use task_tracker tasks if available, otherwise fall back to heuristic task sections
  const hasTrackerTasks = currentTasks.length > 0
  const totalTasks = hasTrackerTasks ? currentTasks.length : taskSections.length
  const doneTasks = hasTrackerTasks
    ? currentTasks.filter((t) => t.status === 'completed').length
    : taskSections.filter((t) => t.done).length

  // Always show fun vibe words — task-specific info is in the checklist
  const displayText = `${vibe}...`

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
          <SparkStar size={14} />
          <AnimatePresence mode="wait">
            <motion.span
              key={displayText}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="task-progress-bar__task task-progress-bar__task--vibe"
            >
              {displayText}
            </motion.span>
          </AnimatePresence>
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

      {/* Expanded task checklist */}
      {expanded && totalTasks > 0 && (
        <div className="task-progress-bar__checklist">
          {hasTrackerTasks
            ? currentTasks.map((task, i) => (
              <div key={`${task.content}-${i}`} className="task-progress-bar__item">
                <span className={`task-progress-bar__item-check${task.status === 'completed' ? ' task-progress-bar__item-check--done' : ''}`}>
                  {task.status === 'completed' ? (
                    <Check size={12} strokeWidth={2} />
                  ) : task.status === 'in_progress' ? (
                    <Loader2 size={12} strokeWidth={1.5} className="tool-tree__spinner" />
                  ) : (
                    <span className="task-progress-bar__item-dot" />
                  )}
                </span>
                <span className="task-progress-bar__item-text">
                  {task.status === 'in_progress' ? task.activeForm : task.content}
                </span>
              </div>
            ))
            : taskSections.map((task, i) => (
              <div key={`${task.title}-${i}`} className="task-progress-bar__item">
                <span className={`task-progress-bar__item-check${task.done ? ' task-progress-bar__item-check--done' : ''}`}>
                  {task.done ? (
                    <Check size={12} strokeWidth={2} />
                  ) : (
                    <Loader2 size={12} strokeWidth={1.5} className="tool-tree__spinner" />
                  )}
                </span>
                <span className="task-progress-bar__item-text">{task.title}</span>
              </div>
            ))
          }
        </div>
      )}

      <div className="task-progress-bar__meta">
        <span className="task-progress-bar__time">{formatTime(elapsed)}</span>
      </div>
    </div>
  )
}
