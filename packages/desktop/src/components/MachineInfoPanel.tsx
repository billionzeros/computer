import { Cpu, HardDrive, MemoryStick, MonitorCog, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { connection } from '../lib/connection.js'
import { updateStore } from '../lib/store/updateStore.js'
import { AntonModal } from './ui/AntonModal.js'

interface SystemStatus {
  status: string
  agent: { healthy: boolean }
  caddy: { running: boolean }
  system: {
    cpuPercent: number
    memUsedMB: number
    memTotalMB: number
    diskUsedGB: number
    diskTotalGB: number
    uptimeSeconds: number
  }
  version: string
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function MachineInfoPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const agentVersion = updateStore((s) => s.agentVersion)

  const config = connection.currentConfig
  const machineName = config?.host?.replace('.antoncomputer.in', '') ?? config?.host ?? 'unknown'
  const isDomain = config?.host?.includes('.antoncomputer.in')

  useEffect(() => {
    if (!config) return

    const fetchStatus = async () => {
      try {
        const statusUrl = isDomain
          ? `https://${config.host}/_anton/status`
          : `http://${config.host}:9878/status`

        const res = await fetch(statusUrl, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const data = await res.json()
          setStatus(data)
        } else {
          setError('Could not reach sidecar')
        }
      } catch {
        setError('Status endpoint unreachable')
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 10_000)
    return () => clearInterval(interval)
  }, [config, isDomain])

  return (
    <AntonModal
      open
      onClose={onClose}
      title={machineName}
      subtitle={config?.host ?? ''}
      icon={<MonitorCog size={16} strokeWidth={1.5} />}
      size="md"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 14px',
          fontSize: 12.5,
        }}
      >
        <span style={{ color: 'var(--text-4)' }}>Host</span>
        <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {config?.host ?? '—'}
        </span>
        <span style={{ color: 'var(--text-4)' }}>Port</span>
        <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {config?.port ?? '—'}
        </span>
        <span style={{ color: 'var(--text-4)' }}>TLS</span>
        <span style={{ color: 'var(--text)' }}>{config?.useTLS ? 'Yes' : 'No'}</span>
        {agentVersion && (
          <>
            <span style={{ color: 'var(--text-4)' }}>Agent</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {agentVersion}
            </span>
          </>
        )}
      </div>

      {loading && (
        <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>Loading system info…</div>
      )}

      {error && !status && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</div>}

      {status && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10,
            }}
          >
            <Stat icon={<Cpu size={13} strokeWidth={1.5} />} label="CPU">
              {status.system.cpuPercent.toFixed(0)}%
            </Stat>
            <Stat icon={<MemoryStick size={13} strokeWidth={1.5} />} label="Memory">
              {(status.system.memUsedMB / 1024).toFixed(1)} /{' '}
              {(status.system.memTotalMB / 1024).toFixed(1)} GB
            </Stat>
            <Stat icon={<HardDrive size={13} strokeWidth={1.5} />} label="Disk">
              {status.system.diskUsedGB.toFixed(1)} / {status.system.diskTotalGB.toFixed(1)} GB
            </Stat>
            <Stat icon={<Timer size={13} strokeWidth={1.5} />} label="Uptime">
              {formatUptime(status.system.uptimeSeconds)}
            </Stat>
          </div>

          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-3)' }}>
            <ServiceDot ok={status.agent.healthy} label="Agent" />
            <ServiceDot ok={status.caddy.running} label="Caddy" />
          </div>
        </>
      )}
    </AntonModal>
  )
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--text-4)',
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ServiceDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ok ? 'var(--success)' : 'var(--danger)',
          boxShadow: ok
            ? '0 0 0 2px color-mix(in oklch, var(--success) 22%, transparent)'
            : '0 0 0 2px color-mix(in oklch, var(--danger) 22%, transparent)',
        }}
      />
      <span>{label}</span>
    </span>
  )
}
