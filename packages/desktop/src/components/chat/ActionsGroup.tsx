import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Clipboard,
  Clock,
  Code2,
  Cpu,
  Database,
  FileDiff,
  FolderOpen,
  GitBranch,
  Globe,
  Image,
  Layers,
  ListTodo,
  Loader2,
  PanelRight,
  Search,
  Send,
  Terminal,
  Wifi,
  Wrench,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { ArtifactCard } from './ArtifactCard.js'
import type { ToolAction } from './groupMessages.js'

// ── Tool icons & helpers ───────────────────────────────────────────

const toolIcons: Record<string, React.ElementType> = {
  shell: Terminal,
  filesystem: FolderOpen,
  browser: Globe,
  process: Cpu,
  network: Wifi,
  artifact: Layers,
  git: GitBranch,
  code_search: Search,
  http_api: Send,
  database: Database,
  memory: Brain,
  todo: ListTodo,
  clipboard: Clipboard,
  notification: Bell,
  image: Image,
  diff: FileDiff,
  sub_agent: Bot,
}

/** Generate a human-readable step title from tool call data */
function getStepTitle(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell': {
      const cmd = (toolInput.command as string) || ''
      if (cmd.startsWith('cd ') && cmd.includes('&&'))
        return cmd.split('&&')[1]?.trim().split(' ')[0] || 'Running command'
      if (cmd.startsWith('python')) return 'Running Python script'
      if (cmd.startsWith('node')) return 'Running Node.js script'
      if (cmd.startsWith('npm ') || cmd.startsWith('pnpm '))
        return `Running ${cmd.split(' ').slice(0, 3).join(' ')}`
      if (cmd.startsWith('git ')) return `Git ${cmd.split(' ')[1]}`
      if (cmd.startsWith('curl ') || cmd.startsWith('wget ')) return 'Making HTTP request'
      if (cmd.startsWith('ls ') || cmd === 'ls') return 'Listing directory'
      if (cmd.startsWith('mkdir ')) return 'Creating directory'
      if (cmd.startsWith('rm ')) return 'Removing files'
      if (cmd.startsWith('cp ')) return 'Copying files'
      if (cmd.startsWith('mv ')) return 'Moving files'
      if (cmd.startsWith('cat ')) return 'Reading file'
      if (cmd.startsWith('grep ') || cmd.startsWith('rg ')) return 'Searching files'
      if (cmd.includes('pkill') || cmd.includes('kill')) return 'Stopping process'
      return 'Running command'
    }
    case 'filesystem': {
      const op = toolInput.operation as string
      const path = toolInput.path as string
      const filename = path?.split('/').pop() || ''
      if (op === 'write') return `Writing ${filename}`
      if (op === 'read') return `Reading ${filename}`
      if (op === 'delete') return `Deleting ${filename}`
      if (op === 'mkdir') return 'Creating directory'
      return `${op || 'File'} operation`
    }
    case 'browser': {
      const op = toolInput.operation as string
      if (op === 'navigate') return 'Navigating to page'
      if (op === 'screenshot') return 'Taking screenshot'
      if (op === 'click') return 'Clicking element'
      if (op === 'type') return 'Typing text'
      return 'Browser action'
    }
    case 'network': {
      const url = (toolInput.url || toolInput.host || '') as string
      if (url) return `Fetching ${url.replace(/^https?:\/\//, '').split('/')[0]}`
      return 'Network request'
    }
    case 'artifact': {
      const title = (toolInput.title as string) || ''
      const artType = (toolInput.type as string) || 'content'
      return title ? `Creating "${title}"` : `Creating ${artType} artifact`
    }
    case 'git': {
      const op = (toolInput.operation as string) || ''
      const path = (toolInput.path as string) || ''
      if (op === 'commit') return 'Git commit'
      if (op === 'checkout' && path) return `Git checkout ${path}`
      if (op === 'branch' && path) return `Creating branch ${path}`
      return `Git ${op}`
    }
    case 'code_search': {
      const query = (toolInput.query as string) || ''
      return query ? `Searching for "${query.slice(0, 40)}"` : 'Searching code'
    }
    case 'http_api': {
      const method = (toolInput.method as string) || 'GET'
      const url = (toolInput.url as string) || ''
      try {
        const host = url ? new URL(url).hostname : ''
        return host ? `${method} ${host}` : `${method} request`
      } catch {
        return `${method} request`
      }
    }
    case 'database': {
      const op = (toolInput.operation as string) || ''
      return op === 'query' ? 'Running query' : op === 'execute' ? 'Executing SQL' : `Database ${op}`
    }
    case 'memory': {
      const op = (toolInput.operation as string) || ''
      const key = (toolInput.key as string) || ''
      if (op === 'save') return key ? `Saving memory "${key}"` : 'Saving memory'
      if (op === 'recall') return key ? `Recalling "${key}"` : 'Recalling memory'
      return `Memory ${op}`
    }
    case 'todo': {
      const op = (toolInput.operation as string) || ''
      if (op === 'add') return 'Adding task'
      if (op === 'complete') return 'Completing task'
      if (op === 'list') return 'Listing tasks'
      return `Todo ${op}`
    }
    case 'clipboard': {
      const op = (toolInput.operation as string) || ''
      return op === 'write' ? 'Copying to clipboard' : 'Reading clipboard'
    }
    case 'notification':
      return `Notifying: ${(toolInput.title as string)?.slice(0, 30) || 'alert'}`
    case 'image': {
      const op = (toolInput.operation as string) || ''
      if (op === 'screenshot') return 'Taking screenshot'
      if (op === 'resize') return 'Resizing image'
      if (op === 'convert') return 'Converting image'
      return `Image ${op}`
    }
    case 'diff': {
      const op = (toolInput.operation as string) || ''
      return op === 'patch' ? 'Applying patch' : 'Comparing files'
    }
    default:
      return toolName
  }
}

// ── Component ──────────────────────────────────────────────────────

interface Props {
  actions: ToolAction[]
  defaultExpanded?: boolean
}

export function ActionsGroup({ actions, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const artifacts = useStore((s) => s.artifacts)
  const setActiveArtifact = useStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)

  const actionCallIds = useMemo(() => new Set(actions.map((a) => a.call.id)), [actions])
  const groupArtifacts = useMemo(
    () => artifacts.filter((a) => actionCallIds.has(a.toolCallId)),
    [artifacts, actionCallIds],
  )

  useEffect(() => {
    if (defaultExpanded) setExpanded(true)
  }, [defaultExpanded])

  const errorCount = actions.filter((a) => a.result?.isError).length
  const pendingCount = actions.filter((a) => !a.result).length
  const total = actions.length

  // Derive a header from the first action
  const firstAction = actions[0]
  const headerTitle = firstAction?.call.toolInput
    ? getStepTitle(
        firstAction.call.toolName || 'unknown',
        firstAction.call.toolInput as Record<string, unknown>,
      )
    : null

  let statusIcon: React.ReactNode
  if (pendingCount > 0) {
    statusIcon = <Loader2 size={16} strokeWidth={1.5} className="actions-pill__spin" />
  } else if (errorCount > 0) {
    statusIcon = <Circle size={16} strokeWidth={1.5} className="actions-pill__status--error" />
  } else {
    statusIcon = <Check size={16} strokeWidth={1.5} className="actions-pill__status--done" />
  }

  const headerText = total === 1 && headerTitle
    ? headerTitle
    : pendingCount > 0
      ? `${total} action${total > 1 ? 's' : ''}`
      : `${total} action${total > 1 ? 's' : ''} completed`

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="actions-group"
    >
      {/* Header */}
      <button
        type="button"
        className="actions-group__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="actions-group__status-icon">{statusIcon}</span>
        <span className="actions-group__header-text">{headerText}</span>
        {errorCount > 0 && <span className="actions-group__error-badge">{errorCount} failed</span>}
        {expanded ? (
          <ChevronUp size={14} strokeWidth={1.5} className="actions-group__chevron" />
        ) : (
          <ChevronDown size={14} strokeWidth={1.5} className="actions-group__chevron" />
        )}
      </button>

      {/* Tool call pills */}
      <AnimatePresence>
        {expanded && (
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
                const isError = action.result?.isError
                const isPending = !action.result
                const isRowExpanded = expandedRowId === action.call.id

                return (
                  <div key={action.call.id} className="action-pill-wrap">
                    {/* Pill */}
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
                      <span className="action-pill__text">{title}</span>
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

      {/* Inline artifact cards */}
      {groupArtifacts.length > 0 && (
        <div className="actions-group__artifacts">
          {groupArtifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

// Re-export helpers for SubAgentGroup
export { toolIcons, getStepTitle }
