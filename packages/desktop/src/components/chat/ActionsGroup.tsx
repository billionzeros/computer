import { AnimatePresence, motion } from 'framer-motion'
import { Brain, ChevronRight, Code, PanelRight, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { parseCitationSources } from '../../lib/store/handlers/citationParser.js'
import { ArtifactCard } from './ArtifactCard.js'
import { SourceCards } from './SourceCards.js'
import type { ToolAction } from './groupMessages.js'

const SEARCH_TOOLS = new Set(['web_search', 'exa_search', 'exa_find_similar', 'web_research'])

// ── Tool type labels & helpers ─────────────────────────────────────

/** Get a favicon URL for tools that interact with external URLs (free, no API key) */
function getToolFavicon(toolName: string, toolInput?: Record<string, unknown>): string | null {
  if (toolName === 'exa_search' || toolName === 'exa_find_similar') {
    return 'https://www.google.com/s2/favicons?domain=exa.ai&sz=16'
  }
  if (toolName === 'web_search') {
    return 'https://www.google.com/s2/favicons?domain=google.com&sz=16'
  }
  if (!toolInput) return null
  let url: string | null = null
  if (toolName === 'browser') url = toolInput.url as string
  else if (toolName === 'network') url = (toolInput.url || toolInput.host) as string
  else if (toolName === 'http_api') url = toolInput.url as string
  if (!url) return null
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`
  } catch {
    return null
  }
}

/** Get a short, bold tool type label (like Claude Code's "Read", "Edit", "Shell") */
function getToolTypeLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell':
      return 'Shell'
    case 'filesystem': {
      const op = toolInput?.operation as string
      if (op === 'write') return 'Write'
      if (op === 'read') return 'Read'
      if (op === 'delete') return 'Delete'
      if (op === 'mkdir') return 'Mkdir'
      return 'File'
    }
    case 'browser':
      return 'Browser'
    case 'network':
      return 'Fetch'
    case 'artifact':
      return 'Artifact'
    case 'git':
      return 'Git'
    case 'code_search':
      return 'Search'
    case 'http_api':
      return 'HTTP'
    case 'database':
      return 'Database'
    case 'memory':
      return 'Memory'
    case 'todo':
      return 'Todo'
    case 'clipboard':
      return 'Clipboard'
    case 'notification':
      return 'Notify'
    case 'image':
      return 'Image'
    case 'diff':
      return 'Diff'
    case 'job':
      return 'Agent'
    case 'sub_agent':
      return 'Agent'
    case 'web_search':
      return 'Search'
    case 'exa_search':
      return 'Search'
    case 'web_research':
      return 'Research'
    case 'exa_find_similar':
      return 'Similar'
    default:
      return formatMcpToolName(toolName)
  }
}

function formatMcpToolName(toolName: string): string {
  const colonIdx = toolName.indexOf(':')
  const tool = colonIdx >= 0 ? toolName.slice(colonIdx + 1) : toolName
  if (!tool) return toolName
  if (!tool.includes('_')) {
    return tool.charAt(0).toUpperCase() + tool.slice(1)
  }
  return tool
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Get the target/description shown after the type label (in code-styled pill) */
function getToolTarget(toolName: string, toolInput?: Record<string, unknown>): string | null {
  if (!toolInput) return null
  switch (toolName) {
    case 'shell': {
      const cmd = (toolInput.command as string) || ''
      return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd
    }
    case 'filesystem': {
      const path = (toolInput.path as string) || ''
      return path || null
    }
    case 'browser': {
      const bUrl = toolInput.url as string
      if (bUrl) {
        try {
          return new URL(bUrl.startsWith('http') ? bUrl : `https://${bUrl}`).hostname
        } catch {
          return bUrl.length > 60 ? `${bUrl.slice(0, 57)}...` : bUrl
        }
      }
      const op = toolInput.operation as string
      if (op === 'screenshot') return 'screenshot'
      if (op === 'click') return (toolInput.selector as string) || 'element'
      if (op === 'type') return (toolInput.selector as string) || 'input'
      return op || null
    }
    case 'network': {
      const url = (toolInput.url || toolInput.host || '') as string
      if (!url) return null
      return url.replace(/^https?:\/\//, '').split('/')[0]
    }
    case 'artifact': {
      const title = (toolInput.title as string) || ''
      return title || (toolInput.type as string) || null
    }
    case 'git': {
      const op = (toolInput.operation as string) || ''
      const path = (toolInput.path as string) || ''
      return path ? `${op} ${path}` : op || null
    }
    case 'code_search': {
      const query = (toolInput.query as string) || ''
      return query ? `"${query.slice(0, 50)}"` : null
    }
    case 'http_api': {
      const method = (toolInput.method as string) || 'GET'
      const url = (toolInput.url as string) || ''
      try {
        const host = url ? new URL(url).hostname : ''
        return host ? `${method} ${host}` : method
      } catch {
        return method
      }
    }
    case 'database':
      return (toolInput.operation as string) || null
    case 'memory': {
      const key = (toolInput.key as string) || ''
      return key || null
    }
    case 'job': {
      const op = (toolInput.operation as string) || ''
      const name = (toolInput.name as string) || (toolInput.agentId as string) || ''
      if (name) return `${op} ${name}`.trim()
      return op || null
    }
    case 'sub_agent':
      return (toolInput.task as string) || null
    case 'web_search':
    case 'exa_search':
    case 'web_research': {
      const query = (toolInput.query as string) || ''
      if (!query) return null
      const trimmed = query.length > 60 ? `${query.slice(0, 57)}...` : query
      return `"${trimmed}"`
    }
    case 'exa_find_similar': {
      const url = (toolInput.url as string) || ''
      if (!url) return null
      try {
        return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      } catch {
        return url.length > 60 ? `${url.slice(0, 57)}...` : url
      }
    }
    default:
      return null
  }
}

/** Get brief metadata from tool result (like "Read 261 lines", "exit 0") */
function getToolMeta(
  toolName: string,
  toolInput?: Record<string, unknown>,
  resultContent?: string,
  isError?: boolean,
): string | null {
  if (isError && resultContent) {
    const firstLine = resultContent.split('\n')[0]
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
  }
  if (!resultContent) return null

  switch (toolName) {
    case 'filesystem': {
      const op = toolInput?.operation as string
      if (op === 'read') {
        const lines = resultContent.split('\n').length
        return `Read ${lines} line${lines !== 1 ? 's' : ''}`
      }
      if (op === 'write') {
        const lines = resultContent.split('\n').length
        return `Wrote ${lines} line${lines !== 1 ? 's' : ''}`
      }
      return null
    }
    case 'shell': {
      const lines = resultContent.trim().split('\n')
      if (lines.length <= 2) return lines[0]?.slice(0, 80) || null
      return `${lines.length} lines of output`
    }
    case 'code_search': {
      const lines = resultContent.trim().split('\n').filter(Boolean)
      if (lines.length === 0) return 'No results'
      return `${lines.length} result${lines.length !== 1 ? 's' : ''}`
    }
    case 'network': {
      const len = resultContent.length
      if (len >= 1024) return `${(len / 1024).toFixed(1)}kb response`
      return `${len} bytes`
    }
    case 'web_search':
    case 'exa_search':
    case 'exa_find_similar':
    case 'web_research': {
      const resultMatches = resultContent.match(/\burl\b/gi)
      if (resultMatches && resultMatches.length > 0) {
        const count = resultMatches.length
        return `${count} result${count !== 1 ? 's' : ''}`
      }
      const category = toolInput?.category as string
      if (category) return category
      return null
    }
    default:
      return null
  }
}

/** Compose the single-chip label: "Type target" or just "Type" */
function getActionLabel(action: ToolAction): string {
  const toolName = action.call.toolName || 'unknown'
  const input = action.call.toolInput as Record<string, unknown> | undefined
  const type = getToolTypeLabel(toolName, input)
  const target = getToolTarget(toolName, input)
  if (!target) return type
  const short = target.length > 70 ? `${target.slice(0, 67)}...` : target
  return `${type} ${short}`
}

function getGroupHeader(actions: ToolAction[]): string {
  if (actions.length === 1) return getActionLabel(actions[0])
  const types = new Map<string, number>()
  for (const a of actions) {
    const label = getToolTypeLabel(
      a.call.toolName || 'unknown',
      a.call.toolInput as Record<string, unknown>,
    )
    types.set(label, (types.get(label) || 0) + 1)
  }
  const parts: string[] = []
  for (const [type, count] of types) {
    parts.push(count > 1 ? `${type} · ${count}` : type)
  }
  return parts.join(' · ')
}

// ── Single action as a conv-chip ──────────────────────────────────

interface ActionChipProps {
  action: ToolAction
}

function ActionChip({ action }: ActionChipProps) {
  const [open, setOpen] = useState(false)
  const artifacts = artifactStore((s) => s.artifacts)
  const setActiveArtifact = artifactStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)

  const toolName = action.call.toolName || 'unknown'
  const input = action.call.toolInput as Record<string, unknown> | undefined
  const isError = action.result?.isError
  const label = getActionLabel(action)
  const meta = getToolMeta(toolName, input, action.result?.content, isError)
  const faviconUrl = getToolFavicon(toolName, input)
  const artifact = artifacts.find((a) => a.toolCallId === action.call.id)

  const resultContent = action.result?.content || ''
  const hasResult = Boolean(resultContent)
  const resultLines = resultContent.split('\n')
  const isLongResult = resultLines.length > 6
  const [showFullResult, setShowFullResult] = useState(false)
  const displayedResult = showFullResult ? resultContent : resultLines.slice(0, 6).join('\n')

  const isSearchTool = SEARCH_TOOLS.has(toolName)
  const searchSources = useMemo(
    () => (isSearchTool && resultContent && !isError ? parseCitationSources(resultContent) : []),
    [isSearchTool, resultContent, isError],
  )
  const showSourceCards = isSearchTool && searchSources.length > 0

  const toggle = () => {
    if (hasResult) setOpen((o) => !o)
  }

  const classes = [
    'conv-chip',
    open ? 'open' : '',
    hasResult ? 'has-children' : '',
    isError ? 'conv-chip--error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <button type="button" className="conv-chip__row" onClick={toggle} disabled={!hasResult}>
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            width={13}
            height={13}
            className="conv-chip__favicon"
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <Code size={13} strokeWidth={1.5} className="conv-chip__icon" />
        )}
        <span className="conv-chip__label">{label}</span>
        {artifact && (
          // biome-ignore lint/a11y/useSemanticElements: nested inside parent <button>; native button would be invalid HTML
          <span
            role="button"
            tabIndex={0}
            className="conv-chip__panel-btn"
            onClick={(e) => {
              e.stopPropagation()
              setActiveArtifact(artifact.id)
              setArtifactPanelOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                setActiveArtifact(artifact.id)
                setArtifactPanelOpen(true)
              }
            }}
            aria-label="Open in panel"
          >
            <PanelRight size={12} strokeWidth={1.5} />
          </span>
        )}
        {hasResult && <ChevronRight size={12} strokeWidth={1.5} className="conv-chip__chev" />}
      </button>
      {hasResult && open && (
        <div className="conv-chip__children">
          <div className="conv-chip__child">
            {meta && (
              <div className={`conv-chip__meta${isError ? ' conv-chip__meta--error' : ''}`}>
                {meta}
              </div>
            )}
            {showSourceCards ? (
              <SourceCards sources={searchSources} />
            ) : (
              <>
                <pre className="conv-chip__result">{displayedResult}</pre>
                {isLongResult && (
                  <button
                    type="button"
                    className="conv-chip__more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowFullResult(!showFullResult)
                    }}
                  >
                    {showFullResult ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Group chip (Running tasks in parallel) ─────────────────────────

interface GroupChipProps {
  label: string
  icon?: typeof ChevronRight
  children: ReactNode
  defaultOpen?: boolean
  errorCount?: number
}

function GroupChip({
  label,
  icon: IconComp = Workflow,
  children,
  defaultOpen = false,
  errorCount = 0,
}: GroupChipProps) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])
  return (
    <div className={`conv-chip has-children${open ? ' open' : ''}`}>
      <button type="button" className="conv-chip__row" onClick={() => setOpen((o) => !o)}>
        <IconComp size={13} strokeWidth={1.5} className="conv-chip__icon" />
        <span className="conv-chip__label">{label}</span>
        {errorCount > 0 && <span className="conv-chip__error-badge">{errorCount} failed</span>}
        <ChevronRight size={12} strokeWidth={1.5} className="conv-chip__chev" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="conv-chip__children">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────

interface Props {
  actions: ToolAction[]
  defaultExpanded?: boolean
}

export function ActionsGroup({ actions, defaultExpanded = false }: Props) {
  const artifacts = artifactStore((s) => s.artifacts)

  const actionCallIds = useMemo(() => new Set(actions.map((a) => a.call.id)), [actions])
  const groupArtifacts = useMemo(
    () => artifacts.filter((a) => actionCallIds.has(a.toolCallId)),
    [artifacts, actionCallIds],
  )

  const errorCount = actions.filter((a) => a.result?.isError).length

  if (actions.length === 0 && groupArtifacts.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="conv-actions"
    >
      {actions.length === 1 && <ActionChip action={actions[0]} />}
      {actions.length > 1 && (
        <GroupChip
          label="Running tasks in parallel"
          defaultOpen={defaultExpanded}
          errorCount={errorCount}
        >
          {actions.map((action) => (
            <div key={action.call.id} className="conv-chip__child">
              <ActionChip action={action} />
            </div>
          ))}
        </GroupChip>
      )}

      {groupArtifacts.length > 0 && (
        <div className="conv-artifacts">
          {groupArtifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

export {
  getToolTypeLabel,
  getToolTarget,
  getToolMeta,
  getGroupHeader,
  getActionLabel,
  ActionChip,
  GroupChip,
}

// Back-compat alias so any stragglers importing ToolTreeItem still compile
export { ActionChip as ToolTreeItem }

// Re-export the thinking-chip icon for callers
export { Brain as ThinkingIcon }
