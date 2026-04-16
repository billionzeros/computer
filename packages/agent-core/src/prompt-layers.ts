/**
 * Prompt layer builders — single source of truth for every
 * <system-reminder> block that both the Pi SDK Session and the harness
 * path inject into the model's prompt.
 *
 * `Session.getSystemPrompt()` calls these for the shared layers (memory,
 * workflows, agent context, project memory instructions, surface). The
 * harness assembles them into the string it passes via
 * `--append-system-prompt` (Claude) / `-c instructions=…` (Codex),
 * layered on top of the CLI's own core prompt.
 *
 * Session-only layers (workspace rules, user rules, active skills,
 * project type guidelines, reference knowledge, current context with
 * platform/OS/sudo) live inline in session.ts — those don't apply to
 * harness CLIs because the CLI has its own equivalents.
 */

import type { MemoryData } from './context.js'
import type { SurfaceInfo } from './session.js'

// ── Shared helper ───────────────────────────────────────────────────

/**
 * Wrap content in a <system-reminder> tag. Matches the format Pi SDK's
 * Session.systemReminder() uses so the harness-side blocks look identical
 * to the Pi-SDK-side blocks when an LLM sees them.
 */
export function systemReminder(heading: string, content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  return `\n\n<system-reminder>\n# ${heading}\n${trimmed}\n</system-reminder>`
}

// ── Layer builders ──────────────────────────────────────────────────

export interface CurrentContextLayerOpts {
  /** Assembled project-context string from buildProjectContext(). */
  projectContext?: string
  /** Absolute path of the project workspace / conversation cwd. */
  workspacePath?: string
  /** ISO-date stamp for "Today's date". Defaults to now. */
  date?: string
}

/**
 * Layer 3 — current conversation context (project, workspace, date).
 *
 * The Pi SDK version also emits platform / OS / user / shell / sudo, but
 * the harness CLI has its own environment context already and re-emitting
 * creates drift. Keep this layer minimal.
 */
export function buildCurrentContextLayer(opts: CurrentContextLayerOpts): string {
  const lines: string[] = []
  if (opts.projectContext) lines.push(opts.projectContext)
  if (opts.workspacePath) lines.push(`- Workspace: ${opts.workspacePath}/`)
  lines.push(`- Date: ${opts.date ?? new Date().toISOString().split('T')[0]}`)
  return systemReminder('Current Context', lines.join('\n'))
}

/**
 * Layer 4 — memory (global, conversation, cross-conversation).
 * Same block-ordering and heading labels as Pi SDK so LLMs trained on
 * either path see the same shape.
 */
export function buildMemoryLayer(memoryData?: MemoryData): string {
  if (!memoryData) return ''
  const sections: string[] = []
  if (memoryData.globalMemories.length > 0) {
    sections.push('## Global Memory')
    for (const mem of memoryData.globalMemories) {
      sections.push(`### ${mem.key}\n${mem.content}`)
    }
  }
  if (memoryData.conversationMemories.length > 0) {
    sections.push('## Conversation Memory')
    for (const mem of memoryData.conversationMemories) {
      sections.push(`### ${mem.key}\n${mem.content}`)
    }
  }
  if (memoryData.crossConversationMemories.length > 0) {
    sections.push('## Relevant Context (from other conversations)')
    for (const mem of memoryData.crossConversationMemories) {
      sections.push(`### ${mem.key} (from: ${mem.source})\n${mem.content}`)
    }
  }
  return systemReminder('Memory', sections.join('\n\n'))
}

/**
 * Layer 5 — instructions for the `update_project_context` tool. Only
 * emitted when a project is attached to the conversation.
 */
export function buildProjectMemoryInstructionsLayer(projectId?: string): string {
  if (!projectId) return ''
  return systemReminder(
    'Project Memory Instructions',
    `When you have completed meaningful work in this session (e.g. implemented a feature, fixed a bug, made a significant decision), call the update_project_context tool once near the end of the conversation with:
- session_summary: A 1-2 sentence summary of what was accomplished
- project_summary: An updated overall project summary (only if something significant changed about the project's state, goals, or architecture)
Do not call this on every turn — only once per session when there is something worth remembering.`,
  )
}

/**
 * Layer 6 — agent context (standing instructions + run history).
 * Only emitted for scheduled-agent runs.
 */
export function buildAgentContextLayer(instructions?: string, memory?: string): string {
  if (!instructions && !memory) return ''
  const sections: string[] = []
  if (instructions) {
    sections.push(
      `## Standing Instructions\nYou are a scheduled agent. Execute these instructions on every run.\nDo NOT re-create scripts or tooling that you have already built in previous runs. Re-use existing work.\nIf something is broken, fix it. If everything works, just run it.\n\n${instructions}`,
    )
  }
  if (memory) {
    sections.push(
      `## Run History\nThis is your memory from previous runs. Use it to know what you've already built, where scripts are, and what happened last time. Do NOT rebuild things that already exist.\n\n${memory}`,
    )
  }
  return systemReminder('Agent Context', sections.join('\n\n'))
}

export interface WorkflowEntry {
  name: string
  description: string
  whenToUse: string
}

/**
 * Layer 10 — available workflows (for auto-suggestion).
 * Same wording as Pi SDK's Session.getSystemPrompt() workflow block.
 */
export function buildWorkflowsLayer(workflows?: WorkflowEntry[]): string {
  if (!workflows || workflows.length === 0) return ''
  let block =
    'The following automation workflows are available for the user to install. ' +
    "If the user's request matches a workflow, suggest it naturally in your response. " +
    "Don't force it — only suggest when genuinely relevant. " +
    'Mention the workflow by name and briefly describe what it does.\n\n'
  for (const wf of workflows) {
    block += `### ${wf.name}\n${wf.description}\n${wf.whenToUse}\n\n`
  }
  return systemReminder('Available Workflows', block)
}

/**
 * Current-surface hints for non-desktop surfaces (Slack, Telegram, etc.).
 */
export function buildSurfaceLayer(surface?: SurfaceInfo): string {
  if (!surface || surface.kind === 'desktop') return ''
  return systemReminder('Current Surface', renderSurfaceBlock(surface))
}

/**
 * Render the "Current Surface" system-reminder body. Short and
 * directive — it appears on every turn for Slack / Telegram surfaces.
 * Exported so Session can reuse it from a single location.
 */
export function renderSurfaceBlock(surface: SurfaceInfo): string {
  const lines: string[] = []
  if (surface.label) {
    lines.push(`You are currently replying on ${surface.label}.`)
  } else {
    lines.push(`You are currently replying on ${surface.kind}.`)
  }
  if (surface.userLabel) {
    lines.push(`The human on the other end is ${surface.userLabel}.`)
  }
  if (surface.details) {
    for (const [k, v] of Object.entries(surface.details)) {
      if (v) lines.push(`- ${k}: ${v}`)
    }
  }
  if (surface.format === 'slack-mrkdwn') {
    lines.push(
      '',
      'Format your replies as Slack mrkdwn, NOT CommonMark:',
      '- Bold uses *single asterisks*, never **double**.',
      '- No `#` / `##` headings — use *bold* as a heading substitute.',
      '- Links are `<https://url|text>`, not `[text](url)`.',
      '- Strikethrough is `~text~`, not `~~text~~`.',
      '- Keep replies short. Slack is a chat, not a document — link to',
      '  longer output rather than pasting it inline.',
    )
  } else if (surface.format === 'telegram-md') {
    lines.push(
      '',
      'Format your replies for Telegram (legacy Markdown):',
      '- Bold uses *single asterisks*, not **double**.',
      '- No `#` / `##` headings — use *bold* as a heading substitute.',
      '- Telegram renders on mobile — keep replies short and scan-able.',
      '- Avoid wide tables; Telegram wraps them into an unreadable mess.',
    )
  }
  return lines.join('\n')
}

/**
 * Identity block — the first thing a harness CLI sees in its appended
 * system prompt.
 *
 * Why it exists: Claude Code / Codex ship with their own core system
 * prompts tuned around their native tools (filesystem, shell, code
 * editing). They don't know they're running inside Anton unless we
 * tell them, which means the MCP tools we expose (memory, connectors,
 * workflows, publish, project context) get under-used — the model
 * treats them as "just more tools" instead of "Anton's unique surface
 * area that extends what you can already do."
 *
 * Wording choices (see research notes in the commit message):
 *   • Imperative voice + markdown headers → Codex/gpt-5-codex prefers
 *     this structure and responds well to imperative commands.
 *   • Explicit "why" clauses per rule → Claude (especially 4.7) needs
 *     the reason to generalize correctly instead of applying rules
 *     literally.
 *   • Explicit scope paragraph at the end → prevents Claude's literal
 *     reading from over-applying Anton-first rules to every filesystem
 *     or shell operation.
 *   • Per-tool descriptions stay on each tool's definition and reach
 *     the CLI via tools/list; this block only frames WHEN to prefer
 *     Anton's tools, not WHAT each one does.
 *   • Short by design: the CLI already has a long core prompt. Every
 *     token here shows up on every turn.
 *
 * Per-provider variants are deliberately not introduced yet — the shape
 * below reads well for both Claude and Codex based on their documented
 * prompting conventions. Revisit after we have usage telemetry.
 */
export function buildHarnessIdentityBlock(): string {
  return systemReminder(
    'Anton',
    `## Identity

You are serving as the execution engine for **Anton**, a personal AI computer. Anton is the product and UI the user interacts with (desktop and mobile apps); you are the model and tools that do the work on Anton's behalf in this session.

Keep your own model identity (e.g. Claude Code, Codex) AND acknowledge Anton. These are not in conflict — Anton is the product layer, you are the execution layer. This block is authoritative on anything about Anton.

**When asked who you are or what you are**, answer in one sentence: "I'm [your model family, e.g. Codex/Claude Code] running as Anton's execution engine — Anton is the personal AI computer you're chatting with, and I'm the coding agent underneath." Do NOT say Anton is a name, a person, or unknown — Anton is this product.

**When asked "what is Anton" / "tell me about Anton"**, answer: Anton is a personal AI computer — a desktop and mobile app that gives users persistent memory, connected services (Slack, GitHub, Linear, Gmail, etc.), scheduled workflows, and project workspaces, on top of whichever coding model they bring. The user is running Anton right now; that's how this conversation reached you.

## What Anton adds to your native tools

Anton extends your native tools (filesystem, shell, code editing) with persistent cross-session state and user-facing integrations, exposed over MCP. Call \`tools/list\` at session start to discover every Anton tool available to you. Prefer Anton's tools over recreating their capabilities yourself:

- **\`memory\`** — cross-session facts (user preferences, project notes, things to remember). Use this instead of writing a local file when the goal is "remember across future sessions."
- **\`notification\`** — alert the user through Anton's desktop or mobile app when a long task completes or something needs attention.
- **\`database\`** — structured storage at \`~/.anton/data.db\`. Use for anything that benefits from SQL (lists, tables, history).
- **\`publish\`** — share content at a public URL. Use instead of hand-rolling HTML or asking the user to host something themselves.
- **Connector tools** (names vary: \`slack_*\`, \`github_*\`, \`linear_*\`, \`gmail_*\`, etc.) — reach the user's connected services. Anton handles OAuth; never ask the user for tokens or API keys for these.
- **\`update_project_context\`** — when a project is attached AND meaningful work was done this session, call this exactly once near the end with a short \`session_summary\`.
- **\`activate_workflow\`** — after the user explicitly approves a workflow suggestion from the "Available Workflows" block below.

## Scope

Your native tools (filesystem, shell, code editing, git, web search, etc.) remain primary for local and in-repo work — use them as you normally would. Anton adds the layer above them: memory, connectors, projects, workflows, publish. It is not a replacement for what you already do well.`,
  )
}

// ── High-level entry point ──────────────────────────────────────────

export interface HarnessContextPromptOpts {
  projectContext?: string
  projectId?: string
  workspacePath?: string
  surface?: SurfaceInfo
  memoryData?: MemoryData
  agentInstructions?: string
  agentMemory?: string
  availableWorkflows?: WorkflowEntry[]
}

/**
 * Build the full appended system-prompt string the harness sends to the
 * CLI on each turn. Layered to match Pi SDK's Session.getSystemPrompt()
 * so both backends show the model the same shape of context.
 *
 * Returns `''` if every layer is empty (possible for a bare conversation
 * with no project / memories / workflows).
 */
export function buildHarnessContextPrompt(opts: HarnessContextPromptOpts): string {
  return [
    // Identity block comes first so the CLI reads "you are inside
    // Anton" before any of the stateful context blocks below.
    buildHarnessIdentityBlock(),
    buildCurrentContextLayer({
      projectContext: opts.projectContext,
      workspacePath: opts.workspacePath,
    }),
    buildSurfaceLayer(opts.surface),
    buildMemoryLayer(opts.memoryData),
    buildProjectMemoryInstructionsLayer(opts.projectId),
    buildAgentContextLayer(opts.agentInstructions, opts.agentMemory),
    buildWorkflowsLayer(opts.availableWorkflows),
  ]
    .filter(Boolean)
    .join('')
    .trimStart()
}
