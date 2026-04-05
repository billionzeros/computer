import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { sessionStore, useActiveSessionState } from '../../lib/store/sessionStore.js'

/**
 * Lightweight debug overlay for observability.
 * Toggle with Ctrl+Shift+D (Cmd+Shift+D on Mac).
 * Shows agent status, connection state, streaming sessions, and last event timestamp.
 */
export function DebugOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        setVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!visible) return null

  return <DebugPanel onClose={() => setVisible(false)} />
}

function DebugPanel({ onClose }: { onClose: () => void }) {
  const agentStatus = useActiveSessionState((s) => s.status)
  const agentStatusDetail = useActiveSessionState((s) => s.statusDetail)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const workingStartedAt = useActiveSessionState((s) => s.workingStartedAt)
  const sessionStates = sessionStore((s) => s.sessionStates)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const workingFor =
    workingStartedAt && agentStatus === 'working'
      ? Math.round((now - workingStartedAt) / 1000)
      : null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        width: 340,
        background: 'rgba(0,0,0,0.9)',
        color: '#e0e0e0',
        borderRadius: 8,
        padding: 12,
        fontSize: 11,
        fontFamily: 'monospace',
        zIndex: 99999,
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: '#fff' }}>Debug</span>
        <button
          onClick={onClose}
          type="button"
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          close
        </button>
      </div>

      <Row
        label="Connection"
        value={connectionStatus}
        color={connectionStatus === 'connected' ? '#4ade80' : '#f87171'}
      />
      <Row
        label="Agent"
        value={agentStatus}
        color={
          agentStatus === 'idle' ? '#4ade80' : agentStatus === 'working' ? '#facc15' : '#f87171'
        }
      />
      {agentStatusDetail && <Row label="Detail" value={agentStatusDetail} />}
      {workingFor !== null && (
        <Row
          label="Working for"
          value={`${workingFor}s`}
          color={workingFor > 120 ? '#f87171' : '#facc15'}
        />
      )}
      <Row label="Assist msg ID" value="(per-session)" />
      <Row
        label="Streaming"
        value={(() => {
          const streaming = Array.from(sessionStates.entries())
            .filter(([, s]) => s.isStreaming)
            .map(([sid]) => sid.slice(0, 8))
          return streaming.length > 0 ? streaming.join(', ') : '(none)'
        })()}
      />

      {sessionStates.size > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
          <div style={{ color: '#888', marginBottom: 4 }}>Session statuses:</div>
          {Array.from(sessionStates.entries()).map(([sid, st]) => (
            <Row
              key={sid}
              label={sid.slice(0, 8)}
              value={`${st.status}${st.statusDetail ? ` — ${st.statusDetail}` : ''}`}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 6, color: '#555', fontSize: 10 }}>Ctrl+Shift+D to toggle</div>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span
        style={{
          color: color || '#e0e0e0',
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}
