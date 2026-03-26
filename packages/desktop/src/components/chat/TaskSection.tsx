import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import { ToolTreeItem } from './ActionsGroup.js'
import type { ToolAction } from './groupMessages.js'

interface Props {
  title: string
  actions: ToolAction[]
  done: boolean
  defaultExpanded?: boolean
}

export function TaskSection({ title, actions, done, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="tool-tree"
    >
      {/* Section header */}
      <button
        type="button"
        className="tool-tree__header"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown size={14} strokeWidth={1.5} className="tool-tree__chevron" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="tool-tree__chevron" />
        )}
        <span className="tool-tree__status-icon">
          {done ? (
            <Check size={14} strokeWidth={1.5} className="tool-tree__status--done" />
          ) : (
            <Loader2 size={14} strokeWidth={1.5} className="tool-tree__spinner" />
          )}
        </span>
        <span className="tool-tree__header-text">{title}</span>
      </button>

      {/* Nested tool actions */}
      <AnimatePresence>
        {expanded && actions.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="tool-tree__items">
              {actions.map((action, i) => (
                <ToolTreeItem
                  key={action.call.id}
                  action={action}
                  isLast={i === actions.length - 1}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
