/**
 * `anton computer setup` — set up the anton agent on this machine.
 *
 * Downloads the agent + sidecar binaries, creates a system user,
 * writes environment config, installs systemd services, and starts
 * everything. Works on any Linux machine (x64 or arm64).
 *
 * Interactive by default; pass --yes for non-interactive (cloud-init).
 */

import { randomBytes } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { theme } from '../lib/theme.js'
import { UPDATE_MANIFEST_URL, CLI_VERSION } from '../lib/version.js'
import {
  DEFAULT_PORT,
  DEFAULT_SIDECAR_PORT,
  ANTON_USER,
  ANTON_DIR,
  AGENT_BIN,
  SIDECAR_BIN,
  ENV_FILE,
  AGENT_SERVICE_PATH,
  SIDECAR_SERVICE_PATH,
  promptInput,
  maskToken,
  step,
  done,
  fail,
  exec,
  execSilent,
  requireLinuxRoot,
} from './computer-common.js'

// ── Types ───────────────────────────────────────────────────────

export interface ComputerSetupArgs {
  token?: string
  port?: number
  sidecarPort?: number
  yes?: boolean
}

interface Manifest {
  version: string
  binaries: Record<string, string>
  sidecar_binaries?: Record<string, string>
}

// ── Helpers ─────────────────────────────────────────────────────

function generateToken(): string {
  return `ak_${randomBytes(24).toString('hex')}`
}

function detectArch(): string {
  const arch = process.arch
  if (arch === 'x64') return 'x64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`Unsupported architecture: ${arch}`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Download with progress ──────────────────────────────────────

async function downloadBinary(url: string, dest: string, label: string): Promise<number> {
  step(label)

  const res = await fetch(url, {
    signal: AbortSignal.timeout(300_000),
    headers: { 'User-Agent': `anton-cli/${CLI_VERSION}` },
  })

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} from ${url}`)
  }

  const tempPath = `${dest}.download-${Date.now()}`
  const fileStream = createWriteStream(tempPath)
  // @ts-expect-error -- ReadableStream is compatible via fromWeb
  const nodeReadable = Readable.fromWeb(res.body)

  let totalBytes = 0
  nodeReadable.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length
  })

  await pipeline(nodeReadable, fileStream)
  chmodSync(tempPath, 0o755)

  // Atomic move
  execSync(`mv -f "${tempPath}" "${dest}"`, { stdio: 'pipe' })

  return totalBytes
}

// ── Fetch manifest ──────────────────────────────────────────────

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(UPDATE_MANIFEST_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': `anton-cli/${CLI_VERSION}` },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch manifest: HTTP ${res.status}`)
  }

  return (await res.json()) as Manifest
}

// ── Systemd templates ───────────────────────────────────────────

function agentServiceUnit(port: number): string {
  return `[Unit]
Description=Anton Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${ANTON_USER}
Group=${ANTON_USER}
EnvironmentFile=${ENV_FILE}
ExecStart=${AGENT_BIN} --port ${port}
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=${ANTON_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`
}

function sidecarServiceUnit(agentPort: number, sidecarPort: number): string {
  return `[Unit]
Description=Anton Sidecar (Health & Status)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
Environment=SIDECAR_PORT=${sidecarPort}
Environment=AGENT_PORT=${agentPort}
ExecStart=${SIDECAR_BIN}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`
}

// ── Health check ────────────────────────────────────────────────

async function waitForHealthy(port: number, maxWait = 30): Promise<boolean> {
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

// ── Main command ────────────────────────────────────────────────

export async function computerSetupCommand(args: ComputerSetupArgs): Promise<void> {
  const interactive = !args.yes

  // ── Banner ──
  console.log()
  console.log(`  ${theme.brand('┌─────────────────────────────────────┐')}`)
  console.log(
    `  ${theme.brand('│')}  ${theme.brandBold('anton.computer')} ${theme.dim('— setup')}              ${theme.brand('│')}`,
  )
  console.log(`  ${theme.brand('└─────────────────────────────────────┘')}`)
  console.log()

  // ── 1. Pre-flight checks ──
  requireLinuxRoot()

  let arch: string
  try {
    arch = detectArch()
  } catch (err) {
    fail('Architecture', (err as Error).message)
    process.exit(1)
    return // unreachable but helps TS
  }

  console.log(`  ${theme.label('System')}:  Linux ${arch}`)

  // ── 2. Configuration ──
  const port = args.port ?? DEFAULT_PORT
  const sidecarPort = args.sidecarPort ?? DEFAULT_SIDECAR_PORT
  let token = args.token ?? generateToken()

  if (interactive) {
    const portInput = await promptInput(
      `  ${theme.label('Port')}    ${theme.dim(`(default: ${DEFAULT_PORT})`)}: `,
    )
    if (portInput) {
      const parsed = Number.parseInt(portInput, 10)
      if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
        // Use the user's port — reassignment needed
        ;(args as { port: number }).port = parsed
      }
    }

    const tokenInput = await promptInput(
      `  ${theme.label('Token')}   ${theme.dim('(default: auto-generated)')}: `,
    )
    if (tokenInput) token = tokenInput
  }

  const effectivePort = args.port ?? port

  console.log(`  ${theme.label('Port')}:    ${effectivePort}`)
  console.log(`  ${theme.label('Token')}:   ${maskToken(token)}`)
  console.log()

  if (interactive) {
    const confirm = await promptInput(`  ${theme.bold('Proceed?')} ${theme.dim('(Y/n)')}: `)
    if (confirm.toLowerCase() === 'n') {
      console.log(`\n  ${theme.dim('Aborted.')}\n`)
      process.exit(0)
    }
    console.log()
  }

  // ── 3. Create system user ──
  step('Creating system user')
  try {
    const userExists = execSilent(`id ${ANTON_USER}`)
    if (!userExists) {
      exec(
        `useradd --system --create-home --home-dir /home/${ANTON_USER} --shell /usr/sbin/nologin ${ANTON_USER}`,
      )
    }
    mkdirSync(ANTON_DIR, { recursive: true })
    mkdirSync(`/home/${ANTON_USER}/Anton`, { recursive: true })
    execSync(`chown -R ${ANTON_USER}:${ANTON_USER} /home/${ANTON_USER}`, { stdio: 'pipe' })
    done('System user created')
  } catch (err) {
    fail('System user', (err as Error).message)
    process.exit(1)
  }

  // ── 4. Fetch manifest + download binaries ──
  let manifest: Manifest
  try {
    step('Fetching manifest')
    manifest = await fetchManifest()
    done('Manifest fetched', `v${manifest.version}`)
  } catch (err) {
    fail('Manifest fetch', (err as Error).message)
    process.exit(1)
    return
  }

  const archKey = `linux-${arch}`

  // Download agent
  const agentUrl = manifest.binaries?.[archKey]
  if (!agentUrl) {
    fail('Agent binary', `No binary found for ${archKey} in manifest`)
    process.exit(1)
  }

  try {
    const bytes = await downloadBinary(agentUrl, AGENT_BIN, 'Downloading agent')
    done(`Agent v${manifest.version} installed`, formatBytes(bytes))
  } catch (err) {
    fail('Agent download', (err as Error).message)
    process.exit(1)
  }

  // Download sidecar
  const sidecarUrl = manifest.sidecar_binaries?.[archKey]
  if (sidecarUrl) {
    try {
      const bytes = await downloadBinary(sidecarUrl, SIDECAR_BIN, 'Downloading sidecar')
      done(`Sidecar v${manifest.version} installed`, formatBytes(bytes))
    } catch (err) {
      fail('Sidecar download', (err as Error).message)
      console.log(`  ${theme.dim('Continuing without sidecar...')}`)
    }
  } else {
    console.log(`  ${theme.dim('○ No sidecar binary in manifest, skipping')}`)
  }

  // ── 5. Write environment file ──
  step('Writing environment config')
  try {
    const envContent = `${[
      `HOME=/home/${ANTON_USER}`,
      `ANTON_DIR=${ANTON_DIR}`,
      `ANTON_TOKEN=${token}`,
    ].join('\n')}\n`

    writeFileSync(ENV_FILE, envContent, { mode: 0o600 })
    done('Environment configured', ENV_FILE)
  } catch (err) {
    fail('Environment file', (err as Error).message)
    process.exit(1)
  }

  // ── 6. Create systemd services ──
  step('Creating systemd services')
  try {
    writeFileSync(AGENT_SERVICE_PATH, agentServiceUnit(effectivePort))
    writeFileSync(SIDECAR_SERVICE_PATH, sidecarServiceUnit(effectivePort, sidecarPort))
    exec('systemctl daemon-reload')
    done('Systemd services created')
  } catch (err) {
    fail('Systemd services', (err as Error).message)
    process.exit(1)
  }

  // ── 7. Start services ──
  step('Starting services')
  try {
    exec('systemctl enable --now anton-agent')
    if (existsSync(SIDECAR_BIN)) {
      exec('systemctl enable --now anton-sidecar')
    }
    done('Services started')
  } catch (err) {
    fail('Service start', (err as Error).message)
    process.exit(1)
  }

  // ── 8. Health check ──
  step('Checking agent health')
  const healthy = await waitForHealthy(effectivePort)
  if (healthy) {
    done('Agent healthy')
  } else {
    fail('Agent health check', 'Not responding after 30s')
    console.log()
    console.log(`  ${theme.dim('Troubleshooting:')}`)
    console.log(`    ${theme.dim('•')} sudo journalctl -u anton-agent -n 20`)
    console.log(`    ${theme.dim('•')} sudo systemctl status anton-agent`)
    console.log()
  }

  // ── 9. Print connection info ──
  console.log()
  console.log(`  ${theme.brand('──────────────────────────────────────')}`)
  console.log()
  console.log(`  ${theme.brandBold('Setup complete!')}`)
  console.log()
  console.log(`  ${theme.label('Token')}:   ${token}`)
  console.log(`  ${theme.label('Port')}:    ${effectivePort}`)
  console.log(`  ${theme.label('Agent')}:   v${manifest.version}`)
  console.log()
  console.log(`  ${theme.dim('Connect from anywhere:')}`)
  console.log(`    ${theme.brand('anton connect')} ${theme.dim('<your-ip>')} --token ${token}`)
  console.log()
}
