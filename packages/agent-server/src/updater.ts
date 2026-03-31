/**
 * Self-update checker and executor for the anton.computer agent.
 *
 * Flow:
 *   1. On startup + every UPDATE_CHECK_INTERVAL, fetch the manifest from GitHub
 *   2. Compare versions — if newer, cache the manifest
 *   3. On client connect (auth_ok), include updateAvailable if cached
 *   4. Client can trigger update_start → agent pulls, rebuilds, restarts via systemd
 *
 * The agent owns its own updates. The desktop is just a viewer.
 */

import { execSync } from 'node:child_process'
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

const CACHED_MANIFEST_PATH = join(getAntonDir(), 'update-manifest.json')

type UpdateStage =
  | 'downloading'
  | 'replacing'
  | 'restarting'
  | 'done'
  | 'error'
  | 'pulling'
  | 'installing'
  | 'building'
type UpdateProgress = { stage: UpdateStage; message: string }

export class Updater {
  private cachedManifest: UpdateManifest | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private updating = false

  /** Called when a periodic check discovers a new version (not on explicit update_check) */
  onUpdateFound?: (manifest: UpdateManifest) => void

  /** Start periodic update checks */
  start() {
    // Load cached manifest from disk (persists across restarts)
    this.loadCachedManifest()

    // Check immediately on startup, then periodically
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
    // Only return if it's actually newer than current
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
        this.saveCachedManifest()
        console.log(`  Update available: v${VERSION} → v${manifest.version}`)

        // Notify server to broadcast to connected clients
        if (isNew && this.onUpdateFound) {
          this.onUpdateFound(manifest)
        }

        return { updateAvailable: true, manifest }
      }

      // Current version is up to date — clear any stale cache
      if (this.cachedManifest) {
        this.cachedManifest = null
        this.saveCachedManifest()
      }

      return { updateAvailable: false, manifest }
    } catch {
      // Network error, offline, etc. — not a problem
      return { updateAvailable: false, manifest: this.cachedManifest }
    }
  }

  /**
   * Execute self-update by downloading the pre-compiled binary from the release.
   *
   * Pipeline:
   *   1. Resolve the binary URL for this platform+arch from the manifest
   *   2. Download the new binary to a temp path
   *   3. Replace the current binary (atomic rename)
   *   4. Write version.json
   *   5. Restart via systemd (or exit for process manager to restart)
   *
   * Falls back to the legacy git-pull pipeline if no binary URL is available
   * in the manifest (e.g. for local dev or pre-binary releases).
   */
  async *selfUpdate(): AsyncGenerator<UpdateProgress> {
    if (this.updating) {
      yield { stage: 'error', message: 'Update already in progress' }
      return
    }

    this.updating = true

    try {
      const manifest = this.cachedManifest
      if (!manifest) {
        yield {
          stage: 'error',
          message: 'No update manifest available. Run an update check first.',
        }
        return
      }

      const binaryUrl = this.resolveBinaryUrl(manifest)

      if (binaryUrl) {
        // ── Binary update path (fast) ──────────────────────────────
        yield* this.binaryUpdate(manifest, binaryUrl)
      } else {
        // ── Legacy source update path (fallback) ───────────────────
        yield* this.sourceUpdate(manifest)
      }
    } catch (err: unknown) {
      yield { stage: 'error', message: `Update failed: ${(err as Error).message}` }
    } finally {
      this.updating = false
    }
  }

  /**
   * Fast path: download pre-compiled binary and replace in-place.
   */
  private async *binaryUpdate(
    manifest: UpdateManifest,
    binaryUrl: string,
  ): AsyncGenerator<UpdateProgress> {
    const antonDir = getAntonDir()
    const binaryPath = join(antonDir, 'anton-agent')
    const tempPath = `${binaryPath}.update-${Date.now()}`

    // 1. Download binary
    yield { stage: 'downloading', message: `Downloading v${manifest.version} binary...` }
    const res = await fetch(binaryUrl, {
      signal: AbortSignal.timeout(300_000), // 5 min timeout for large binaries
      headers: { 'User-Agent': `anton-agent/${VERSION}` },
    })

    if (!res.ok || !res.body) {
      yield { stage: 'error', message: `Download failed: HTTP ${res.status}` }
      return
    }

    // Stream to temp file
    const { createWriteStream, unlinkSync, renameSync, chmodSync } = await import('node:fs')
    const { Writable: _Writable } = await import('node:stream')
    const { pipeline } = await import('node:stream/promises')
    const { Readable } = await import('node:stream')

    const fileStream = createWriteStream(tempPath)
    // @ts-expect-error -- ReadableStream is compatible with node Readable via fromWeb
    const nodeReadable = Readable.fromWeb(res.body)
    await pipeline(nodeReadable, fileStream)

    // Make executable
    chmodSync(tempPath, 0o755)

    yield { stage: 'downloading', message: `Downloaded ${manifest.version} binary` }

    // 2. Atomic replace
    yield { stage: 'replacing', message: 'Replacing current binary...' }
    try {
      // Back up current binary in case we need to rollback
      if (existsSync(binaryPath)) {
        renameSync(binaryPath, `${binaryPath}.bak`)
      }
      renameSync(tempPath, binaryPath)
    } catch (err) {
      // Rollback: restore backup
      try {
        if (existsSync(`${binaryPath}.bak`)) {
          renameSync(`${binaryPath}.bak`, binaryPath)
        }
      } catch {}
      // Clean up temp file
      try {
        unlinkSync(tempPath)
      } catch {}
      yield { stage: 'error', message: `Binary replace failed: ${(err as Error).message}` }
      return
    }

    // Clean up backup (non-critical)
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
        deployedBy: 'self-update-binary',
      }),
    )

    // 4. Clear cached manifest
    this.cachedManifest = null
    this.saveCachedManifest()

    // 5. Restart
    yield { stage: 'restarting', message: 'Restarting anton-agent service...' }
    try {
      this.run('sudo systemctl restart anton-agent', antonDir)
    } catch {
      yield {
        stage: 'restarting',
        message: 'No systemd — process will exit. Restart manually or use a process manager.',
      }
    }

    yield { stage: 'done', message: `Updated to v${manifest.version} (${manifest.gitHash})` }
  }

  /**
   * Legacy fallback: git pull → pnpm install → pnpm build → restart.
   * Used when the manifest has no binary URLs (dev builds, pre-binary releases).
   */
  private async *sourceUpdate(manifest: UpdateManifest): AsyncGenerator<UpdateProgress> {
    const agentDir = this.resolveAgentDir()

    if (!agentDir) {
      yield {
        stage: 'error',
        message: 'Could not find agent source directory and no binary URL in manifest',
      }
      return
    }

    // 1. Pull
    yield { stage: 'pulling', message: 'Pulling latest code from remote...' }
    const pullOutput = this.run('git pull --ff-only', agentDir)
    yield { stage: 'pulling', message: pullOutput }

    // 2. Install
    yield { stage: 'installing', message: 'Installing dependencies...' }
    const installOutput = this.run('pnpm install --no-frozen-lockfile', agentDir)
    yield { stage: 'installing', message: installOutput }

    // 3. Build
    yield { stage: 'building', message: 'Building packages...' }
    const buildOutput = this.run(
      'pnpm --filter @anton/protocol build && ' +
        'pnpm --filter @anton/agent-config build && ' +
        'pnpm --filter @anton/agent-core build && ' +
        'pnpm --filter @anton/agent-server build && ' +
        'pnpm --filter @anton/agent build',
      agentDir,
    )
    yield { stage: 'building', message: buildOutput }

    // 4. Write version.json
    const newHash = this.run('git rev-parse --short HEAD', agentDir).trim()
    writeFileSync(
      join(getAntonDir(), 'version.json'),
      JSON.stringify({
        version: manifest.version,
        gitHash: newHash,
        branch: 'main',
        deployedAt: new Date().toISOString(),
        deployedBy: 'self-update-source',
      }),
    )

    // 5. Restart
    yield { stage: 'restarting', message: 'Restarting anton-agent service...' }
    try {
      this.run('sudo systemctl restart anton-agent', agentDir)
    } catch {
      yield {
        stage: 'restarting',
        message: 'No systemd — process will exit. Restart manually or use a process manager.',
      }
    }

    this.cachedManifest = null
    this.saveCachedManifest()

    yield { stage: 'done', message: `Updated to v${manifest.version} (${newHash})` }
  }

  /**
   * Resolve the binary download URL for the current platform + arch.
   * Returns null if no binary is available (falls back to source update).
   */
  private resolveBinaryUrl(manifest: UpdateManifest): string | null {
    if (!manifest.binaries) return null

    const platform =
      process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'darwin' : null
    const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null

    if (!platform || !arch) return null

    const key = `${platform}-${arch}`
    return manifest.binaries[key] ?? null
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

  // ── Helpers ─────────────────────────────────────────────────────

  private resolveAgentDir(): string | null {
    // Check common locations
    const candidates = [
      join(getAntonDir(), 'agent'), // deployed via Makefile sync
      '/opt/anton', // system install
    ]

    // Also try to find via git (if running from source)
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', { stdio: 'pipe' }).toString().trim()
      if (gitRoot && existsSync(join(gitRoot, 'package.json'))) {
        candidates.unshift(gitRoot)
      }
    } catch {}

    for (const dir of candidates) {
      if (existsSync(join(dir, 'package.json'))) {
        return dir
      }
    }
    return null
  }

  private run(cmd: string, cwd: string): string {
    return execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    }).toString()
  }

  private loadCachedManifest() {
    try {
      if (existsSync(CACHED_MANIFEST_PATH)) {
        this.cachedManifest = JSON.parse(readFileSync(CACHED_MANIFEST_PATH, 'utf-8'))
      }
    } catch {}
  }

  private saveCachedManifest() {
    try {
      if (this.cachedManifest) {
        writeFileSync(CACHED_MANIFEST_PATH, JSON.stringify(this.cachedManifest, null, 2))
      } else {
        // Clear the file
        writeFileSync(CACHED_MANIFEST_PATH, '{}')
      }
    } catch {}
  }
}
