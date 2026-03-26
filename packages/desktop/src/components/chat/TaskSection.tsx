import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  PanelRight,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../lib/store.js'
import { toolIcons, getStepTitle } from './ActionsGroup.js'
import type { ToolAction } from './groupMessages.js'

interface Props {
  title: string
  actions: ToolAction[]
  done: boolean
  defaultExpanded?: boolean
}

export function TaskSection({ title, actions, done, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const artifacts = useStore((s) => s.artifacts)
  const setActiveArtifact = useStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)

  const pendingCount = actions.filter((a) => !a.result).length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="task-section"
    >
      {/* Section header — like Manus */}
      <button
        type="button"
        className="task-section__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`task-section__check${done ? ' task-section__check--done' : ''}`}>
          {done ? (
            <Check size={14} strokeWidth={2} />
          ) : (
            <Loader2 size={14} strokeWidth={1.5} className="actions-pill__spin" />
          )}
        </span>
        <span className="task-section__title">{title}</span>
        {expanded ? (
          <ChevronUp size={14} strokeWidth={1.5} className="task-section__chevron" />
        ) : (
          <ChevronDown size={14} strokeWidth={1.5} className="task-section__chevron" />
        )}
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
            <div className="task-section__actions">
              {actions.map((action) => {
                const toolName = action.call.toolName || 'unknown'
                const Icon = toolIcons[toolName] || Wrench
                const stepTitle = action.call.toolInput
                  ? getStepTitle(toolName, action.call.toolInput as Record<string, unknown>)
                  : toolName
                const isError = action.result?.isError
                const isPending = !action.result
                const isRowExpanded = expandedRowId === action.call.id

                return (
                  <div key={action.call.id} className="action-pill-wrap">
                    <button
                      type="button"
                      className={`action-pill${isError ? ' action-pill--error' : ''}${isPending ? ' action-pill--pending' : ''}`}
                      onClick={() =>
                        action.result && setExpandedRowId(isRowExpanded ? null : action.call.id)
                      }
                    >
                      <span className="action-pill__icon">
                        {isPending ? (
                          <Loader2 size={14} strokeWidth={1.5} className="actions-pill__spin" />
                        ) : (
                          <Icon size={14} strokeWidth={1.5} />
                        )}
                      </span>
                      <span className="action-pill__text">{stepTitle}</span>
                      {(() => {
                        const artifact = artifacts.find((a) => a.toolCallId === action.call.id)
                        if (!artifact) return null
                        return (
                          <button
                            type="button"
                            className="action-pill__panel-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveArtifact(artifact.id)
                              setArtifactPanelOpen(true)
                            }}
                            aria-label="Open in panel"
                          >
                            <PanelRight size={14} strokeWidth={1.5} />
                          </button>
                        )
                      })()}
                    </button>

                    {/* Expanded result */}
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
