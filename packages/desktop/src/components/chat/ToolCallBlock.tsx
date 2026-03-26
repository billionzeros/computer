import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  FolderOpen,
  Globe,
  Terminal,
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

const toolIcons: Record<string, React.ElementType> = {
  shell: Terminal,
  filesystem: FolderOpen,
  browser: Globe,
  process: Cpu,
  network: Wifi,
}

function getToolParam(toolName: string, toolInput: Record<string, unknown>): string {
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

export function ToolCallBlock({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isResult = !message.toolName
  const isError = message.isError

  if (isResult) {
    return (
      <div className="tool-result">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="tool-result__summary"
        >
          {isError ? (
            <XCircle size={14} strokeWidth={1.5} style={{ color: '#f87171', flexShrink: 0 }} />
          ) : (
            <CheckCircle size={14} strokeWidth={1.5} style={{ color: '#4ade80', flexShrink: 0 }} />
          )}
          <span
            className={`tool-result__label ${isError ? 'tool-result__label--error' : 'tool-result__label--success'}`}
          >
            {isError ? 'Error' : 'Success'}
          </span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            {message.content.slice(0, 80)}
            {message.content.length > 80 ? '...' : ''}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-subtle)', flexShrink: 0 }}>
            {expanded ? <ChevronUp size={14} strokeWidth={1.5} /> : <ChevronDown size={14} strokeWidth={1.5} />}
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
              <pre className="tool-result__content">{message.content}</pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  const Icon = toolIcons[message.toolName!] || Wrench
  const param = message.toolInput
    ? getToolParam(message.toolName!, message.toolInput as Record<string, unknown>)
    : ''

  return (
    <div className="tool-call">
      <span className="tool-call__badge">
        <Icon className="tool-call__badge-icon" />
        {message.toolName}
      </span>
      {param && <span className="tool-call__param">{param}</span>}
      <span className="tool-call__pulse" />
    </div>
  )
}
