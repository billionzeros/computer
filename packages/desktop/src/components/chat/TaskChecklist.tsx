import type { TaskItem } from '@anton/protocol'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight, ListChecks, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface Props {
  tasks: TaskItem[]
}

export function TaskChecklist({ tasks }: Props) {
  const [expanded, setExpanded] = useState(true)

  if (tasks.length === 0) return null

  const completed = tasks.filter((t) => t.status === 'completed').length
  const total = tasks.length
  const inProgress = tasks.find((t) => t.status === 'in_progress')
  const allDone = completed === total

  // Truncate to show max 5 items when collapsed, with "+N more"
  const MAX_VISIBLE = 6
  const visibleTasks = expanded ? tasks : tasks.slice(0, MAX_VISIBLE)
  const hiddenCount = tasks.length - MAX_VISIBLE

  // Header label
  const headerLabel = inProgress
    ? inProgress.activeForm || 'Working on tasks'
    : allDone
      ? `Completed ${total} tasks`
      : `Task list (${completed}/${total})`

  return (
    <div className="task-checklist-v2">
      {/* Perplexity-style action header */}
      <button
        type="button"
        className="task-checklist-v2__header"
        onClick={() => setExpanded(!expanded)}
      >
        <ListChecks size={15} strokeWidth={1.5} className="task-checklist-v2__header-icon" />
        <span className="task-checklist-v2__header-label">{headerLabel}</span>
        {expanded ? (
          <ChevronDown size={14} strokeWidth={1.5} className="task-checklist-v2__chevron" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="task-checklist-v2__chevron" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="task-checklist-v2__body">
              {visibleTasks.map((task, i) => (
                <div
                  key={`${task.content}-${i}`}
                  className={`task-checklist-v2__item${task.status === 'in_progress' ? ' task-checklist-v2__item--active' : ''}`}
                >
                  <span className="task-checklist-v2__item-icon">
                    {task.status === 'completed' ? (
                      <span className="task-checklist-v2__icon--done">✓</span>
                    ) : task.status === 'in_progress' ? (
                      <Loader2
                        size={13}
                        strokeWidth={1.5}
                        className="task-checklist-v2__icon--progress"
                      />
                    ) : (
                      <span className="task-checklist-v2__icon--pending">○</span>
                    )}
                  </span>
                  <span
                    className={`task-checklist-v2__item-text task-checklist-v2__item-text--${task.status}`}
                  >
                    {task.status === 'in_progress' ? task.activeForm : task.content}
                  </span>
                </div>
              ))}
              {!expanded && hiddenCount > 0 && (
                <div className="task-checklist-v2__more">+{hiddenCount} more</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
