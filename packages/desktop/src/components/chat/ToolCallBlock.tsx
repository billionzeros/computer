import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Code2,
  Cpu,
  FolderOpen,
  GitBranch,
  Globe,
  Search,
  Settings2,
  Share2,
  Terminal,
  Upload,
  Wifi,
  Wrench,
  XCircle,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import type { ChatMessage } from '../../lib/store.js'

interface Props {
  message: ChatMessage
}

// ── Action-specific icons (like Perplexity) ──

function getActionIcon(toolName: string, toolInput?: Record<string, unknown>): React.ElementType {
  if (!toolInput) return getToolIcon(toolName)

  const operation = (toolInput.operation as string) || ''

  switch (toolName) {
    case 'shell': {
      const cmd = ((toolInput.command as string) || '').toLowerCase()
      if (
        cmd.startsWith('npm') ||
        cmd.startsWith('pnpm') ||
        cmd.startsWith('yarn') ||
        cmd.startsWith('pip')
      )
        return Settings2
      if (cmd.startsWith('git')) return GitBranch
      if (cmd.startsWith('curl') || cmd.startsWith('wget')) return Globe
      if (cmd.startsWith('cp') || cmd.startsWith('mv') || cmd.startsWith('mkdir')) return FolderOpen
      return Terminal
    }
    case 'filesystem':
      if (operation === 'read' || operation === 'tree' || operation === 'list') return BookOpen
      if (operation === 'write' || operation === 'create') return Upload
      if (operation === 'search') return Search
      return FolderOpen
    case 'browser':
      if (operation === 'screenshot' || operation === 'snapshot') return Search
      if (operation === 'fetch' || operation === 'extract') return BookOpen
      return Globe
    case 'git':
      return GitBranch
    case 'process':
      return Cpu
    case 'network':
      return Wifi
    case 'memory':
      return ClipboardList
    case 'artifact':
      return Code2
    case 'publish':
      return Share2
    default:
      return Wrench
  }
}

function getToolIcon(toolName: string): React.ElementType {
  switch (toolName) {
    case 'shell':
      return Terminal
    case 'filesystem':
      return FolderOpen
    case 'browser':
      return Globe
    case 'process':
      return Cpu
    case 'network':
      return Wifi
    case 'git':
      return GitBranch
    default:
      return Wrench
  }
}

// ── Human-readable action description ──

function getActionLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return toolName

  switch (toolName) {
    case 'shell': {
      const cmd = ((toolInput.command as string) || '').trim()
      // Shorten long commands
      if (cmd.length > 80) return cmd.slice(0, 77) + '...'
      return cmd || 'Running command'
    }
    case 'filesystem': {
      const op = toolInput.operation as string
      const path = (toolInput.path as string) || ''
      const shortPath = path.split('/').slice(-2).join('/')
      switch (op) {
        case 'read':
          return `Reading ${shortPath}`
        case 'write':
        case 'create':
          return `Writing to ${shortPath}`
        case 'list':
          return `Listing ${shortPath}`
        case 'tree':
          return `Exploring ${shortPath}`
        case 'search':
          return `Searching in ${shortPath}`
        case 'delete':
          return `Deleting ${shortPath}`
        default:
          return `${op || 'Operating on'} ${shortPath}`
      }
    }
    case 'browser': {
      const op = toolInput.operation as string
      switch (op) {
        case 'open':
          return `Opening ${((toolInput.url as string) || '').slice(0, 50)}`
        case 'click':
          return `Clicking ${toolInput.ref || 'element'}`
        case 'fill':
          return `Typing in ${toolInput.ref || 'input'}`
        case 'snapshot':
          return 'Reading page elements'
        case 'screenshot':
          return 'Capturing screenshot'
        case 'scroll':
          return `Scrolling ${toolInput.direction || 'page'}`
        case 'close':
          return 'Closing browser'
        case 'fetch':
          return `Fetching ${((toolInput.url as string) || '').slice(0, 50)}`
        case 'extract':
          return `Extracting from page`
        default:
          return `Browser: ${op}`
      }
    }
    case 'git': {
      const op = toolInput.operation as string
      switch (op) {
        case 'clone':
          return `Cloning ${toolInput.url || 'repository'}`
        case 'commit':
          return `Committing: ${(toolInput.message as string)?.slice(0, 50) || 'changes'}`
        case 'push':
          return 'Pushing to remote'
        case 'pull':
          return 'Pulling from remote'
        case 'status':
          return 'Checking git status'
        default:
          return `Git ${op}`
      }
    }
    case 'process':
      return [toolInput.operation, toolInput.pid || toolInput.name].filter(Boolean).join(' ')
    case 'network':
      return [toolInput.operation, toolInput.url || toolInput.host].filter(Boolean).join(' ')
    case 'memory':
      return `${toolInput.operation || 'Accessing'} memory: ${toolInput.key || ''}`
    case 'artifact':
      return `Creating ${toolInput.type || 'artifact'}`
    case 'publish':
      return 'Publishing to web'
    default:
      return JSON.stringify(toolInput).slice(0, 80)
  }
}

// ── Tool Call (the action line) ──

export function ToolCallBlock({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isResult = message.id.startsWith('tr_')
  const isError = message.isError

  // ── Result rendering ──
  if (isResult) {
    return <ToolResultBlock content={message.content} isError={!!isError} />
  }

  // ── Call rendering (Perplexity-style single line) ──
  const Icon = getActionIcon(message.toolName!, message.toolInput as Record<string, unknown>)
  const label = getActionLabel(message.toolName!, message.toolInput as Record<string, unknown>)

  return (
    <div className="tool-action">
      <Icon size={15} strokeWidth={1.5} className="tool-action__icon" />
      <span className="tool-action__label">{label}</span>
      <ChevronRight size={14} strokeWidth={1.5} className="tool-action__chevron" />
    </div>
  )
}

// ── Tool Result (expandable, clean) ──

function ToolResultBlock({ content, isError }: { content: string; isError: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = content.trim().length > 0
  const preview = content.slice(0, 120).trim()
  const hasMore = content.length > 120

  if (!hasContent) return null

  return (
    <div className={`tool-result-inline${isError ? ' tool-result-inline--error' : ''}`}>
      <button
        type="button"
        className="tool-result-inline__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {isError ? (
          <XCircle
            size={13}
            strokeWidth={1.5}
            className="tool-result-inline__status-icon tool-result-inline__status-icon--error"
          />
        ) : (
          <CheckCircle
            size={13}
            strokeWidth={1.5}
            className="tool-result-inline__status-icon tool-result-inline__status-icon--success"
          />
        )}
        <span className="tool-result-inline__preview">
          {preview}
          {hasMore && !expanded ? '...' : ''}
        </span>
        <ChevronRight
          size={13}
          strokeWidth={1.5}
          className={`tool-result-inline__expand ${expanded ? 'tool-result-inline__expand--open' : ''}`}
        />
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
            <pre className="tool-result-inline__content">{content}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
