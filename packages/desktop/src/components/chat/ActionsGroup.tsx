import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Brain,
  ChevronDown,
  ChevronRight,
  Clipboard,
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
}

const toolLabels: Record<string, string> = {
  shell: 'Running command',
  filesystem: 'File operation',
  browser: 'Browser action',
  process: 'Process',
  network: 'Network request',
  artifact: 'Creating artifact',
  git: 'Git operation',
  code_search: 'Searching code',
  http_api: 'API request',
  database: 'Database query',
  memory: 'Memory operation',
  todo: 'Task update',
  clipboard: 'Clipboard',
  notification: 'Notification',
  image: 'Image operation',
  diff: 'File diff',
}

function _getToolParam(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell':
      return (toolInput.command as string) || ''
    case 'filesystem':
      return [toolInput.operation, toolInput.path].filter(Boolean).join(' ')
    case 'browser':
      return [toolInput.operation, toolInput.url].filter(Boolean).join(' ')
    case 'process':
      return [toolInput.operation, toolInput.pid || toolInput.name].filter(Boolean).join(' ')
    case 'network':
      return [toolInput.operation, toolInput.url || toolInput.host].filter(Boolean).join(' ')
    default:
      return JSON.stringify(toolInput).slice(0, 120)
  }
}

/** Generate a human-readable step title from tool call data */
function getStepTitle(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell': {
      const cmd = (toolInput.command as string) || ''
      // Try to describe common commands
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
      return query ? `Searching for "${query.slice(0, 30)}"` : 'Searching code'
    }
    case 'http_api': {
      const method = (toolInput.method as string) || 'GET'
      const url = (toolInput.url as string) || ''
      const host = url ? new URL(url).hostname : ''
      return host ? `${method} ${host}` : `${method} request`
    }
    case 'database': {
      const op = (toolInput.operation as string) || ''
      return op === 'query'
        ? 'Running query'
        : op === 'execute'
          ? 'Executing SQL'
          : `Database ${op}`
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
      return toolLabels[toolName] || toolName
  }
}

/** Get a code snippet preview from the tool input */
function getCodePreview(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'shell':
      return (toolInput.command as string) || null
    case 'filesystem': {
      const op = toolInput.operation as string
      const path = toolInput.path as string
      if (op && path) return `${op} ${path}`
      return null
    }
    case 'network': {
      const url = (toolInput.url || toolInput.host) as string
      return url || null
    }
    case 'git': {
      const op = toolInput.operation as string
      const path = toolInput.path as string
      return [op, path].filter(Boolean).join(' ')
    }
    case 'code_search':
      return (toolInput.query as string) || null
    case 'http_api': {
      const method = toolInput.method as string
      const url = toolInput.url as string
      return url ? `${method} ${url}` : null
    }
    case 'database':
      return (toolInput.sql as string) || null
    case 'artifact':
      return (toolInput.filename as string) || (toolInput.title as string) || null
    default:
      return null
  }
}

/** Get a short result preview */
function getResultPreview(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return '(no output)'
  const firstLine = trimmed.split('\n')[0]
  if (firstLine.length > 100) return `${firstLine.slice(0, 100)}...`
  return firstLine
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

  // Find artifacts produced by actions in this group
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

  let headerText: string
  if (pendingCount > 0) {
    headerText = `${total} action${total > 1 ? 's' : ''}`
  } else {
    headerText = `${total} action${total > 1 ? 's' : ''} completed`
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="actions-group"
    >
      {/* Collapsed header */}
      <button
        type="button"
        className="actions-group__header"
        onClick={() => setExpanded(!expanded)}
      >
        <Code2 size={14} className="actions-group__header-icon" />
        <span className="actions-group__header-text">{headerText}</span>
        {errorCount > 0 && <span className="actions-group__error-badge">{errorCount} failed</span>}
        {expanded ? (
          <ChevronDown size={14} className="actions-group__chevron" />
        ) : (
          <ChevronRight size={14} className="actions-group__chevron" />
        )}
      </button>

      {/* Timeline of steps */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="actions-group__timeline">
              {actions.map((action, idx) => {
                const toolName = action.call.toolName || 'unknown'
                const Icon = toolIcons[toolName] || Wrench
                const title = action.call.toolInput
                  ? getStepTitle(toolName, action.call.toolInput as Record<string, unknown>)
                  : toolLabels[toolName] || toolName
                const codePreview = action.call.toolInput
                  ? getCodePreview(toolName, action.call.toolInput as Record<string, unknown>)
                  : null
                const isError = action.result?.isError
                const isPending = !action.result
                const isRowExpanded = expandedRowId === action.call.id
                const isLast = idx === actions.length - 1

                return (
                  <div
                    key={action.call.id}
                    className={`actions-group__step ${isLast ? 'actions-group__step--last' : ''}`}
                  >
                    {/* Timeline dot */}
                    <div className="actions-group__dot-col">
                      <div
                        className={`actions-group__dot ${
                          isPending
                            ? 'actions-group__dot--pending'
                            : isError
                              ? 'actions-group__dot--error'
                              : 'actions-group__dot--done'
                        }`}
                      >
                        {isPending ? (
                          <Loader2 size={12} className="actions-group__spin" />
                        ) : (
                          <Icon size={10} />
                        )}
                      </div>
                      {!isLast && <div className="actions-group__line" />}
                    </div>

                    {/* Step content */}
                    <div className="actions-group__step-content">
                      <button
                        type="button"
                        className="actions-group__step-header"
                        onClick={() =>
                          action.result && setExpandedRowId(isRowExpanded ? null : action.call.id)
                        }
                      >
                        <span
                          className={`actions-group__step-title ${
                            isError ? 'actions-group__step-title--error' : ''
                          }`}
                        >
                          {title}
                        </span>
                        {(() => {
                          const artifact = artifacts.find((a) => a.toolCallId === action.call.id)
                          if (!artifact) return null
                          return (
                            <button
                              type="button"
                              className="actions-group__open-panel"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveArtifact(artifact.id)
                                setArtifactPanelOpen(true)
                              }}
                              aria-label="Open in panel"
                            >
                              <PanelRight size={12} />
                            </button>
                          )
                        })()}
                        {action.result && (
                          <span className="actions-group__step-chevron">
                            {isRowExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                        )}
                      </button>

                      {/* Code preview */}
                      {codePreview && (
                        <div className="actions-group__code-preview">{codePreview}</div>
                      )}

                      {/* Result preview (one-liner) when not expanded */}
                      {action.result && !isRowExpanded && (
                        <div
                          className={`actions-group__result-preview ${
                            isError ? 'actions-group__result-preview--error' : ''
                          }`}
                        >
                          {getResultPreview(action.result.content)}
                        </div>
                      )}

                      {/* Full result when expanded */}
                      <AnimatePresence>
                        {isRowExpanded && action.result && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.12 }}
                            style={{ overflow: 'hidden' }}
                          >
                            <pre className="actions-group__result">{action.result.content}</pre>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
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
