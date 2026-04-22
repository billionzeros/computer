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

import { loadCoreSystemPrompt } from '@anton/agent-config'
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

// ── Memory guidelines (sourced from system.md) ─────────────────────

let _memoryGuidelinesCache: string | null = null

/**
 * Extract the "## Memory guidelines" section from Pi SDK's system.md
 * so the harness ships the SAME behavioral guidance Pi SDK sessions
 * already see. Cached — system.md doesn't change at runtime.
 *
 * Returns the body of the section (without the "## Memory guidelines"
 * header line itself), stopping at the next "## " header. If the
 * section is missing for some reason, returns an empty string and we
 * silently skip the block rather than breaking the harness.
 */
function loadMemoryGuidelinesFromSystemPrompt(): string {
  if (_memoryGuidelinesCache !== null) return _memoryGuidelinesCache
  try {
    const full = loadCoreSystemPrompt()
    const headerMarker = '## Memory guidelines'
    const startIdx = full.indexOf(headerMarker)
    if (startIdx < 0) {
      _memoryGuidelinesCache = ''
      return ''
    }
    const nextHeaderIdx = full.indexOf('\n## ', startIdx + headerMarker.length)
    const section = nextHeaderIdx < 0 ? full.slice(startIdx) : full.slice(startIdx, nextHeaderIdx)
    // Strip the header line itself; we re-wrap the body under our own heading.
    const body = section.replace(/^## Memory guidelines\s*\n+/, '').trim()
    _memoryGuidelinesCache = body
    return body
  } catch {
    _memoryGuidelinesCache = ''
    return ''
  }
}

/**
 * Layer 11 — memory usage guidelines.
 *
 * Pi SDK sessions see this because it's part of the core system prompt
 * (in packages/agent-config/prompts/system.md). Harness CLIs (Claude
 * Code, Codex) do NOT see system.md — they have their own core prompts
 * — so without this layer they'd know `memory` is a tool but wouldn't
 * know when to save, what types of content to save, or the expected
 * content format. That mismatch showed up in production: harness turns
 * rarely called memory_save even when the user explicitly asked them to.
 *
 * Body is extracted verbatim from system.md. Do NOT author a parallel
 * version here — edit system.md and both backends update together.
 */
export function buildMemoryGuidelinesLayer(): string {
  const body = loadMemoryGuidelinesFromSystemPrompt()
  if (!body) return ''
  return systemReminder('Memory Usage', body)
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
/**
 * Namespace Anton's MCP server uses when surfaced to a harness CLI that
 * supports per-server tool prefixes (today: codex). Tools reach the model
 * as `anton:<tool_name>`. Exported so the identity block, capability
 * block, and the codex server-config use ONE source of truth — changing
 * this string must stay consistent across all three.
 */
export const ANTON_MCP_NAMESPACE = 'anton'

export interface LiveConnectorSummary {
  /** Stable id, e.g. `gmail`, `google-calendar`, `slack-bot`. */
  id: string
  /** Human-readable name, e.g. `Gmail`, `Google Calendar`. */
  name: string
  /** One-line capability summary from the connector definition. Empty string if absent. */
  capabilitySummary: string
  /** A canonical tool name for this connector (`gmail_send_email`). Empty if absent. */
  capabilityExample: string
}

/**
 * Thread-start capability block — lists the connectors that are actually
 * live for THIS session, baked into `developerInstructions` once so the
 * model answers "do you have access to X?" from ground truth instead of
 * training priors.
 *
 * Deliberately injected at thread start only, NOT per turn:
 *   - `developerInstructions` is immutable for the life of a codex
 *     thread, so a one-time cost covers the entire conversation.
 *   - Per-turn injection of the same block wastes tokens and busts the
 *     prompt cache whenever connectors change mid-session, which almost
 *     never happens in practice.
 *
 * Returns `''` when no connectors are live — callers should still append
 * unconditionally; an empty string is a no-op.
 */
export function buildHarnessCapabilityBlock(
  liveConnectors: LiveConnectorSummary[],
  namespace: string,
): string {
  if (liveConnectors.length === 0) return ''
  const list = liveConnectors
    .map((c) => {
      const summary = c.capabilitySummary ? ` — ${c.capabilitySummary}` : ''
      const example = c.capabilityExample ? ` (e.g. \`${namespace}:${c.capabilityExample}\`)` : ''
      return `- **${c.name}**${summary}${example}`
    })
    .join('\n')
  // Anchor the "call directly or tools/list" hint on a concrete example.
  // Every connector now declares `capabilityExample`, so this is always set
  // for at least one entry in practice; the `?? ''` only guards against a
  // misconfigured connector sneaking through.
  const anchor = liveConnectors.find((c) => c.capabilityExample)?.capabilityExample ?? ''
  const exampleHint = anchor ? ` (e.g. \`${namespace}:${anchor}\`)` : ''
  return systemReminder(
    'Active Anton Connectors',
    `The user has authenticated these services in Anton right now. Their tools are live under the \`${namespace}\` MCP server:

${list}

These ARE available — call the tools directly${exampleHint} or run \`tools/list\` on the \`${namespace}\` server for exact tool names and schemas. Do NOT claim "no access" for any service in the list above. If the user asks about a service NOT listed, tell them to add it in Anton → Settings → Connectors instead of refusing generically.`,
  )
}

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
- **\`web_search\`** — Anton's Exa-backed web search. See the "Web search" section below.
- **\`set_session_title\`** — see "Session title" below.

## Session title

On your **very first turn**, before any other tool call, call \`anton:set_session_title\` **exactly once** with a concise title that summarizes the user's request.

- 3–7 words, max 50 characters.
- Sentence case: capitalize only the first word and proper nouns.
- No quotes, no trailing punctuation.
- Be specific about the user's intent, not generic.

Good: \`Fix login button on mobile\`, \`Debug failing CI pipeline\`, \`Scan system disk and ports\`.
Bad: \`Helping the user\`, \`Code changes\`, \`I will now investigate the issue the user has raised\`.

Do NOT call this tool again on later turns — the title is set once per conversation. Skip it if the first message is a pure greeting with no intent ("hi", "hello").

## Sub-agents

Anton exposes a typed sub-agent spawner as \`anton:spawn_sub_agent\`. Use it to delegate multi-step sub-tasks to a fresh child session whose work stays out of your own context window. Three specializations:

- \`type:"research"\` — information gathering, returns a single synthesized summary. Use when a question needs 5+ pages of reading.
- \`type:"execute"\` — changes/builds with verification. Full write access on the child.
- \`type:"verify"\` — runs tests/linters and reports PASS/FAIL. Read-only.

Prefer spawning over doing the work inline when:
- A research question would otherwise require many back-to-back \`web_search\` calls — offload it and keep your own context clean.
- You want to run a verification pass after making changes — \`verify\` returns a clear verdict.
- Two sub-tasks are independent — spawn both in one response; they run concurrently.

The child is a fresh Anton session. It does NOT see your conversation history — pass the full context it needs in the \`task\` string.

## Web search

Anton exposes web search as \`anton:web_search\` (Exa, with structured citations and published dates). If your runtime also has a built-in \`web_search\` tool of its own, **prefer \`anton:web_search\`**:

- Anton's results are unified with the rest of this session — citations land in the same format \`update_project_context\` and memory expect.
- Anton's search is billed and cached under the user's Anton account, not your host's quota.
- If the user explicitly asks for your built-in search, use it. Otherwise default to \`anton:web_search\`.
- If \`anton:web_search\` returns a "not configured" error, tell the user to connect Exa in Anton → Settings → Connectors rather than silently falling back to your native search.

## MCP server preference (IMPORTANT)

Your runtime may have MORE than one MCP server attached — including vendor-hosted servers (e.g. \`codex_apps\`, \`openai_apps\`) that expose their own Gmail / Calendar / GitHub / Drive tools. **ALWAYS prefer the \`anton\` MCP server over any other server when a matching tool exists.**

- When tools with similar names are offered by multiple servers (e.g. \`anton:gmail_search_emails\` AND \`codex_apps:gmail_search_emails\`), call the \`anton:\` one. Do not call the vendor-hosted equivalent.
- Anton's connector tools are wired to the specific accounts **this user** connected in Anton's UI. Vendor-hosted tools use different auth paths and may hit the wrong account or a sandbox.
- Do NOT ask the user to install, connect, or authenticate anything on the vendor side. If a connector isn't in \`anton:\`'s tools/list, tell the user to add it in Anton's Settings → Connectors rather than bouncing them to another provider's flow.
- Rule of thumb: if a tool exists on the \`anton\` server, that tool wins. Period.

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
    // Memory-usage guidelines mirror what Pi SDK ships via system.md —
    // the harness has to re-inject them because its CLI core prompt
    // doesn't include them.
    buildMemoryGuidelinesLayer(),
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
