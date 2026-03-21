/**
 * Version info for the anton.computer agent.
 * Git hash is resolved at runtime from the repo or falls back to "dev".
 *
 * Version compatibility:
 *   - SPEC_VERSION:     Wire protocol version (bumped on protocol changes)
 *   - MIN_CLIENT_SPEC:  Oldest client spec version this agent supports
 *   - MIN_AGENT_SPEC:   Oldest agent spec version the desktop client supports
 *                        (exported for the desktop app to check against auth_ok.specVersion)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SPEC_VERSION = '0.5.0'

/**
 * Minimum client spec version this agent will accept.
 * Clients older than this get a compatibility warning in auth_ok.
 */
export const MIN_CLIENT_SPEC = '0.3.0'

/**
 * Minimum agent spec version the desktop client needs.
 * If the agent reports a specVersion older than this, the desktop shows
 * "Agent outdated — please update" banner.
 */
export const MIN_AGENT_SPEC = '0.4.0'

/**
 * URL where the latest release manifest lives.
 * The agent checks this periodically for self-update.
 * The manifest is a JSON file: { version, specVersion, gitHash, releaseUrl, changelog }
 */
export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/OmGuptaIND/anton.computer/main/manifest.json'

/** How often to check for updates (ms) — default 1 hour */
export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

// ── Update manifest types ──────────────────────────────────────────

export interface UpdateManifest {
  /** Latest available version (semver) */
  version: string
  /** Spec version of the latest release */
  specVersion: string
  /** Git hash of the latest release */
  gitHash: string
  /** URL to release notes or download */
  releaseUrl: string
  /** Short changelog (markdown, 1-3 bullet points) */
  changelog: string
  /** ISO timestamp of when this release was published */
  publishedAt: string
  /** Pre-compiled agent binary URLs keyed by platform-arch (e.g. "linux-x64", "linux-arm64") */
  binaries?: Record<string, string>
  /** CLI bundle download URL (single .mjs file, platform-independent) */
  cli?: string
}

// ── Semver comparison ──────────────────────────────────────────────

/** Parse "major.minor.patch" → [major, minor, patch] */
function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map(Number)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** Returns true if `a` >= `b` (semver) */
export function semverGte(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a)
  const [bMaj, bMin, bPat] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat >= bPat
}

/** Returns true if `a` > `b` (semver) */
export function semverGt(a: string, b: string): boolean {
  return semverGte(a, b) && a !== b
}

// ── Runtime version resolution ────────────────────────────────────

function getPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
    return pkg.version ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
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
