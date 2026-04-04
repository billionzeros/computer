import { ChevronDown, ChevronRight, FileText, RefreshCw, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { uiStore } from '../../lib/store/uiStore.js'

type DevTab = 'prompt' | 'memories'

/** Don't re-fetch if data was fetched less than 30s ago */
const CACHE_TTL_MS = 30_000

export function DevModePanel() {
  const [activeTab, setActiveTab] = useState<DevTab>('prompt')
  const { systemPrompt, memories, lastFetched } = uiStore((s) => s.devModeData)
  const activeConv = useStore((s) => s.getActiveConversation())
  const sessionId = activeConv?.id

  const refresh = useCallback(() => {
    connection.sendConfigQuery('system_prompt', sessionId)
    connection.sendConfigQuery('memories', sessionId)
  }, [sessionId])

  useEffect(() => {
    // Only fetch if cache is stale or empty
    if (Date.now() - lastFetched > CACHE_TTL_MS || !systemPrompt) {
      refresh()
    }
  }, [refresh, lastFetched, systemPrompt])

  return (
    <div className="devmode-panel">
      <div className="devmode-panel__tabs">
        <button
          type="button"
          className={`devmode-panel__tab${activeTab === 'prompt' ? ' devmode-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('prompt')}
        >
          <Terminal size={14} strokeWidth={1.5} />
          System Prompt
        </button>
        <button
          type="button"
          className={`devmode-panel__tab${activeTab === 'memories' ? ' devmode-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('memories')}
        >
          <FileText size={14} strokeWidth={1.5} />
          Memories
        </button>
        <div className="devmode-panel__tabs-spacer" />
        <button type="button" className="devmode-panel__refresh" onClick={refresh} title="Refresh">
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="devmode-panel__content">
        {activeTab === 'prompt' && <PromptView prompt={systemPrompt} sessionId={sessionId} />}
        {activeTab === 'memories' && <MemoriesView memories={memories} />}
      </div>
    </div>
  )
}

function PromptView({ prompt, sessionId }: { prompt: string | null; sessionId?: string }) {
  if (!prompt) {
    return <div className="devmode-panel__empty">Loading system prompt...</div>
  }

  return (
    <div className="devmode-panel__prompt-wrap">
      {sessionId && (
        <div className="devmode-panel__prompt-badge">
          Full composed prompt for session {sessionId.slice(0, 8)}...
        </div>
      )}
      {!sessionId && (
        <div className="devmode-panel__prompt-badge">Base prompt (no active session)</div>
      )}
      <pre className="devmode-panel__prompt">{prompt}</pre>
    </div>
  )
}

function MemoriesView({
  memories,
}: { memories: { name: string; content: string; scope?: string }[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (memories.length === 0) {
    return <div className="devmode-panel__empty">No memories found</div>
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Group by scope
  const globalMemories = memories.filter((m) => m.scope !== 'conversation')
  const convMemories = memories.filter((m) => m.scope === 'conversation')

  return (
    <div className="devmode-panel__memories">
      {globalMemories.length > 0 && (
        <div className="devmode-panel__memory-group">
          <div className="devmode-panel__memory-group-label">Global</div>
          {globalMemories.map((m) => (
            <MemoryItem key={`global-${m.name}`} memory={m} expanded={expanded} onToggle={toggle} />
          ))}
        </div>
      )}
      {convMemories.length > 0 && (
        <div className="devmode-panel__memory-group">
          <div className="devmode-panel__memory-group-label">Conversation</div>
          {convMemories.map((m) => (
            <MemoryItem key={`conv-${m.name}`} memory={m} expanded={expanded} onToggle={toggle} />
          ))}
        </div>
      )}
    </div>
  )
}

function MemoryItem({
  memory,
  expanded,
  onToggle,
}: {
  memory: { name: string; content: string; scope?: string }
  expanded: Set<string>
  onToggle: (key: string) => void
}) {
  const key = `${memory.scope}-${memory.name}`
  const isOpen = expanded.has(key)
  return (
    <div className="devmode-panel__memory">
      <button type="button" className="devmode-panel__memory-header" onClick={() => onToggle(key)}>
        {isOpen ? (
          <ChevronDown size={14} strokeWidth={1.5} />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} />
        )}
        <span className="devmode-panel__memory-name">{memory.name}</span>
      </button>
      {isOpen && <pre className="devmode-panel__memory-content">{memory.content}</pre>}
    </div>
  )
}
