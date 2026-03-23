/**
 * CLI version info, compatibility checks, and self-update.
 *
 * Version model (same as desktop + agent):
 *   - CLI_VERSION:     This CLI's release version
 *   - SPEC_VERSION:    Wire protocol version this CLI speaks
 *   - MIN_AGENT_SPEC:  Oldest agent spec this CLI can talk to
 *
 * Self-update:
 *   CLI checks manifest.json for a newer version.
 *   If available, downloads the binary and replaces itself.
 */

import {
  chmodSync,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

/** Wire protocol version this CLI speaks */
export const SPEC_VERSION = '0.5.0'

/** Minimum agent spec version this CLI requires */
export const MIN_AGENT_SPEC = '0.4.0'

/** Manifest URL — same one the agent uses */
export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/OmGuptaIND/anton.computer/main/manifest.json'

export interface CLIManifest {
  version: string
  specVersion: string
  gitHash: string
  changelog: string
  publishedAt: string
  cli?: string // Single .mjs bundle URL (platform-independent)
}

// ── Version resolution ──────────────────────────────────────────

/** Read version from package.json or build-time constant */
function getPackageVersion(): string {
  // In bundled binary, esbuild injects this via --define
  try {
    // @ts-expect-error -- injected at bundle time by esbuild --define:__CLI_VERSION__
    if (typeof __CLI_VERSION__ !== 'undefined') return __CLI_VERSION__
  } catch {}

  // Dev mode: read from package.json
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf-8'))
    return pkg.version ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
}

export const CLI_VERSION = getPackageVersion()

// ── Semver comparison ───────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map(Number)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

export function semverGt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a)
  const [bMaj, bMin, bPat] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat > bPat
}

export function semverGte(a: string, b: string): boolean {
  return a === b || semverGt(a, b)
}

// ── Compatibility check ─────────────────────────────────────────

/**
 * Check if the agent's spec version is compatible with this CLI.
 * Returns null if compatible, or an error message if not.
 */
export function checkAgentCompatibility(agentSpecVersion: string): string | null {
  if (!semverGte(agentSpecVersion, MIN_AGENT_SPEC)) {
    return `Agent spec ${agentSpecVersion} is too old (CLI requires >= ${MIN_AGENT_SPEC}). Ask the agent owner to update.`
  }
  return null
}

// ── Self-update ─────────────────────────────────────────────────

/**
 * Check if a newer CLI version is available.
 */
export async function checkForUpdate(): Promise<{
  available: boolean
  latest: string
  changelog: string | null
  downloadUrl: string | null
} | null> {
  try {
    const res = await fetch(UPDATE_MANIFEST_URL, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': `anton-cli/${CLI_VERSION}` },
    })
    if (!res.ok) return null

    const manifest = (await res.json()) as CLIManifest
    if (!semverGt(manifest.version, CLI_VERSION)) {
      return { available: false, latest: manifest.version, changelog: null, downloadUrl: null }
    }

    const downloadUrl = manifest.cli ?? null

    return {
      available: true,
      latest: manifest.version,
      changelog: manifest.changelog,
      downloadUrl,
    }
  } catch {
    return null
  }
}

/**
 * Download and replace the current CLI binary.
 * Only works when running as a standalone binary (not from source).
 */
export async function selfUpdate(downloadUrl: string): Promise<void> {
  const binaryPath = process.execPath
  const tempPath = `${binaryPath}.update-${Date.now()}`

  // Download
  const res = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(300_000),
    headers: { 'User-Agent': `anton-cli/${CLI_VERSION}` },
  })

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }

  const fileStream = createWriteStream(tempPath)
  // @ts-expect-error -- ReadableStream is compatible via fromWeb
  const nodeReadable = Readable.fromWeb(res.body)
  await pipeline(nodeReadable, fileStream)

  chmodSync(tempPath, 0o755)

  // Atomic replace with backup
  const backupPath = `${binaryPath}.bak`
  try {
    if (existsSync(binaryPath)) {
      renameSync(binaryPath, backupPath)
    }
    renameSync(tempPath, binaryPath)
  } catch (err) {
    // Rollback
    try {
      if (existsSync(backupPath)) renameSync(backupPath, binaryPath)
    } catch {}
    try {
      unlinkSync(tempPath)
    } catch {}
    throw err
  }

  // Clean up backup
  try {
    unlinkSync(backupPath)
  } catch {}
}
