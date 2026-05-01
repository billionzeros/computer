import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CitationSource } from '../../lib/store.js'
import { parseCitationSources } from '../../lib/store/handlers/citationParser.js'
import { ActionsGroup } from './ActionsGroup.js'
import { MessageBubble } from './MessageBubble.js'
import { SourceCards } from './SourceCards.js'
import { SubAgentGroup } from './SubAgentGroup.js'
import { TaskSection } from './TaskSection.js'
import type { GroupedItem, ToolAction } from './groupMessages.js'

const SEARCH_TOOLS = new Set(['web_search', 'exa_search', 'exa_find_similar', 'web_research'])

interface Props {
  items: GroupedItem[]
  isWorking?: boolean
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

function shortenTitle(text: string, max = 90): string {
  const t = stripThinkTags(text)
  const firstLine = t.split('\n')[0]
  if (firstLine.length <= max) return firstLine
  return `${firstLine.slice(0, max - 1)}…`
}

function deriveTitle(items: GroupedItem[], isWorking?: boolean): string {
  if (isWorking) {
    // Show the latest meaningful step while streaming
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.type === 'task_section') return shortenTitle(item.title)
      if (item.type === 'sub_agent') return shortenTitle(item.task)
      if (
        item.type === 'message' &&
        item.message.role === 'assistant' &&
        !item.message.isThinking
      ) {
        return shortenTitle(item.message.content)
      }
    }
    return 'Working'
  }
  // When done, prefer the first step's title (the original goal)
  for (const item of items) {
    if (item.type === 'task_section') return shortenTitle(item.title)
    if (item.type === 'sub_agent') return shortenTitle(item.task)
    if (item.type === 'message' && item.message.role === 'assistant' && !item.message.isThinking) {
      return shortenTitle(item.message.content)
    }
  }
  return 'Steps'
}

function countSteps(items: GroupedItem[]): number {
  let n = 0
  for (const item of items) {
    if (item.type === 'task_section' || item.type === 'sub_agent' || item.type === 'actions') {
      n += Math.max(item.actions.length, 1)
    } else if (item.type === 'message' && item.message.isThinking) {
      n += 1
    }
  }
  return n
}

function collectSearchSources(items: GroupedItem[]): CitationSource[] {
  const seen = new Set<string>()
  const out: CitationSource[] = []
  const fromActions = (actions: ToolAction[]) => {
    for (const a of actions) {
      const tool = a.call.toolName
      if (!tool || !SEARCH_TOOLS.has(tool)) continue
      if (a.result?.isError) continue
      const content = a.result?.content
      if (!content) continue
      for (const s of parseCitationSources(content)) {
        if (seen.has(s.url)) continue
        seen.add(s.url)
        out.push(s)
      }
    }
  }
  for (const item of items) {
    if (item.type === 'task_section' || item.type === 'actions' || item.type === 'sub_agent') {
      fromActions(item.actions)
    }
  }
  return out
}

export function TurnProgress({ items, isWorking }: Props) {
  const [open, setOpen] = useState<boolean>(!!isWorking)
  const userToggledRef = useRef(false)

  // Open while working; auto-collapse once the assistant has written its
  // reply to the main conversation. Skip the auto behavior once the user
  // has manually toggled this turn so we respect their choice.
  useEffect(() => {
    if (userToggledRef.current) return
    setOpen(!!isWorking)
  }, [isWorking])

  const handleToggle = () => {
    userToggledRef.current = true
    setOpen((o) => !o)
  }

  const title = deriveTitle(items, isWorking)
  const stepCount = countSteps(items)
  const sources = useMemo(() => collectSearchSources(items), [items])

  if (items.length === 0) return null

  return (
    <div
      className={[
        'turn-progress',
        open ? 'turn-progress--open' : '',
        isWorking ? 'turn-progress--working' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {sources.length > 0 && (
        <div className="turn-progress__sources">
          <SourceCards sources={sources} />
        </div>
      )}

      <button type="button" className="turn-progress__header" onClick={handleToggle}>
        <span className="turn-progress__title">{title}</span>
        {stepCount > 0 && (
          <span className="turn-progress__count">
            {stepCount} step{stepCount !== 1 ? 's' : ''}
          </span>
        )}
        <ChevronRight size={13} strokeWidth={1.5} className="turn-progress__chev" />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="turn-progress__body">
              {items.map((item, idx) => {
                const isLast = idx === items.length - 1 && !!isWorking
                if (item.type === 'message') {
                  return (
                    <MessageBubble
                      key={item.message.id}
                      message={item.message}
                      isLastThinking={isLast && !!item.message.isThinking}
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
                      defaultExpanded={isLast}
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
                      defaultExpanded={isLast}
                    />
                  )
                }
                return (
                  <ActionsGroup key={item.id} actions={item.actions} defaultExpanded={isLast} />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
