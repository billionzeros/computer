import { AlertTriangle, Download, Loader2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { connection } from '../lib/connection.js'
import { semverGt } from '../lib/semver.js'
import { useConnectionStatus, useStore } from '../lib/store.js'
import { FRONTEND_VERSION } from '../lib/version.js'
import { AntonLogo } from './AntonLogo.js'

/**
 * Full-screen blocking gate that prevents app usage when the backend
 * version is older than the frontend. Non-dismissable — the user must
 * update before continuing.
 */
export function ForceUpdateGate({ children }: { children: ReactNode }) {
  const agentVersion = useStore((s) => s.agentVersion)
  const updateStage = useStore((s) => s.updateStage)
  const updateMessage = useStore((s) => s.updateMessage)
  const status = useConnectionStatus()

  // Only gate when we have a confirmed version AND the frontend is newer
  const requiresUpdate =
    agentVersion !== null &&
    FRONTEND_VERSION !== '0.0.0' &&
    semverGt(FRONTEND_VERSION, agentVersion)

  const isUpdating =
    updateStage === 'pulling' ||
    updateStage === 'installing' ||
    updateStage === 'building' ||
    updateStage === 'downloading' ||
    updateStage === 'replacing' ||
    updateStage === 'restarting'

  const isError = updateStage === 'error'

  // Show gate when version mismatch OR mid-forced-update OR error during forced update
  if (!requiresUpdate && !isUpdating && !(isError && requiresUpdate)) {
    return <>{children}</>
  }

  // If not a forced update scenario (versions now match but still updating from optional update), pass through
  if (!requiresUpdate && isUpdating) {
    return <>{children}</>
  }

  const isDisconnectedForUpdate =
    updateStage === 'restarting' && (status === 'disconnected' || status === 'connecting')

  const stageLabel = (stage: string | null): string => {
    switch (stage) {
      case 'downloading':
        return 'Downloading update...'
      case 'pulling':
        return 'Pulling latest code...'
      case 'replacing':
        return 'Installing binary...'
      case 'installing':
        return 'Installing dependencies...'
      case 'building':
        return 'Building...'
      case 'restarting':
        return 'Restarting your machine...'
      default:
        return 'Updating...'
    }
  }

  return (
    <div className="force-update-gate">
      <div className="update-banner__card">
        {/* ── Version mismatch — prompt to update ── */}
        {requiresUpdate && !isUpdating && !isError && (
          <>
            <AntonLogo size={48} />
            <div className="force-update-gate__icon">
              <AlertTriangle size={20} strokeWidth={1.5} />
            </div>
            <div className="update-banner__version">Update required</div>
            <div className="update-banner__changelog">
              Your machine is running <strong>v{agentVersion}</strong> but this app requires{' '}
              <strong>v{FRONTEND_VERSION}</strong>. Please update to continue.
            </div>
            <button
              type="button"
              className="update-banner__action"
              onClick={() => connection.sendUpdateStart()}
            >
              <Download size={16} strokeWidth={1.5} />
              Update now
            </button>
          </>
        )}

        {/* ── Update in progress ── */}
        {isUpdating && (
          <>
            <div className="update-banner__spinner">
              <Loader2 size={36} strokeWidth={1.5} className="update-banner__spin" />
            </div>
            <div className="update-banner__version">
              {isDisconnectedForUpdate ? 'Restarting your machine...' : stageLabel(updateStage)}
            </div>
            <div className="update-banner__changelog">
              {isDisconnectedForUpdate
                ? 'Reconnecting automatically when ready'
                : updateMessage || 'This may take a moment'}
            </div>
          </>
        )}

        {/* ── Error ── */}
        {isError && requiresUpdate && (
          <>
            <AntonLogo size={48} />
            <div className="update-banner__version update-banner__version--error">
              Update failed
            </div>
            <div className="update-banner__changelog">
              {updateMessage || 'Something went wrong'}
            </div>
            <button
              type="button"
              className="update-banner__action"
              onClick={() => {
                useStore.getState().setUpdateProgress(null, null)
                connection.sendUpdateStart()
              }}
            >
              <RotateCw size={16} strokeWidth={1.5} />
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  )
}
