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
