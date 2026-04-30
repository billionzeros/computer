import { AnimatePresence } from 'framer-motion'
import { ArrowDown, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ChatMessage, useRoutineStatus, useStore } from '../../lib/store.js'
import { sessionStore, useActiveSessionState } from '../../lib/store/sessionStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { ActionsGroup } from './ActionsGroup.js'
import { MessageBubble } from './MessageBubble.js'
import { SubAgentGroup } from './SubAgentGroup.js'
import { TaskChecklist } from './TaskChecklist.js'
import { TaskSection } from './TaskSection.js'
import { ThinkingIndicator } from './ThinkingIndicator.js'
import { TurnProgress } from './TurnProgress.js'
import { type GroupedItem, groupMessages } from './groupMessages.js'

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
  const turnUsage = useActiveSessionState((s) => s.turnUsage)
  const lastTurnDurationMs = useActiveSessionState((s) => s.lastTurnDurationMs)
  const agentStatus = useActiveSessionState((s) => s.status)

  if (agentStatus !== 'idle' || !turnUsage || !lastTurnDurationMs) return null

  return (
    <div className="turn-stats">
      <span className="turn-stats__text">
        {formatElapsed(lastTurnDurationMs)} · ↓{formatTokens(turnUsage.outputTokens)} tokens
      </span>
    </div>
  )
}

function TaskChecklistInline() {
  const currentTasks = useActiveSessionState((s) => s.tasks)
  const tasksHidden = uiStore((s) => s.tasksHidden)
  if (currentTasks.length === 0 || tasksHidden) return null
  return <TaskChecklist tasks={currentTasks} />
}

type RenderEntry =
  | { kind: 'turn'; key: string; items: GroupedItem[]; isWorking: boolean }
  | { kind: 'leaf'; key: string; item: GroupedItem }

function isWorkItem(item: GroupedItem): boolean {
  if (item.type === 'actions' || item.type === 'task_section' || item.type === 'sub_agent') {
    return true
  }
  if (item.type === 'message') {
    const m = item.message
    if (m.role === 'assistant' && m.isThinking) return true
    // Intermediate assistant narrations that didn't get folded into a task_section
    // (long-ish prose between tool calls). They belong inside the work log.
    if (m.role === 'assistant' && !m.isThinking) return true
  }
  return false
}

function buildRenderQueue(grouped: GroupedItem[], isAgentWorking: boolean): RenderEntry[] {
  // Step 1: identify the LAST assistant non-thinking message in each "turn"
  // (a turn ends at a user/system message). That message is the final answer
  // and renders OUTSIDE the TurnProgress wrapper.
  const finalAnswerIndices = new Set<number>()
  let lastAssistantIdx = -1
  for (let i = 0; i < grouped.length; i++) {
    const item = grouped[i]
    if (item.type !== 'message') continue
    const m = item.message
    if (m.role === 'user' || m.role === 'system') {
      if (lastAssistantIdx >= 0) finalAnswerIndices.add(lastAssistantIdx)
      lastAssistantIdx = -1
    } else if (m.role === 'assistant' && !m.isThinking) {
      lastAssistantIdx = i
    }
  }
  // Close the trailing turn only when the agent has stopped — otherwise it
  // might still emit more text and we don't want to "lock in" an early answer.
  if (lastAssistantIdx >= 0 && !isAgentWorking) {
    finalAnswerIndices.add(lastAssistantIdx)
  }

  // Step 2: walk and bucket into a render queue
  const queue: RenderEntry[] = []
  let buffer: GroupedItem[] = []
  const flush = () => {
    if (buffer.length === 0) return
    const first = buffer[0]
    const id = first.type === 'message' ? first.message.id : first.id
    queue.push({ kind: 'turn', key: `turn_${id}`, items: buffer, isWorking: false })
    buffer = []
  }

  for (let i = 0; i < grouped.length; i++) {
    const item = grouped[i]
    const isFinal = finalAnswerIndices.has(i)
    const isUserOrSystem =
      item.type === 'message' && (item.message.role === 'user' || item.message.role === 'system')
    const isToolLeaf = item.type === 'message' && item.message.role === 'tool'

    if (isUserOrSystem || isFinal || isToolLeaf) {
      flush()
      const id = item.type === 'message' ? item.message.id : item.id
      queue.push({ kind: 'leaf', key: id, item })
      continue
    }

    if (isWorkItem(item)) {
      buffer.push(item)
    } else {
      // Unknown bucket — render as a leaf to be safe.
      flush()
      const id = item.type === 'message' ? item.message.id : item.id
      queue.push({ kind: 'leaf', key: id, item })
    }
  }

  // Trailing buffer is the in-progress turn; mark it as working iff the agent is.
  if (buffer.length > 0) {
    const first = buffer[0]
    const id = first.type === 'message' ? first.message.id : first.id
    queue.push({ kind: 'turn', key: `turn_${id}`, items: buffer, isWorking: isAgentWorking })
  }

  return queue
}

export function MessageList({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const agentStatus = useRoutineStatus()
  const grouped = useMemo(() => groupMessages(messages), [messages])
  const renderQueue = useMemo(
    () => buildRenderQueue(grouped, agentStatus === 'working'),
    [grouped, agentStatus],
  )

  // Pagination: load older messages on scroll-to-top
  const activeSessionId = useStore((s) => s.getActiveConversation()?.sessionId)
  const hasMore = sessionStore((s) =>
    activeSessionId ? s.getSessionState(activeSessionId).hasMore : false,
  )
  const isLoadingOlder = sessionStore((s) =>
    activeSessionId ? s.getSessionState(activeSessionId).isLoadingOlder : false,
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

    // When a new user message is sent, scroll so the new query appears
    // at the top of the viewport (Perplexity-style). The assistant
    // response will stream in below it.
    const lastMsg = messages[messages.length - 1]
    if (messages.length > prevCount && lastMsg?.role === 'user') {
      requestAnimationFrame(() => {
        // Find the last user message bubble in the DOM
        const userBubbles = container.querySelectorAll('.message--user')
        const lastUserBubble = userBubbles[userBubbles.length - 1]
        if (lastUserBubble) {
          const bubbleTop = (lastUserBubble as HTMLElement).offsetTop
          container.scrollTo({ top: bubbleTop, behavior: 'instant' })
        } else {
          scrollToBottom(true)
        }
      })
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
          {renderQueue.map((entry) => {
            if (entry.kind === 'turn') {
              return (
                <TurnProgress key={entry.key} items={entry.items} isWorking={entry.isWorking} />
              )
            }
            const { item } = entry
            if (item.type === 'message') {
              return (
                <MessageBubble
                  key={item.message.id}
                  message={item.message}
                  sessionId={activeSessionId}
                />
              )
            }
            if (item.type === 'task_section') {
              return (
                <TaskSection
                  key={item.id}
                  title={item.title}
                  actions={item.actions}
                  done={item.done}
                />
              )
            }
            if (item.type === 'sub_agent') {
              return (
                <SubAgentGroup
                  key={item.id}
                  toolCallId={item.toolCallId}
                  task={item.task}
                  agentType={item.agentType}
                  actions={item.actions}
                  progressContent={item.progressContent}
                  result={item.result}
                />
              )
            }
            return <ActionsGroup key={item.id} actions={item.actions} />
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
