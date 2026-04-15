import type { ConnectionStatus } from '../../lib/connection.js'
import type { RoutineStatus } from '../../lib/store.js'

interface Props {
  type: 'connection' | 'agent'
  status: ConnectionStatus | RoutineStatus
  label?: boolean
}

export function StatusIndicator({ type, status, label = true }: Props) {
  const config =
    type === 'connection'
      ? connectionConfig[status as ConnectionStatus] || connectionConfig.disconnected
      : agentConfig[status as RoutineStatus] || agentConfig.unknown

  return (
    <div className="status-indicator">
      <span
        className={`status-indicator__dot ${config.className} ${config.animate ? 'status-indicator__dot--pulse' : ''}`}
      />
      {label && <span className="status-indicator__label">{config.label}</span>}
    </div>
  )
}

const connectionConfig: Record<
  ConnectionStatus,
  { className: string; label: string; animate: boolean }
> = {
  connected: { className: 'status-indicator__dot--success', label: 'Connected', animate: false },
  connecting: {
    className: 'status-indicator__dot--warning',
    label: 'Connecting...',
    animate: true,
  },
  authenticating: {
    className: 'status-indicator__dot--warning',
    label: 'Authenticating...',
    animate: true,
  },
  disconnected: {
    className: 'status-indicator__dot--muted',
    label: 'Disconnected',
    animate: false,
  },
  error: { className: 'status-indicator__dot--danger', label: 'Error', animate: false },
}

const agentConfig: Record<RoutineStatus, { className: string; label: string; animate: boolean }> = {
  idle: { className: 'status-indicator__dot--success', label: 'Ready', animate: false },
  working: { className: 'status-indicator__dot--warning', label: 'Working...', animate: true },
  error: { className: 'status-indicator__dot--danger', label: 'Error', animate: false },
  unknown: { className: 'status-indicator__dot--muted', label: 'Unknown', animate: false },
}
