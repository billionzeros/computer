/**
 * `anton computer update`
 *
 * Updates everything on the machine in one shot:
 *   1. Update CLI binary (self-update)
 *   2. Clone agent repo into staging dir + install + build
 *   3. Download new sidecar binary
 *   4. Stop agent
 *   5. Swap agent dirs (atomic rename)
 *   6. Restart sidecar (picks up new binary)
 *   7. Start agent
 *   8. Health check — rollback if unhealthy
 *   9. Clean up
 *
 * --json flag emits structured NDJSON for machine consumption.
 */

import { execSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { theme } from '../lib/theme.js'
import {
  ANTON_USER,
  DEFAULT_PORT,
  MANIFEST_URL,
  REPO_DIR,
  REPO_URL,
  SIDECAR_BIN,
  done,
  exec,
  fail,
  readPortFromService,
  requireLinuxRoot,
  step,
} from './computer-common.js'

const STAGING_DIR = `${REPO_DIR}-staging`
const PREV_DIR = `${REPO_DIR}-prev`
const AGENT_ENTRY = 'packages/agent-server/dist/index.js'
const AGENT_SVC = 'anton-agent'
const SIDECAR_SVC = 'anton-sidecar'

type Stage =
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'building'
  | 'stopping'
  | 'swapping'
  | 'starting'
  | 'verifying'
  | 'done'
  | 'error'

export async function computerUpdateCommand(
  args: {
    yes?: boolean
    json?: boolean
  } = {},
): Promise<void> {
  requireLinuxRoot()

  const jsonMode = args.json ?? false

  const emit = (stage: Stage, message: string) => {
    if (jsonMode) console.log(JSON.stringify({ stage, message }))
  }
  const emitStep = (stage: Stage, label: string) => {
    emit(stage, label)
    if (!jsonMode) step(label)
  }
  const emitDone = (stage: Stage, label: string, detail?: string) => {
    emit(stage, label)
    if (!jsonMode) done(label, detail)
  }
  const emitFail = (_stage: Stage, label: string, detail?: string) => {
    emit('error', detail ? `${label}: ${detail}` : label)
    if (!jsonMode) fail(label, detail)
  }

  if (!jsonMode) {
    console.log()
    console.log(`  ${theme.brandBold('anton.computer')} ${theme.dim('— update')}`)
    console.log()
  }

  // ── 1. Check for updates ─────────────────────────────────────
  emitStep('checking', 'Checking for updates')
  let manifest: { version: string; changelog?: string; sidecar?: Record<string, string> }
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      emitFail('checking', 'Manifest fetch', `HTTP ${res.status}`)
      process.exit(1)
    }
    manifest = (await res.json()) as typeof manifest
  } catch (err) {
    emitFail('checking', 'Manifest fetch', (err as Error).message)
    process.exit(1)
  }

  let current = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf-8'))
    current = pkg.version ?? 'unknown'
  } catch {
    // first install or missing
  }

  if (!semverGt(manifest.version, current)) {
    emitDone('done', `Already up to date (v${current})`)
    if (!jsonMode) console.log()
    return
  }
  emitDone('checking', `v${current} → v${manifest.version}`)

  if (!jsonMode && manifest.changelog) {
    console.log(`  ${theme.dim(manifest.changelog)}`)
    console.log()
  }

  // Clean up leftover dirs from a previous failed attempt
  cleanup(STAGING_DIR)
  cleanup(PREV_DIR)

  // ── 2. Update CLI binary ─────────────────────────────────────
  // Shell out to the install script instead of in-process self-update.
  // The install script is the canonical installer — it handles symlinks,
  // multiple installations, and per-user paths correctly. In-process
  // self-update only touches process.argv[1] which can miss other installs.
  emitStep('downloading', 'Updating CLI')
  try {
    execSync('curl -fsSL https://antoncomputer.in/install | bash', {
      stdio: 'pipe',
      timeout: 120_000,
      env: { ...process.env, ANTON_INSTALL_QUIET: '1' },
    })
    emitDone('downloading', 'CLI updated')
  } catch (err) {
    // Non-fatal — CLI update failure shouldn't block agent update
    emitDone('downloading', 'CLI update skipped', (err as Error).message.slice(0, 200))
  }

  // ── 3. Clone agent into staging ──────────────────────────────
  emitStep('downloading', 'Cloning into staging')
  try {
    // Clone as root (anton can't create dirs in /opt), then chown to anton
    execSync(`git clone --depth 1 --branch main ${REPO_URL} ${STAGING_DIR}`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
    execSync(`chown -R ${ANTON_USER}:${ANTON_USER} ${STAGING_DIR}`, { stdio: 'pipe' })
    emitDone('downloading', 'Cloned')
  } catch (err) {
    emitFail('downloading', 'Clone failed', (err as Error).message)
    cleanup(STAGING_DIR)
    process.exit(1)
  }

  // ── 4. Install dependencies ──────────────────────────────────
  emitStep('installing', 'Installing dependencies')
  try {
    execSync(
      `sudo -u ${ANTON_USER} bash -c "cd ${STAGING_DIR} && CI=true pnpm install --frozen-lockfile"`,
      {
        stdio: 'pipe',
        timeout: 600_000,
      },
    )
    emitDone('installing', 'Dependencies installed')
  } catch (err) {
    emitFail('installing', 'pnpm install failed', (err as Error).message)
    cleanup(STAGING_DIR)
    process.exit(1)
  }

  // ── 5. Build ─────────────────────────────────────────────────
  emitStep('building', 'Building')
  try {
    execSync(`sudo -u ${ANTON_USER} bash -c "cd ${STAGING_DIR} && pnpm -r build"`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
    emitDone('building', 'Build complete')
  } catch (err) {
    emitFail('building', 'Build failed', (err as Error).message)
    cleanup(STAGING_DIR)
    process.exit(1)
  }

  // ── 6. Verify build ──────────────────────────────────────────
  emitStep('building', 'Verifying build')
  if (!existsSync(join(STAGING_DIR, AGENT_ENTRY))) {
    emitFail('building', 'Verification', `${AGENT_ENTRY} not found`)
    cleanup(STAGING_DIR)
    process.exit(1)
  }
  emitDone('building', 'Build verified')

  // ── 7. Download new sidecar binary ───────────────────────────
  emitStep('downloading', 'Updating sidecar binary')
  try {
    const arch = getSidecarArch()
    const sidecarUrl =
      manifest.sidecar?.[arch] ??
      `https://github.com/billionzeros/computer/releases/download/v${manifest.version}/anton-sidecar-${arch}`

    execSync(`curl -fSL -o "${SIDECAR_BIN}.new" "${sidecarUrl}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
    chmodSync(`${SIDECAR_BIN}.new`, 0o755)
    emitDone('downloading', 'Sidecar binary downloaded')
  } catch (err) {
    // Non-fatal — sidecar might not have changed
    emitDone('downloading', 'Sidecar update skipped', (err as Error).message)
  }

  // ── 8. Stop agent — downtime starts ──────────────────────────
  emitStep('stopping', 'Stopping agent')
  try {
    exec(`systemctl stop ${AGENT_SVC}`)
    emitDone('stopping', 'Agent stopped')
  } catch (err) {
    emitFail('stopping', 'Stop failed', (err as Error).message)
    cleanup(STAGING_DIR)
    cleanupFile(`${SIDECAR_BIN}.new`)
    process.exit(1)
  }

  // ── 9. Atomic swap ───────────────────────────────────────────
  emitStep('swapping', 'Swapping directories')
  try {
    execSync(`mv ${REPO_DIR} ${PREV_DIR}`, { stdio: 'pipe' })
  } catch (err) {
    emitFail('swapping', 'Swap failed (live → prev)', (err as Error).message)
    tryExec(`systemctl start ${AGENT_SVC}`)
    cleanup(STAGING_DIR)
    cleanupFile(`${SIDECAR_BIN}.new`)
    process.exit(1)
  }
  try {
    execSync(`mv ${STAGING_DIR} ${REPO_DIR}`, { stdio: 'pipe' })
  } catch (err) {
    emitFail('swapping', 'Swap failed (staging → live)', (err as Error).message)
    tryExec(`mv ${PREV_DIR} ${REPO_DIR}`)
    tryExec(`systemctl start ${AGENT_SVC}`)
    cleanup(STAGING_DIR)
    cleanupFile(`${SIDECAR_BIN}.new`)
    process.exit(1)
  }
  emitDone('swapping', 'Swap complete')

  // ── 10. Replace sidecar binary + restart ─────────────────────
  if (existsSync(`${SIDECAR_BIN}.new`)) {
    emitStep('starting', 'Updating sidecar')
    try {
      execSync(`mv ${SIDECAR_BIN}.new ${SIDECAR_BIN}`, { stdio: 'pipe' })
      exec(`systemctl restart ${SIDECAR_SVC}`)
      emitDone('starting', 'Sidecar restarted')
    } catch {
      emitDone('starting', 'Sidecar restart skipped')
    }
  }

  // ── 11. Start agent ──────────────────────────────────────────
  emitStep('starting', 'Starting agent')
  try {
    exec(`systemctl start ${AGENT_SVC}`)
    emitDone('starting', 'Agent started')
  } catch (err) {
    emitFail('starting', 'Start failed — rolling back', (err as Error).message)
    tryExec(`mv ${REPO_DIR} ${STAGING_DIR}`)
    tryExec(`mv ${PREV_DIR} ${REPO_DIR}`)
    tryExec(`systemctl start ${AGENT_SVC}`)
    cleanup(STAGING_DIR)
    process.exit(1)
  }

  // ── 12. Health check ─────────────────────────────────────────
  emitStep('verifying', 'Verifying health')
  const port = readPortFromService() ?? DEFAULT_PORT
  try {
    await waitForHealth(port, 30_000)
    emitDone('verifying', 'Agent healthy')
  } catch {
    emitFail('verifying', 'Health check failed — rolling back')
    tryExec(`systemctl stop ${AGENT_SVC}`)
    tryExec(`mv ${REPO_DIR} ${STAGING_DIR}`)
    tryExec(`mv ${PREV_DIR} ${REPO_DIR}`)
    tryExec(`systemctl start ${AGENT_SVC}`)
    cleanup(STAGING_DIR)
    if (!jsonMode) console.log(`\n  ${theme.error(`Rolled back to v${current}`)}\n`)
    process.exit(1)
  }

  // ── 13. Clean up ─────────────────────────────────────────────
  cleanup(PREV_DIR)

  emit('done', `Updated to v${manifest.version}`)
  if (!jsonMode) {
    console.log()
    console.log(`  ${theme.success(`Updated to v${manifest.version}`)}`)
    console.log()
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function cleanup(dir: string) {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function cleanupFile(path: string) {
  try {
    if (existsSync(path)) rmSync(path)
  } catch {}
}

function tryExec(cmd: string) {
  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch {}
}

function getSidecarArch(): string {
  if (process.arch === 'arm64') return 'linux-arm64'
  if (process.arch === 'x64') return 'linux-amd64'
  return `linux-${process.arch}`
}

async function waitForHealth(port: number, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`Agent not healthy within ${timeout / 1000}s`)
}

function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}
