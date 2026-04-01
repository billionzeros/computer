/**
 * Self-update checker and executor for the anton.computer agent.
 *
 * Flow:
 *   1. On startup + every UPDATE_CHECK_INTERVAL, fetch the manifest from GitHub
 *   2. Compare versions — if newer, cache in memory
 *   3. On client connect (auth_ok), include updateAvailable if cached
 *   4. Client can trigger update_start → agent downloads binary, replaces, restarts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

export class Updater {
  private cachedManifest: UpdateManifest | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private updating = false

  /** Called when a periodic check discovers a new version (not on explicit update_check) */
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
   * Execute self-update: download pre-compiled binary, replace, restart.
   */
  async *selfUpdate(): AsyncGenerator<UpdateProgress> {
    if (this.updating) {
      yield { stage: 'error', message: 'Update already in progress' }
      return
    }

    this.updating = true

    try {
      // If no manifest cached, do a fresh check before giving up
      if (!this.cachedManifest) {
        yield { stage: 'downloading', message: 'Checking for updates...' }
        await this.checkForUpdates()
      }

      const manifest = this.cachedManifest
      if (!manifest) {
        yield { stage: 'error', message: 'No update available.' }
        return
      }

      const binaryUrl = this.resolveBinaryUrl(manifest)
      if (!binaryUrl) {
        yield { stage: 'error', message: `No binary available for ${process.platform}-${process.arch}` }
        return
      }

      yield* this.binaryUpdate(manifest, binaryUrl)
    } catch (err: unknown) {
      yield { stage: 'error', message: `Update failed: ${(err as Error).message}` }
    } finally {
      this.updating = false
    }
  }

  /** Get current update status for update_check_response */
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

  /**
   * Resolve the path of the currently running binary.
   * Priority: process.execPath (for SEA binaries) → /usr/local/bin/anton-agent → ~/.anton/anton-agent
   */
  private resolveCurrentBinaryPath(): string {
    const antonDir = getAntonDir()

    const execName = process.execPath.split('/').pop() ?? ''
    if (execName.includes('anton-agent')) {
      return process.execPath
    }

    const systemBin = '/usr/local/bin/anton-agent'
    if (existsSync(systemBin)) {
      return systemBin
    }

    return join(antonDir, 'anton-agent')
  }

  private async *binaryUpdate(
    manifest: UpdateManifest,
    binaryUrl: string,
  ): AsyncGenerator<UpdateProgress> {
    const antonDir = getAntonDir()
    const binaryPath = this.resolveCurrentBinaryPath()
    const tempPath = `${binaryPath}.update-${Date.now()}`

    // 1. Download binary
    yield { stage: 'downloading', message: `Downloading v${manifest.version}...` }
    const res = await fetch(binaryUrl, {
      signal: AbortSignal.timeout(300_000),
      headers: { 'User-Agent': `anton-agent/${VERSION}` },
    })

    if (!res.ok || !res.body) {
      yield { stage: 'error', message: `Download failed: HTTP ${res.status}` }
      return
    }

    const { createWriteStream, unlinkSync, renameSync, chmodSync } = await import('node:fs')
    const { pipeline } = await import('node:stream/promises')
    const { Readable } = await import('node:stream')

    const fileStream = createWriteStream(tempPath)
    // @ts-expect-error -- ReadableStream is compatible with node Readable via fromWeb
    const nodeReadable = Readable.fromWeb(res.body)
    await pipeline(nodeReadable, fileStream)

    chmodSync(tempPath, 0o755)
    yield { stage: 'downloading', message: `Downloaded v${manifest.version}` }

    // 2. Atomic replace
    yield { stage: 'replacing', message: `Replacing binary at ${binaryPath}...` }
    try {
      if (existsSync(binaryPath)) {
        renameSync(binaryPath, `${binaryPath}.bak`)
      }
      renameSync(tempPath, binaryPath)
    } catch (err) {
      try {
        if (existsSync(`${binaryPath}.bak`)) {
          renameSync(`${binaryPath}.bak`, binaryPath)
        }
      } catch {}
      try {
        unlinkSync(tempPath)
      } catch {}
      yield { stage: 'error', message: `Binary replace failed: ${(err as Error).message}` }
      return
    }

    try {
      unlinkSync(`${binaryPath}.bak`)
    } catch {}

    // 3. Write version.json
    writeFileSync(
      join(antonDir, 'version.json'),
      JSON.stringify({
        version: manifest.version,
        gitHash: manifest.gitHash,
        deployedAt: new Date().toISOString(),
        deployedBy: 'self-update',
      }),
    )

    // 4. Clear cached manifest
    this.cachedManifest = null

    // 5. Restart
    yield { stage: 'restarting', message: 'Restarting anton-agent service...' }
    try {
      const { execSync } = await import('node:child_process')
      execSync('sudo systemctl restart anton-agent', { stdio: 'pipe', timeout: 30_000 })
    } catch {
      yield {
        stage: 'restarting',
        message: 'No systemd — process will exit. Restart manually or use a process manager.',
      }
    }

    yield { stage: 'done', message: `Updated to v${manifest.version} (${manifest.gitHash})` }
  }

  private resolveBinaryUrl(manifest: UpdateManifest): string | null {
    if (!manifest.binaries) return null

    const platform =
      process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'darwin' : null
    const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null

    if (!platform || !arch) return null

    return manifest.binaries[`${platform}-${arch}`] ?? null
  }
}
