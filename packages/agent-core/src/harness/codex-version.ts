/**
 * Pinned support matrix for the `codex` CLI used by the Codex harness.
 *
 * The vendored TypeScript bindings under `./codex-proto/` were generated
 * from the CLI at `PINNED_CLI_VERSION`. Other versions may work but are
 * not tested — we warn at session start so drift is visible.
 *
 * When bumping:
 *   1. `scripts/regen-codex-proto.sh`
 *   2. Update `PINNED_CLI_VERSION` below
 *   3. Run the probe at `.context/codex-probe/` to verify framing + events
 *   4. Commit the schema diff
 */

import { execFile } from 'node:child_process'
import { createLogger } from '@anton/logger'

const log = createLogger('codex-version')

/** Version the vendored bindings were generated from. */
export const PINNED_CLI_VERSION = '0.120.0'

/**
 * Minimum CLI version we speak the v2 thread/turn/item protocol with.
 * v2 was introduced in 0.107 and is the only surface from 0.120 onward
 * (codex 0.120 dropped legacy `newConversation` / `sendUserTurn`).
 */
export const MIN_SUPPORTED_CLI_VERSION = '0.107.0'

export interface CodexCliInfo {
  installed: boolean
  version?: string
  /** True when version >= MIN_SUPPORTED_CLI_VERSION and minor/major match PINNED. */
  supported: boolean
}

/**
 * Check the installed `codex` CLI and return a compatibility verdict.
 * Used at HarnessSession start to log a warning if the user's CLI is
 * outside the tested range.
 */
export async function detectCodexCli(): Promise<CodexCliInfo> {
  const version = await new Promise<string | undefined>((resolve) => {
    execFile('codex', ['--version'], { timeout: 5_000 }, (err, stdout) => {
      if (err) return resolve(undefined)
      // stdout looks like: "codex-cli 0.107.0"
      const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
      resolve(match ? match[1] : undefined)
    })
  })

  if (!version) {
    return { installed: false, supported: false }
  }

  const supported = isVersionSupported(version)

  if (!supported) {
    log.warn(
      { actual: version, pinned: PINNED_CLI_VERSION, min: MIN_SUPPORTED_CLI_VERSION },
      'codex CLI version outside tested range — harness may misbehave. Run scripts/regen-codex-proto.sh after bumping.',
    )
  }

  return { installed: true, version, supported }
}

function isVersionSupported(version: string): boolean {
  const a = parseVersion(version)
  const b = parseVersion(MIN_SUPPORTED_CLI_VERSION)
  if (!a || !b) return false
  if (a.major !== b.major) return false
  if (a.minor < b.minor) return false
  if (a.minor === b.minor && a.patch < b.patch) return false
  return true
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}
