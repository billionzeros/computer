import { Cpu, HardDrive, MemoryStick, MonitorCog, Timer, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { connection } from '../lib/connection.js'
import { useStore } from '../lib/store.js'

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
  const agentVersion = useStore((s) => s.agentVersion)

  const config = connection.currentConfig
  const machineName = config?.host?.replace('.antoncomputer.in', '') ?? config?.host ?? 'unknown'
  const isDomain = config?.host?.includes('.antoncomputer.in')

  useEffect(() => {
    if (!config) return

    const fetchStatus = async () => {
      try {
        // Build status URL based on connection type
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
    <div className="machine-info-overlay" onClick={onClose} onKeyDown={undefined}>
      <div className="machine-info-panel" onClick={(e) => e.stopPropagation()} onKeyDown={undefined}>
        {/* Header */}
        <div className="machine-info-panel__header">
          <div className="machine-info-panel__title-row">
            <MonitorCog size={18} strokeWidth={1.5} />
            <h3 className="machine-info-panel__title">{machineName}</h3>
          </div>
          <button type="button" onClick={onClose} className="machine-info-panel__close" aria-label="Close">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Connection info */}
        <div className="machine-info-panel__section">
          <div className="machine-info-panel__row">
            <span className="machine-info-panel__label">Host</span>
            <span className="machine-info-panel__value">{config?.host}</span>
          </div>
          <div className="machine-info-panel__row">
            <span className="machine-info-panel__label">Port</span>
            <span className="machine-info-panel__value">{config?.port}</span>
          </div>
          <div className="machine-info-panel__row">
            <span className="machine-info-panel__label">TLS</span>
            <span className="machine-info-panel__value">{config?.useTLS ? 'Yes' : 'No'}</span>
          </div>
          {agentVersion && (
            <div className="machine-info-panel__row">
              <span className="machine-info-panel__label">Agent</span>
              <span className="machine-info-panel__value">{agentVersion}</span>
            </div>
          )}
        </div>

        {/* System stats */}
        {loading && (
          <div className="machine-info-panel__section machine-info-panel__loading">
            Loading system info...
          </div>
        )}

        {error && !status && (
          <div className="machine-info-panel__section machine-info-panel__error">{error}</div>
        )}

        {status && (
          <div className="machine-info-panel__section">
            <div className="machine-info-panel__stats">
              <div className="machine-info-panel__stat">
                <Cpu size={14} strokeWidth={1.5} />
                <span className="machine-info-panel__stat-label">CPU</span>
                <span className="machine-info-panel__stat-value">
                  {status.system.cpuPercent.toFixed(0)}%
                </span>
              </div>

              <div className="machine-info-panel__stat">
                <MemoryStick size={14} strokeWidth={1.5} />
                <span className="machine-info-panel__stat-label">Memory</span>
                <span className="machine-info-panel__stat-value">
                  {(status.system.memUsedMB / 1024).toFixed(1)} / {(status.system.memTotalMB / 1024).toFixed(1)} GB
                </span>
              </div>

              <div className="machine-info-panel__stat">
                <HardDrive size={14} strokeWidth={1.5} />
                <span className="machine-info-panel__stat-label">Disk</span>
                <span className="machine-info-panel__stat-value">
                  {status.system.diskUsedGB.toFixed(1)} / {status.system.diskTotalGB.toFixed(1)} GB
                </span>
              </div>

              <div className="machine-info-panel__stat">
                <Timer size={14} strokeWidth={1.5} />
                <span className="machine-info-panel__stat-label">Uptime</span>
                <span className="machine-info-panel__stat-value">
                  {formatUptime(status.system.uptimeSeconds)}
                </span>
              </div>
            </div>

            {/* Service status */}
            <div className="machine-info-panel__services">
              <div className="machine-info-panel__service">
                <span
                  className={`machine-info-panel__dot ${status.agent.healthy ? 'machine-info-panel__dot--ok' : 'machine-info-panel__dot--err'}`}
                />
                <span>Agent</span>
              </div>
              <div className="machine-info-panel__service">
                <span
                  className={`machine-info-panel__dot ${status.caddy.running ? 'machine-info-panel__dot--ok' : 'machine-info-panel__dot--err'}`}
                />
                <span>Caddy</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
