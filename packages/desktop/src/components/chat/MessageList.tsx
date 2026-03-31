import { AnimatePresence } from 'framer-motion'
import { ArrowDown, Loader2 } from 'lucide-react'
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
  const activeConversationId = useStore((s) => s.activeConversationId)
  const turnStatsConversationId = useStore((s) => s.turnStatsConversationId)

  if (agentStatus !== 'idle' || !turnUsage || !lastTurnDurationMs) return null
  if (turnStatsConversationId !== activeConversationId) return null

  return (
    <div className="turn-stats">
      <span className="turn-stats__text">
        {formatElapsed(lastTurnDurationMs)} · ↓{formatTokens(turnUsage.outputTokens)} tokens
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

  // Pagination: load older messages on scroll-to-top
  const activeSessionId = useStore((s) => s.getActiveConversation()?.sessionId)
  const hasMore = useStore((s) =>
    activeSessionId ? (s._sessionHasMore.get(activeSessionId) ?? false) : false,
  )
  const isLoadingOlder = useStore((s) =>
    activeSessionId ? s._loadingOlderSessions.has(activeSessionId) : false,
  )
  const prevScrollHeightRef = useRef(0)

  const prevMsgCountRef = useRef(0)

  const scrollToBottom = useCallback((instant?: boolean) => {
    bottomRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' })
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const prevCount = prevMsgCountRef.current
    prevMsgCountRef.current = messages.length

    // When switching to a new chat (had 0 messages before), scroll to bottom instantly
    if (prevCount === 0 && messages.length > 0) {
      requestAnimationFrame(() => scrollToBottom(true))
      return
    }

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (isNearBottom) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // Show/hide scroll button + trigger pagination on scroll-to-top
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollBtn(distFromBottom > 200)

      // Trigger loading older messages when scrolled near the top
      if (container.scrollTop < 80 && hasMore && !isLoadingOlder && activeSessionId) {
        prevScrollHeightRef.current = container.scrollHeight
        useStore.getState().loadOlderMessages(activeSessionId)
      }
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
  }, [hasMore, isLoadingOlder, activeSessionId])

  // Maintain scroll position when older messages are prepended
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length triggers scroll position restore
  useEffect(() => {
    const container = containerRef.current
    if (!container || prevScrollHeightRef.current === 0) return

    const newHeight = container.scrollHeight
    const heightDiff = newHeight - prevScrollHeightRef.current
    if (heightDiff > 0) {
      container.scrollTop += heightDiff
    }
    prevScrollHeightRef.current = 0
  }, [messages.length])

  return (
    <div ref={containerRef} className="message-list">
      <div className="message-list__inner">
        {/* Loading spinner for older messages */}
        {isLoadingOlder && (
          <div className="message-list__loading-older">
            <Loader2 size={16} strokeWidth={1.5} className="message-list__loading-spinner" />
          </div>
        )}
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
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="message-list__scrollButton"
        >
          <ArrowDown size={18} strokeWidth={1.5} className="message-list__scrollIcon" />
        </button>
      )}
    </div>
  )
}
