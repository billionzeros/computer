/**
 * Version info for the anton.computer agent.
 * Git hash is resolved at runtime from the repo or falls back to "dev".
 *
 * Single unified version for agent, sidecar, desktop, and CLI.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * URL where the latest release manifest lives.
 * The agent checks this periodically for self-update.
 */
export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/billionzeros/computer/main/manifest.json'

/** How often to check for updates (ms) — default 1 hour */
export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

// ── Update manifest types ──────────────────────────────────────────

export interface UpdateManifest {
  /** Latest available version (semver) */
  version: string
  /** Git hash of the latest release */
  gitHash: string
  /** URL to release notes or download */
  releaseUrl: string
  /** Short changelog (markdown, 1-3 bullet points) */
  changelog: string
  /** Pre-compiled agent binary URLs keyed by platform-arch (e.g. "linux-x64", "linux-arm64") */
  binaries?: Record<string, string>
  /** Pre-compiled sidecar binary URLs keyed by platform-arch */
  sidecar_binaries?: Record<string, string>
  /** CLI bundle download URL (single .mjs file, platform-independent) */
  cli?: string
}

// ── Semver comparison ──────────────────────────────────────────────

/** Parse "major.minor.patch" → [major, minor, patch] */
function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map(Number)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** Returns true if `a` > `b` (semver) */
export function semverGt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a)
  const [bMaj, bMin, bPat] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat > bPat
}

// ── Runtime version resolution ────────────────────────────────────

function getPackageVersion(): string {
  // In bundled SEA binary, esbuild injects this via --define
  try {
    // @ts-expect-error -- injected at bundle time by esbuild --define
    if (typeof __AGENT_VERSION__ !== 'undefined') return __AGENT_VERSION__
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

function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim()
  } catch {
    return 'dev'
  }
}

export const VERSION = getPackageVersion()
export const GIT_HASH = getGitHash()
