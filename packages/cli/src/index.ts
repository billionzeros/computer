#!/usr/bin/env node

/**
 * anton — CLI for anton.computer
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → ws://  (default)
 *   Port 9877 → wss:// (--tls)
 *
 * Usage:
 *   anton                           Interactive REPL
 *   anton connect [host]            Connect to an agent (interactive)
 *   anton machines                  List saved machines
 *   anton chat "message"            One-shot chat
 *   anton shell                     Remote shell
 *   anton skills [list|run <name>]  Manage skills
 *   anton status                    Check agent status
 *   anton help                      Show this help
 */

import { render } from 'ink'
import React from 'react'
import { chatCommand } from './commands/chat.js'
import { computerConfigCommand } from './commands/computer-config.js'
import {
  computerLogsCommand,
  computerRestartCommand,
  computerStartCommand,
  computerStatusCommand,
  computerStopCommand,
  computerUninstallCommand,
} from './commands/computer-lifecycle.js'
import { computerSetupCommand } from './commands/computer-setup.js'
import { computerSidecarCommand } from './commands/computer-sidecar.js'
import { connectCommand } from './commands/connect.js'
import { connectorCommand } from './commands/connector.js'
import { machinesCommand } from './commands/machines.js'
import { shellCommand } from './commands/shell.js'
import { skillsCommand } from './commands/skills.js'
import { statusCommand } from './commands/status.js'
import { getDefaultMachine } from './lib/machines.js'
import { getLogo, theme } from './lib/theme.js'
import { CLI_VERSION, checkForUpdate, selfUpdate } from './lib/version.js'
import { App } from './ui/App.js'

const args = process.argv.slice(2)
const command = args[0]

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}

function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

async function main() {
  switch (command) {
    case 'connect': {
      // Host is optional — will prompt interactively if not provided
      const host = args[1] && !args[1].startsWith('--') ? args[1] : undefined
      await connectCommand({
        host,
        token: parseFlag('--token'),
        name: parseFlag('--name'),
        tls: hasFlag('--tls'),
      })
      break
    }

    case 'machines':
      machinesCommand(args[1], args[2])
      break

    case 'chat': {
      const message = args.slice(1).join(' ')
      if (!message) {
        console.log(`\n  Usage: anton chat "your message here"\n`)
        process.exit(1)
      }
      await chatCommand(message)
      break
    }

    case 'shell':
      await shellCommand()
      break

    case 'skills': {
      const action = (args[1] ?? 'list') as 'list' | 'run'
      const skillName = args[2]
      await skillsCommand(action, skillName)
      break
    }

    case 'status':
      await statusCommand(args[1], args[2] ? Number.parseInt(args[2], 10) : undefined)
      break

    case 'connector':
    case 'connectors':
      connectorCommand(args.slice(1))
      break

    case 'help':
    case '--help':
    case '-h':
      showHelp()
      break

    case 'version':
    case '--version':
    case '-v':
      console.log(`anton CLI v${CLI_VERSION}`)
      break

    case 'computer': {
      const subcommand = args[1]
      if (subcommand === 'setup') {
        await computerSetupCommand({
          token: parseFlag('--token'),
          port: parseFlag('--port') ? Number(parseFlag('--port')) : undefined,
          sidecarPort: parseFlag('--sidecar-port')
            ? Number(parseFlag('--sidecar-port'))
            : undefined,
          yes: hasFlag('--yes') || hasFlag('-y'),
        })
      } else if (subcommand === 'version') {
        // Try local agent first (on the VM), then remote
        const { readTokenFromEnv, readPortFromService } = await import(
          './commands/computer-common.js'
        )
        const localPort = readPortFromService()
        const localToken = readTokenFromEnv()

        if (localPort && localToken) {
          // Running on the VM — connect to local agent
          const { Connection } = await import('./lib/connection.js')
          const conn = new Connection()
          try {
            await conn.connect({
              host: 'localhost',
              port: localPort,
              token: localToken,
              useTLS: false,
            })
            console.log(`\n  ${theme.bold('Agent')}`)
            console.log(`    ID:        ${conn.agentId}`)
            console.log(`    Version:   ${conn.agentVersion}`)
            console.log(`    Commit:    ${conn.agentGitHash}`)
            console.log(`    Port:      ${localPort}`)
            console.log('')
            console.log(`  ${theme.bold('CLI')}`)
            console.log(`    Version:   ${CLI_VERSION}`)
            console.log('')
            conn.disconnect()
          } catch (err: unknown) {
            console.log(
              `\n  ${theme.error(`Could not connect to local agent: ${(err as Error).message}`)}\n`,
            )
          }
        } else {
          // Remote — use saved machine
          const m = getDefaultMachine()
          if (!m) {
            console.log(
              `\n  No local agent or saved machines found. Run ${theme.bold('anton computer setup')} or ${theme.bold('anton connect')} first.\n`,
            )
            break
          }
          const { Connection } = await import('./lib/connection.js')
          const conn = new Connection()
          try {
            await conn.connect({
              host: m.host,
              port: m.port,
              token: m.token,
              useTLS: m.useTLS,
            })
            console.log(`\n  ${theme.bold('Agent')}`)
            console.log(`    ID:        ${conn.agentId}`)
            console.log(`    Version:   ${conn.agentVersion}`)
            console.log(`    Commit:    ${conn.agentGitHash}`)
            console.log(`    Host:      ${m.host}:${m.port}`)
            console.log('')
            console.log(`  ${theme.bold('CLI')}`)
            console.log(`    Version:   ${CLI_VERSION}`)
            console.log('')
            conn.disconnect()
          } catch (err: unknown) {
            console.log(`\n  ${theme.error(`Could not connect: ${(err as Error).message}`)}\n`)
          }
        }
      } else if (subcommand === 'update') {
        // Trigger agent self-update via the protocol
        const m = getDefaultMachine()
        if (!m) {
          console.log(`\n  No machines configured. Run ${theme.bold('anton connect')} first.\n`)
          break
        }
        const { Connection } = await import('./lib/connection.js')
        const { Channel } = await import('@anton/protocol')
        const conn = new Connection()
        try {
          await conn.connect({ host: m.host, port: m.port, token: m.token, useTLS: m.useTLS })
          console.log(`\n  Connected to ${conn.agentId} (v${conn.agentVersion})`)
          console.log('  Triggering update...\n')

          // Listen for progress messages
          conn.onMessage((channel, msg: unknown) => {
            const m = msg as Record<string, unknown>
            if (channel === Channel.CONTROL && m.type === 'update_progress') {
              const stage = m.stage as string
              const message = m.message as string
              if (stage === 'done') {
                console.log(`  ${theme.success(message)}`)
                conn.disconnect()
                process.exit(0)
              } else if (stage === 'error') {
                console.log(`  ${theme.error(message)}`)
                conn.disconnect()
                process.exit(1)
              } else {
                console.log(`  [${stage}] ${message}`)
              }
            } else if (channel === Channel.CONTROL && m.type === 'update_check_response') {
              if (!(m.updateAvailable as boolean)) {
                console.log(`  ${theme.success('Agent is already up to date.')}`)
                conn.disconnect()
                process.exit(0)
              }
              console.log(`  Update available: v${m.currentVersion} → v${m.latestVersion}`)
              console.log('  Starting update...')
              conn.send(Channel.CONTROL, { type: 'update_start' })
            }
          })

          // First check if update is available
          conn.send(Channel.CONTROL, { type: 'update_check' })

          // Wait for completion (timeout after 5 min)
          await new Promise((resolve) => setTimeout(resolve, 300_000))
        } catch (err: unknown) {
          console.log(`\n  ${theme.error(`Failed: ${(err as Error).message}`)}\n`)
        }
      } else if (subcommand === 'status') {
        await computerStatusCommand()
      } else if (subcommand === 'stop') {
        await computerStopCommand()
      } else if (subcommand === 'start') {
        await computerStartCommand()
      } else if (subcommand === 'restart') {
        await computerRestartCommand()
      } else if (subcommand === 'logs') {
        await computerLogsCommand({
          target: args[2] && !args[2].startsWith('-') ? args[2] : 'agent',
          follow: hasFlag('-f') || hasFlag('--follow'),
          lines: parseFlag('-n') ? Number(parseFlag('-n')) : undefined,
        })
      } else if (subcommand === 'uninstall') {
        await computerUninstallCommand({
          yes: hasFlag('--yes') || hasFlag('-y'),
          purge: hasFlag('--purge'),
        })
      } else if (subcommand === 'sidecar') {
        await computerSidecarCommand({
          sidecarPort: parseFlag('--sidecar-port')
            ? Number(parseFlag('--sidecar-port'))
            : undefined,
        })
      } else if (subcommand === 'config') {
        await computerConfigCommand(args.slice(2))
      } else {
        console.log('\n  Usage:')
        console.log(
          `    ${theme.brand('anton computer setup')}        Set up agent on this machine`,
        )
        console.log(`    ${theme.brand('anton computer config')}       Manage agent configuration`)
        console.log(`    ${theme.brand('anton computer status')}       Show agent + sidecar health`)
        console.log(
          `    ${theme.brand('anton computer logs')}         View logs (agent|sidecar|deploy|all)`,
        )
        console.log(`    ${theme.brand('anton computer start')}        Start services`)
        console.log(`    ${theme.brand('anton computer stop')}         Stop services`)
        console.log(`    ${theme.brand('anton computer restart')}      Restart services`)
        console.log(
          `    ${theme.brand('anton computer sidecar')}      Install/update sidecar binary`,
        )
        console.log(`    ${theme.brand('anton computer update')}       Update agent binary`)
        console.log(`    ${theme.brand('anton computer version')}      Show agent version`)
        console.log(
          `    ${theme.brand('anton computer uninstall')}    Remove agent from this machine\n`,
        )
      }
      break
    }

    case 'update': {
      console.log(`\n  Checking for updates... (current: v${CLI_VERSION})`)
      const update = await checkForUpdate()
      if (!update || !update.available) {
        console.log(`  ${theme.success('Already up to date.')}\n`)
        break
      }
      console.log(`  ${theme.brand(`v${update.latest}`)} available`)
      if (update.changelog) {
        console.log(`  ${theme.dim(update.changelog)}\n`)
      }
      if (!update.downloadUrl) {
        console.log('  No binary available for this platform.')
        console.log('  Update manually: npm i -g @anton/cli\n')
        break
      }
      console.log('  Downloading...')
      try {
        await selfUpdate(update.downloadUrl)
        console.log(`  ${theme.success(`Updated to v${update.latest}`)}`)
        console.log(`  Restart your terminal or run ${theme.bold('anton version')} to verify.\n`)
      } catch (err: unknown) {
        console.log(`  ${theme.error(`Update failed: ${(err as Error).message}`)}\n`)
      }
      break
    }

    case undefined: {
      // Interactive REPL mode
      const machine = getDefaultMachine()
      if (!machine) {
        console.log(getLogo(CLI_VERSION))
        console.log(`  ${theme.warning('No machines configured.')}`)
        console.log(`  Run ${theme.bold('anton connect')} to get started.\n`)
        process.exit(0)
      }

      const { waitUntilExit } = render(React.createElement(App, { machine }))
      await waitUntilExit()
      break
    }

    default:
      console.log(`\n  Unknown command: ${command}`)
      console.log(`  Run ${theme.bold('anton help')} for usage.\n`)
      process.exit(1)
  }
}

function showHelp() {
  console.log(getLogo(CLI_VERSION))

  // ── Connect & Use ──
  console.log(`  ${theme.bold('Connect & Use')}`)
  console.log()
  console.log(`    ${theme.brand('anton')}                            Interactive REPL`)
  console.log(
    `    ${theme.brand('anton connect')} ${theme.dim('[host]')}              Connect to an agent`,
  )
  console.log(`      ${theme.dim('--token <tok>')}                  Auth token`)
  console.log(`      ${theme.dim('--name <name>')}                  Friendly name`)
  console.log(`      ${theme.dim('--tls')}                           Use TLS (port 9877)`)
  console.log(
    `    ${theme.brand('anton chat')} ${theme.dim('"message"')}              One-shot message`,
  )
  console.log(`    ${theme.brand('anton shell')}                       Remote shell`)
  console.log()

  // ── Server Management ──
  console.log(`  ${theme.bold('Server Management')}`)
  console.log()
  console.log(
    `    ${theme.brand('anton computer setup')}              Set up agent on this machine`,
  )
  console.log(`      ${theme.dim('--token <tok>')}                  Auth token (auto-generated)`)
  console.log(`      ${theme.dim('--port <n>')}                     Agent port (default: 9876)`)
  console.log(`      ${theme.dim('--yes')}                           Non-interactive mode`)
  console.log(`    ${theme.brand('anton computer status')}             Agent + sidecar health`)
  console.log(
    `    ${theme.brand('anton computer logs')} ${theme.dim('[agent|sidecar|deploy]')}  View logs`,
  )
  console.log(`      ${theme.dim('-f')}                               Follow mode`)
  console.log(`      ${theme.dim('-n <lines>')}                       Lines to show (default: 50)`)
  console.log(`    ${theme.brand('anton computer start')}              Start services`)
  console.log(`    ${theme.brand('anton computer stop')}               Stop services`)
  console.log(`    ${theme.brand('anton computer restart')}            Restart services`)
  console.log(`    ${theme.brand('anton computer update')}             Update agent binary`)
  console.log(`    ${theme.brand('anton computer version')}            Show agent version`)
  console.log(`    ${theme.brand('anton computer uninstall')}          Remove agent`)
  console.log(`      ${theme.dim('--purge')}                         Also delete user + data`)
  console.log(`    ${theme.brand('anton status')}                      Remote agent health check`)
  console.log()

  // ── Machines ──
  console.log(`  ${theme.bold('Saved Machines')}`)
  console.log()
  console.log(`    ${theme.brand('anton machines')}                    List saved machines`)
  console.log(
    `    ${theme.brand('anton machines rm')} ${theme.dim('<name>')}          Remove a machine`,
  )
  console.log(`    ${theme.brand('anton machines default')} ${theme.dim('<name>')}     Set default`)
  console.log()

  // ── Connectors ──
  console.log(`  ${theme.bold('Connectors')}`)
  console.log()
  console.log(
    `    ${theme.brand('anton connector')}                     List configured + available`,
  )
  console.log(
    `    ${theme.brand('anton connector add')} ${theme.dim('<id> [opts]')}     Add a connector`,
  )
  console.log(`      ${theme.dim('--url <url>')}                   SearXNG URL`)
  console.log(`      ${theme.dim('--api-key <key>')}               API key (Brave, etc.)`)
  console.log(`      ${theme.dim('--env KEY=value')}              Env var (MCP connectors)`)
  console.log(
    `    ${theme.brand('anton connector remove')} ${theme.dim('<id>')}        Remove a connector`,
  )
  console.log()

  // ── Other ──
  console.log(`  ${theme.bold('Other')}`)
  console.log()
  console.log(
    `    ${theme.brand('anton skills')} ${theme.dim('[list|run <name>]')}    Manage skills`,
  )
  console.log(`    ${theme.brand('anton update')}                      Update CLI`)
  console.log(`    ${theme.brand('anton help')}                        Show this help`)
  console.log()
}

main().catch((err) => {
  console.error(theme.error(`Fatal: ${err.message}`))
  process.exit(1)
})
