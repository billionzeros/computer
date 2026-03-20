import { AnimatePresence } from 'framer-motion'
import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStatus, type ChatMessage } from '../../lib/store.js'
import { ActionsGroup } from './ActionsGroup.js'
import { groupMessages } from './groupMessages.js'
import { MessageBubble } from './MessageBubble.js'
import { ThinkingIndicator } from './ThinkingIndicator.js'

interface Props {
  messages: ChatMessage[]
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

  // Show/hide scroll button
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollBtn(distFromBottom > 200)
    }

    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div ref={containerRef} className="message-list">
      <div className="message-list__inner">
        <AnimatePresence mode="popLayout">
          {grouped.map((item, idx) =>
            item.type === 'message' ? (
              <MessageBubble key={item.message.id} message={item.message} />
            ) : (
              <ActionsGroup
                key={item.id}
                actions={item.actions}
                defaultExpanded={
                  idx === grouped.length - 1 && agentStatus === 'working'
                }
              />
            ),
          )}
        </AnimatePresence>
        {agentStatus === 'working' && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button type="button" onClick={scrollToBottom} className="message-list__scrollButton">
          <ArrowDown className="message-list__scrollIcon" />
        </button>
      )}
    </div>
  )
}
