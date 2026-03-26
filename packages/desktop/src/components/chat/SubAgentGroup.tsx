import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ToolAction } from './groupMessages.js'
import type { ChatMessage } from '../../lib/store.js'
import { ToolTreeItem, getGroupHeader } from './ActionsGroup.js'

interface Props {
  toolCallId: string
  task: string
  actions: ToolAction[]
  result: ChatMessage | null
  defaultExpanded?: boolean
}

export function SubAgentGroup({ task, actions, result, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const isPending = !result
  const isError = result?.isError
  const errorCount = actions.filter((a) => a.result?.isError).length

  useEffect(() => {
    if (defaultExpanded || isPending) setExpanded(true)
  }, [defaultExpanded, isPending])

  const taskPreview = task.length > 80 ? `${task.slice(0, 77)}...` : task

  let statusIcon: React.ReactNode
  if (isPending) {
    statusIcon = <Loader2 size={14} strokeWidth={1.5} className="tool-tree__spinner" />
  } else if (isError) {
    statusIcon = <Circle size={14} strokeWidth={1.5} className="tool-tree__status--error" />
  } else {
    statusIcon = <Check size={14} strokeWidth={1.5} className="tool-tree__status--done" />
  }

  // Build summary: "Agent · Glob · 4 tool calls"
  const _actionsSummary = actions.length > 0 ? getGroupHeader(actions) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="tool-tree tool-tree--sub-agent"
    >
      {/* Header */}
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
        <span className="tool-tree__status-icon">{statusIcon}</span>
        <span className="tool-tree__header-text">{taskPreview}</span>
        {errorCount > 0 && (
          <span className="tool-tree__error-badge">{errorCount} failed</span>
        )}
        {actions.length > 0 && (
          <span className="tool-tree__count">
            {actions.length} step{actions.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Nested tool call tree */}
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
