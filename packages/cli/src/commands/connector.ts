import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { theme } from '../lib/theme.js'

/**
 * Resolve the .anton directory.
 * Priority: ANTON_DIR env var → /home/anton/.anton (Linux root) → ~/.anton
 */
function resolveAntonDir(): string {
  if (process.env.ANTON_DIR) return process.env.ANTON_DIR
  // On Linux as root, the agent runs as the 'anton' user — use its home
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    return '/home/anton/.anton'
  }
  return join(homedir(), '.anton')
}

const ANTON_DIR = resolveAntonDir()
const CONFIG_PATH = join(ANTON_DIR, 'config.yaml')

interface ConnectorEntry {
  id: string
  name: string
  description?: string
  icon?: string
  type: 'mcp' | 'api'
  apiKey?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
}

// ── Built-in registry (same as agent-config but duplicated to avoid the dependency) ──

interface RegistryEntry {
  id: string
  name: string
  description: string
  icon: string
  type: 'mcp' | 'api'
  requires: string // Human-readable requirement
  example: string // Example CLI command
}

const REGISTRY: RegistryEntry[] = [
  {
    id: 'exa-search',
    name: 'Web Search (Exa)',
    description: 'Semantic web search with full page content extraction',
    icon: '🔍',
    type: 'api',
    requires: 'Search proxy URL and bearer token',
    example:
      'anton connector add exa-search --url https://search-proxy.workers.dev --api-key tok_...',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Send and receive Telegram messages',
    icon: '📱',
    type: 'mcp',
    requires: 'Telegram Bot Token (from @BotFather)',
    example: 'anton connector add telegram --env TELEGRAM_BOT_TOKEN=your_token',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repos, issues, and PRs',
    icon: '🐙',
    type: 'mcp',
    requires: 'GitHub Personal Access Token',
    example: 'anton connector add github --env GITHUB_TOKEN=ghp_...',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages and manage channels',
    icon: '💬',
    type: 'mcp',
    requires: 'Slack Bot Token',
    example: 'anton connector add slack --env SLACK_BOT_TOKEN=xoxb-...',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write Notion pages and databases',
    icon: '📝',
    type: 'mcp',
    requires: 'Notion API Key',
    example: 'anton connector add notion --env NOTION_API_KEY=secret_...',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues, projects, and workflows',
    icon: '📋',
    type: 'mcp',
    requires: 'Linear API Key',
    example: 'anton connector add linear --env LINEAR_API_KEY=lin_api_...',
  },
]

// ── Config helpers ──────────────────────────────────────────────────

function loadConnectors(): { config: Record<string, unknown>; connectors: ConnectorEntry[] } {
  mkdirSync(ANTON_DIR, { recursive: true })
  if (!existsSync(CONFIG_PATH)) {
    return { config: {}, connectors: [] }
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  const config = (parseYaml(raw) as Record<string, unknown>) || {}
  return { config, connectors: (config.connectors as ConnectorEntry[]) || [] }
}

function saveConnectors(config: Record<string, unknown>, connectors: ConnectorEntry[]) {
  config.connectors = connectors
  writeFileSync(CONFIG_PATH, stringifyYaml(config), 'utf-8')
}

// ── MCP command defaults ────────────────────────────────────────────

const MCP_COMMANDS: Record<string, { command: string; args: string[] }> = {
  telegram: { command: 'npx', args: ['-y', 'telegram-mcp-server'] },
  github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  slack: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
  notion: { command: 'npx', args: ['-y', '@anthropic/mcp-server-notion'] },
  linear: { command: 'npx', args: ['-y', 'mcp-server-linear'] },
  gmail: { command: 'npx', args: ['-y', '@anthropic/mcp-server-gmail'] },
  'google-calendar': { command: 'npx', args: ['-y', '@anthropic/mcp-server-google-calendar'] },
  'google-drive': { command: 'npx', args: ['-y', '@anthropic/mcp-server-google-drive'] },
}

// ── Main command ────────────────────────────────────────────────────

/**
 * anton connector                  — list configured + show available
 * anton connector add <id> [opts]  — add a connector
 * anton connector remove <id>      — remove a connector
 */
export function connectorCommand(args: string[]): void {
  const action = args[0]

  switch (action) {
    case 'add':
      handleAdd(args.slice(1))
      break

    case 'remove':
    case 'rm':
      handleRemove(args[1])
      break

    case 'list':
    case undefined:
      handleList()
      break

    default:
      console.log(`\n  Unknown action: ${action}`)
      console.log(`  Usage: ${theme.brand('anton connector')} [add|remove|list]\n`)
  }
}

// ── Handlers ────────────────────────────────────────────────────────

function handleList() {
  const { connectors } = loadConnectors()

  // Show configured connectors
  if (connectors.length > 0) {
    console.log(`\n  ${theme.bold('Configured Connectors')}\n`)
    for (const c of connectors) {
      const status = c.enabled ? theme.success('●') : theme.dim('○')
      const detail = c.baseUrl || (c.apiKey ? `${c.apiKey.slice(0, 8)}...` : c.command || '')
      console.log(
        `  ${status} ${theme.bold(c.name)} ${theme.dim(`(${c.id})`)}  ${theme.dim(detail)}`,
      )
    }
  } else {
    console.log(`\n  ${theme.dim('No connectors configured.')}`)
  }

  // Show available connectors from registry
  const configuredIds = new Set(connectors.map((c) => c.id))
  const available = REGISTRY.filter((r) => !configuredIds.has(r.id))

  if (available.length > 0) {
    console.log(`\n  ${theme.bold('Available Connectors')}\n`)
    for (const r of available) {
      console.log(`  ${r.icon} ${theme.bold(r.name)} ${theme.dim(`(${r.id})`)}`)
      console.log(`    ${r.description}`)
      console.log(`    Requires: ${theme.dim(r.requires)}`)
      console.log(`    ${theme.dim(`$ ${r.example}`)}`)
      console.log()
    }
  }

  console.log(
    `  ${theme.dim('Add with:')} ${theme.brand('anton connector add <id> --url <url> | --api-key <key> | --env KEY=value')}\n`,
  )
}

function handleAdd(args: string[]) {
  const id = args[0]
  if (!id) {
    console.log(`\n  Usage: ${theme.brand('anton connector add <id>')} [options]`)
    console.log('\n  Options:')
    console.log(`    ${theme.dim('--url <url>')}               Base URL (for SearXNG, etc.)`)
    console.log(`    ${theme.dim('--api-key <key>')}           API key (for Brave Search, etc.)`)
    console.log(
      `    ${theme.dim('--env KEY=value')}           Environment variable (for MCP connectors)`,
    )
    console.log(`    ${theme.dim('--name <name>')}             Display name`)
    console.log('\n  Examples:')
    console.log(
      `    ${theme.brand('anton connector add exa-search --url https://search-proxy.workers.dev --api-key tok_...')}`,
    )
    console.log(`    ${theme.brand('anton connector add github --env GITHUB_TOKEN=ghp_...')}\n`)

    // Show registry
    console.log(`  ${theme.bold('Available connectors:')}\n`)
    for (const r of REGISTRY) {
      console.log(`    ${r.icon} ${theme.bold(r.id.padEnd(16))} ${r.description}`)
    }
    console.log()
    return
  }

  const url = parseFlag(args, '--url')
  const apiKey = parseFlag(args, '--api-key')
  const name = parseFlag(args, '--name')
  const envPairs = parseEnvFlags(args)

  if (!url && !apiKey && Object.keys(envPairs).length === 0) {
    // Show what this specific connector needs
    const reg = REGISTRY.find((r) => r.id === id)
    if (reg) {
      console.log(`\n  ${reg.icon} ${theme.bold(reg.name)}`)
      console.log(`  ${reg.description}`)
      console.log(`\n  Requires: ${reg.requires}`)
      console.log('\n  Example:')
      console.log(`    ${theme.brand(`$ ${reg.example}`)}\n`)
    } else {
      console.log(`\n  ${theme.error('Must provide --url, --api-key, or --env KEY=value')}\n`)
    }
    return
  }

  // Determine connector type
  const mcpDefaults = MCP_COMMANDS[id]
  const isApi = !!url || !!apiKey
  const isMcp = !isApi && (Object.keys(envPairs).length > 0 || !!mcpDefaults)

  const reg = REGISTRY.find((r) => r.id === id)

  const { config, connectors } = loadConnectors()
  const filtered = connectors.filter((c) => c.id !== id)

  const connector: ConnectorEntry = {
    id,
    name: name || reg?.name || id,
    description: reg?.description,
    icon: reg?.icon,
    type: isApi ? 'api' : 'mcp',
    enabled: true,
  }

  if (url) connector.baseUrl = url
  if (apiKey) connector.apiKey = apiKey
  if (isMcp) {
    connector.env = envPairs
    if (mcpDefaults) {
      connector.command = mcpDefaults.command
      connector.args = mcpDefaults.args
    }
  }

  filtered.push(connector)
  saveConnectors(config, filtered)

  console.log(`\n  ${theme.success('✓')} Connector ${theme.bold(connector.name)} added`)
  if (url) console.log(`    URL:     ${url}`)
  if (apiKey) console.log(`    API Key: ${apiKey.slice(0, 8)}...`)
  if (Object.keys(envPairs).length > 0) {
    for (const [k, v] of Object.entries(envPairs)) {
      console.log(`    ${k}: ${v.slice(0, 12)}...`)
    }
  }
  console.log(`    Config:  ${CONFIG_PATH}`)
  console.log(`\n  ${theme.dim('Restart the agent for changes to take effect.')}\n`)
}

function handleRemove(id?: string) {
  if (!id) {
    console.log(`\n  Usage: ${theme.brand('anton connector remove <id>')}\n`)
    return
  }
  const { config, connectors } = loadConnectors()
  const before = connectors.length
  const filtered = connectors.filter((c) => c.id !== id)
  if (filtered.length === before) {
    console.log(`\n  ${theme.error(`Connector "${id}" not found`)}\n`)
    return
  }
  saveConnectors(config, filtered)
  console.log(`\n  ${theme.success('✓')} Connector ${theme.bold(id)} removed\n`)
}

// ── Utils ───────────────────────────────────────────────────────────

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}

function parseEnvFlags(args: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      const pair = args[i + 1]
      const eq = pair.indexOf('=')
      if (eq > 0) {
        env[pair.slice(0, eq)] = pair.slice(eq + 1)
      }
    }
  }
  return env
}
