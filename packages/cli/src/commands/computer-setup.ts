/**
 * `anton computer setup` — set up the anton agent on this machine.
 *
 * Clones the repo, installs dependencies, builds from source,
 * creates a system user, writes environment config, installs
 * systemd services, and starts everything.
 *
 * Interactive by default; pass --yes for non-interactive (cloud-init).
 */

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { theme } from '../lib/theme.js'
import { CLI_VERSION } from '../lib/version.js'
import {
  AGENT_ENTRY,
  AGENT_SERVICE_PATH,
  ANTON_DIR,
  ANTON_USER,
  DEFAULT_PORT,
  DEFAULT_SIDECAR_PORT,
  ENV_FILE,
  REPO_DIR,
  REPO_URL,
  done,
  exec,
  execSilent,
  fail,
  maskToken,
  promptInput,
  requireLinuxRoot,
  step,
} from './computer-common.js'
import { computerSidecarCommand } from './computer-sidecar.js'

// ── Types ───────────────────────────────────────────────────────

export interface ComputerSetupArgs {
  token?: string
  port?: number
  sidecarPort?: number
  yes?: boolean
}

// ── Helpers ─────────────────────────────────────────────────────

function generateToken(): string {
  return `ak_${randomBytes(24).toString('hex')}`
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
WorkingDirectory=${REPO_DIR}
ExecStart=/usr/bin/node ${AGENT_ENTRY} --port ${port}
Restart=always
RestartSec=5

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
  console.log(`  ${theme.label('System')}:  Linux ${process.arch}`)
  console.log(`  ${theme.label('CLI')}:     v${CLI_VERSION}`)

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
        `useradd --system --create-home --home-dir /home/${ANTON_USER} --shell /bin/bash ${ANTON_USER}`,
      )
    }
    mkdirSync(ANTON_DIR, { recursive: true })
    mkdirSync(`/home/${ANTON_USER}/Anton`, { recursive: true })
    execSync(`chown -R ${ANTON_USER}:${ANTON_USER} /home/${ANTON_USER}`, { stdio: 'pipe' })
    // Grant passwordless sudo so the agent can install packages, manage services, etc.
    writeFileSync(`/etc/sudoers.d/${ANTON_USER}`, `${ANTON_USER} ALL=(ALL) NOPASSWD:ALL\n`, {
      mode: 0o440,
    })
    done('System user created (with sudo)')
  } catch (err) {
    fail('System user', (err as Error).message)
    process.exit(1)
  }

  // ── 4. Install Node.js + pnpm (if not present) ──
  step('Checking Node.js')
  try {
    const nodeVersion = exec('node --version')
    const major = Number.parseInt(nodeVersion.replace('v', '').split('.')[0], 10)
    if (major < 22) {
      throw new Error(`Node.js ${nodeVersion} is too old, need v22+`)
    }
    done('Node.js found', nodeVersion)
  } catch {
    step('Installing Node.js 22')
    try {
      exec('curl -fsSL https://deb.nodesource.com/setup_22.x | bash -')
      exec('apt-get install -y nodejs')
      done('Node.js 22 installed')
    } catch (err) {
      fail('Node.js install', (err as Error).message)
      process.exit(1)
    }
  }

  step('Checking pnpm')
  try {
    exec('pnpm --version')
    done('pnpm found')
  } catch {
    try {
      exec('npm install -g pnpm')
      done('pnpm installed')
    } catch (err) {
      fail('pnpm install', (err as Error).message)
      process.exit(1)
    }
  }

  // ── 5. Clone repo + build ──
  step('Setting up repo')
  try {
    if (existsSync(`${REPO_DIR}/.git`)) {
      // Repo already exists — pull latest
      execSync(`sudo -u ${ANTON_USER} git -C ${REPO_DIR} fetch origin`, { stdio: 'pipe' })
      execSync(`sudo -u ${ANTON_USER} git -C ${REPO_DIR} reset --hard origin/main`, {
        stdio: 'pipe',
      })
      done('Repo updated', 'git pull')
    } else {
      // Fresh clone
      mkdirSync(REPO_DIR, { recursive: true })
      execSync(`chown ${ANTON_USER}:${ANTON_USER} ${REPO_DIR}`, { stdio: 'pipe' })
      execSync(`sudo -u ${ANTON_USER} git clone ${REPO_URL} ${REPO_DIR}`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
      done('Repo cloned')
    }
  } catch (err) {
    fail('Repo setup', (err as Error).message)
    process.exit(1)
  }

  step('Installing dependencies')
  try {
    execSync(
      `sudo -u ${ANTON_USER} bash -c "cd ${REPO_DIR} && CI=true pnpm install --frozen-lockfile"`,
      {
        stdio: 'pipe',
        timeout: 600_000,
      },
    )
    done('Dependencies installed')
  } catch (err) {
    fail('Dependencies', (err as Error).message)
    process.exit(1)
  }

  step('Building')
  try {
    execSync(`sudo -u ${ANTON_USER} bash -c "cd ${REPO_DIR} && pnpm -r build"`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
    done('Build complete')
  } catch (err) {
    fail('Build', (err as Error).message)
    process.exit(1)
  }

  // Verify the entry point exists
  if (!existsSync(AGENT_ENTRY)) {
    fail('Build verification', `${AGENT_ENTRY} not found after build`)
    process.exit(1)
  }

  // ── 6. Write environment file ──
  step('Writing environment config')
  try {
    const envContent = `${[
      `HOME=/home/${ANTON_USER}`,
      `ANTON_DIR=${ANTON_DIR}`,
      `ANTON_TOKEN=${token}`,
    ].join('\n')}\n`

    writeFileSync(ENV_FILE, envContent, { mode: 0o600 })
    execSync(`chown ${ANTON_USER}:${ANTON_USER} ${ENV_FILE}`, { stdio: 'pipe' })
    done('Environment configured', ENV_FILE)
  } catch (err) {
    fail('Environment file', (err as Error).message)
    process.exit(1)
  }

  // ── 7. Create agent systemd service ──
  step('Creating agent systemd service')
  try {
    writeFileSync(AGENT_SERVICE_PATH, agentServiceUnit(effectivePort))
    exec('systemctl daemon-reload')
    done('Agent service created')
  } catch (err) {
    fail('Agent service', (err as Error).message)
    process.exit(1)
  }

  // ── 8. Start agent ──
  step('Starting agent')
  try {
    exec('systemctl enable --now anton-agent')
    done('Agent started')
  } catch (err) {
    fail('Agent start', (err as Error).message)
    process.exit(1)
  }

  // ── 9. Agent health check ──
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

  // ── 10. Install + start sidecar ──
  await computerSidecarCommand({ agentPort: effectivePort, sidecarPort })

  // ── 11. Write version info ──
  try {
    const gitHash = execSilent(`sudo -u ${ANTON_USER} git -C ${REPO_DIR} rev-parse --short HEAD`)
      ? exec(`sudo -u ${ANTON_USER} git -C ${REPO_DIR} rev-parse --short HEAD`)
      : 'unknown'
    const versionInfo = {
      version: CLI_VERSION,
      gitHash,
      deployedAt: new Date().toISOString(),
      deployedBy: 'setup',
    }
    writeFileSync(`${ANTON_DIR}/version.json`, JSON.stringify(versionInfo, null, 2))
  } catch {
    // non-critical
  }

  // ── 12. Print connection info ──
  console.log()
  console.log(`  ${theme.brand('──────────────────────────────────────')}`)
  console.log()
  console.log(`  ${theme.brandBold('Setup complete!')}`)
  console.log()
  console.log(`  ${theme.label('Token')}:   ${token}`)
  console.log(`  ${theme.label('Port')}:    ${effectivePort}`)
  console.log(`  ${theme.label('Repo')}:    ${REPO_DIR}`)
  console.log()
  console.log(`  ${theme.dim('Connect from anywhere:')}`)
  console.log(`    ${theme.brand('anton connect')} ${theme.dim('<your-ip>')} --token ${token}`)
  console.log()
  console.log(`  ${theme.dim('Update:')}`)
  console.log(`    ${theme.brand('sudo anton computer update')}`)
  console.log()
}
