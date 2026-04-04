/**
 * Self-update checker and executor for the anton.computer agent.
 *
 * Repo-clone model:
 *   1. On startup + every UPDATE_CHECK_INTERVAL, fetch the manifest from GitHub
 *   2. Compare versions — if newer, cache in memory
 *   3. Client can trigger update_start → agent does git pull + pnpm build + restart
 */

import { execSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  UPDATE_CHECK_INTERVAL,
  UPDATE_MANIFEST_URL,
  type UpdateManifest,
  VERSION,
  getAntonDir,
  semverGt,
} from '@anton/agent-config'

export type UpdateStage = 'downloading' | 'replacing' | 'restarting' | 'done' | 'error'
export type UpdateProgress = { stage: UpdateStage; message: string }

/** Where the repo lives on disk */
const REPO_DIR = '/opt/anton'

export class Updater {
  private cachedManifest: UpdateManifest | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private updating = false

  /** Called when a periodic check discovers a new version */
  onUpdateFound?: (manifest: UpdateManifest) => void

  /** Start periodic update checks */
  start() {
    this.checkForUpdates().catch((err) => {
      console.warn('  Update check failed:', (err as Error).message)
    })

    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch((err) => {
        console.warn('  Update check failed:', (err as Error).message)
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
    if (!this.cachedManifest) return null
    if (semverGt(this.cachedManifest.version, VERSION)) {
      return this.cachedManifest
    }
    return null
  }

  /** Check the manifest URL for a newer version */
  async checkForUpdates(): Promise<{
    updateAvailable: boolean
    manifest: UpdateManifest | null
  }> {
    try {
      const res = await fetch(UPDATE_MANIFEST_URL, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': `anton-agent/${VERSION}` },
      })

      if (!res.ok) {
        return { updateAvailable: false, manifest: null }
      }

      const manifest = (await res.json()) as UpdateManifest

      if (semverGt(manifest.version, VERSION)) {
        const isNew = !this.cachedManifest || this.cachedManifest.version !== manifest.version
        this.cachedManifest = manifest
        console.log(`  Update available: v${VERSION} → v${manifest.version}`)

        if (isNew && this.onUpdateFound) {
          this.onUpdateFound(manifest)
        }

        return { updateAvailable: true, manifest }
      }

      this.cachedManifest = null
      return { updateAvailable: false, manifest }
    } catch {
      return { updateAvailable: false, manifest: this.cachedManifest }
    }
  }

  /**
   * Execute self-update: git pull + pnpm install + build + restart.
   */
  async *selfUpdate(): AsyncGenerator<UpdateProgress> {
    if (this.updating) {
      yield { stage: 'error', message: 'Update already in progress' }
      return
    }

    this.updating = true

    try {
      // If no manifest cached, do a fresh check
      if (!this.cachedManifest) {
        yield { stage: 'downloading', message: 'Checking for updates...' }
        await this.checkForUpdates()
      }

      const manifest = this.cachedManifest
      if (!manifest) {
        yield { stage: 'error', message: 'No update available.' }
        return
      }

      yield* this.repoUpdate(manifest)
    } catch (err: unknown) {
      yield { stage: 'error', message: `Update failed: ${(err as Error).message}` }
    } finally {
      this.updating = false
    }
  }

  /** Get current update status */
  getStatus() {
    const manifest = this.getUpdateAvailable()
    return {
      currentVersion: VERSION,
      latestVersion: manifest?.version ?? null,
      updateAvailable: manifest !== null,
      changelog: manifest?.changelog ?? null,
      releaseUrl: manifest?.releaseUrl ?? null,
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private async *repoUpdate(manifest: UpdateManifest): AsyncGenerator<UpdateProgress> {
    const antonDir = getAntonDir()

    // Check if repo exists
    if (!existsSync(join(REPO_DIR, '.git'))) {
      yield {
        stage: 'error',
        message: `Repo not found at ${REPO_DIR}. Run 'anton computer setup' first.`,
      }
      return
    }

    // 1. Git pull
    yield { stage: 'downloading', message: `Pulling v${manifest.version}...` }
    try {
      execSync('git fetch origin', { cwd: REPO_DIR, stdio: 'pipe', timeout: 60_000 })
      execSync('git reset --hard origin/main', { cwd: REPO_DIR, stdio: 'pipe', timeout: 30_000 })
    } catch (err) {
      yield { stage: 'error', message: `Git pull failed: ${(err as Error).message}` }
      return
    }
    yield { stage: 'downloading', message: 'Code updated' }

    // 2. Install deps
    yield { stage: 'replacing', message: 'Installing dependencies...' }
    try {
      execSync('pnpm install', { cwd: REPO_DIR, stdio: 'pipe', timeout: 300_000 })
    } catch (err) {
      yield { stage: 'error', message: `pnpm install failed: ${(err as Error).message}` }
      return
    }

    // 3. Build
    yield { stage: 'replacing', message: 'Building...' }
    try {
      execSync('pnpm -r build', { cwd: REPO_DIR, stdio: 'pipe', timeout: 120_000 })
    } catch (err) {
      yield { stage: 'error', message: `Build failed: ${(err as Error).message}` }
      return
    }
    yield { stage: 'replacing', message: 'Build complete' }

    // 4. Write version.json
    writeFileSync(
      join(antonDir, 'version.json'),
      JSON.stringify({
        version: manifest.version,
        gitHash: manifest.gitHash,
        deployedAt: new Date().toISOString(),
        deployedBy: 'self-update',
      }),
    )

    // 5. Clear cached manifest
    this.cachedManifest = null

    // 6. Restart
    yield { stage: 'restarting', message: 'Restarting anton-agent service...' }
    try {
      execSync('sudo systemctl restart anton-agent', { stdio: 'pipe', timeout: 30_000 })
    } catch {
      yield {
        stage: 'restarting',
        message: 'No systemd — process will exit. Restart manually or use a process manager.',
      }
    }

    yield { stage: 'done', message: `Updated to v${manifest.version} (${manifest.gitHash})` }
  }
}
