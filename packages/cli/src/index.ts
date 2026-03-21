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
import { connectCommand } from './commands/connect.js'
import { machinesCommand } from './commands/machines.js'
import { shellCommand } from './commands/shell.js'
import { skillsCommand } from './commands/skills.js'
import { statusCommand } from './commands/status.js'
import { getDefaultMachine } from './lib/machines.js'
import { LOGO, theme } from './lib/theme.js'
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
      machinesCommand()
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

    case 'help':
    case '--help':
    case '-h':
      showHelp()
      break

    case 'version':
    case '--version':
    case '-v':
      console.log(`anton CLI v${CLI_VERSION} (spec ${(await import('./lib/version.js')).SPEC_VERSION})`)
      break

    case 'computer': {
      const subcommand = args[1]
      if (subcommand === 'version') {
        // Connect to agent and show its version
        const m = getDefaultMachine()
        if (!m) {
          console.log(`\n  No machines configured. Run ${theme.bold('anton connect')} first.\n`)
          break
        }
        const { Connection } = await import('./lib/connection.js')
        const { SPEC_VERSION: cliSpec, MIN_AGENT_SPEC: cliMinAgent } = await import('./lib/version.js')
        const conn = new Connection()
        try {
          await conn.connect({ host: m.host, port: m.port, token: m.token, useTLS: m.useTLS })
          console.log(`\n  ${theme.bold('Agent')}`)
          console.log(`    ID:        ${conn.agentId}`)
          console.log(`    Version:   ${conn.agentVersion}`)
          console.log(`    Spec:      ${conn.agentSpecVersion}`)
          console.log(`    Commit:    ${conn.agentGitHash}`)
          console.log(`    Host:      ${m.host}:${m.port}`)
          console.log(``)
          console.log(`  ${theme.bold('CLI')}`)
          console.log(`    Version:   ${CLI_VERSION}`)
          console.log(`    Spec:      ${cliSpec}`)
          console.log(`    Min agent: ${cliMinAgent}`)
          console.log(``)
          conn.disconnect()
        } catch (err: unknown) {
          console.log(`\n  ${theme.error(`Could not connect: ${(err as Error).message}`)}\n`)
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
          console.log(`  Triggering update...\n`)

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
              console.log(`  Starting update...`)
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
      } else {
        console.log(`\n  Usage:`)
        console.log(`    ${theme.brand('anton computer version')}    Show agent version`)
        console.log(`    ${theme.brand('anton computer update')}     Update the agent\n`)
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
        console.log(`  No binary available for this platform.`)
        console.log(`  Update manually: npm i -g @anton/cli\n`)
        break
      }
      console.log(`  Downloading...`)
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
        console.log(LOGO)
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
  console.log(LOGO)
  console.log(`  ${theme.bold('Usage:')}`)
  console.log()
  console.log(`  ${theme.brand('anton')}                              Interactive REPL`)
  console.log(`  ${theme.brand('anton connect')} [host]               Connect to an agent`)
  console.log('    --token <tok>                     Auth token')
  console.log('    --name <name>                     Friendly name')
  console.log('    --tls                             Use TLS (port 9877)')
  console.log(`  ${theme.brand('anton machines')}                      List saved machines`)
  console.log(`  ${theme.brand('anton chat')} "message"                One-shot chat`)
  console.log(`  ${theme.brand('anton shell')}                         Remote shell`)
  console.log(`  ${theme.brand('anton skills')} [list|run <name>]      Manage skills`)
  console.log(`  ${theme.brand('anton status')}                        Check agent status`)
  console.log(`  ${theme.brand('anton update')}                        Update CLI to latest version`)
  console.log(`  ${theme.brand('anton computer version')}              Show agent version`)
  console.log(`  ${theme.brand('anton computer update')}               Update the agent on your VM`)
  console.log(`  ${theme.brand('anton help')}                          Show this help`)
  console.log()
  console.log(`  ${theme.dim('Ports (from SPEC.md):')}`)
  console.log(`    ${theme.dim('9876')}  ws://   ${theme.dim('plain (default)')}`)
  console.log(`    ${theme.dim('9877')}  wss://  ${theme.dim('TLS (--tls flag)')}`)
  console.log()
}

main().catch((err) => {
  console.error(theme.error(`Fatal: ${err.message}`))
  process.exit(1)
})
