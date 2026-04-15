import type { RoutineRunLogEntry } from '@anton/protocol'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  ChevronRight,
  Globe,
  Loader2,
  MessageSquare,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { formatAbsoluteTime, formatDuration } from '../../lib/agent-utils.js'
import { projectStore } from '../../lib/store/projectStore.js'

// ── Think tag parsing ──────────────────────────────────────────────

/** Split content into thinking and non-thinking parts. */
function parseThinkTags(content: string): { thinking: string | null; text: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  let thinking = ''
  let text = content

  let match: RegExpExecArray | null = thinkRegex.exec(content)
  while (match !== null) {
    thinking += (thinking ? '\n' : '') + match[1].trim()
    match = thinkRegex.exec(content)
  }

  text = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  return {
    thinking: thinking || null,
    text,
  }
}

// ── Grouping ────────────────────────────────────────────────────────

type GroupedRunItem =
  | { type: 'prompt'; content: string; ts: number }
  | { type: 'narrative'; content: string; ts: number }
  | { type: 'thinking'; content: string; ts: number }
  | {
      type: 'tool_group'
      actions: { call: RoutineRunLogEntry; result: RoutineRunLogEntry | null }[]
    }

function groupRunLogs(logs: RoutineRunLogEntry[]): GroupedRunItem[] {
  const items: GroupedRunItem[] = []
  let isFirstUser = true

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]

    if (log.role === 'user') {
      if (isFirstUser) {
        items.push({ type: 'prompt', content: log.content, ts: log.ts })
        isFirstUser = false
      } else {
        items.push({ type: 'narrative', content: log.content, ts: log.ts })
      }
      continue
    }

    if (log.role === 'assistant') {
      // Parse <think> tags from assistant messages
      const { thinking, text } = parseThinkTags(log.content)

      if (thinking) {
        items.push({ type: 'thinking', content: thinking, ts: log.ts })
      }
      if (text) {
        items.push({ type: 'narrative', content: text, ts: log.ts })
      }
      continue
    }

    if (log.role === 'tool_call') {
      // Collect consecutive tool_call + tool_result pairs
      const actions: { call: RoutineRunLogEntry; result: RoutineRunLogEntry | null }[] = []

      while (i < logs.length && (logs[i].role === 'tool_call' || logs[i].role === 'tool_result')) {
        const current = logs[i]
        if (current.role === 'tool_call') {
          // Check if next is its result
          if (i + 1 < logs.length && logs[i + 1].role === 'tool_result') {
            actions.push({ call: current, result: logs[i + 1] })
            i += 2
          } else {
            actions.push({ call: current, result: null })
            i++
          }
        } else {
          // Orphaned result — show it as a standalone
          actions.push({
            call: { ...current, role: 'tool_call', toolName: current.toolName || 'unknown' },
            result: current,
          })
          i++
        }
      }
      i-- // outer loop will increment

      if (actions.length > 0) {
        items.push({ type: 'tool_group', actions })
      }
      continue
    }

    // Standalone tool_result (shouldn't happen often)
    if (log.role === 'tool_result') {
      items.push({ type: 'narrative', content: log.content, ts: log.ts })
    }
  }

  return items
}

// ── Tool icons & labels ─────────────────────────────────────────────

function getRunToolIcon(toolName: string): React.ElementType {
  const name = toolName.toLowerCase()
  if (name.includes('slack') || name.includes('message') || name.includes('notify'))
    return MessageSquare
  if (name.includes('search') || name.includes('query') || name.includes('fetch')) return Search
  if (name.includes('gsc') || name.includes('api') || name.includes('http') || name.includes('web'))
    return Globe
  if (name.includes('shell') || name.includes('exec') || name.includes('run')) return Terminal
  if (name.includes('file') || name.includes('filesystem')) return Wrench
  return Wrench
}

function prettifyToolName(toolName: string): string {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGsc\b/g, 'GSC')
    .replace(/\bApi\b/g, 'API')
    .replace(/\bHttp\b/g, 'HTTP')
    .replace(/\bUrl\b/g, 'URL')
}

/** Try to extract a short error summary from raw content (often JSON). */
function extractErrorSummary(content: string): { summary: string; detail: string } {
  try {
    const parsed = JSON.parse(content)
    const msg =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error?.errors?.[0]?.message ||
      parsed?.errors?.[0]?.message
    if (msg) {
      const code = parsed?.error?.code || parsed?.code || parsed?.status
      const summary = code ? `${code}: ${msg}` : msg
      return { summary, detail: content }
    }
  } catch {
    // not JSON
  }

  const errorMatch = content.match(/(?:Error|error|ERROR):\s*(.+?)(?:\n|$)/)
  if (errorMatch) {
    return { summary: errorMatch[1].trim(), detail: content }
  }

  const firstLine = content.split('\n')[0].trim()
  return {
    summary: firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine,
    detail: content,
  }
}

// ── Components ──────────────────────────────────────────────────────

function PromptSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.slice(0, 100).trim()
  const hasMore = content.length > 100

  return (
    <div className="run-step run-step--prompt">
      <button
        type="button"
        className="run-step__prompt-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className={`run-step__chevron ${expanded ? 'run-step__chevron--open' : ''}`}
        />
        <span className="run-step__prompt-label">System Prompt</span>
        {!expanded && (
          <span className="run-step__prompt-preview">
            {preview}
            {hasMore ? '...' : ''}
          </span>
        )}
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
            <pre className="run-step__prompt-content">{content}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ThinkingSection({ content, ts }: { content: string; ts: number }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.split('\n')[0].slice(0, 80).trim()

  return (
    <div className="run-step run-step--thinking">
      <button
        type="button"
        className="run-step__thinking-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain size={14} strokeWidth={1.5} className="run-step__thinking-icon" />
        <ChevronRight
          size={13}
          strokeWidth={1.5}
          className={`run-step__chevron ${expanded ? 'run-step__chevron--open' : ''}`}
        />
        <span className="run-step__thinking-label">Thinking</span>
        {!expanded && <span className="run-step__thinking-preview">{preview}...</span>}
        <span className="run-step__time">{formatAbsoluteTime(ts)}</span>
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
            <div className="run-step__thinking-content">{content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NarrativeStep({ content, ts }: { content: string; ts: number }) {
  if (!content.trim()) return null
  return (
    <div className="run-step run-step--narrative">
      <div className="run-step__narrative-text">{content}</div>
      <span className="run-step__time">{formatAbsoluteTime(ts)}</span>
    </div>
  )
}

function ToolActionItem({
  call,
  result,
}: { call: RoutineRunLogEntry; result: RoutineRunLogEntry | null }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getRunToolIcon(call.toolName || '')
  const label = call.toolName ? prettifyToolName(call.toolName) : 'Tool Call'
  const isError = result?.isError ?? false
  const hasResult = result && result.content.trim().length > 0
  const toolInput = call.toolInput || call.content

  // For errors, extract summary
  const errorInfo = isError && result ? extractErrorSummary(result.content) : null

  return (
    <div className={`run-action ${isError ? 'run-action--error' : ''}`}>
      <button type="button" className="run-action__header" onClick={() => setExpanded(!expanded)}>
        <Icon size={15} strokeWidth={1.5} className="run-action__icon" />
        <span className="run-action__label">{label}</span>

        {/* Input preview */}
        {toolInput && !isError && (
          <span className="run-action__input-preview">
            {typeof toolInput === 'string' && toolInput.length > 60
              ? `${toolInput.slice(0, 57)}...`
              : typeof toolInput === 'string'
                ? toolInput
                : ''}
          </span>
        )}

        {/* Error summary inline */}
        {errorInfo && (
          <span className="run-action__error-badge">
            <AlertTriangle size={12} strokeWidth={1.5} />
            {errorInfo.summary.length > 60
              ? `${errorInfo.summary.slice(0, 57)}...`
              : errorInfo.summary}
          </span>
        )}

        {hasResult && (
          <ChevronRight
            size={13}
            strokeWidth={1.5}
            className={`run-action__expand ${expanded ? 'run-action__expand--open' : ''}`}
          />
        )}
      </button>

      <AnimatePresence>
        {expanded && hasResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <pre className="run-action__detail">{result!.content}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ToolGroupStep({
  actions,
}: { actions: { call: RoutineRunLogEntry; result: RoutineRunLogEntry | null }[] }) {
  return (
    <div className="run-step run-step--tools">
      {actions.map((action, i) => (
        <ToolActionItem key={`${action.call.ts}-${i}`} call={action.call} result={action.result} />
      ))}
    </div>
  )
}

// ── Main View ───────────────────────────────────────────────────────

interface RunInfo {
  startedAt: number
  completedAt: number | null
  status: 'success' | 'error' | 'timeout'
  durationMs?: number
  trigger: 'cron' | 'manual'
  runSessionId?: string
  error?: string
}

interface Props {
  agentSessionId: string
  projectId: string
  run: RunInfo
  onBack: () => void
}

export function RoutineRunView({ agentSessionId, projectId, run, onBack }: Props) {
  const agentRunLogs = projectStore((s) => s.routineRunLogs)
  const agentRunLogsLoading = projectStore((s) => s.routineRunLogsLoading)

  useEffect(() => {
    if (!run.completedAt) return
    projectStore.setState({ routineRunLogs: null, routineRunLogsLoading: true })
    projectStore
      .getState()
      .getRoutineRunLogs(projectId, agentSessionId, run.startedAt, run.completedAt, run.runSessionId)
  }, [projectId, agentSessionId, run.startedAt, run.completedAt, run.runSessionId])

  const grouped = useMemo(() => {
    if (!agentRunLogs?.length) return []
    return groupRunLogs(agentRunLogs)
  }, [agentRunLogs])

  const isError = run.status === 'error'

  return (
    <div className="conv-panel">
      <div className="conv-panel__topbar">
        <button
          type="button"
          className="conv-panel__back"
          onClick={onBack}
          aria-label="Back to routine"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="conv-panel__title run-view__title">
          <Terminal size={14} strokeWidth={1.5} />
          <span>Run at {formatAbsoluteTime(run.startedAt)}</span>
        </div>
        <div className="run-view__meta">
          <span className={`run-view__badge run-view__badge--${run.status}`}>{run.status}</span>
          {run.durationMs != null && (
            <span className="run-view__badge run-view__badge--duration">
              {formatDuration(run.durationMs)}
            </span>
          )}
          <span className="run-view__badge run-view__badge--trigger">{run.trigger}</span>
        </div>
      </div>

      <div className="routine-run-view__body">
        {agentRunLogsLoading ? (
          <div className="routine-run-view__loading">
            <Loader2 size={20} strokeWidth={1.5} className="routine-run-view__spinner" />
            <span>Loading run logs...</span>
          </div>
        ) : !agentRunLogs?.length ? (
          <div className="routine-run-view__empty">
            {isError && run.error ? (
              <div className="routine-run-view__error-msg">
                <span className="routine-run-view__error-label">Error</span>
                <pre>{run.error}</pre>
              </div>
            ) : (
              <span>No logs found for this run.</span>
            )}
          </div>
        ) : (
          <div className="run-steps">
            {grouped.map((item) => {
              const key =
                item.type === 'tool_group'
                  ? `tools-${item.actions[0]?.call.ts ?? ''}`
                  : `${item.type}-${item.ts}`
              switch (item.type) {
                case 'prompt':
                  return <PromptSection key={key} content={item.content} />
                case 'thinking':
                  return <ThinkingSection key={key} content={item.content} ts={item.ts} />
                case 'narrative':
                  return <NarrativeStep key={key} content={item.content} ts={item.ts} />
                case 'tool_group':
                  return <ToolGroupStep key={key} actions={item.actions} />
                default:
                  return null
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
