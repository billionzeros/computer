/**
 * CLI version info and self-update.
 *
 * Single unified version for agent, sidecar, desktop, and CLI.
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

/** Manifest URL — same one the agent uses */
export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/billionzeros/computer/main/manifest.json'

export interface CLIManifest {
  version: string
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

  // Dev mode: walk up from compiled JS to find package.json
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'))
        if (pkg.name && pkg.version) return pkg.version
      }
      dir = dirname(dir)
    }
  } catch {}
  return '0.1.0'
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
 * Download and replace the current CLI script.
 *
 * The CLI runs as `node ~/.anton/bin/anton-cli.mjs`, so process.execPath
 * points to the *node* binary — NOT the CLI script. We must update
 * process.argv[1] (the script) instead, otherwise we'd overwrite the
 * system node binary and break everything.
 */
export async function selfUpdate(downloadUrl: string): Promise<void> {
  const scriptPath = process.argv[1]
  if (!scriptPath || !existsSync(scriptPath)) {
    throw new Error('Cannot determine CLI script path for self-update')
  }

  // Safety: never overwrite the node/bun runtime binary
  if (scriptPath === process.execPath) {
    throw new Error('Refusing to overwrite runtime binary — CLI must run as a script')
  }

  // Safety: only update files that look like our CLI
  const basename = scriptPath.split('/').pop() ?? ''
  if (!basename.includes('anton')) {
    throw new Error(`Refusing to update unexpected file: ${scriptPath}`)
  }

  const binaryPath = scriptPath
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
