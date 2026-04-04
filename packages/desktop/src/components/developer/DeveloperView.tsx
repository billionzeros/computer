import {
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Layers,
  RefreshCw,
  ScrollText,
  Terminal,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnectionStatus, useStore } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { uiStore } from '../../lib/store/uiStore.js'

type DevTab = 'overview' | 'events' | 'prompt' | 'memories'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.floor(s % 60)}s`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ── Status Bar ──

function StatusBar() {
  const connectionStatus = useConnectionStatus()
  const agentStatus = sessionStore((s) => s.agentStatus)
  const agentStatusDetail = sessionStore((s) => s.agentStatusDetail)
  const workingStartedAt = sessionStore((s) => s.workingStartedAt)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!workingStartedAt || agentStatus !== 'working') {
      setElapsed(0)
      return
    }
    const id = setInterval(() => setElapsed(Date.now() - workingStartedAt), 500)
    return () => clearInterval(id)
  }, [workingStartedAt, agentStatus])

  const connColor =
    connectionStatus === 'connected'
      ? 'var(--success)'
      : connectionStatus === 'error'
        ? 'var(--danger)'
        : 'var(--warning)'
  const agentColor =
    agentStatus === 'idle'
      ? 'var(--success)'
      : agentStatus === 'working'
        ? 'var(--warning)'
        : 'var(--danger)'

  return (
    <div className="dev-status-bar">
      <div className="dev-status-pill" style={{ '--pill-color': connColor } as React.CSSProperties}>
        {connectionStatus === 'connected' ? (
          <Wifi size={14} strokeWidth={1.5} />
        ) : (
          <WifiOff size={14} strokeWidth={1.5} />
        )}
        <span>{connectionStatus}</span>
      </div>
      <div
        className="dev-status-pill"
        style={{ '--pill-color': agentColor } as React.CSSProperties}
      >
        <Activity size={14} strokeWidth={1.5} />
        <span>
          {agentStatus}
          {agentStatusDetail ? ` — ${agentStatusDetail}` : ''}
        </span>
      </div>
      {agentStatus === 'working' && elapsed > 0 && (
        <div
          className="dev-status-pill"
          style={{ '--pill-color': 'var(--text-subtle)' } as React.CSSProperties}
        >
          <Clock size={14} strokeWidth={1.5} />
          <span>{formatDuration(elapsed)}</span>
        </div>
      )}
    </div>
  )
}

// ── Overview Tab ──

function OverviewTab() {
  const sessionStates = sessionStore((s) => s.sessionStates)
  const turnUsage = sessionStore((s) => s.turnUsage)
  const sessionUsage = sessionStore((s) => s.sessionUsage)
  const lastTurnDurationMs = sessionStore((s) => s.lastTurnDurationMs)
  const workingSessionId = sessionStore((s) => s.workingSessionId)

  const sessions = Array.from(sessionStates.entries())
  const activeSessions = sessions.filter(([, v]) => v.status === 'working')
  const streamingCount = sessions.filter(([, v]) => v.isStreaming).length

  return (
    <div className="dev-overview">
      {/* Sessions card */}
      <div className="dev-card">
        <div className="dev-card__header">
          <Layers size={15} strokeWidth={1.5} />
          <span>Sessions</span>
          <span className="dev-card__badge">{sessions.length}</span>
        </div>
        <div className="dev-card__body">
          <div className="dev-kv">
            <span className="dev-kv__label">Active</span>
            <span className="dev-kv__value">{activeSessions.length}</span>
          </div>
          <div className="dev-kv">
            <span className="dev-kv__label">Streaming</span>
            <span className="dev-kv__value">{streamingCount}</span>
          </div>
          {workingSessionId && (
            <div className="dev-kv">
              <span className="dev-kv__label">Working</span>
              <span className="dev-kv__value dev-kv__value--mono">
                {workingSessionId.slice(0, 16)}
              </span>
            </div>
          )}
          {sessions.length > 0 && (
            <div className="dev-session-list">
              {sessions.map(([sid, s]) => (
                <div key={sid} className="dev-session-row">
                  <span
                    className={`dev-session-dot dev-session-dot--${s.status === 'working' ? 'working' : s.status === 'error' ? 'error' : 'idle'}`}
                  />
                  <span className="dev-session-id">{sid.slice(0, 20)}</span>
                  <span className="dev-session-status">{s.status}</span>
                  {s.statusDetail && <span className="dev-session-detail">{s.statusDetail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Usage card */}
      <div className="dev-card">
        <div className="dev-card__header">
          <Zap size={15} strokeWidth={1.5} />
          <span>Usage</span>
        </div>
        <div className="dev-card__body">
          {lastTurnDurationMs != null && (
            <div className="dev-kv">
              <span className="dev-kv__label">Last turn</span>
              <span className="dev-kv__value">{formatDuration(lastTurnDurationMs)}</span>
            </div>
          )}
          {turnUsage && (
            <>
              <div className="dev-kv-group-label">Current turn</div>
              <div className="dev-kv">
                <span className="dev-kv__label">Input</span>
                <span className="dev-kv__value">{formatTokens(turnUsage.inputTokens)}</span>
              </div>
              <div className="dev-kv">
                <span className="dev-kv__label">Output</span>
                <span className="dev-kv__value">{formatTokens(turnUsage.outputTokens)}</span>
              </div>
              <div className="dev-kv">
                <span className="dev-kv__label">Cache read</span>
                <span className="dev-kv__value">{formatTokens(turnUsage.cacheReadTokens)}</span>
              </div>
              <div className="dev-kv">
                <span className="dev-kv__label">Cache write</span>
                <span className="dev-kv__value">{formatTokens(turnUsage.cacheWriteTokens)}</span>
              </div>
            </>
          )}
          {sessionUsage && (
            <>
              <div className="dev-kv-group-label">Session total</div>
              <div className="dev-kv">
                <span className="dev-kv__label">Total tokens</span>
                <span className="dev-kv__value">{formatTokens(sessionUsage.totalTokens)}</span>
              </div>
              <div className="dev-kv">
                <span className="dev-kv__label">Input</span>
                <span className="dev-kv__value">{formatTokens(sessionUsage.inputTokens)}</span>
              </div>
              <div className="dev-kv">
                <span className="dev-kv__label">Output</span>
                <span className="dev-kv__value">{formatTokens(sessionUsage.outputTokens)}</span>
              </div>
            </>
          )}
          {!turnUsage && !sessionUsage && <div className="dev-card__empty">No usage data yet</div>}
        </div>
      </div>
    </div>
  )
}

// ── Event Log Tab ──

const EVENT_TYPE_COLORS: Record<string, string> = {
  status: 'var(--info)',
  tool_call: 'var(--warning)',
  done: 'var(--success)',
  error: 'var(--danger)',
  thinking: 'var(--text-subtle)',
  session_created: 'var(--info)',
  session_destroyed: 'var(--text-subtle)',
}

function EventLogTab() {
  const eventLog = uiStore((s) => s.eventLog)
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="dev-event-log" ref={scrollRef}>
      {eventLog.length === 0 ? (
        <div className="dev-card__empty">No events yet. Events appear as the agent works.</div>
      ) : (
        eventLog.map((e) => (
          <div key={e.id} className="dev-event-row">
            <span className="dev-event-time">{formatTime(e.timestamp)}</span>
            <span
              className="dev-event-badge"
              style={{ color: EVENT_TYPE_COLORS[e.type] || 'var(--text-subtle)' }}
            >
              {e.type}
            </span>
            <span className="dev-event-summary">{e.summary}</span>
          </div>
        ))
      )}
    </div>
  )
}

// ── System Prompt Tab ──

function PromptTab() {
  const { systemPrompt, lastFetched } = uiStore((s) => s.devModeData)
  const activeConv = useStore((s) => s.getActiveConversation())
  const sessionId = activeConv?.id

  const refresh = useCallback(() => {
    sessionStore.getState().sendConfigQuery('system_prompt', sessionId)
  }, [sessionId])

  useEffect(() => {
    if (Date.now() - lastFetched > 30_000 || !systemPrompt) {
      refresh()
    }
  }, [refresh, lastFetched, systemPrompt])

  return (
    <div className="dev-prompt-tab">
      <div className="dev-prompt-tab__toolbar">
        <span className="dev-prompt-tab__label">
          {sessionId ? `Session ${sessionId.slice(0, 8)}...` : 'Base prompt (no session)'}
        </span>
        <button type="button" className="dev-prompt-tab__refresh" onClick={refresh} title="Refresh">
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>
      {systemPrompt ? (
        <pre className="dev-prompt-tab__content">{systemPrompt}</pre>
      ) : (
        <div className="dev-card__empty">Loading system prompt...</div>
      )}
    </div>
  )
}

// ── Memories Tab ──

function MemoriesTab() {
  const { memories, lastFetched } = uiStore((s) => s.devModeData)
  const activeConv = useStore((s) => s.getActiveConversation())
  const sessionId = activeConv?.id
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    sessionStore.getState().sendConfigQuery('memories', sessionId)
  }, [sessionId])

  useEffect(() => {
    if (Date.now() - lastFetched > 30_000 || memories.length === 0) {
      refresh()
    }
  }, [refresh, lastFetched, memories.length])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const globalMemories = memories.filter((m) => m.scope !== 'conversation')
  const convMemories = memories.filter((m) => m.scope === 'conversation')

  return (
    <div className="dev-memories-tab">
      <div className="dev-prompt-tab__toolbar">
        <span className="dev-prompt-tab__label">{memories.length} memories</span>
        <button type="button" className="dev-prompt-tab__refresh" onClick={refresh} title="Refresh">
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>
      {memories.length === 0 ? (
        <div className="dev-card__empty">No memories found</div>
      ) : (
        <div className="dev-memories-list">
          {globalMemories.length > 0 && (
            <div className="dev-memory-group">
              <div className="dev-kv-group-label">Global</div>
              {globalMemories.map((m) => {
                const key = `global-${m.name}`
                const isOpen = expanded.has(key)
                return (
                  <div key={key} className="dev-memory-item">
                    <button type="button" className="dev-memory-header" onClick={() => toggle(key)}>
                      {isOpen ? (
                        <ChevronDown size={14} strokeWidth={1.5} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} />
                      )}
                      <span>{m.name}</span>
                    </button>
                    {isOpen && <pre className="dev-memory-content">{m.content}</pre>}
                  </div>
                )
              })}
            </div>
          )}
          {convMemories.length > 0 && (
            <div className="dev-memory-group">
              <div className="dev-kv-group-label">Conversation</div>
              {convMemories.map((m) => {
                const key = `conv-${m.name}`
                const isOpen = expanded.has(key)
                return (
                  <div key={key} className="dev-memory-item">
                    <button type="button" className="dev-memory-header" onClick={() => toggle(key)}>
                      {isOpen ? (
                        <ChevronDown size={14} strokeWidth={1.5} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} />
                      )}
                      <span>{m.name}</span>
                    </button>
                    {isOpen && <pre className="dev-memory-content">{m.content}</pre>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main View ──

export function DeveloperView() {
  const [activeTab, setActiveTab] = useState<DevTab>('overview')

  const tabs: { id: DevTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={15} strokeWidth={1.5} /> },
    { id: 'events', label: 'Event Log', icon: <ScrollText size={15} strokeWidth={1.5} /> },
    { id: 'prompt', label: 'System Prompt', icon: <Terminal size={15} strokeWidth={1.5} /> },
    { id: 'memories', label: 'Memories', icon: <FileText size={15} strokeWidth={1.5} /> },
  ]

  return (
    <div className="developer-view">
      <div className="developer-view__inner">
        <StatusBar />

        <div className="dev-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`dev-tab${activeTab === tab.id ? ' dev-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="developer-view__content">
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'events' && <EventLogTab />}
          {activeTab === 'prompt' && <PromptTab />}
          {activeTab === 'memories' && <MemoriesTab />}
        </div>
      </div>
    </div>
  )
}
