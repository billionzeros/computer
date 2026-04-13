/**
 * Command registry — slash commands intercepted before the LLM.
 *
 * Commands are parsed and executed in front of `session.processMessage()`,
 * so they cost zero tokens. The registry is provider-agnostic; any webhook
 * surface (Slack, Telegram, future) gets the same commands for free.
 */

import { findProjectsByName, listProjectIndex, loadProject } from '@anton/agent-config'
import type { Session } from './session.js'

// ── Types ────────────────────────────────────────────────────────────

export interface CommandContext {
  sessionId: string
  /** Evict the current session so the next message creates a fresh one. */
  evictSession: () => void
  /** Get the live Session instance, if one exists. */
  getSession: () => Session | undefined
  /** Get the current project binding for this channel/chat. */
  getProjectId: () => string | undefined
  /** Save a new project binding for this channel/chat. */
  saveProjectBinding: (projectId: string) => void
  /** Persist a model override so the next session uses it. */
  saveModelOverride: (model: string) => void
  /** Get the model override from binding, if set. */
  getModelOverride?: () => string | undefined
  /** Get the default provider/model from config. */
  getDefaultModel?: () => { provider: string; model: string }
  /** List available AI providers with key status. */
  listProviders?: () => { name: string; hasKey: boolean; isDefault: boolean }[]
  /** List scheduled agents/bots. */
  listAgents?: () => { name: string; description: string; schedule: string; nextRun: number; lastRun: number | null; enabled: boolean }[]
}

export interface CommandResult {
  text: string
}

export interface Command {
  name: string
  description: string
  usage?: string
  handler: (args: string, context: CommandContext) => CommandResult
}

// ── Model shorthand map ──────────────────────────────────────────────

const MODEL_SHORTHANDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-0-20250115',
  haiku: 'claude-haiku-3-5-20241022',
  'gpt-4o': 'gpt-4o',
  'o3-mini': 'o3-mini',
}

// ── Command definitions ──────────────────────────────────────────────

const commands: Command[] = [
  {
    name: 'project',
    description: 'Switch to a project or show current',
    usage: '/project [name]',
    handler: handleProject,
  },
  {
    name: 'projects',
    description: 'List all projects',
    usage: '/projects',
    handler: handleProjects,
  },
  {
    name: 'model',
    description: 'Switch model or show current',
    usage: '/model [name]',
    handler: handleModel,
  },
  {
    name: 'providers',
    description: 'List AI providers and key status',
    usage: '/providers',
    handler: handleProviders,
  },
  {
    name: 'agents',
    description: 'List scheduled agents',
    usage: '/agents',
    handler: handleAgents,
  },
  {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: handleHelp,
  },
  {
    name: 'status',
    description: 'Show current status',
    usage: '/status',
    handler: handleStatus,
  },
  {
    name: 'reset',
    description: 'Reset conversation',
    usage: '/reset',
    handler: handleReset,
  },
]

// ── Public API ───────────────────────────────────────────────────────

/** Parse text into a command name + args, or null if not a command. */
export function parseCommand(text: string): { name: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

  // Only match registered commands
  if (!commands.some((c) => c.name === name)) return null
  return { name, args }
}

/** Parse and execute a command. Returns null if text is not a command. */
export function executeCommand(text: string, context: CommandContext): CommandResult | null {
  const parsed = parseCommand(text)
  if (!parsed) return null

  const cmd = commands.find((c) => c.name === parsed.name)
  if (!cmd) return null

  return cmd.handler(parsed.args, context)
}

/** List all registered commands (for help text and Telegram registration). */
export function listCommands(): readonly Command[] {
  return commands
}

// ── Command handlers ─────────────────────────────────────────────────

function ok(text: string): CommandResult {
  return { text }
}

function handleProject(args: string, ctx: CommandContext): CommandResult {
  if (!args) {
    // Show current project
    const projectId = ctx.getProjectId()
    if (!projectId) {
      return ok('No project bound to this chat. Use `/project <name>` to switch.')
    }
    const project = loadProject(projectId)
    if (!project) {
      return ok(
        `Bound to project \`${projectId}\` but it no longer exists. Use \`/project <name>\` to switch.`,
      )
    }
    const lines = [
      `**${project.icon} ${project.name}**`,
      project.description ? `_${project.description}_` : '',
      project.workspacePath ? `Workspace: \`${project.workspacePath}\`` : '',
      `Type: ${project.type || 'mixed'}`,
    ].filter(Boolean)
    return ok(lines.join('\n'))
  }

  // Switch to a project
  const matches = findProjectsByName(args)
  if (matches.length === 0) {
    const all = listProjectIndex()
    const list = all.map((p) => `• ${p.icon} ${p.name}`).join('\n')
    return ok(`No project matching "${args}". Available projects:\n${list}`)
  }
  if (matches.length > 1) {
    const list = matches.map((p) => `• ${p.icon} ${p.name}`).join('\n')
    return ok(`Multiple matches for "${args}":\n${list}\nBe more specific.`)
  }

  const project = matches[0]
  ctx.saveProjectBinding(project.id)
  ctx.evictSession()
  return ok(
    `Switched to **${project.icon} ${project.name}**. Next message starts a fresh session with this project's context.`,
  )
}

function handleProjects(_args: string, ctx: CommandContext): CommandResult {
  const projects = listProjectIndex()
  if (projects.length === 0) {
    return ok('No projects found.')
  }

  const currentId = ctx.getProjectId()
  const lines = projects.map((p, i) => {
    const marker = p.id === currentId ? ' ← current' : ''
    return `${i + 1}. ${p.icon} **${p.name}**${marker}`
  })
  return ok(lines.join('\n'))
}

function handleModel(args: string, ctx: CommandContext): CommandResult {
  if (!args) {
    const session = ctx.getSession()
    if (!session) {
      return ok('No active session. Send a message first, then check the model.')
    }
    return ok(`Model: \`${session.model}\`\nProvider: \`${session.provider}\``)
  }

  // Resolve shorthand
  const resolved = MODEL_SHORTHANDS[args.toLowerCase()] || args

  // Persist the override so getOrCreateSession picks it up, then evict
  // the current session. Mutating session.model does nothing — the PiAgent
  // was already constructed with the old model at session creation time.
  ctx.saveModelOverride(resolved)
  ctx.evictSession()
  return ok(`Model switched to \`${resolved}\`. Next message will use it.`)
}

function handleHelp(): CommandResult {
  const lines = commands.map((c) => `\`${c.usage || `/${c.name}`}\` — ${c.description}`)
  return ok(`**Available commands:**\n${lines.join('\n')}`)
}

function handleStatus(_args: string, ctx: CommandContext): CommandResult {
  const lines: string[] = []

  // Project
  const projectId = ctx.getProjectId()
  if (projectId) {
    const project = loadProject(projectId)
    lines.push(`**Project:** ${project ? `${project.icon} ${project.name}` : projectId}`)
  } else {
    lines.push('**Project:** none')
  }

  // Model & provider — show from session if active, otherwise from binding/default
  const session = ctx.getSession()
  if (session) {
    lines.push(`**Model:** \`${session.model}\``)
    lines.push(`**Provider:** \`${session.provider}\``)
    lines.push(`**Session:** active`)
  } else {
    const override = ctx.getModelOverride?.()
    const defaults = ctx.getDefaultModel?.()
    if (override) {
      lines.push(`**Model:** \`${override}\` (override)`)
    } else if (defaults) {
      lines.push(`**Model:** \`${defaults.model}\` (default)`)
    }
    if (defaults) {
      lines.push(`**Provider:** \`${defaults.provider}\``)
    }
    lines.push('**Session:** idle (next message will create one)')
  }

  return ok(lines.join('\n'))
}

function handleProviders(_args: string, ctx: CommandContext): CommandResult {
  const providers = ctx.listProviders?.()
  if (!providers || providers.length === 0) {
    return ok('No providers configured.')
  }
  const lines = providers.map((p) => {
    const status = p.hasKey ? '✅' : '❌'
    const marker = p.isDefault ? ' ← active' : ''
    return `${status} **${p.name}**${marker}`
  })
  return ok(`**AI Providers:**\n${lines.join('\n')}`)
}

function handleAgents(_args: string, ctx: CommandContext): CommandResult {
  const agents = ctx.listAgents?.()
  if (!agents || agents.length === 0) {
    return ok('No scheduled agents.')
  }
  const lines = agents.map((a) => {
    const status = a.enabled ? '🟢' : '⏸️'
    const next = new Date(a.nextRun).toLocaleString()
    return `${status} **${a.name}** — ${a.schedule}\n    Next: ${next}`
  })
  return ok(`**Scheduled Agents:**\n${lines.join('\n')}`)
}

function handleReset(_args: string, ctx: CommandContext): CommandResult {
  ctx.evictSession()
  return ok('Session reset. Next message starts fresh.')
}
