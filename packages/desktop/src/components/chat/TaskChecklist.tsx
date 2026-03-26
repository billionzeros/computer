import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, Circle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { TaskItem } from '@anton/protocol'

interface Props {
  tasks: TaskItem[]
}

export function TaskChecklist({ tasks }: Props) {
  const [expanded, setExpanded] = useState(true)

  if (tasks.length === 0) return null

  const completed = tasks.filter((t) => t.status === 'completed').length
  const total = tasks.length
  const allDone = completed === total

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="task-checklist"
    >
      <button
        type="button"
        className="task-checklist__header"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown size={14} strokeWidth={1.5} className="task-checklist__chevron" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="task-checklist__chevron" />
        )}
        <span className="task-checklist__title">
          {allDone ? 'Completed' : 'Working'}
        </span>
        <span className="task-checklist__count">
          {completed}/{total}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="task-checklist__items">
              {tasks.map((task, i) => (
                <div
                  key={`${task.content}-${i}`}
                  className={`task-checklist__item${task.status === 'in_progress' ? ' task-checklist__item--active' : ''}`}
                >
                  <span className="task-checklist__item-icon">
                    {task.status === 'completed' ? (
                      <Check size={14} strokeWidth={2} className="task-checklist__icon--done" />
                    ) : task.status === 'in_progress' ? (
                      <Loader2 size={14} strokeWidth={1.5} className="tool-tree__spinner" />
                    ) : (
                      <Circle size={10} strokeWidth={1.5} className="task-checklist__icon--pending" />
                    )}
                  </span>
                  <span className={`task-checklist__item-text task-checklist__item-text--${task.status}`}>
                    {task.status === 'in_progress' ? task.activeForm : task.content}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
