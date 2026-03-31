import { Check, Download, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { connection } from '../lib/connection.js'
import { semverGt } from '../lib/semver.js'
import { useConnectionStatus, useStore } from '../lib/store.js'
import { FRONTEND_VERSION } from '../lib/version.js'
import { AntonLogo } from './AntonLogo.js'

/**
 * Update notification overlay for the anton agent.
 *
 * Three states:
 *   A) Update available — shows version + "Update now" button
 *   B) Update in progress — spinner + stage text, non-dismissable
 *   C) Update complete — check icon + "Updated to vX.Y.Z", auto-dismisses
 */
export function UpdateBanner() {
  const status = useConnectionStatus()
  const updateInfo = useStore((s) => s.updateInfo)
  const updateStage = useStore((s) => s.updateStage)
  const updateMessage = useStore((s) => s.updateMessage)
  const updateDismissed = useStore((s) => s.updateDismissed)
  const dismissUpdate = useStore((s) => s.dismissUpdate)
  const agentVersion = useStore((s) => s.agentVersion)

  // When a forced update is active, the ForceUpdateGate handles the UI
  const isForceUpdate =
    agentVersion !== null &&
    FRONTEND_VERSION !== '0.0.0' &&
    semverGt(FRONTEND_VERSION, agentVersion)
  if (isForceUpdate) return null

  // Auto-dismiss "done" state after 4 seconds
  useEffect(() => {
    if (updateStage !== 'done') return
    const timer = setTimeout(() => {
      dismissUpdate()
      useStore.getState().setUpdateProgress(null, null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [updateStage, dismissUpdate])

  // Determine which state to show
  const isUpdating =
    updateStage === 'pulling' ||
    updateStage === 'installing' ||
    updateStage === 'building' ||
    updateStage === 'downloading' ||
    updateStage === 'replacing' ||
    updateStage === 'restarting'
  const isDone = updateStage === 'done'
  const isError = updateStage === 'error'
  const hasUpdate = updateInfo?.updateAvailable && !updateDismissed && !updateStage

  const visible = hasUpdate || isUpdating || isDone || isError

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

  // When disconnected during restarting phase, override the label
  const isDisconnectedForUpdate =
    updateStage === 'restarting' && (status === 'disconnected' || status === 'connecting')

  if (!visible) return null

  return (
    <div className="update-banner">
      <div className="update-banner__card">
        {/* ── State A: Update available ── */}
        {hasUpdate && (
          <>
            <AntonLogo size={48} />
            <div className="update-banner__version">
              Update available: v{updateInfo.latestVersion}
            </div>
            {updateInfo.changelog && (
              <div className="update-banner__changelog">{updateInfo.changelog}</div>
            )}
            <button
              type="button"
              className="update-banner__action"
              onClick={() => connection.sendUpdateStart()}
            >
              <Download size={16} strokeWidth={1.5} />
              Update now
            </button>
            <button
              type="button"
              className="update-banner__dismiss"
              onClick={dismissUpdate}
              aria-label="Dismiss"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </>
        )}

        {/* ── State B: Update in progress ── */}
        {isUpdating && (
          <>
            <div className="update-banner__spinner">
              <Loader2 size={36} strokeWidth={1.5} className="update-banner__spin" />
            </div>
            <div className="update-banner__version">
              {isDisconnectedForUpdate
                ? 'Restarting your machine...'
                : stageLabel(updateStage)}
            </div>
            <div className="update-banner__changelog">
              {isDisconnectedForUpdate
                ? 'Reconnecting automatically when ready'
                : updateMessage || 'This may take a moment'}
            </div>
          </>
        )}

        {/* ── State C: Update complete ── */}
        {isDone && (
          <>
            <div className="update-banner__check">
              <Check size={36} strokeWidth={1.5} />
            </div>
            <div className="update-banner__version">
              Updated to v{agentVersion}
            </div>
            <div className="update-banner__changelog">Your machine is up to date</div>
          </>
        )}

        {/* ── State D: Error ── */}
        {isError && (
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
              Retry
            </button>
            <button
              type="button"
              className="update-banner__dismiss"
              onClick={() => {
                useStore.getState().setUpdateProgress(null, null)
                dismissUpdate()
              }}
              aria-label="Dismiss"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
