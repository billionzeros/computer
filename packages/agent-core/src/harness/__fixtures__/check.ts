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
import { ClaudeAdapter } from '../adapters/claude.js'
import { CodexAdapter } from '../adapters/codex.js'
import type { HarnessAdapter } from '../adapter.js'
import type { SessionEvent } from '../../session.js'
import {
  claudeSimpleExpected,
  claudeToolCallExpected,
  claudeErrorExpected,
  codexSimpleExpected,
  codexToolCallExpected,
  codexErrorExpected,
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
  { name: 'claude-simple', adapter: claude, fixture: 'claude-simple.ndjson', expected: claudeSimpleExpected },
  { name: 'claude-tool-call', adapter: claude, fixture: 'claude-tool-call.ndjson', expected: claudeToolCallExpected },
  { name: 'claude-error', adapter: claude, fixture: 'claude-error.ndjson', expected: claudeErrorExpected },
  { name: 'codex-simple', adapter: codex, fixture: 'codex-simple.ndjson', expected: codexSimpleExpected },
  { name: 'codex-tool-call', adapter: codex, fixture: 'codex-tool-call.ndjson', expected: codexToolCallExpected },
  { name: 'codex-error', adapter: codex, fixture: 'codex-error.ndjson', expected: codexErrorExpected },
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
    mustNotInclude: ['# Memory', '# Available Workflows', '# Agent Context'],
  },
  {
    name: 'project-context-included',
    opts: {
      projectContext: 'You are running inside Anton.\nProject: foo',
      projectId: 'proj_1',
      workspacePath: '/tmp/foo',
    },
    mustInclude: ['# Current Context', 'Project: foo', '- Workspace: /tmp/foo/', '# Project Memory Instructions'],
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
    mustInclude: ['# Memory', '## Global Memory', '### prefer_short_replies', 'Keep answers brief.'],
  },
  {
    name: 'workflow-catalog-emitted',
    opts: {
      availableWorkflows: [
        { name: 'triage-slack', description: 'Summarize unread Slack DMs.', whenToUse: 'user asks about slack' },
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
    mustInclude: ['# Agent Context', '## Standing Instructions', 'Run the daily lead scan.', '## Run History'],
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

import { AntonToolRegistry } from '../tool-registry.js'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

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
  buildMemoryLayer as _buildMemoryLayer,
  buildWorkflowsLayer as _buildWorkflowsLayer,
  buildAgentContextLayer as _buildAgentContextLayer,
  buildProjectMemoryInstructionsLayer as _buildProjectMemoryInstructionsLayer,
  buildSurfaceLayer as _buildSurfaceLayer,
  buildHarnessIdentityBlock as _buildHarnessIdentityBlock,
  buildHarnessContextPrompt as _buildHarnessContextPrompt,
} from '../../prompt-layers.js'

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
      '## Run History\nThis is your memory from previous runs. Use it to know what you\'ve already built, where scripts are, and what happened last time. Do NOT rebuild things that already exist.\n\n' +
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
      b.startsWith('\n\n<system-reminder>\n# Anton\n') ? null : 'missing <system-reminder># Anton header',
  },
  {
    name: 'identity section present',
    assert: (b) => (b.includes('## Identity') ? null : 'missing "## Identity" header'),
  },
  {
    name: 'frames the model as Anton execution engine',
    assert: (b) =>
      b.includes("serving as the execution engine for **Anton**")
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
      b.includes('When asked who you are or what you are') &&
      b.includes("Anton's execution engine")
        ? null
        : 'missing "who are you" answer script',
  },
  {
    name: 'answer script for "what is Anton"',
    assert: (b) =>
      b.includes('When asked "what is Anton"') &&
      b.includes('personal AI computer')
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
    name: 'every core tool name is mentioned',
    assert: (b) => {
      const required = [
        '`memory`',
        '`notification`',
        '`database`',
        '`publish`',
        '`update_project_context`',
        '`activate_workflow`',
      ]
      const missing = required.filter((r) => !b.includes(r))
      return missing.length > 0 ? `missing tool references: ${missing.join(', ')}` : null
    },
  },
  {
    name: 'tools/list discovery hint',
    assert: (b) =>
      b.includes('`tools/list`') ? null : 'missing tools/list discovery hint',
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
