/**
 * Update checker for the anton.computer agent.
 *
 * Periodically checks the sidecar for available updates and notifies
 * the connected desktop client. The actual update execution is handled
 * by the sidecar (which calls `anton computer update`).
 */

import { UPDATE_CHECK_INTERVAL, type UpdateManifest, VERSION } from '@anton/agent-config'
import { createLogger } from '@anton/logger'

const log = createLogger('updater')

const SIDECAR_PORT = Number(process.env.SIDECAR_PORT) || 9878
const SIDECAR_BASE = `http://127.0.0.1:${SIDECAR_PORT}`

interface SidecarCheckResult {
  updateAvailable: boolean
  currentVersion: string
  latestVersion?: string
  changelog?: string
  releaseUrl?: string
}

export class Updater {
  private cachedCheck: SidecarCheckResult | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private token: string

  /** Called when a periodic check discovers a new version */
  onUpdateFound?: (manifest: UpdateManifest) => void

  constructor(token?: string) {
    this.token = token ?? process.env.ANTON_TOKEN ?? ''
  }

  /** Start periodic update checks */
  start() {
    this.checkForUpdates().catch((err) => {
      log.warn({ err }, 'update check failed')
    })

    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch((err) => {
        log.warn({ err }, 'update check failed')
      })
    }, UPDATE_CHECK_INTERVAL)
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  /** Get cached update info (for auth_ok handshake) */
  getUpdateAvailable(): UpdateManifest | null {
    if (!this.cachedCheck?.updateAvailable || !this.cachedCheck.latestVersion) return null
    return {
      version: this.cachedCheck.latestVersion,
      changelog: this.cachedCheck.changelog ?? '',
      releaseUrl: this.cachedCheck.releaseUrl ?? '',
      gitHash: '',
    }
  }

  /** Check for updates via the sidecar */
  async checkForUpdates(): Promise<{
    updateAvailable: boolean
    manifest: UpdateManifest | null
  }> {
    try {
      const res = await fetch(`${SIDECAR_BASE}/update/check`, {
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.token}` },
      })

      if (!res.ok) {
        log.warn({ status: res.status }, 'sidecar update check failed')
        return { updateAvailable: false, manifest: null }
      }

      const result = (await res.json()) as SidecarCheckResult
      this.cachedCheck = result

      if (result.updateAvailable && result.latestVersion) {
        log.info(
          { current: result.currentVersion, available: result.latestVersion },
          'update available',
        )

        const manifest: UpdateManifest = {
          version: result.latestVersion,
          changelog: result.changelog ?? '',
          releaseUrl: result.releaseUrl ?? '',
          gitHash: '',
        }

        if (this.onUpdateFound) {
          this.onUpdateFound(manifest)
        }

        return { updateAvailable: true, manifest }
      }

      return { updateAvailable: false, manifest: null }
    } catch (err) {
      log.warn({ err }, 'sidecar update check error')
      return { updateAvailable: false, manifest: null }
    }
  }

  /** Get current update status */
  getStatus() {
    const check = this.cachedCheck
    return {
      currentVersion: VERSION,
      latestVersion: check?.latestVersion ?? null,
      updateAvailable: check?.updateAvailable ?? false,
      changelog: check?.changelog ?? null,
      releaseUrl: check?.releaseUrl ?? null,
    }
  }
}
