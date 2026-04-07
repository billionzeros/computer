/**
 * `anton computer sidecar` — download and install the sidecar binary.
 *
 * Fetches the latest sidecar binary from the GitHub release (per manifest),
 * installs it, creates a systemd service, and starts it.
 *
 * Can be run standalone or called from `anton computer setup`.
 */

import { execSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import {
  DEFAULT_PORT,
  DEFAULT_SIDECAR_PORT,
  MANIFEST_URL,
  SIDECAR_BIN,
  SIDECAR_SERVICE_PATH,
  done,
  exec,
  fail,
  readPortFromService,
  requireLinuxRoot,
  sidecarServiceUnit,
  step,
} from './computer-common.js'

// ── Architecture mapping ───────────────────────────────────────

function getSidecarArch(): string {
  const arch = process.arch // 'arm64' | 'x64' | ...
  if (arch === 'arm64') return 'linux-arm64'
  if (arch === 'x64') return 'linux-amd64'
  return `linux-${arch}`
}

// ── Download helper ────────────────────────────────────────────

async function downloadSidecarBinary(): Promise<boolean> {
  step('Fetching manifest')
  let manifest: Record<string, unknown>
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest = (await res.json()) as Record<string, unknown>
    done('Manifest fetched', `v${manifest.version}`)
  } catch (err) {
    fail('Manifest fetch', (err as Error).message)
    return false
  }

  const arch = getSidecarArch()
  const sidecar = manifest.sidecar as Record<string, string> | undefined
  let binaryUrl = sidecar?.[arch]

  if (!binaryUrl) {
    // Fallback: try constructing URL from version
    const version = manifest.version as string
    binaryUrl = `https://github.com/OmGuptaIND/computer/releases/download/v${version}/anton-sidecar-${arch}`
  }

  step('Downloading sidecar binary')
  // Write to a temp file first then atomically mv into place. Direct overwrite
  // fails with "Text file busy" if the sidecar binary is currently running.
  // mv works because it's a rename (relinks inode), not a write.
  const tempPath = `${SIDECAR_BIN}.new`
  try {
    execSync(`curl -fSL -o "${tempPath}" "${binaryUrl}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
    chmodSync(tempPath, 0o755)
    execSync(`mv "${tempPath}" "${SIDECAR_BIN}"`, { stdio: 'pipe' })
    done('Sidecar binary installed', SIDECAR_BIN)
    return true
  } catch (err) {
    // Best-effort cleanup of temp file
    try {
      execSync(`rm -f "${tempPath}"`, { stdio: 'pipe' })
    } catch {}
    fail('Sidecar download', (err as Error).message)
    return false
  }
}

// ── Health check ───────────────────────────────────────────────

async function waitForSidecarHealthy(port: number, maxWait = 15): Promise<boolean> {
  for (let i = 0; i < maxWait; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return false
}

// ── Main command ───────────────────────────────────────────────

export async function computerSidecarCommand(options?: {
  agentPort?: number
  sidecarPort?: number
}): Promise<void> {
  requireLinuxRoot()

  const agentPort = options?.agentPort ?? readPortFromService() ?? DEFAULT_PORT
  const sidecarPort = options?.sidecarPort ?? DEFAULT_SIDECAR_PORT

  console.log()
  console.log('  Installing sidecar...')
  console.log()

  // 1. Download binary
  const downloaded = await downloadSidecarBinary()
  if (!downloaded) {
    console.log()
    fail('Sidecar installation failed', 'Could not download binary')
    console.log()
    return
  }

  // 2. Create systemd service
  step('Creating systemd service')
  try {
    writeFileSync(SIDECAR_SERVICE_PATH, sidecarServiceUnit(agentPort, sidecarPort))
    exec('systemctl daemon-reload')
    done('Systemd service created')
  } catch (err) {
    fail('Systemd service', (err as Error).message)
    return
  }

  // 3. Start service
  step('Starting sidecar')
  try {
    exec('systemctl enable --now anton-sidecar')
    done('Sidecar started')
  } catch (err) {
    fail('Sidecar start', (err as Error).message)
    return
  }

  // 4. Health check
  step('Checking sidecar health')
  const healthy = await waitForSidecarHealthy(sidecarPort)
  if (healthy) {
    done('Sidecar healthy', `port ${sidecarPort}`)
  } else {
    fail('Sidecar health check', 'Not responding after 15s')
    console.log()
    console.log('  Troubleshooting:')
    console.log('    sudo journalctl -u anton-sidecar -n 20')
    console.log('    sudo systemctl status anton-sidecar')
  }

  console.log()
}
