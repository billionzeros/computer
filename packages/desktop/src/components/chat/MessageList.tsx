import { AnimatePresence } from 'framer-motion'
import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ChatMessage, useAgentStatus, useStore } from '../../lib/store.js'
import { ActionsGroup } from './ActionsGroup.js'
import { MessageBubble } from './MessageBubble.js'
import { SubAgentGroup } from './SubAgentGroup.js'
import { TaskChecklist } from './TaskChecklist.js'
import { TaskSection } from './TaskSection.js'
import { ThinkingIndicator } from './ThinkingIndicator.js'
import { groupMessages } from './groupMessages.js'

interface Props {
  messages: ChatMessage[]
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}m ${sec}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function TurnStats() {
  const turnUsage = useStore((s) => s.turnUsage)
  const lastTurnDurationMs = useStore((s) => s.lastTurnDurationMs)
  const agentStatus = useStore((s) => s.agentStatus)

  if (agentStatus !== 'idle' || !turnUsage || !lastTurnDurationMs) return null

  return (
    <div className="turn-stats">
      <span className="turn-stats__text">
        {formatElapsed(lastTurnDurationMs)} · ↓{formatTokens(turnUsage.totalTokens)} tokens
      </span>
    </div>
  )
}

function TaskChecklistInline() {
  const currentTasks = useStore((s) => s.currentTasks)
  if (currentTasks.length === 0) return null
  return <TaskChecklist tasks={currentTasks} />
}

export function MessageList({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const agentStatus = useAgentStatus()
  const grouped = useMemo(() => groupMessages(messages), [messages])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages triggers scroll check
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (isNearBottom) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // Show/hide scroll button (recalculate on scroll AND content size changes)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollBtn(distFromBottom > 200)
    }

    container.addEventListener('scroll', checkScroll)

    const observer = new ResizeObserver(checkScroll)
    observer.observe(container)
    for (const child of container.children) {
      observer.observe(child)
    }

    return () => {
      container.removeEventListener('scroll', checkScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <div ref={containerRef} className="message-list">
      <div className="message-list__inner">
        <AnimatePresence mode="popLayout">
          {grouped.map((item, idx) => {
            if (item.type === 'message') {
              return <MessageBubble key={item.message.id} message={item.message} />
            }
            if (item.type === 'task_section') {
              return (
                <TaskSection
                  key={item.id}
                  title={item.title}
                  actions={item.actions}
                  done={item.done}
                  defaultExpanded={idx === grouped.length - 1 && agentStatus === 'working'}
                />
              )
            }
            if (item.type === 'sub_agent') {
              return (
                <SubAgentGroup
                  key={item.id}
                  toolCallId={item.toolCallId}
                  task={item.task}
                  actions={item.actions}
                  result={item.result}
                  defaultExpanded={idx === grouped.length - 1 && agentStatus === 'working'}
                />
              )
            }
            return (
              <ActionsGroup
                key={item.id}
                actions={item.actions}
                defaultExpanded={idx === grouped.length - 1 && agentStatus === 'working'}
              />
            )
          })}
        </AnimatePresence>
        <TaskChecklistInline />
        {agentStatus === 'working' && <ThinkingIndicator />}
        <TurnStats />
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button type="button" onClick={scrollToBottom} className="message-list__scrollButton">
          <ArrowDown size={18} strokeWidth={1.5} className="message-list__scrollIcon" />
        </button>
      )}
    </div>
  )
}
