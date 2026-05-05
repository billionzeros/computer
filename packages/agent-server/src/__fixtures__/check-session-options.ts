/**
 * Session-options drift guard.
 *
 * Run with:  pnpm --filter @anton/agent-server check:session-options
 *
 * Why this exists
 * ───────────────
 * `SessionOptions` is the single shape that desktop, webhook, and
 * scheduled-agent sessions all flow through. Several layers consume
 * it:
 *
 *   1. `createSession` / `resumeSession` in agent-core/session.ts
 *      — must propagate every field into the Session ctor or
 *      ToolCallbacks. A field that isn't read here is silently dropped
 *      (TypeScript won't catch it because `opts` is optional and
 *      excess-property checks only fire on object literals).
 *
 *   2. `AgentServer.buildSessionOptions` in agent-server/server.ts
 *      — must explicitly set every shared field so desktop and webhook
 *      sessions don't differ. The new explicit `: SessionOptions`
 *      return type already enforces this at compile time.
 *
 *   3. `AgentServer.buildHarnessSessionContext` in
 *      agent-server/server.ts — must propagate every shared (non-Pi-
 *      SDK-only) field so harness sessions (Codex / Claude Code) get
 *      the same wiring desktop and webhook sessions get.
 *
 * The `SESSION_OPTIONS_KEYS` const below is exhaustive at compile time
 * (TypeScript will fail to build if a key is added to `SessionOptions`
 * without being listed). At runtime this script reads each consumer's
 * source, scans for `opts?.<key>` / `opts.<key>` / `shared.<key>`, and
 * fails if any key is unreferenced — turning future drift into a CI
 * failure rather than a silent prod bug.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionOptions } from '@anton/agent-core'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── The single contract ──────────────────────────────────────────────
//
// Every field of `SessionOptions` must appear here. The `satisfies`
// clause is exhaustive — adding a field to `SessionOptions` without
// extending this list is a TypeScript error.
const SESSION_OPTIONS_KEYS = [
  // Provider config (createSession-only; resume reads from disk)
  'provider',
  'model',
  'apiKey',
  'ephemeral',
  // Project / workspace context
  'projectId',
  'projectContext',
  'projectWorkspacePath',
  'projectType',
  // Manager wiring
  'mcpManager',
  'connectorManager',
  // Tool-callback handlers
  'onSubAgentEvent',
  'onJobAction',
  'onActivateWorkflow',
  'onSharedState',
  'onDeliverResult',
  'resolveProviderToken',
  // Anton context
  'domain',
  'thinkingLevel',
  'surface',
  // Workflow / agent context
  'workflowId',
  'workflowAgentKey',
  'workflowMetadata',
  'agentInstructions',
  'agentMemory',
  // Prompt-aware context
  'availableWorkflows',
  'liveConnectors',
  // Safety limits
  'maxDurationMs',
] as const satisfies readonly (keyof SessionOptions)[]

// Compile-time exhaustiveness assertion. Resolves to `true` only when
// every `keyof SessionOptions` is included in `SESSION_OPTIONS_KEYS`.
// Adding a new field to `SessionOptions` flips this to `false`, which
// makes the `Assert` line below fail to typecheck. Add the field to the
// list above to fix.
type Assert<T extends true> = T
const _exhaustive: Assert<
  [keyof SessionOptions] extends [(typeof SESSION_OPTIONS_KEYS)[number]] ? true : false
> = true
void _exhaustive

// ── Allow-lists ──────────────────────────────────────────────────────
//
// Some fields legitimately don't appear in every consumer:
//   - `resumeSession` ignores create-only fields (provider/model/apiKey/
//     ephemeral) since the persisted session reuses what was on disk.
//   - `buildSessionOptions` returns a desktop-shape; some create-time
//     fields aren't its concern (the caller forwards them via `extra`).
//   - `buildHarnessSessionContext` only carries the SHARED subset
//     (Pi-SDK-only fields like agentInstructions/Memory and Braintrust
//     metadata flow via `buildHarnessContextPrompt` instead).

const RESUME_SESSION_IGNORED = new Set<string>(['provider', 'model', 'apiKey', 'ephemeral'])

const BUILD_SESSION_OPTIONS_IGNORED = new Set<string>([
  'ephemeral', // sub-agent flag; not set by the desktop factory
  'maxDurationMs', // safety limit; not set by the desktop factory
  // `surface` is intentionally per-event: webhook agent-runner sets it
  // from the inbound Telegram/Slack event before calling
  // createSession; desktop sessions are surface-less. Adding it to
  // buildSessionOptions would force a stale value on every turn.
  'surface',
])

// Fields that the harness path doesn't propagate via
// `HarnessSessionContext`. They're either Pi-SDK-only (e.g. tracing,
// fork context) or flow into the harness through a different layer.
const BUILD_HARNESS_CONTEXT_IGNORED = new Set<string>([
  'provider',
  'model',
  'apiKey',
  'ephemeral',
  'projectContext', // baked into the per-turn system prompt instead
  'projectType', // ditto
  'mcpManager', // server attaches via spawn config, not per-session
  'connectorManager', // ditto
  'onSubAgentEvent', // desktop AI-channel only
  'thinkingLevel', // codex CLI flag, set on session not context
  'surface', // mapped to `surface: string` (label) on harness
  'workflowId', // workflow-agent state flows via system prompt
  'workflowAgentKey', // ditto
  'workflowMetadata', // Braintrust trace; harness has its own tracer
  'onSharedState', // workflow-agent shared state via system prompt
  'agentInstructions', // injected via buildHarnessContextPrompt
  'agentMemory', // ditto
  'availableWorkflows', // ditto
  'liveConnectors', // ditto via buildHarnessCapabilityBlock
  'maxDurationMs', // not enforced on harness CLI today
])

// ── Source readers ───────────────────────────────────────────────────

const sessionTs = readFileSync(join(__dirname, '../../../agent-core/src/session.ts'), 'utf-8')
const serverTs = readFileSync(join(__dirname, '../server.ts'), 'utf-8')

/**
 * Slice the source between two anchors so we can run substring checks
 * against just one function's body. Returns the substring exclusive of
 * the closing anchor so the next slice can start there.
 */
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker)
  if (start < 0) throw new Error(`anchor not found: ${startMarker}`)
  const after = src.indexOf(endMarker, start + startMarker.length)
  if (after < 0) throw new Error(`end anchor not found after ${startMarker}: ${endMarker}`)
  return stripComments(src.slice(start, after))
}

/**
 * Strip line comments (`//…`) and block comments (`/* … *​/`) so a
 * commented-out wiring line doesn't mask a real drop. We don't care
 * about strict TypeScript parsing — the substring/regex checks only
 * need real code, not narrative.
 */
function stripComments(src: string): string {
  // Block comments first so a `// foo /* bar */` line doesn't lose its
  // line-comment status mid-strip.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  // Line comments — strip from `//` to end-of-line. Doesn't try to be
  // string-literal-aware; the consumers we slice contain no string
  // literals with `//` in them.
  out = out
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
  return out
}

const createSessionBody = sliceBetween(
  sessionTs,
  'export function createSession(',
  '\n/**\n * Resume a persisted session from disk.',
)
const resumeSessionBody = sliceBetween(
  sessionTs,
  'export function resumeSession(',
  '\n/**\n * Generate a concise, descriptive title from the first user message.',
)
const buildSessionOptionsBody = sliceBetween(
  serverTs,
  'private buildSessionOptions(',
  '  /**\n   * Build the per-session context the harness tool-registry uses',
)
const buildHarnessSessionContextBody = sliceBetween(
  serverTs,
  'private buildHarnessSessionContext(',
  '/** Build the routine action callback',
)

// ── The check ────────────────────────────────────────────────────────

interface FieldUsage {
  key: string
  inCreateSession: boolean
  inResumeSession: boolean
  inBuildSessionOptions: boolean
  inBuildHarnessSessionContext: boolean
}

function refersToField(body: string, key: string): boolean {
  // Match either:
  //   - read-side:  `opts?.foo` / `opts.foo` / `shared.foo` / `extra(?).foo`
  //   - write-side: `foo:` / `foo,` (object-literal property in a return)
  // Any one is enough — a field that's read here is propagated, and a
  // field that's written by name is being set explicitly. Word-boundary
  // anchors keep `foo` from accidentally matching `foobar`.
  const readPatterns = [
    `opts?.${key}`,
    `opts.${key}`,
    `shared.${key}`,
    `extra?.${key}`,
    `extra.${key}`,
  ]
  if (readPatterns.some((p) => body.includes(p))) return true
  // Write-side: `\bkey:` or `\bkey,` (the latter for shorthand).
  const writeRegex = new RegExp(`(^|[^a-zA-Z0-9_$])${key}\\s*[:,]`, 'm')
  return writeRegex.test(body)
}

const usage: FieldUsage[] = SESSION_OPTIONS_KEYS.map((key) => ({
  key,
  inCreateSession: refersToField(createSessionBody, key),
  inResumeSession: refersToField(resumeSessionBody, key),
  inBuildSessionOptions: refersToField(buildSessionOptionsBody, key),
  inBuildHarnessSessionContext: refersToField(buildHarnessSessionContextBody, key),
}))

const failures: string[] = []
for (const u of usage) {
  if (!u.inCreateSession) {
    failures.push(`createSession does not reference \`opts.${u.key}\` — field is silently dropped.`)
  }
  if (!u.inResumeSession && !RESUME_SESSION_IGNORED.has(u.key)) {
    failures.push(
      `resumeSession does not reference \`opts.${u.key}\` — field is silently dropped on resumed sessions. ` +
        `If this field is create-time-only, add it to RESUME_SESSION_IGNORED with a short justification.`,
    )
  }
  if (!u.inBuildSessionOptions && !BUILD_SESSION_OPTIONS_IGNORED.has(u.key)) {
    failures.push(
      `buildSessionOptions does not set \`${u.key}\` — desktop and webhook sessions can't pass it. ` +
        `If this field is intentionally per-call (passed via the \`extra\` argument or the caller), ` +
        `add it to BUILD_SESSION_OPTIONS_IGNORED with a justification.`,
    )
  }
  if (!u.inBuildHarnessSessionContext && !BUILD_HARNESS_CONTEXT_IGNORED.has(u.key)) {
    failures.push(
      `buildHarnessSessionContext does not propagate \`${u.key}\` — harness (Codex / Claude Code) ` +
        `sessions silently lose it. If the harness path uses a different mechanism (system prompt, ` +
        `Braintrust trace, etc.), add it to BUILD_HARNESS_CONTEXT_IGNORED with a short justification.`,
    )
  }
}

if (failures.length > 0) {
  console.error(`✗ session-options drift: ${failures.length} issue(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

function requiredCount(ignored: Set<string>): {
  required: number
  referenced: (u: FieldUsage) => boolean
  count: (sel: (u: FieldUsage) => boolean) => number
} {
  const required = SESSION_OPTIONS_KEYS.length - ignored.size
  return {
    required,
    referenced: (_u: FieldUsage) => true,
    count: (sel) => usage.filter((u) => !ignored.has(u.key) && sel(u)).length,
  }
}

const cs = requiredCount(new Set())
const rs = requiredCount(RESUME_SESSION_IGNORED)
const bso = requiredCount(BUILD_SESSION_OPTIONS_IGNORED)
const bhc = requiredCount(BUILD_HARNESS_CONTEXT_IGNORED)

console.log(`✓ session-options drift check: ${SESSION_OPTIONS_KEYS.length} fields verified`)
console.log(
  `  createSession=${cs.count((u) => u.inCreateSession)}/${cs.required}, ` +
    `resumeSession=${rs.count((u) => u.inResumeSession)}/${rs.required} (excluding ${RESUME_SESSION_IGNORED.size} create-only), ` +
    `buildSessionOptions=${bso.count((u) => u.inBuildSessionOptions)}/${bso.required}, ` +
    `buildHarnessSessionContext=${bhc.count((u) => u.inBuildHarnessSessionContext)}/${bhc.required}`,
)
