#!/usr/bin/env node

/**
 * anton.computer agent — your personal cloud computer daemon.
 *
 * Install on any VPS, connect from the desktop app or CLI.
 * The agent DOES things — deploys code, manages files, monitors servers.
 *
 * Usage:
 *   anton-agent              # Start with default config (~/.anton/config.yaml)
 *   anton-agent --port 9876  # Override port
 *
 * Environment variables:
 *   ANTON_TOKEN  — Force a specific auth token (skips random generation)
 */

import { loadConfig, loadProjects, loadSkills } from '@anton/agent-config'
import { GIT_HASH, VERSION } from '@anton/agent-config'
import { closeBrowserSession, flushTraces, initTracing } from '@anton/agent-core'
import { createLogger, initLogger } from '@anton/logger'
import { AgentManager } from './agents/index.js'
import { Scheduler } from './scheduler.js'
import { AgentServer } from './server.js'

async function main() {
  // biome-ignore lint/suspicious/noConsole: startup banner before logger init
  console.log(`
   ┌─────────────────────────────────────┐
   │  anton.computer agent v${VERSION}         │
   │  Your personal cloud computer.      │
   │  commit: ${GIT_HASH.padEnd(28)}│
   └─────────────────────────────────────┘
  `)

  // Initialize structured logging (before anything else)
  initLogger()
  const log = createLogger('server')

  // Load config (creates default on first run)
  const config = loadConfig()

  // Load skills from ~/.anton/skills/
  const skills = loadSkills()
  config.skills = skills

  if (skills.length > 0) {
    log.info({ count: skills.length, skills: skills.map((s) => s.name) }, 'skills loaded')
  }

  // Show provider status
  const providers = Object.entries(config.providers ?? {})
  const configured = providers.filter(([, p]) => p.apiKey && p.apiKey.length > 0)
  log.info(
    {
      configured: configured.length,
      total: providers.length,
      default: config.defaults ? `${config.defaults.provider}/${config.defaults.model}` : undefined,
    },
    'providers status',
  )

  // Initialize Braintrust tracing (no-ops if no API key)
  initTracing(config.braintrust)

  // Start the WebSocket server (handles client connections + sessions)
  const server = new AgentServer(config)
  await server.start()

  // Start the scheduler for 24/7 autonomous skills
  const scheduler = new Scheduler(config)
  scheduler.addSkills(skills)
  scheduler.start()
  server.setScheduler(scheduler)

  // Start the agent manager — agents are conversations with a schedule
  const agentManager = new AgentManager((event) => {
    server.broadcastAgentEvent(event)
  })
  const projects = loadProjects()
  agentManager.loadAll(projects.map((p) => p.id))
  agentManager.start()
  server.setAgentManager(agentManager)

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down')
    scheduler.stop()
    agentManager.shutdown()
    await server.shutdown() // Stop MCP servers, kill PTYs, release resources
    await closeBrowserSession() // Close Playwright browser if open
    await flushTraces()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  createLogger('server').fatal({ err }, 'fatal error')
  process.exit(1)
})

export { AgentServer } from './server.js'
export { Scheduler } from './scheduler.js'
export { Updater } from './updater.js'
export { AgentManager } from './agents/index.js'
export type { SchedulerJobInfo, SchedulerEventCallback } from './scheduler.js'
