/**
 * `anton computer config` — manage agent configuration on this machine.
 *
 * Sets environment variables in the agent's env file and restarts the agent.
 *
 * Usage:
 *   anton computer config                          — show current config
 *   anton computer config set <KEY> <VALUE>         — set an env var
 *   anton computer config oauth                     — configure OAuth proxy
 *   anton computer config braintrust                — configure Braintrust
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { theme } from '../lib/theme.js'
import {
  ENV_FILE,
  done,
  execSilent,
  fail,
  maskToken,
  promptInput,
  requireLinuxRoot,
  step,
} from './computer-common.js'

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}

// Keys we know about — for display purposes
const KNOWN_KEYS: Record<string, { label: string; secret: boolean }> = {
  ANTON_TOKEN: { label: 'Agent Token', secret: true },
  ANTHROPIC_API_KEY: { label: 'Anthropic API Key', secret: true },
  OPENAI_API_KEY: { label: 'OpenAI API Key', secret: true },
  GOOGLE_API_KEY: { label: 'Google AI API Key', secret: true },
  BRAINTRUST_API_KEY: { label: 'Braintrust API Key', secret: true },
  OAUTH_PROXY_URL: { label: 'OAuth Proxy URL', secret: false },
  OAUTH_CALLBACK_BASE_URL: { label: 'OAuth Callback Base URL', secret: false },
}

// ── Env file helpers ─────────────────────────────────────────────

function readEnvFile(): Record<string, string> {
  try {
    const content = readFileSync(ENV_FILE, 'utf-8')
    const vars: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq > 0) {
        vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
      }
    }
    return vars
  } catch {
    return {}
  }
}

function writeEnvFile(vars: Record<string, string>): void {
  const lines = ['# Anton Agent environment variables', '# Managed by anton computer config', '']
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${value}`)
  }
  lines.push('')
  writeFileSync(ENV_FILE, lines.join('\n'), 'utf-8')
}

function setEnvVar(key: string, value: string): void {
  const vars = readEnvFile()
  vars[key] = value
  writeEnvFile(vars)
}

function removeEnvVar(key: string): void {
  const vars = readEnvFile()
  delete vars[key]
  writeEnvFile(vars)
}

function restartAgent(): void {
  step('Restarting agent')
  if (execSilent('systemctl restart anton-agent')) {
    done('Agent restarted')
  } else {
    fail('Agent restart failed')
  }
}

// ── Commands ─────────────────────────────────────────────────────

export async function computerConfigCommand(args: string[]): Promise<void> {
  const action = args[0]

  switch (action) {
    case 'set':
      requireLinuxRoot()
      handleSet(args[1], args[2])
      break

    case 'unset':
    case 'remove':
      requireLinuxRoot()
      handleUnset(args[1])
      break

    case 'oauth':
      requireLinuxRoot()
      await handleOAuth(args.slice(1))
      break

    case 'braintrust':
      requireLinuxRoot()
      await handleBraintrust(args.slice(1))
      break

    case undefined:
    case 'show':
      handleShow()
      break

    default:
      console.log(`\n  Unknown action: ${action}`)
      showUsage()
  }
}

function showUsage(): void {
  console.log(`\n  ${theme.bold('Usage:')}`)
  console.log(
    `    ${theme.brand('anton computer config')}                        Show current config`,
  )
  console.log(
    `    ${theme.brand('anton computer config set')} ${theme.dim('<KEY> <VALUE>')}    Set an environment variable`,
  )
  console.log(
    `    ${theme.brand('anton computer config unset')} ${theme.dim('<KEY>')}          Remove an environment variable`,
  )
  console.log(
    `    ${theme.brand('anton computer config oauth')}                  Configure OAuth proxy (for connectors)`,
  )
  console.log(
    `    ${theme.brand('anton computer config braintrust')}             Configure Braintrust observability`,
  )
  console.log()
}

function handleShow(): void {
  const vars = readEnvFile()

  console.log()
  console.log(`  ${theme.brandBold('anton.computer')} ${theme.dim('— config')}`)
  console.log()

  if (Object.keys(vars).length === 0) {
    console.log(`  ${theme.dim('No configuration found.')}`)
    console.log(`  ${theme.dim(`Config file: ${ENV_FILE}`)}`)
    showUsage()
    return
  }

  for (const [key, value] of Object.entries(vars)) {
    const known = KNOWN_KEYS[key]
    const label = known?.label || key
    const display = known?.secret ? maskToken(value) : value
    console.log(`  ${theme.label(label.padEnd(28))} ${display}`)
  }

  // Show OAuth status
  const hasOAuth = vars.OAUTH_PROXY_URL
  console.log()
  if (hasOAuth) {
    console.log(
      `  ${theme.success('●')} OAuth connectors:  ${theme.dim('configured')} ${theme.dim(`(${vars.OAUTH_PROXY_URL})`)}`,
    )
  } else {
    console.log(
      `  ${theme.dim('○')} OAuth connectors:  ${theme.dim('not configured')} ${theme.dim('— run: anton computer config oauth')}`,
    )
  }

  const hasBraintrust = vars.BRAINTRUST_API_KEY
  if (hasBraintrust) {
    console.log(`  ${theme.success('●')} Braintrust:        ${theme.dim('configured')}`)
  }

  console.log(`\n  ${theme.dim(`Config file: ${ENV_FILE}`)}`)
  console.log()
}

function handleSet(key?: string, value?: string): void {
  if (!key || !value) {
    console.log(
      `\n  Usage: ${theme.brand('anton computer config set')} ${theme.dim('<KEY> <VALUE>')}`,
    )
    console.log('\n  Example:')
    console.log(`    ${theme.brand('anton computer config set ANTHROPIC_API_KEY sk-ant-...')}`)
    console.log(`    ${theme.brand('anton computer config set OAUTH_PROXY_URL https://...')}`)
    console.log()
    return
  }

  setEnvVar(key, value)
  const known = KNOWN_KEYS[key]
  const display = known?.secret ? maskToken(value) : value
  console.log(`\n  ${theme.success('✓')} ${key} = ${display}`)
  restartAgent()
  console.log()
}

function handleUnset(key?: string): void {
  if (!key) {
    console.log(`\n  Usage: ${theme.brand('anton computer config unset')} ${theme.dim('<KEY>')}\n`)
    return
  }

  removeEnvVar(key)
  console.log(`\n  ${theme.success('✓')} ${key} removed`)
  restartAgent()
  console.log()
}

async function handleOAuth(args: string[] = []): Promise<void> {
  const flagProxyUrl = parseFlag(args, '--proxy-url')
  const flagCallbackUrl = parseFlag(args, '--callback-url')
  const nonInteractive = flagProxyUrl != null || flagCallbackUrl != null

  if (!nonInteractive) {
    console.log()
    console.log(`  ${theme.brandBold('anton.computer')} ${theme.dim('— OAuth connector setup')}`)
    console.log()
    console.log(
      `  ${theme.dim('This configures one-click OAuth connectors (Slack, GitHub, etc.)')}`,
    )
    console.log(`  ${theme.dim('You need a deployed OAuth proxy (Cloudflare Worker).')}`)
    console.log()
  }

  const vars = readEnvFile()

  // OAuth Proxy URL
  const currentProxy = vars.OAUTH_PROXY_URL || ''
  let proxyUrl = flagProxyUrl
  if (!nonInteractive) {
    proxyUrl = await promptInput(
      `  OAuth Proxy URL ${currentProxy ? theme.dim(`(${currentProxy})`) : ''}: `,
    )
  }
  if (proxyUrl) {
    setEnvVar('OAUTH_PROXY_URL', proxyUrl)
    done('OAUTH_PROXY_URL', proxyUrl)
  } else if (currentProxy) {
    done('OAUTH_PROXY_URL', `keeping ${currentProxy}`)
  } else {
    fail('OAUTH_PROXY_URL', 'skipped — OAuth connectors will not work')
    if (!nonInteractive) console.log()
    return
  }

  // Callback Base URL — the agent's public URL
  const currentCallback = vars.OAUTH_CALLBACK_BASE_URL || ''
  let callbackUrl = flagCallbackUrl
  if (!nonInteractive) {
    console.log()
    console.log(
      `  ${theme.dim("  This is your agent's public URL (e.g. https://yourname.antoncomputer.in)")}`,
    )
    callbackUrl = await promptInput(
      `  Agent Public URL ${currentCallback ? theme.dim(`(${currentCallback})`) : ''}: `,
    )
  }
  if (callbackUrl) {
    setEnvVar('OAUTH_CALLBACK_BASE_URL', callbackUrl)
    done('OAUTH_CALLBACK_BASE_URL', callbackUrl)
  } else if (currentCallback) {
    done('OAUTH_CALLBACK_BASE_URL', `keeping ${currentCallback}`)
  } else {
    fail('OAUTH_CALLBACK_BASE_URL', 'skipped — OAuth callbacks will not work')
  }

  console.log()
  restartAgent()

  if (!nonInteractive) {
    console.log()
    console.log(`  ${theme.success('✓')} OAuth connectors configured.`)
    console.log(
      `  ${theme.dim('Users can now click "Connect" in the desktop app for Slack, GitHub, etc.')}`,
    )
    console.log()
  }
}

async function handleBraintrust(args: string[] = []): Promise<void> {
  const flagApiKey = parseFlag(args, '--api-key')

  if (!flagApiKey) {
    console.log()
    console.log(`  ${theme.brandBold('anton.computer')} ${theme.dim('— Braintrust setup')}`)
    console.log()
  }

  const vars = readEnvFile()
  const currentKey = vars.BRAINTRUST_API_KEY || ''

  let apiKey = flagApiKey
  if (!apiKey) {
    apiKey = await promptInput(
      `  Braintrust API Key ${currentKey ? theme.dim('(press Enter to keep current)') : ''}: `,
    )
  }

  if (apiKey) {
    setEnvVar('BRAINTRUST_API_KEY', apiKey)
    done('BRAINTRUST_API_KEY', maskToken(apiKey))
    restartAgent()
  } else if (currentKey) {
    done('BRAINTRUST_API_KEY', 'keeping current value')
  } else {
    console.log(`  ${theme.dim('Skipped.')}`)
  }
  console.log()
}
