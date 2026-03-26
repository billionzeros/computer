import { AnimatePresence, motion } from 'framer-motion'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store.js'
import type { ToolAction } from './groupMessages.js'
import type { ChatMessage } from '../../lib/store.js'
import { toolIcons, getStepTitle } from './ActionsGroup.js'

interface Props {
  toolCallId: string
  task: string
  actions: ToolAction[]
  result: ChatMessage | null
  defaultExpanded?: boolean
}

export function SubAgentGroup({ toolCallId, task, actions, result, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const isPending = !result
  const isError = result?.isError
  const errorCount = actions.filter((a) => a.result?.isError).length

  useEffect(() => {
    if (defaultExpanded || isPending) setExpanded(true)
  }, [defaultExpanded, isPending])

  const taskPreview = task.length > 80 ? `${task.slice(0, 77)}...` : task

  let statusIcon: React.ReactNode
  if (isPending) {
    statusIcon = <Loader2 size={16} strokeWidth={1.5} className="actions-pill__spin" />
  } else if (isError) {
    statusIcon = <Circle size={16} strokeWidth={1.5} className="actions-pill__status--error" />
  } else {
    statusIcon = <Check size={16} strokeWidth={1.5} className="actions-pill__status--done" />
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="actions-group actions-group--sub-agent"
    >
      {/* Header */}
      <button
        type="button"
        className="actions-group__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="actions-group__status-icon">{statusIcon}</span>
        <span className="actions-group__header-text">{taskPreview}</span>
        {errorCount > 0 && (
          <span className="actions-group__error-badge">{errorCount} failed</span>
        )}
        {actions.length > 0 && (
          <span className="actions-group__count">
            {actions.length} step{actions.length !== 1 ? 's' : ''}
          </span>
        )}
        {expanded ? (
          <ChevronUp size={14} strokeWidth={1.5} className="actions-group__chevron" />
        ) : (
          <ChevronDown size={14} strokeWidth={1.5} className="actions-group__chevron" />
        )}
      </button>

      {/* Nested tool call pills */}
      <AnimatePresence>
        {expanded && actions.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="actions-group__pills">
              {actions.map((action) => {
                const toolName = action.call.toolName || 'unknown'
                const Icon = toolIcons[toolName] || Wrench
                const title = action.call.toolInput
                  ? getStepTitle(toolName, action.call.toolInput as Record<string, unknown>)
                  : toolName
                const isActionError = action.result?.isError
                const isActionPending = !action.result
                const isRowExpanded = expandedRowId === action.call.id

                return (
                  <div key={action.call.id} className="action-pill-wrap">
                    <button
                      type="button"
                      className={`action-pill${isActionError ? ' action-pill--error' : ''}${isActionPending ? ' action-pill--pending' : ''}`}
                      onClick={() =>
                        action.result && setExpandedRowId(isRowExpanded ? null : action.call.id)
                      }
                    >
                      <span className="action-pill__icon">
                        {isActionPending ? (
                          <Loader2 size={14} strokeWidth={1.5} className="actions-pill__spin" />
                        ) : (
                          <Icon size={14} strokeWidth={1.5} />
                        )}
                      </span>
                      <span className="action-pill__text">{title}</span>
                    </button>

                    <AnimatePresence>
                      {isRowExpanded && action.result && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.12 }}
                          style={{ overflow: 'hidden' }}
                        >
                          <pre className="action-pill__result">
                            {action.result.content}
                          </pre>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
