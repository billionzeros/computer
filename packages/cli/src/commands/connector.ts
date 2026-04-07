import { spawn } from 'node:child_process'
import { Channel } from '@anton/protocol'
import type {
  AiMessage,
  ConnectorRegistryEntryPayload,
  ConnectorStatusPayload,
} from '@anton/protocol'
import { Connection } from '../lib/connection.js'
import { getDefaultMachine } from '../lib/machines.js'
import { ICONS, theme } from '../lib/theme.js'

const REQUEST_TIMEOUT_MS = 15_000
const OAUTH_WAIT_TIMEOUT_MS = 10 * 60 * 1000

interface ConnectorState {
  connectors: ConnectorStatusPayload[]
  registry: ConnectorRegistryEntryPayload[]
}

/**
 * anton connector                  — list configured + available connectors
 * anton connector connect <id>     — connect a built-in OAuth connector
 * anton connector disconnect <id>  — disconnect/remove a configured connector
 */
export async function connectorCommand(args: string[]): Promise<void> {
  const action = args[0]

  switch (action) {
    case 'connect':
      await handleConnect(args[1])
      break

    case 'disconnect':
    case 'remove':
    case 'rm':
      await handleDisconnect(args[1])
      break

    case 'list':
    case undefined:
      await handleList()
      break

    default:
      printUsage(`Unknown action: ${action}`)
      process.exit(1)
  }
}

async function handleList(): Promise<void> {
  const conn = await connectToDefaultAgent()
  try {
    const { connectors, registry } = await fetchConnectorState(conn)

    if (connectors.length > 0) {
      console.log(`\n  ${theme.bold('Configured Connectors')}\n`)
      for (const connector of connectors.sort(sortConfiguredConnectors)) {
        const status = connector.connected
          ? theme.success('●')
          : connector.enabled
            ? theme.warning('○')
            : theme.dim('○')
        const type = theme.dim(`[${connector.type}]`)
        const tools = connector.toolCount > 0 ? theme.dim(`${connector.toolCount} tools`) : ''
        const meta =
          connector.type === 'oauth' && connector.connected ? theme.dim('connected via OAuth') : ''
        console.log(
          `  ${status} ${theme.bold(connector.name)} ${theme.dim(`(${connector.id})`)} ${type} ${tools} ${meta}`.trimEnd(),
        )
      }
    } else {
      console.log(`\n  ${theme.dim('No connectors configured.')}`)
    }

    const configuredIds = new Set(connectors.map((c) => c.id))
    const availableOAuth = registry
      .filter((entry) => entry.type === 'oauth' && !configuredIds.has(entry.id))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (availableOAuth.length > 0) {
      console.log(`\n  ${theme.bold('Available OAuth Connectors')}\n`)
      for (const entry of availableOAuth) {
        console.log(`  ${entry.icon} ${theme.bold(entry.name)} ${theme.dim(`(${entry.id})`)}`)
        console.log(`    ${entry.description}`)
        console.log(`    ${theme.dim(`$ anton connector connect ${entry.id}`)}`)
        console.log()
      }
    }

    const nonOAuth = registry.filter(
      (entry) => entry.type !== 'oauth' && !configuredIds.has(entry.id),
    )
    if (nonOAuth.length > 0) {
      console.log(
        `  ${theme.dim('Non-OAuth and custom connector setup remains in the desktop app for now.')}\n`,
      )
    } else {
      console.log()
    }
  } finally {
    conn.disconnect()
  }
}

async function handleConnect(id?: string): Promise<void> {
  if (!id) {
    printUsage()
    process.exit(1)
  }

  const conn = await connectToDefaultAgent()
  try {
    const state = await fetchConnectorState(conn)
    const entry = state.registry.find((item) => item.id === id)
    if (!entry) {
      console.error(`\n  ${theme.error(`Unknown connector "${id}"`)}\n`)
      process.exit(1)
    }
    if (entry.type !== 'oauth') {
      console.error(
        `\n  ${theme.error(`Connector "${id}" is not OAuth-backed.`)} ${theme.dim('Use the desktop app for non-OAuth/custom connectors.')}\n`,
      )
      process.exit(1)
    }

    const existing = state.connectors.find((item) => item.id === id)
    if (existing?.connected && existing.enabled) {
      console.log(`\n  ${theme.success('✓')} ${theme.bold(entry.name)} is already connected.\n`)
      return
    }

    console.log(`\n  ${ICONS.connecting} Starting OAuth for ${theme.bold(entry.name)}...`)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error('Timed out waiting for OAuth completion'))
      }, OAUTH_WAIT_TIMEOUT_MS)

      const cleanup = () => clearTimeout(timer)
      const off = conn.onMessage((channel, payload) => {
        if (channel !== Channel.AI) return
        const msg = payload as AiMessage

        if (msg.type === 'connector_oauth_url' && msg.provider === id) {
          const opened = openExternalUrl(msg.url)
          console.log(
            `  ${theme.success('✓')} ${opened ? 'Opened browser' : 'Open this URL in your browser'}: ${theme.info(msg.url)}`,
          )
          return
        }

        if (msg.type === 'connector_oauth_complete' && msg.provider === id) {
          cleanup()
          off()
          if (msg.success) resolve()
          else reject(new Error(msg.error || 'OAuth failed'))
          return
        }

        if (msg.type === 'error') {
          cleanup()
          off()
          reject(new Error(msg.message))
        }
      })

      conn.sendConnectorOAuthStart(id)
    })

    console.log(`\n  ${theme.success('✓')} Connected ${theme.bold(entry.name)}.\n`)
  } catch (err) {
    console.error(`\n  ${theme.error(`Failed to connect ${id}: ${(err as Error).message}`)}\n`)
    process.exit(1)
  } finally {
    conn.disconnect()
  }
}

async function handleDisconnect(id?: string): Promise<void> {
  if (!id) {
    printUsage()
    process.exit(1)
  }

  const conn = await connectToDefaultAgent()
  try {
    const state = await fetchConnectorState(conn)
    const connector = state.connectors.find((item) => item.id === id)
    if (!connector) {
      console.error(`\n  ${theme.error(`Connector "${id}" is not configured.`)}\n`)
      process.exit(1)
    }

    console.log(`\n  ${ICONS.connecting} Disconnecting ${theme.bold(connector.name)}...`)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error('Timed out waiting for connector removal'))
      }, REQUEST_TIMEOUT_MS)

      const cleanup = () => clearTimeout(timer)
      const off = conn.onMessage((channel, payload) => {
        if (channel !== Channel.AI) return
        const msg = payload as AiMessage

        if (msg.type === 'connector_removed' && msg.id === id) {
          cleanup()
          off()
          resolve()
          return
        }

        if (msg.type === 'error') {
          cleanup()
          off()
          reject(new Error(msg.message))
        }
      })

      if (connector.type === 'oauth') conn.sendConnectorOAuthDisconnect(id)
      else conn.sendConnectorRemove(id)
    })

    console.log(`\n  ${theme.success('✓')} Disconnected ${theme.bold(connector.name)}.\n`)
  } catch (err) {
    console.error(`\n  ${theme.error(`Failed to disconnect ${id}: ${(err as Error).message}`)}\n`)
    process.exit(1)
  } finally {
    conn.disconnect()
  }
}

async function connectToDefaultAgent(): Promise<Connection> {
  const conn = new Connection()
  const machine = getDefaultMachine()
  const localTarget = await getLocalAgentTarget()

  const target = machine
    ? {
        host: machine.host,
        port: machine.port,
        token: machine.token,
        useTLS: machine.useTLS,
      }
    : localTarget

  if (!target) {
    console.error(
      `\n  No machine configured. Run ${theme.bold('anton connect <host>')} first, or run this on the Anton machine.\n`,
    )
    process.exit(1)
  }

  try {
    await conn.connect(target)
  } catch (err) {
    console.error(`\n  ${theme.error(`Connection failed: ${(err as Error).message}`)}\n`)
    process.exit(1)
  }

  return conn
}

async function getLocalAgentTarget(): Promise<{
  host: string
  port: number
  token: string
  useTLS: boolean
} | null> {
  try {
    const { readPortFromService, readTokenFromEnv } = await import('./computer-common.js')
    const token = readTokenFromEnv()
    const port = readPortFromService()
    if (!token || !port) return null
    return { host: 'localhost', port, token, useTLS: false }
  } catch {
    return null
  }
}

async function fetchConnectorState(conn: Connection): Promise<ConnectorState> {
  return new Promise((resolve, reject) => {
    let connectors: ConnectorStatusPayload[] | null = null
    let registry: ConnectorRegistryEntryPayload[] | null = null

    const timer = setTimeout(() => {
      off()
      reject(new Error('Timed out loading connector state'))
    }, REQUEST_TIMEOUT_MS)

    const maybeResolve = () => {
      if (!connectors || !registry) return
      clearTimeout(timer)
      off()
      resolve({ connectors, registry })
    }

    const off = conn.onMessage((channel, payload) => {
      if (channel !== Channel.AI) return
      const msg = payload as AiMessage

      if (msg.type === 'connectors_list_response') {
        connectors = msg.connectors
        maybeResolve()
        return
      }

      if (msg.type === 'connector_registry_list_response') {
        registry = msg.entries
        maybeResolve()
        return
      }

      if (msg.type === 'error') {
        clearTimeout(timer)
        off()
        reject(new Error(msg.message))
      }
    })

    conn.sendConnectorsList()
    conn.sendConnectorRegistryList()
  })
}

function sortConfiguredConnectors(a: ConnectorStatusPayload, b: ConnectorStatusPayload): number {
  if (a.connected !== b.connected) return a.connected ? -1 : 1
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
  return a.name.localeCompare(b.name)
}

function printUsage(error?: string) {
  if (error) {
    console.log(`\n  ${error}`)
  }
  console.log(`\n  Usage: ${theme.brand('anton connector')} [list|connect|disconnect]\n`)
  console.log(
    `    ${theme.brand('anton connector')}                         List configured connectors`,
  )
  console.log(
    `    ${theme.brand('anton connector connect')} ${theme.dim('<id>')}          Connect a built-in OAuth connector`,
  )
  console.log(
    `    ${theme.brand('anton connector disconnect')} ${theme.dim('<id>')}       Disconnect/remove a configured connector`,
  )
  console.log()
}

function openExternalUrl(url: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return true
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      })
      child.on('error', () => {})
      child.unref()
      return true
    }
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
