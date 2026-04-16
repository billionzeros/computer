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

import { buildHarnessContextPrompt } from '../prompt-layers.js'

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
