import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronRight, PanelRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { ArtifactCard } from './ArtifactCard.js'
import type { ToolAction } from './groupMessages.js'

// ── Tool type labels & helpers ─────────────────────────────────────

/** Get a favicon URL for tools that interact with external URLs (free, no API key) */
function getToolFavicon(toolName: string, toolInput?: Record<string, unknown>): string | null {
  // Exa search tools get exa.ai favicon
  if (toolName === 'exa_search' || toolName === 'exa_find_similar') {
    return 'https://www.google.com/s2/favicons?domain=exa.ai&sz=16'
  }
  // Web search gets a generic search icon via Google favicon
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
    case 'exa_find_similar':
      return 'Similar'
    default:
      return formatMcpToolName(toolName)
  }
}

/**
 * Render an MCP tool name (`server:tool` or just `tool`) as a human label.
 * Strips the server prefix (the connector source is conveyed elsewhere),
 * splits the snake_case tool name on underscores, and title-cases each
 * word. Falls back to a single-letter capitalize if the name has no
 * underscore and no colon, so a bare `Memory` still looks right.
 *
 *   codex_apps:gmail_search_emails → "Gmail Search Emails"
 *   anton:memory_save              → "Memory Save"
 *   list_channels                  → "List Channels"
 *   ping                           → "Ping"
 */
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
      // Show the command, truncated
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
    case 'exa_search': {
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
    case 'exa_find_similar': {
      // Try to count results from the output
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

/** Generate a descriptive header for a group of actions */
function getGroupHeader(actions: ToolAction[]): string {
  if (actions.length === 1) {
    const action = actions[0]
    const toolName = action.call.toolName || 'unknown'
    const label = getToolTypeLabel(toolName, action.call.toolInput as Record<string, unknown>)
    const target = getToolTarget(toolName, action.call.toolInput as Record<string, unknown>)
    if (target) {
      // For single actions, combine: "Read config.ts" or "Shell npm test"
      const shortTarget = target.length > 60 ? `${target.slice(0, 57)}...` : target
      return `${label} ${shortTarget}`
    }
    return label
  }

  // Multiple actions — group by type and summarize
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
    parts.push(count > 1 ? `${type} · ${count} tool calls` : type)
  }
  return parts.join(', ')
}

// ── Shared tree item renderer ──────────────────────────────────────

interface ToolTreeItemProps {
  action: ToolAction
  isLast: boolean
}

function ToolTreeItem({ action, isLast }: ToolTreeItemProps) {
  const [showResult, setShowResult] = useState(false)
  const artifacts = artifactStore((s) => s.artifacts)
  const setActiveArtifact = artifactStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)

  const toolName = action.call.toolName || 'unknown'
  const input = action.call.toolInput as Record<string, unknown> | undefined
  const typeLabel = getToolTypeLabel(toolName, input)
  const target = getToolTarget(toolName, input)
  const isError = action.result?.isError
  const meta = getToolMeta(toolName, input, action.result?.content, isError)
  const faviconUrl = getToolFavicon(toolName, input)
  const artifact = artifacts.find((a) => a.toolCallId === action.call.id)

  // For long results, show "Show more" toggle
  const resultContent = action.result?.content || ''
  const resultLines = resultContent.split('\n')
  const isLongResult = resultLines.length > 6
  const [showFullResult, setShowFullResult] = useState(false)
  const displayedResult = showFullResult ? resultContent : resultLines.slice(0, 6).join('\n')

  return (
    <div className={`tool-tree__item${isLast ? ' tool-tree__item--last' : ''}`}>
      <div
        className={`tool-tree__item-row${isError ? ' tool-tree__item-row--error' : ''}`}
        onClick={() => action.result && setShowResult(!showResult)}
        role={action.result ? 'button' : undefined}
        tabIndex={action.result ? 0 : undefined}
        onKeyDown={(e) => {
          if (action.result && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setShowResult(!showResult)
          }
        }}
      >
        {faviconUrl && (
          <img
            src={faviconUrl}
            alt=""
            className="tool-tree__favicon"
            width={14}
            height={14}
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="tool-tree__type">{typeLabel}</span>
        {target && <span className="tool-tree__target">{target}</span>}
        {artifact && (
          <button
            type="button"
            className="tool-tree__panel-btn"
            onClick={(e) => {
              e.stopPropagation()
              setActiveArtifact(artifact.id)
              setArtifactPanelOpen(true)
            }}
            aria-label="Open in panel"
          >
            <PanelRight size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {meta && (
        <div className={`tool-tree__meta${isError ? ' tool-tree__meta--error' : ''}`}>{meta}</div>
      )}

      {/* Expanded result */}
      <AnimatePresence>
        {showResult && action.result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ overflow: 'hidden' }}
          >
            <pre className="tool-tree__result">{displayedResult}</pre>
            {isLongResult && (
              <button
                type="button"
                className="tool-tree__show-more"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowFullResult(!showFullResult)
                }}
              >
                {showFullResult ? 'Show less' : 'Show more'}
              </button>
            )}
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
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [showAllItems, setShowAllItems] = useState(false)
  const artifacts = artifactStore((s) => s.artifacts)

  const actionCallIds = useMemo(() => new Set(actions.map((a) => a.call.id)), [actions])
  const groupArtifacts = useMemo(
    () => artifacts.filter((a) => actionCallIds.has(a.toolCallId)),
    [artifacts, actionCallIds],
  )

  useEffect(() => {
    if (defaultExpanded) setExpanded(true)
  }, [defaultExpanded])

  const errorCount = actions.filter((a) => a.result?.isError).length

  const headerText = getGroupHeader(actions)

  // Show favicon in header for single-action groups that fetch URLs
  const headerFavicon = useMemo(() => {
    if (actions.length !== 1) return null
    const input = actions[0].call.toolInput as Record<string, unknown> | undefined
    return getToolFavicon(actions[0].call.toolName || '', input)
  }, [actions])

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="tool-tree"
    >
      {/* Header */}
      <button type="button" className="tool-tree__header" onClick={() => setExpanded(!expanded)}>
        {expanded ? (
          <ChevronDown size={14} strokeWidth={1.5} className="tool-tree__chevron" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="tool-tree__chevron" />
        )}
        {headerFavicon && (
          <img
            src={headerFavicon}
            alt=""
            className="tool-tree__favicon"
            width={14}
            height={14}
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="tool-tree__header-text">{headerText}</span>
        {errorCount > 0 && <span className="tool-tree__error-badge">{errorCount} failed</span>}
      </button>

      {/* Tree items */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="tool-tree__items">
              {actions.length > 4 && !showAllItems ? (
                <>
                  {actions.slice(0, 2).map((action) => (
                    <ToolTreeItem key={action.call.id} action={action} isLast={false} />
                  ))}
                  <button
                    type="button"
                    className="tool-tree__show-more-items"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowAllItems(true)
                    }}
                  >
                    Show {actions.length - 3} more
                  </button>
                  <ToolTreeItem
                    key={actions[actions.length - 1].call.id}
                    action={actions[actions.length - 1]}
                    isLast={true}
                  />
                </>
              ) : (
                actions.map((action, i) => (
                  <ToolTreeItem
                    key={action.call.id}
                    action={action}
                    isLast={i === actions.length - 1}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline artifact cards */}
      {groupArtifacts.length > 0 && (
        <div className="tool-tree__artifacts">
          {groupArtifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

// Re-export helpers for SubAgentGroup and TaskSection
export { getToolTypeLabel, getToolTarget, getToolMeta, getGroupHeader, ToolTreeItem }
