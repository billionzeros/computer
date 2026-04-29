/**
 * Fixture-driven adapter smoke check.
 *
 * Run with:  pnpm --filter @anton/agent-core check:harness
 *
 * For each NDJSON fixture, feeds every line through the adapter's
 * parseEvent() and compares the resulting SessionEvent[] to an expected
 * array. Prints a diff and exits non-zero on mismatch.
 *
 * Fixtures are committed alongside this file. To capture new ones:
 *   claude -p "<prompt>" --output-format stream-json --verbose \
 *     > new-fixture.ndjson
 *   codex exec "<prompt>" --json --color never --full-auto \
 *     > new-fixture.ndjson
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionEvent } from '../../session.js'
import type { HarnessAdapter } from '../adapter.js'
import { ClaudeAdapter } from '../adapters/claude.js'
import { CodexAdapter } from '../adapters/codex.js'
import {
  claudeErrorExpected,
  claudeSimpleExpected,
  claudeToolCallExpected,
  codexErrorExpected,
  codexMcpRealExpected,
  codexSimpleExpected,
  codexToolCallExpected,
} from './expected.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

interface Case {
  name: string
  adapter: HarnessAdapter
  fixture: string
  expected: SessionEvent[]
}

const claude = new ClaudeAdapter()
const codex = new CodexAdapter()

const cases: Case[] = [
  {
    name: 'claude-simple',
    adapter: claude,
    fixture: 'claude-simple.ndjson',
    expected: claudeSimpleExpected,
  },
  {
    name: 'claude-tool-call',
    adapter: claude,
    fixture: 'claude-tool-call.ndjson',
    expected: claudeToolCallExpected,
  },
  {
    name: 'claude-error',
    adapter: claude,
    fixture: 'claude-error.ndjson',
    expected: claudeErrorExpected,
  },
  {
    name: 'codex-simple',
    adapter: codex,
    fixture: 'codex-simple.ndjson',
    expected: codexSimpleExpected,
  },
  {
    name: 'codex-tool-call',
    adapter: codex,
    fixture: 'codex-tool-call.ndjson',
    expected: codexToolCallExpected,
  },
  {
    name: 'codex-error',
    adapter: codex,
    fixture: 'codex-error.ndjson',
    expected: codexErrorExpected,
  },
  // Real stdout captured from Codex CLI in production (Apr 2026). If
  // this fails, Codex changed its mcp_tool_call item shape again and
  // the adapter needs to be updated to match.
  {
    name: 'codex-mcp-real',
    adapter: codex,
    fixture: 'codex-mcp-real.ndjson',
    expected: codexMcpRealExpected,
  },
]

function runFixture(c: Case): SessionEvent[] {
  const raw = readFileSync(join(__dirname, c.fixture), 'utf-8')
  const events: SessionEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    events.push(...c.adapter.parseEvent(line))
  }
  return events
}

function eq(actual: SessionEvent[], expected: SessionEvent[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

let failed = 0
for (const c of cases) {
  try {
    const actual = runFixture(c)
    if (eq(actual, c.expected)) {
      console.log(`✓ ${c.name}`)
    } else {
      failed++
      console.error(`✗ ${c.name}`)
      console.error('  expected:', JSON.stringify(c.expected, null, 2))
      console.error('  actual:  ', JSON.stringify(actual, null, 2))
    }
  } catch (err) {
    failed++
    console.error(`✗ ${c.name} (threw)`, err)
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${cases.length} harness fixture checks failed`)
  process.exit(1)
}

console.log(`\nAll ${cases.length} harness fixture checks passed`)

// ── Prompt layer smoke tests ────────────────────────────────────────
// Not a full diff — just assert each layer's heading shows up when its
// data is present, and nothing emits for empty/undefined inputs. Guards
// against an accidental rename of a <system-reminder> heading, which
// would silently change prompt shape for the LLM.

import { buildHarnessContextPrompt } from '../../prompt-layers.js'

interface LayerCase {
  name: string
  opts: Parameters<typeof buildHarnessContextPrompt>[0]
  mustInclude: string[]
  mustNotInclude?: string[]
}

const layerCases: LayerCase[] = [
  {
    name: 'empty-opts-produces-minimal-output',
    opts: {},
    mustInclude: ['# Current Context', '- Date:'],
    // The memory-DATA block is "# Memory\n## Global Memory" — distinct
    // from the always-on "# Memory Usage" guidelines block. Use
    // sub-headers so we match only the data path.
    mustNotInclude: ['## Global Memory', '# Available Workflows', '# Agent Context'],
  },
  {
    name: 'project-context-included',
    opts: {
      projectContext: 'You are running inside Anton.\nProject: foo',
      projectId: 'proj_1',
      workspacePath: '/tmp/foo',
    },
    mustInclude: [
      '# Current Context',
      'Project: foo',
      '- Workspace: /tmp/foo/',
      '# Project Memory Instructions',
    ],
  },
  {
    name: 'memory-block-emitted',
    opts: {
      memoryData: {
        globalMemories: [{ key: 'prefer_short_replies', content: 'Keep answers brief.' }],
        conversationMemories: [],
        crossConversationMemories: [],
      },
    },
    mustInclude: [
      '# Memory',
      '## Global Memory',
      '### prefer_short_replies',
      'Keep answers brief.',
    ],
  },
  {
    name: 'workflow-catalog-emitted',
    opts: {
      availableWorkflows: [
        {
          name: 'triage-slack',
          description: 'Summarize unread Slack DMs.',
          whenToUse: 'user asks about slack',
        },
      ],
    },
    mustInclude: ['# Available Workflows', '### triage-slack', 'Summarize unread Slack DMs.'],
  },
  {
    name: 'agent-context-emitted',
    opts: {
      agentInstructions: 'Run the daily lead scan.',
      agentMemory: 'Last run: 2026-04-15, found 3 leads.',
    },
    mustInclude: [
      '# Agent Context',
      '## Standing Instructions',
      'Run the daily lead scan.',
      '## Run History',
    ],
  },
]

let layerFailed = 0
for (const c of layerCases) {
  try {
    const out = buildHarnessContextPrompt(c.opts)
    const missing = c.mustInclude.filter((s) => !out.includes(s))
    const leaked = (c.mustNotInclude || []).filter((s) => out.includes(s))
    if (missing.length === 0 && leaked.length === 0) {
      console.log(`✓ prompt-layer: ${c.name}`)
    } else {
      layerFailed++
      console.error(`✗ prompt-layer: ${c.name}`)
      if (missing.length) console.error('  missing:', missing)
      if (leaked.length) console.error('  leaked:', leaked)
      console.error('  output:', out)
    }
  } catch (err) {
    layerFailed++
    console.error(`✗ prompt-layer: ${c.name} (threw)`, err)
  }
}

if (layerFailed > 0) {
  console.error(`\n${layerFailed}/${layerCases.length} prompt-layer checks failed`)
  process.exit(1)
}

console.log(`All ${layerCases.length} prompt-layer checks passed`)

// ── Tool registry smoke tests ──────────────────────────────────────
// Exercises AntonToolRegistry composition: static tools always present,
// project-scoped tools appear only when the session context has a
// projectId + handler, connector tools flow through the AgentTool→MCP
// adapter.

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { AntonToolRegistry } from '../tool-registry.js'

// Fake connector tool built with the same shape Pi SDK connectors use.
const fakeConnectorTool: AgentTool = {
  name: 'github_list_issues',
  label: 'GitHub: List Issues',
  description: 'List open issues in a repository.',
  parameters: Type.Object({
    repo: Type.String({ description: 'owner/repo' }),
  }),
  async execute(_id, params) {
    return {
      content: [{ type: 'text', text: `issues for ${(params as { repo: string }).repo}` }],
      details: {},
    }
  },
}

interface RegistryCase {
  name: string
  setup: () => AntonToolRegistry
  sessionId: string
  mustInclude: string[]
  mustNotInclude?: string[]
}

// Canonical Pi SDK tool names — same definitions both backends use.
const STATIC_NAMES = ['database', 'memory', 'notification', 'publish']

const registryCases: RegistryCase[] = [
  {
    name: 'static-tools-always-present',
    setup: () => new AntonToolRegistry(),
    sessionId: 'sess-bare',
    mustInclude: STATIC_NAMES,
    mustNotInclude: ['activate_workflow', 'update_project_context', 'github_list_issues'],
  },
  {
    name: 'project-context-adds-update-project-context',
    setup: () =>
      new AntonToolRegistry({
        getSessionContext: () => ({ projectId: 'proj_1' }),
      }),
    sessionId: 'sess-p',
    mustInclude: [...STATIC_NAMES, 'update_project_context'],
    mustNotInclude: ['activate_workflow'],
  },
  {
    name: 'project-plus-workflow-handler-adds-activate-workflow',
    setup: () =>
      new AntonToolRegistry({
        getSessionContext: () => ({
          projectId: 'proj_1',
          onActivateWorkflow: async () => 'ok',
        }),
      }),
    sessionId: 'sess-pw',
    mustInclude: [...STATIC_NAMES, 'activate_workflow', 'update_project_context'],
  },
  {
    name: 'connector-tools-flow-through-adapter',
    setup: () =>
      new AntonToolRegistry({
        connectorManager: { getAllTools: () => [fakeConnectorTool] },
      }),
    sessionId: 'sess-c',
    mustInclude: [...STATIC_NAMES, 'github_list_issues'],
  },
]

let regFailed = 0
for (const c of registryCases) {
  try {
    const reg = c.setup()
    const names = reg.getTools(c.sessionId).map((t) => t.name)
    const missing = c.mustInclude.filter((n) => !names.includes(n))
    const leaked = (c.mustNotInclude || []).filter((n) => names.includes(n))
    if (missing.length === 0 && leaked.length === 0) {
      console.log(`✓ registry: ${c.name}`)
    } else {
      regFailed++
      console.error(`✗ registry: ${c.name}`)
      if (missing.length) console.error('  missing:', missing)
      if (leaked.length) console.error('  leaked:', leaked)
      console.error('  names:', names)
    }
  } catch (err) {
    regFailed++
    console.error(`✗ registry: ${c.name} (threw)`, err)
  }
}

if (regFailed > 0) {
  console.error(`\n${regFailed}/${registryCases.length} registry checks failed`)
  process.exit(1)
}

console.log(`All ${registryCases.length} registry checks passed`)

// ── Shared-layer byte-for-byte check ───────────────────────────────
// Proves the layer builders produce the same <system-reminder> blocks
// Session.getSystemPrompt used to inline. If a builder's wording drifts,
// this fails loudly before a Pi SDK prompt regression ships.

import {
  buildActiveConnectorsLayer as _buildActiveConnectorsLayer,
  buildActiveSkillsLayer as _buildActiveSkillsLayer,
  buildAgentContextLayer as _buildAgentContextLayer,
  buildHarnessContextPrompt as _buildHarnessContextPrompt,
  buildHarnessIdentityBlock as _buildHarnessIdentityBlock,
  buildMemoryGuidelinesLayer as _buildMemoryGuidelinesLayer,
  buildMemoryLayer as _buildMemoryLayer,
  buildProjectMemoryInstructionsLayer as _buildProjectMemoryInstructionsLayer,
  buildSurfaceLayer as _buildSurfaceLayer,
  buildWorkflowsLayer as _buildWorkflowsLayer,
  selectRelevantSkillsForMessage as _selectRelevantSkillsForMessage,
} from '../../prompt-layers.js'
import { buildSkillTool as _buildSkillTool } from '../../tools/skill-factory.js'

interface LayerSnapshot {
  name: string
  actual: string
  expected: string
}

const layerSnapshots: LayerSnapshot[] = [
  {
    name: 'memory (all three buckets)',
    actual: _buildMemoryLayer({
      globalMemories: [{ key: 'prefer_short_replies', content: 'Keep answers brief.' }],
      conversationMemories: [{ key: 'current_task', content: 'Fixing the login bug.' }],
      crossConversationMemories: [
        { key: 'deploy_cmd', content: 'pnpm deploy', source: 'sess_abc' },
      ],
    }),
    expected:
      '\n\n<system-reminder>\n# Memory\n' +
      '## Global Memory\n\n' +
      '### prefer_short_replies\nKeep answers brief.\n\n' +
      '## Conversation Memory\n\n' +
      '### current_task\nFixing the login bug.\n\n' +
      '## Relevant Context (from other conversations)\n\n' +
      '### deploy_cmd (from: sess_abc)\npnpm deploy\n</system-reminder>',
  },
  {
    name: 'workflows',
    actual: _buildWorkflowsLayer([
      { name: 'triage-slack', description: 'Summarize unread DMs.', whenToUse: 'on slack request' },
    ]),
    expected:
      '\n\n<system-reminder>\n# Available Workflows\n' +
      'The following automation workflows are available for the user to install. ' +
      "If the user's request matches a workflow, suggest it naturally in your response. " +
      "Don't force it — only suggest when genuinely relevant. " +
      'Mention the workflow by name and briefly describe what it does.\n\n' +
      '### triage-slack\nSummarize unread DMs.\non slack request\n</system-reminder>',
  },
  {
    name: 'agent context',
    actual: _buildAgentContextLayer('Run the daily lead scan.', 'Last run: 2026-04-15, 3 leads.'),
    expected:
      '\n\n<system-reminder>\n# Agent Context\n' +
      '## Standing Instructions\nYou are a scheduled agent. Execute these instructions on every run.\n' +
      'Do NOT re-create scripts or tooling that you have already built in previous runs. Re-use existing work.\n' +
      'If something is broken, fix it. If everything works, just run it.\n\n' +
      'Run the daily lead scan.\n\n' +
      "## Run History\nThis is your memory from previous runs. Use it to know what you've already built, where scripts are, and what happened last time. Do NOT rebuild things that already exist.\n\n" +
      'Last run: 2026-04-15, 3 leads.\n</system-reminder>',
  },
  {
    name: 'project memory instructions',
    actual: _buildProjectMemoryInstructionsLayer('proj_1'),
    expected:
      '\n\n<system-reminder>\n# Project Memory Instructions\n' +
      'When you have completed meaningful work in this session (e.g. implemented a feature, fixed a bug, made a significant decision), call the update_project_context tool once near the end of the conversation with:\n' +
      '- session_summary: A 1-2 sentence summary of what was accomplished\n' +
      "- project_summary: An updated overall project summary (only if something significant changed about the project's state, goals, or architecture)\n" +
      'Do not call this on every turn — only once per session when there is something worth remembering.\n</system-reminder>',
  },
  {
    name: 'surface (desktop returns empty)',
    actual: _buildSurfaceLayer({ kind: 'desktop' }),
    expected: '',
  },
]

let snapFailed = 0
for (const s of layerSnapshots) {
  if (s.actual === s.expected) {
    console.log(`✓ snapshot: ${s.name}`)
  } else {
    snapFailed++
    console.error(`✗ snapshot: ${s.name}`)
    console.error('  expected:', JSON.stringify(s.expected))
    console.error('  actual:  ', JSON.stringify(s.actual))
  }
}

if (snapFailed > 0) {
  console.error(`\n${snapFailed}/${layerSnapshots.length} snapshot checks failed`)
  process.exit(1)
}

console.log(`All ${layerSnapshots.length} snapshot checks passed`)

// ── Identity block checks ──────────────────────────────────────────
// Structural asserts rather than a full byte-for-byte snapshot — the
// exact wording can tune over time, but these markers are load-bearing
// (the harness prompt shape depends on them).

interface IdentityCase {
  name: string
  assert: (block: string) => string | null // null = pass; string = failure message
}

const identityBlock = _buildHarnessIdentityBlock()
const identityCases: IdentityCase[] = [
  {
    name: 'wrapped in <system-reminder> with Anton heading',
    assert: (b) =>
      b.startsWith('\n\n<system-reminder>\n# Anton\n')
        ? null
        : 'missing <system-reminder># Anton header',
  },
  {
    name: 'identity section present',
    assert: (b) => (b.includes('## Identity') ? null : 'missing "## Identity" header'),
  },
  {
    name: 'frames the model as Anton execution engine',
    assert: (b) =>
      b.includes('serving as the execution engine for **Anton**')
        ? null
        : 'missing "execution engine for Anton" framing',
  },
  {
    name: 'keeps native model identity alongside Anton',
    assert: (b) =>
      b.includes('Keep your own model identity') ? null : 'missing dual-identity instruction',
  },
  {
    name: 'answer script for "who are you"',
    assert: (b) =>
      b.includes('When asked who you are or what you are') && b.includes("Anton's execution engine")
        ? null
        : 'missing "who are you" answer script',
  },
  {
    name: 'answer script for "what is Anton"',
    assert: (b) =>
      b.includes('When asked "what is Anton"') && b.includes('personal AI computer')
        ? null
        : 'missing "what is Anton" answer script',
  },
  {
    name: 'explicit guard against "Anton is a name" hallucination',
    assert: (b) =>
      b.includes('Do NOT say Anton is a name')
        ? null
        : 'missing explicit guard against name/person hallucination',
  },
  {
    name: 'What Anton adds section',
    assert: (b) =>
      b.includes('## What Anton adds to your native tools')
        ? null
        : 'missing "What Anton adds" header',
  },
  {
    name: 'Scope section (prevents over-application)',
    assert: (b) => (b.includes('## Scope') ? null : 'missing "Scope" header'),
  },
  {
    name: 'MCP server-preference section',
    assert: (b) =>
      b.includes('## MCP server preference') ? null : 'missing "MCP server preference" header',
  },
  {
    name: 'explicit anton-over-vendor rule',
    assert: (b) =>
      b.includes('ALWAYS prefer the `anton` MCP server') &&
      b.includes('codex_apps') &&
      b.includes('anton:gmail_search_emails')
        ? null
        : 'missing explicit rule about preferring anton over vendor MCP servers',
  },
  {
    name: 'guard against sending user to a vendor auth flow',
    assert: (b) =>
      b.includes('Settings → Connectors') && b.includes('Do NOT ask the user to install')
        ? null
        : 'missing guidance to redirect users to Anton Settings instead of vendor auth',
  },
  {
    name: 'every core tool name is mentioned',
    assert: (b) => {
      const required = [
        '`memory`',
        '`notification`',
        '`database`',
        '`publish`',
        '`skill`',
        '`update_project_context`',
        '`activate_workflow`',
      ]
      const missing = required.filter((r) => !b.includes(r))
      return missing.length > 0 ? `missing tool references: ${missing.join(', ')}` : null
    },
  },
  {
    name: 'tools/list discovery hint',
    assert: (b) => (b.includes('`tools/list`') ? null : 'missing tools/list discovery hint'),
  },
  {
    name: 'identity prepended in buildHarnessContextPrompt',
    assert: () => {
      const full = _buildHarnessContextPrompt({})
      return full.startsWith('<system-reminder>\n# Anton\n')
        ? null
        : `expected identity block first, got: ${full.slice(0, 80)}`
    },
  },
]

let identityFailed = 0
for (const c of identityCases) {
  try {
    const err = c.assert(identityBlock)
    if (err === null) {
      console.log(`✓ identity: ${c.name}`)
    } else {
      identityFailed++
      console.error(`✗ identity: ${c.name} — ${err}`)
    }
  } catch (err) {
    identityFailed++
    console.error(`✗ identity: ${c.name} (threw)`, err)
  }
}

if (identityFailed > 0) {
  console.error(`\n${identityFailed}/${identityCases.length} identity checks failed`)
  process.exit(1)
}

console.log(`All ${identityCases.length} identity checks passed`)

// ── Memory guidelines layer checks ─────────────────────────────────
// Body is extracted from system.md at runtime. The load-bearing
// markers below are from the current "## Memory guidelines" section —
// if system.md is restructured, either update these markers or the
// harness will silently ship an empty memory block.

interface MemGuideCase {
  name: string
  assert: (block: string) => string | null
}

const memBlock = _buildMemoryGuidelinesLayer()
const memCases: MemGuideCase[] = [
  {
    name: 'wrapped in <system-reminder># Memory Usage',
    assert: (b) =>
      b.startsWith('\n\n<system-reminder>\n# Memory Usage\n') ? null : 'missing header',
  },
  {
    name: 'four memory types present (user/feedback/project/reference)',
    assert: (b) => {
      const types = ['**user**', '**feedback**', '**project**', '**reference**']
      const missing = types.filter((t) => !b.includes(t))
      return missing.length > 0 ? `missing types: ${missing.join(', ')}` : null
    },
  },
  {
    name: 'when-to-save + when-not-to-save sections',
    assert: (b) =>
      b.includes('### When to save') && b.includes('### When NOT to save')
        ? null
        : 'missing when-to-save structure',
  },
  {
    name: 'content format template (Why / How to apply)',
    assert: (b) =>
      b.includes('**Why:**') && b.includes('**How to apply:**')
        ? null
        : 'missing Why / How to apply template',
  },
  {
    name: 'prepended in full harness context prompt',
    assert: () => {
      const full = _buildHarnessContextPrompt({})
      return full.includes('# Memory Usage') ? null : 'memory guidelines missing from full prompt'
    },
  },
]

let memFailed = 0
for (const c of memCases) {
  const err = c.assert(memBlock)
  if (err === null) {
    console.log(`✓ mem-guide: ${c.name}`)
  } else {
    memFailed++
    console.error(`✗ mem-guide: ${c.name} — ${err}`)
  }
}

if (memFailed > 0) {
  console.error(`\n${memFailed}/${memCases.length} memory-guidelines checks failed`)
  process.exit(1)
}

console.log(`All ${memCases.length} memory-guidelines checks passed`)

// ── Active skills layer checks ─────────────────────────────────────

const docxSkill = {
  name: 'docx',
  description:
    "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', 'report', 'memo', or 'letter'.",
  prompt: 'DOCX playbook body. Always set page size explicitly.',
  whenToUse: 'When the user is working with Word documents or .docx files.',
  context: 'inline' as const,
  source: 'user' as const,
  skillDir: '/tmp/skills/docx',
}

const spreadsheetSkill = {
  name: 'spreadsheet',
  description: 'Use for xlsx files, CSV cleanup, and spreadsheet formulas.',
  prompt: 'Spreadsheet playbook body.',
  context: 'inline' as const,
  source: 'user' as const,
}

const activeSkillMatches = _selectRelevantSkillsForMessage(
  [docxSkill, spreadsheetSkill],
  'Please polish this .docx report and keep tracked changes intact.',
)
if (activeSkillMatches[0]?.skill.name !== 'docx') {
  console.error('✗ skills: expected docx to auto-match .docx report request')
  process.exit(1)
}
console.log('✓ skills: deterministic trigger matching')

const activeSkillsBlock = _buildActiveSkillsLayer({
  skills: [docxSkill, spreadsheetSkill],
  userMessage: 'Please polish this .docx report.',
})
if (
  !activeSkillsBlock.includes('# Active Skills') ||
  !activeSkillsBlock.includes('## Recommended for this turn') ||
  !activeSkillsBlock.includes('- docx (score') ||
  activeSkillsBlock.includes('DOCX playbook body') ||
  !activeSkillsBlock.includes('## Skill Catalog')
) {
  console.error('✗ skills: active skills layer should include metadata, not full body')
  process.exit(1)
}
console.log('✓ skills: metadata listing stays compact')

const harnessSkillsPrompt = _buildHarnessContextPrompt({
  skills: [docxSkill],
  userMessage: 'Create a Word document proposal.',
})
if (
  !harnessSkillsPrompt.includes('calling the skill tool is a blocking requirement') ||
  !harnessSkillsPrompt.includes('- docx (score') ||
  harnessSkillsPrompt.includes('[SKILL ACTIVATED: docx]')
) {
  console.error('✗ skills: harness context prompt did not steer skill tool invocation')
  process.exit(1)
}
console.log('✓ skills: harness prompt steers skill tool invocation')

const skillTool = _buildSkillTool({ getSkills: () => [docxSkill, spreadsheetSkill] })
const skillToolResult = await skillTool.execute(
  'tool-test-skill',
  { skill: 'docx', args: 'proposal.docx' },
  undefined,
  undefined,
)
const skillToolText = skillToolResult.content
  .filter((chunk): chunk is { type: 'text'; text: string } => chunk.type === 'text')
  .map((chunk) => chunk.text)
  .join('\n')
if (
  !skillToolText.includes('[SKILL ACTIVATED: docx]') ||
  !skillToolText.includes('DOCX playbook body') ||
  !skillToolText.includes('proposal.docx')
) {
  console.error('✗ skills: skill tool did not load full skill prompt')
  process.exit(1)
}
console.log('✓ skills: skill tool loads full body on demand')

const connectorBlock = _buildActiveConnectorsLayer([
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    capabilitySummary: 'read and manage calendar events',
    capabilityExample: 'google_calendar_list_events',
  },
])
if (
  !connectorBlock.includes('# Active Anton Connectors') ||
  !connectorBlock.includes('Google Calendar') ||
  !connectorBlock.includes('google_calendar_list_events')
) {
  console.error('✗ connectors: active connector layer missing Calendar capability')
  process.exit(1)
}
console.log('✓ connectors: Pi SDK connector capability layer')

// ── Mirror synthesizer tests ───────────────────────────────────────
// Pure-function coverage of synthesizeHarnessTurn. No disk I/O.

import { synthesizeHarnessTurn } from '../mirror.js'

interface MirrorCase {
  name: string
  userMessage: string
  events: SessionEvent[]
  expectedRoles: string[]
  // Optional content checks keyed by message index
  expectedContent?: Record<number, unknown>
}

const mirrorCases: MirrorCase[] = [
  {
    name: 'user + assistant text only',
    userMessage: 'hi',
    events: [{ type: 'text', content: 'Hello!' }],
    expectedRoles: ['user', 'assistant'],
    expectedContent: {
      0: [{ type: 'text', text: 'hi' }],
      1: [{ type: 'text', text: 'Hello!' }],
    },
  },
  {
    name: 'assistant thinks + uses tool + gets result + replies',
    userMessage: 'list files',
    events: [
      { type: 'thinking', text: 'I should list files.' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'a.txt\nb.txt' },
      { type: 'text', content: 'Two files.' },
    ],
    expectedRoles: ['user', 'assistant', 'tool', 'assistant'],
    expectedContent: {
      1: [
        { type: 'thinking', thinking: 'I should list files.' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
      2: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt\nb.txt' }],
      3: [{ type: 'text', text: 'Two files.' }],
    },
  },
  {
    name: 'multiple tool_calls + batched results',
    userMessage: 'check both',
    events: [
      { type: 'tool_call', id: 'a', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_call', id: 'b', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', id: 'a', output: 'x' },
      { type: 'tool_result', id: 'b', output: '/tmp' },
      { type: 'text', content: 'Done.' },
    ],
    expectedRoles: ['user', 'assistant', 'tool', 'assistant'],
    expectedContent: {
      2: [
        { type: 'tool_result', tool_use_id: 'a', content: 'x' },
        { type: 'tool_result', tool_use_id: 'b', content: '/tmp' },
      ],
    },
  },
  {
    name: 'tool error marks is_error',
    userMessage: 'run',
    events: [
      { type: 'tool_call', id: 't1', name: 'shell', input: { command: 'false' } },
      { type: 'tool_result', id: 't1', output: 'exit 1', isError: true },
    ],
    expectedRoles: ['user', 'assistant', 'tool'],
    expectedContent: {
      2: [{ type: 'tool_result', tool_use_id: 't1', content: 'exit 1', is_error: true }],
    },
  },
  {
    name: 'metadata events (done/error/title) are ignored',
    userMessage: 'hi',
    events: [
      { type: 'title_update', title: 'Greeting' },
      { type: 'text', content: 'Hi.' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ],
    expectedRoles: ['user', 'assistant'],
  },
  {
    name: 'empty events only emits user message',
    userMessage: 'hi',
    events: [],
    expectedRoles: ['user'],
  },
  {
    name: 'streamed text deltas coalesce into one block',
    userMessage: 'save it',
    events: [
      { type: 'text', content: ' artifact' },
      { type: 'text', content: ' is' },
      { type: 'text', content: ' now' },
      { type: 'text', content: ' saved.' },
    ],
    expectedRoles: ['user', 'assistant'],
    expectedContent: {
      1: [{ type: 'text', text: ' artifact is now saved.' }],
    },
  },
  {
    name: 'streamed thinking deltas coalesce into one block',
    userMessage: 'think',
    events: [
      { type: 'thinking', text: 'First, ' },
      { type: 'thinking', text: 'then second.' },
      { type: 'text', content: 'done' },
    ],
    expectedRoles: ['user', 'assistant'],
    expectedContent: {
      1: [
        { type: 'thinking', thinking: 'First, then second.' },
        { type: 'text', text: 'done' },
      ],
    },
  },
  {
    name: 'text deltas split by tool_call do not coalesce across the tool',
    userMessage: 'do work',
    events: [
      { type: 'text', content: 'Starting' },
      { type: 'text', content: ' now.' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'ok' },
      { type: 'text', content: 'All' },
      { type: 'text', content: ' done.' },
    ],
    expectedRoles: ['user', 'assistant', 'tool', 'assistant'],
    expectedContent: {
      1: [
        { type: 'text', text: 'Starting now.' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
      3: [{ type: 'text', text: 'All done.' }],
    },
  },
]

let mirrorFailed = 0
for (const c of mirrorCases) {
  try {
    const msgs = synthesizeHarnessTurn(c.userMessage, c.events, 1000)
    const roles = msgs.map((m) => m.role)
    const rolesMatch = JSON.stringify(roles) === JSON.stringify(c.expectedRoles)
    let contentOk = true
    if (c.expectedContent) {
      for (const [idxStr, expected] of Object.entries(c.expectedContent)) {
        const actual = msgs[Number(idxStr)]?.content
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          contentOk = false
          console.error(`  content mismatch at index ${idxStr}`)
          console.error('    expected:', JSON.stringify(expected))
          console.error('    actual:  ', JSON.stringify(actual))
        }
      }
    }
    if (rolesMatch && contentOk) {
      console.log(`✓ mirror: ${c.name}`)
    } else {
      mirrorFailed++
      console.error(`✗ mirror: ${c.name}`)
      if (!rolesMatch) {
        console.error('  expected roles:', c.expectedRoles)
        console.error('  actual roles:  ', roles)
      }
    }
  } catch (err) {
    mirrorFailed++
    console.error(`✗ mirror: ${c.name} (threw)`, err)
  }
}

if (mirrorFailed > 0) {
  console.error(`\n${mirrorFailed}/${mirrorCases.length} mirror checks failed`)
  process.exit(1)
}

console.log(`All ${mirrorCases.length} mirror checks passed`)

// ── Round-trip: synthesize → jsonl → readHarnessHistory ─────────────
// Writes a fresh messages.jsonl into a temp session dir, reads it back
// with readHarnessHistory, and asserts the flattened entries preserve
// role/content/tool-name wiring. Guards against drift between the
// mirror write-side shape and the history read-side parser.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { readHarnessHistory as _readHarnessHistory } from '../mirror.js'
import { buildReplaySeed as _buildReplaySeed } from '../replay.js'

function writeMessagesJsonl(dir: string, msgs: SessionEvent[], userMsg: string): void {
  const synthesized = synthesizeHarnessTurn(userMsg, msgs, 1000)
  mkdirSync(dir, { recursive: true })
  const lines = synthesized.map((m) => JSON.stringify(m)).join('\n')
  writeFileSync(pathJoin(dir, 'messages.jsonl'), lines.length > 0 ? `${lines}\n` : '', 'utf-8')
  // readHarnessHistory requires this path layout (conversationDir or
  // projectSessionsDir). We write directly into the dir the reader
  // expects, then pass the sessionId matching the last path segment.
}

function withTempSession<T>(fn: (sessionId: string, dir: string) => T): T {
  // readHarnessHistory resolves ~/.anton/conversations/<id> for no
  // projectId. Use a unique id under the real conversations dir so
  // the path matches the reader's expectation, then clean up.
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const base = pathJoin(process.env.HOME ?? tmpdir(), '.anton', 'conversations', sessionId)
  try {
    return fn(sessionId, base)
  } finally {
    try {
      rmSync(base, { recursive: true, force: true })
    } catch {
      /* cleanup best-effort */
    }
  }
}

interface RoundTripCase {
  name: string
  userMessage: string
  events: SessionEvent[]
  expectedRoles: string[]
  assert?: (entries: import('@anton/protocol').SessionHistoryEntry[]) => string | null
}

const roundTripCases: RoundTripCase[] = [
  {
    name: 'simple user + assistant text',
    userMessage: 'hello',
    events: [{ type: 'text', content: 'Hi there.' }],
    expectedRoles: ['user', 'assistant'],
  },
  {
    name: 'tool call + result flatten correctly',
    userMessage: 'run ls',
    events: [
      { type: 'thinking', text: 'listing' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'a\nb' },
      { type: 'text', content: 'two files' },
    ],
    // thinking + tool_use batch into ONE assistant message; flatten
    // yields ['assistant' (thinking), 'tool_call'] then the tool_result
    // and the final 'two files' assistant text.
    expectedRoles: ['user', 'assistant', 'tool_call', 'tool_result', 'assistant'],
    assert: (entries) => {
      const call = entries.find((e) => e.role === 'tool_call')
      const result = entries.find((e) => e.role === 'tool_result')
      if (!call || call.toolName !== 'Bash') return 'tool_call missing toolName=Bash'
      if (!result || result.toolId !== 't1') return 'tool_result missing toolId'
      if (!result.toolName || result.toolName !== 'Bash')
        return 'tool_result missing cross-linked toolName'
      return null
    },
  },
  {
    name: 'error flag carries through',
    userMessage: 'try it',
    events: [
      { type: 'tool_call', id: 'x', name: 'shell', input: {} },
      { type: 'tool_result', id: 'x', output: 'boom', isError: true },
    ],
    expectedRoles: ['user', 'tool_call', 'tool_result'],
    assert: (entries) => {
      const result = entries.find((e) => e.role === 'tool_result')
      return result?.isError === true ? null : 'tool_result missing isError=true'
    },
  },
]

let rtFailed = 0
for (const c of roundTripCases) {
  try {
    withTempSession((sessionId, dir) => {
      writeMessagesJsonl(dir, c.events, c.userMessage)
      const entries = _readHarnessHistory(sessionId)
      const roles = entries.map((e) => e.role)
      const rolesMatch = JSON.stringify(roles) === JSON.stringify(c.expectedRoles)
      let customErr: string | null = null
      if (c.assert) customErr = c.assert(entries)
      if (rolesMatch && !customErr) {
        console.log(`✓ roundtrip: ${c.name}`)
      } else {
        rtFailed++
        console.error(`✗ roundtrip: ${c.name}`)
        if (!rolesMatch) {
          console.error('  expected roles:', c.expectedRoles)
          console.error('  actual roles:  ', roles)
        }
        if (customErr) console.error('  assertion:', customErr)
      }
    })
  } catch (err) {
    rtFailed++
    console.error(`✗ roundtrip: ${c.name} (threw)`, err)
  }
}

if (rtFailed > 0) {
  console.error(`\n${rtFailed}/${roundTripCases.length} round-trip checks failed`)
  process.exit(1)
}

console.log(`All ${roundTripCases.length} round-trip checks passed`)

// Legacy mirror files written before per-delta coalescing landed can
// contain a single assistant message whose content is a run of
// per-token TextBlocks. readHarnessHistory must fuse these back into
// one entry, otherwise the UI renders each token on its own line.
try {
  withTempSession((sessionId, dir) => {
    mkdirSync(dir, { recursive: true })
    const legacyMsg = {
      role: 'assistant',
      timestamp: 1000,
      content: [
        { type: 'text', text: ' artifact' },
        { type: 'text', text: ' is' },
        { type: 'text', text: ' now' },
        { type: 'text', text: ' saved.' },
      ],
    }
    writeFileSync(pathJoin(dir, 'messages.jsonl'), `${JSON.stringify(legacyMsg)}\n`, 'utf-8')
    const entries = _readHarnessHistory(sessionId)
    const assistantEntries = entries.filter((e) => e.role === 'assistant')
    if (assistantEntries.length !== 1) {
      rtFailed++
      console.error(`✗ legacy-mirror: expected 1 assistant entry, got ${assistantEntries.length}`)
    } else if (assistantEntries[0].content !== ' artifact is now saved.') {
      rtFailed++
      console.error(
        `✗ legacy-mirror: content not fused, got ${JSON.stringify(assistantEntries[0].content)}`,
      )
    } else {
      console.log('✓ legacy-mirror: per-token text blocks coalesce on read')
    }
  })
} catch (err) {
  rtFailed++
  console.error('✗ legacy-mirror (threw)', err)
}

if (rtFailed > 0) process.exit(1)

// ── Replay seed smoke test ─────────────────────────────────────────
// Builds a seed from a minimal stored conversation and checks it
// contains the load-bearing markers the new provider will read.

let replayFailed = 0
try {
  withTempSession((sessionId) => {
    // Write a two-turn history
    const events1: SessionEvent[] = [{ type: 'text', content: 'hello back' }]
    const events2: SessionEvent[] = [
      { type: 'tool_call', id: 'r', name: 'memory', input: { operation: 'save', key: 'x' } },
      { type: 'tool_result', id: 'r', output: 'ok' },
      { type: 'text', content: 'saved' },
    ]
    const dir = pathJoin(process.env.HOME ?? tmpdir(), '.anton', 'conversations', sessionId)
    mkdirSync(dir, { recursive: true })
    const m1 = synthesizeHarnessTurn('hi', events1)
    const m2 = synthesizeHarnessTurn('save x', events2)
    const lines = [...m1, ...m2].map((m) => JSON.stringify(m)).join('\n')
    writeFileSync(pathJoin(dir, 'messages.jsonl'), `${lines}\n`, 'utf-8')

    const seed = _buildReplaySeed({ sessionId })
    const required = [
      '<system-reminder>',
      '# Prior Conversation',
      '<turn index="1">',
      '<turn index="2">',
      '[tool_call memory',
      '<tool_result for="memory">ok</tool_result>',
      'hi',
      'saved',
    ]
    const missing = required.filter((r) => !seed.includes(r))
    if (missing.length === 0) {
      console.log('✓ replay-seed: renders prior conversation with turn/tool markers')
    } else {
      replayFailed++
      console.error('✗ replay-seed: missing markers:', missing)
      console.error('  seed was:', seed.slice(0, 400))
    }
  })
} catch (err) {
  replayFailed++
  console.error('✗ replay-seed (threw)', err)
}

if (replayFailed > 0) {
  console.error(`\n${replayFailed} replay-seed checks failed`)
  process.exit(1)
}

console.log('All 1 replay-seed check passed')

// ── Cross-surface rendering invariant ──────────────────────────────
// Pins the rule that desktop, webhook (Telegram/Slack), and mirror/
// history all render the same text for a given event stream. The
// 200-per-token bubble bug was a violation of this — mirror exploded
// where desktop and webhook coalesced. Each surface has its own
// rendering loop today; this test simulates all three against shared
// fixtures and asserts they agree on the final assistant text run.
//
// To faithfully represent each surface, the simulators mirror the
// exact logic shipped in production:
//
//   desktop  → packages/desktop/src/lib/store/handlers/chatHandler.ts
//              + toolHandler.ts clear-on-tool-call behavior
//   webhook  → packages/agent-server/src/webhooks/agent-runner.ts
//              (chunks.push on text, chunks.length = 0 on tool_call)
//   mirror   → packages/agent-core/src/harness/mirror.ts
//              (synthesizeHarnessTurn + readHarnessHistory)
//
// If any of those surfaces changes, update the simulator here.

interface RenderSurface {
  name: string
  render: (events: SessionEvent[], sessionId: string) => string[]
}

// Desktop: appendAssistantText accumulates into the current bubble;
// tool_call resets the tracked bubble so the next text opens a new one.
const desktopSurface: RenderSurface = {
  name: 'desktop',
  render: (events) => {
    const bubbles: string[] = []
    let current: string | null = null
    for (const ev of events) {
      if (ev.type === 'text') {
        if (!ev.content) continue
        if (current === null) current = ''
        current += ev.content
      } else if (ev.type === 'tool_call') {
        if (current !== null) {
          bubbles.push(current)
          current = null
        }
      }
      // Other event types don't split the bubble.
    }
    if (current !== null) bubbles.push(current)
    return bubbles
  },
}

// Webhook runner: chunks.push on text, reset chunks on tool_call,
// post one final message at turn-end with chunks.join('').
const webhookSurface: RenderSurface = {
  name: 'webhook',
  render: (events) => {
    const chunks: string[] = []
    for (const ev of events) {
      if (ev.type === 'text') {
        chunks.push(ev.content)
      } else if (ev.type === 'tool_call') {
        chunks.length = 0
      }
    }
    return chunks.length > 0 ? [chunks.join('')] : []
  },
}

// Mirror: synthesize the turn, write messages.jsonl, read it back.
// Filter assistant-text entries only — tool_call entries have a
// toolName set; tool_result entries have role='tool_result'.
const mirrorSurface: RenderSurface = {
  name: 'mirror',
  render: (events, sessionId) => {
    const userMsg = 'user prompt'
    const msgs = synthesizeHarnessTurn(userMsg, events, 1000)
    const dir = pathJoin(process.env.HOME ?? tmpdir(), '.anton', 'conversations', sessionId)
    mkdirSync(dir, { recursive: true })
    const lines = msgs.map((m) => JSON.stringify(m)).join('\n')
    writeFileSync(pathJoin(dir, 'messages.jsonl'), lines.length > 0 ? `${lines}\n` : '', 'utf-8')
    const entries = _readHarnessHistory(sessionId)
    return entries
      .filter((e) => e.role === 'assistant' && !e.isThinking && !e.toolName)
      .map((e) => e.content)
  },
}

interface CrossSurfaceCase {
  name: string
  events: SessionEvent[]
  // The final assistant text run every surface must agree on.
  // (Webhook only shows the final run; desktop/mirror may have more
  // but the LAST one has to match.)
  expectedFinalText: string
  // If true, assert all three surfaces produce the exact same full
  // set of bubbles — only applicable when there's no tool boundary
  // (webhook's clear-on-tool-call makes multi-run cases asymmetric).
  expectFullAgreement?: boolean
}

function genTokens(n: number): SessionEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'text',
    content: `t${i} `,
  }))
}

const crossSurfaceCases: CrossSurfaceCase[] = [
  {
    name: 'single text event',
    events: [{ type: 'text', content: 'Hello world' }],
    expectedFinalText: 'Hello world',
    expectFullAgreement: true,
  },
  {
    name: '200 per-token deltas coalesce (the original bug)',
    events: genTokens(200),
    expectedFinalText: Array.from({ length: 200 }, (_, i) => `t${i} `).join(''),
    expectFullAgreement: true,
  },
  {
    name: '1000 per-token deltas stress test',
    events: genTokens(1000),
    expectedFinalText: Array.from({ length: 1000 }, (_, i) => `t${i} `).join(''),
    expectFullAgreement: true,
  },
  {
    name: 'unicode emoji surrogate pair split across deltas',
    // 😀 = U+1F600, encoded as UTF-16 surrogate pair \uD83D\uDE00.
    // Streaming adapters can split this across deltas; the final
    // rendered text must still contain one intact emoji.
    events: [
      { type: 'text', content: 'hi ' },
      { type: 'text', content: '\uD83D' },
      { type: 'text', content: '\uDE00' },
      { type: 'text', content: ' ok' },
    ],
    expectedFinalText: 'hi \uD83D\uDE00 ok',
    expectFullAgreement: true,
  },
  {
    name: 'empty deltas interleaved',
    events: [
      { type: 'text', content: '' },
      { type: 'text', content: 'a' },
      { type: 'text', content: '' },
      { type: 'text', content: 'b' },
      { type: 'text', content: '' },
    ],
    expectedFinalText: 'ab',
    expectFullAgreement: true,
  },
  {
    name: 'text run after a tool_call — final run agrees',
    // Webhook clears on tool_call, so it only shows the final run.
    // Desktop splits into two bubbles; mirror has two entries.
    // The *final* run must match across all three.
    events: [
      { type: 'text', content: 'Let me check. ' },
      { type: 'text', content: 'One sec.' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'ok' },
      { type: 'text', content: 'Done: ' },
      { type: 'text', content: 'files listed.' },
    ],
    expectedFinalText: 'Done: files listed.',
    expectFullAgreement: false,
  },
]

let xsurfaceFailed = 0
let xsurfaceTotal = 0
for (const c of crossSurfaceCases) {
  try {
    withTempSession((sessionId) => {
      const outputs: Record<string, string[]> = {}
      for (const s of [desktopSurface, webhookSurface, mirrorSurface]) {
        outputs[s.name] = s.render(c.events, sessionId)
      }

      // Every surface must have emitted at least one bubble for the final text.
      for (const s of Object.keys(outputs)) {
        xsurfaceTotal++
        const last = outputs[s][outputs[s].length - 1]
        if (last !== c.expectedFinalText) {
          xsurfaceFailed++
          console.error(`✗ cross-surface[${s}]: ${c.name} — final text mismatch`)
          console.error(`  expected: ${JSON.stringify(c.expectedFinalText)}`)
          console.error(`  actual:   ${JSON.stringify(last)}`)
        } else {
          console.log(`✓ cross-surface[${s}]: ${c.name}`)
        }
      }

      if (c.expectFullAgreement) {
        xsurfaceTotal++
        const d = outputs.desktop
        const w = outputs.webhook
        const m = outputs.mirror
        const sameAcross =
          JSON.stringify(d) === JSON.stringify(w) && JSON.stringify(d) === JSON.stringify(m)
        if (!sameAcross) {
          xsurfaceFailed++
          console.error(`✗ cross-surface[full]: ${c.name} — surfaces diverge`)
          console.error('  desktop:', d)
          console.error('  webhook:', w)
          console.error('  mirror: ', m)
        } else {
          console.log(`✓ cross-surface[full]: ${c.name}`)
        }
      }
    })
  } catch (err) {
    xsurfaceFailed++
    console.error(`✗ cross-surface: ${c.name} (threw)`, err)
  }
}

if (xsurfaceFailed > 0) {
  console.error(`\n${xsurfaceFailed}/${xsurfaceTotal} cross-surface checks failed`)
  process.exit(1)
}

console.log(`All ${xsurfaceTotal} cross-surface checks passed`)
