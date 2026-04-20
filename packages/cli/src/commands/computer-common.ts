/**
 * Shared constants, types, and helpers for `anton computer *` commands.
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { ICONS, theme } from '../lib/theme.js'

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_PORT = 9876
export const DEFAULT_SIDECAR_PORT = 9878
export const ANTON_USER = 'anton'
export const ANTON_DIR = `/home/${ANTON_USER}/.anton`
export const REPO_DIR = '/opt/anton'
export const AGENT_ENTRY = `${REPO_DIR}/packages/agent-server/dist/index.js`
export const SIDECAR_BIN = '/usr/local/bin/anton-sidecar'
export const AGENT_SERVICE_PATH = '/etc/systemd/system/anton-agent.service'
export const REPO_URL = 'https://github.com/billionzeros/computer.git'

/** @deprecated Use AGENT_ENTRY instead — kept for migration from SEA binary */
export const AGENT_BIN = '/usr/local/bin/anton-agent'

/**
 * Detect the env file path used by the running agent service.
 * Priority: systemd service EnvironmentFile → ~/.anton/agent.env
 */
function detectEnvFile(): string {
  // 1. Check what the systemd service actually uses
  try {
    const serviceContent = readFileSync('/etc/systemd/system/anton-agent.service', 'utf-8')
    const match = serviceContent.match(/^EnvironmentFile=(.+)$/m)
    if (match?.[1] && existsSync(match[1])) return match[1]
  } catch {}

  // 2. Prefer the Ansible-managed location
  const antonEnv = `${ANTON_DIR}/agent.env`
  if (existsSync(antonEnv)) return antonEnv

  // 3. Fall back to canonical path (same as Ansible)
  return `${ANTON_DIR}/agent.env`
}

export const ENV_FILE = detectEnvFile()
export const SIDECAR_SERVICE_PATH = '/etc/systemd/system/anton-sidecar.service'
export const AGENT_SERVICE = 'anton-agent'
export const SIDECAR_SERVICE = 'anton-sidecar'

// ── Helpers ─────────────────────────────────────────────────────

export function promptInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••'
  return `${token.slice(0, 6)}••••${token.slice(-4)}`
}

export function step(label: string) {
  process.stdout.write(`  ${theme.dim('○')} ${label}...`)
}

export function done(label: string, detail?: string) {
  const extra = detail ? `  ${theme.dim(detail)}` : ''
  process.stdout.write(`\r  ${ICONS.toolDone} ${label}${extra}\n`)
}

export function fail(label: string, error?: string) {
  const extra = error ? `  ${theme.dim(error)}` : ''
  process.stdout.write(`\r  ${ICONS.toolError} ${theme.error(label)}${extra}\n`)
}

export function exec(cmd: string): string {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim()
}

export function execSilent(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Require Linux + root. Auto-re-execs with sudo if not root. */
export function requireLinuxRoot(): void {
  if (process.platform !== 'linux') {
    fail('Platform check', `Expected linux, got ${process.platform}`)
    console.log(`\n  ${theme.dim('This command must be run on the target Linux machine.')}\n`)
    process.exit(1)
  }

  const isRoot = process.getuid?.() === 0
  if (isRoot) return

  // Re-exec ourselves under sudo, preserving args and stdio.
  // Avoids the "sudo su -" dance — user just runs `anton computer update`.
  console.log(`  ${theme.dim('Elevating to root via sudo...')}`)
  const result = spawnSync(
    'sudo',
    ['--preserve-env=PATH', process.execPath, process.argv[1], ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}

/** Read token from env file, returns masked or raw. */
export function readTokenFromEnv(): string | null {
  try {
    const content = readFileSync(ENV_FILE, 'utf-8')
    const match = content.match(/^ANTON_TOKEN=(.+)$/m)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** Manifest URL for downloading release artifacts. */
export const MANIFEST_URL =
  'https://raw.githubusercontent.com/billionzeros/computer/main/manifest.json'

/** Systemd unit for the sidecar health/status server. */
export function sidecarServiceUnit(agentPort: number, sidecarPort: number): string {
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

/** Read port from the agent systemd unit file. */
export function readPortFromService(): number | null {
  try {
    const content = readFileSync(AGENT_SERVICE_PATH, 'utf-8')
    const match = content.match(/--port\s+(\d+)/)
    return match ? Number.parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

/** Get systemd service status. Returns { active, pid, uptime } or null. */
export function getServiceStatus(service: string): {
  active: boolean
  status: string
  pid: string | null
  uptime: string | null
} | null {
  try {
    const output = exec(
      `systemctl show ${service} --property=ActiveState,MainPID,ActiveEnterTimestamp --no-pager`,
    )
    const props: Record<string, string> = {}
    for (const line of output.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key) props[key] = rest.join('=')
    }

    const activeState = props.ActiveState ?? 'unknown'
    const active = activeState === 'active'
    const pid = props.MainPID && props.MainPID !== '0' ? props.MainPID : null

    let uptime: string | null = null
    if (active && props.ActiveEnterTimestamp) {
      const startTime = new Date(props.ActiveEnterTimestamp).getTime()
      if (!Number.isNaN(startTime)) {
        const elapsed = Date.now() - startTime
        uptime = formatUptime(elapsed)
      }
    }

    return { active, status: activeState, pid, uptime }
  } catch {
    return null
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  if (hours < 24) return `${hours}h ${remainMinutes}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
