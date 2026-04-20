# Harness app-server migration — known gaps & follow-ups

Companion to `specs/features/HARNESS_APP_SERVER_MIGRATION.md`. Everything
listed here was identified during audit of Phase 1 (2026-04-19) — some
items are fixed in the same session, others are parked.

Status legend:
- `[done]` — fixed in code, referenced by file:line.
- `[open]` — known gap, not yet fixed. Do not close until a matching
  code reference exists.
- `[wontfix]` — intentionally deferred with reason.

---

## P1 — real functional gaps

### 1. `[done]` Per-turn system prompt refresh
**Problem:** `buildSystemPrompt(userMessage, turnIndex)` was called every turn
but its output only flowed into `NewConversationParams.developerInstructions`
on turn 0. Turns 1+ kept the stale turn-0 prompt — memory/workflow/surface
context went stale after the first turn. Regression vs Pi SDK.

**Fix:** On every turn, compare the freshly-built system prompt against the
one used for `newConversation`. If it changed meaningfully, prepend a
`<anton-context-update>…</anton-context-update>` block to the user message
so Codex sees the new context inline without tearing down the conversation.

**Code:** `packages/agent-core/src/harness/codex-harness-session.ts` — see
`injectContextIfChanged()` and its call site inside `processMessage`.

### 2. `[done]` Approval requests not acked
**Problem:** `apply_patch_approval_request` / `exec_approval_request` were
not subscribed. With `approvalPolicy: "never"` these should not fire, but
if Codex emits one anyway the turn hangs waiting for a reply we never send.

**Fix:** Subscribe to both, auto-respond `{decision: "approved"}` via the
corresponding response methods, log a warning for visibility.

**Code:** `codex-harness-session.ts` — `onApprovalRequest()`.

### 3. `[done]` Attachments dropped
**Problem:** `processMessage(userMessage, attachments)` ignored the
attachments param. Image uploads silently vanished on Codex sessions even
though Pi SDK preserved them with position markers.

**Fix:** Port the `[img:<id>]` marker parser from `session.ts:buildInterleavedContent`
and build a Codex `InputItem[]` with interleaved text + `{type:"image", data:{image_url: "data:<mime>;base64,<data>"}}` blocks. Unreferenced attachments append after the text.

**Code:** `codex-harness-session.ts` — `buildInputItems()`.

### 4. `[done]` Plan events fan-in
**Problem:** Only `turn/plan/updated` was wired. Spec also references
`item/plan/delta` and `codex/event/plan_delta`. Probe didn't trigger plans
so it was unclear which variant actually fires in production.

**Fix:** Subscribe to all three, de-duplicate by content hash so the UI
sees exactly one `tasks_update` per real change.

**Code:** `codex-harness-session.ts` — `onPlanUpdated()`, `lastPlanHash`
instance field.

### 5. `[done]` `codex/event/token_count` not wired
**Problem:** Only `thread/tokenUsage/updated` (v2) was wired. The v1
`token_count` event was specced but not subscribed. If the installed
codex version favors v1, mid-turn token counts would be lost.

**Fix:** Subscribe to `codex/event/token_count`, emit `token_update`.
De-dup by timestamp so v1+v2 of the same counter don't both emit.

**Code:** `codex-harness-session.ts` — `onCodexEvent("token_count")`.

---

## P2 — polish / UX

### 6. `[done]` Phase tagging on agent messages
`text` SessionEvent now carries an optional `phase: "commentary" | "final_answer"`
field (additive; Pi SDK leaves undefined). `CodexHarnessSession` tracks
`item.id → phase` from `item/started AgentMessage` events in
`messagePhases` and tags each `item/agentMessage/delta` emission by
`itemId` lookup. UI can opt in to distinct rendering whenever the design
lands; no breaking change until then.

**Code:** `packages/agent-core/src/session.ts` (text event shape),
`packages/agent-core/src/harness/codex-harness-session.ts` — `messagePhases`
field + `onItemStarted`/`onItemCompleted` branches for `agentMessage`.

### 7. `[done]` Dead `web_search_begin` subscription
Closed in the P1 sweep — `onCodexEvent` case removed and the subscription
was dropped entirely. Tool-call emission happens in `onItemStarted` only.

### 8. `[done]` Title double-emission edge
`onThreadNameUpdated` now checks `name !== this.title` before emitting
`title_update` (landed in the shape-fix sweep). Combined with the
`!this.title` guard in the first-text fallback, we emit at most one
title_update per title change.

**Code:** `codex-harness-session.ts` — `onThreadNameUpdated`.

### 9. `[done]` Reasoning / agent block tracking
Both `thinking` and `text` SessionEvents now carry optional `blockId`;
`thinking` also carries `kind: "raw" | "summary"`. `CodexHarnessSession`
populates both from the `item/reasoning/textDelta` and
`item/reasoning/summaryTextDelta` `itemId`/kind plumbing. Purely additive —
Pi SDK leaves them undefined. UI can use them to group deltas into blocks
when ready.

**Code:** `packages/agent-core/src/session.ts` (shape change),
`codex-harness-session.ts` — `onReasoningDelta` now threads `itemId` as
`blockId` and the kind parameter.

### 10. `[done]` ProjectFilesView auto-refresh on artifact
`ProjectFilesView` now subscribes to `artifactStore`. When a new artifact
with a `filepath` under the currently-viewed `cwd` arrives, it calls
`sendFilesystemList(cwd)` to refresh the file tree. Tracked by artifact
count so unrelated field updates (publish status, etc.) don't trigger
extra refreshes. Works for any backend that emits `artifact` events —
Codex, Claude Code, and Pi SDK all benefit.

**Code:** `packages/desktop/src/components/files/ProjectFilesView.tsx` —
new `useEffect` hooking `artifactStore.subscribe`.

---

## P0 — shape bugs (all fixed in the same session as P1)

Second audit pass caught a class of bugs where handler code parsed the
**v1 envelope** shape on subscriptions pointing at **v2 notifications**. The
probe log confirmed the real shapes, which are now reflected in code.

### 14. `[done]` v2 notifications are flat (no `msg` wrapper)
All `item/*`, `turn/*`, `thread/*` notifications carry payload fields
directly on `params`. Prior handlers read `params.msg.*` which is the
v1 `codex/event/*` envelope — the v2 handlers were effectively no-ops.

**Handlers fixed:** `onAgentMessageDelta`, `onReasoningDelta`,
`onThreadNameUpdated`, `onTokenUsageUpdated`, `onItemStarted`,
`onItemCompleted`, `onTurnStarted`, `onTurnCompleted`, `onPlanUpdated`.

### 15. `[done]` Item type capitalization
v2 uses camelCase (`"webSearch"`, `"commandExecution"`, `"mcpToolCall"`);
v1 uses PascalCase (`"WebSearch"`, `"CommandExecution"`, `"McpToolCall"`).
Handlers now normalize via `normalizeItemType()` — strips non-alphanumeric
and lowercases so both match a single `kind` branch.

### 16. `[done]` v2 `turn/completed` carries no usage
Per `codex-proto/v2/Turn.ts`, v2 `turn/completed` is just
`{threadId, turn: {id, items, status, error}}`. Final turn usage now comes
from either v2 `thread/tokenUsage/updated` (fires mid- and end-of-turn) or
v1 `codex/event/task_complete` (also subscribed as a fallback).

### 17. `[done]` ThreadTokenUsage shape
Real shape is `{total: TokenUsageBreakdown, last, modelContextWindow}`
where `TokenUsageBreakdown = {totalTokens, inputTokens, cachedInputTokens,
outputTokens, reasoningOutputTokens}`. Handler now reads `tokenUsage.total`
correctly.

### 18. `[done]` v1 TokenCountEvent shape
Real shape is `msg.info.total_token_usage: TokenUsage` where `TokenUsage`
uses snake_case (`input_tokens`, `cached_input_tokens`). Handler now reads
`msg.info.total_token_usage` instead of the wrong `msg.usage`.

### 19. `[done]` Thread name field
v2 uses `threadName`, v1 `msg.thread_name`. Was reading `.name` (nothing).

### 20. `[done]` Subprocess-death restart lockout
`this.startPromise` stayed fulfilled after subprocess exit, so the next
`ensureStarted()` call returned the stale promise and skipped re-init.
`proc.on("exit")` now resets `startPromise`, `conversationId`, and
`subscriptionId` alongside `started`.

### 21. `[done]` Concurrent-turn guard
`processMessage` now rejects re-entry with an `error` SessionEvent if
`currentTurn` is already set. The server already serializes via
`activeTurns` but the class is self-protecting now.

---

## Infrastructure / dev quality

### 11. `[open]` End-to-end smoke test
The live probe at `.context/codex-probe/` validates the protocol but is
manual. There's no CI job that spins up app-server and asserts a turn
round-trip. Needed before we can confidently bump the pinned CLI
version.

### 12. `[done]` Dead `CodexAdapter` construction removed from factory
The `const adapter = providerName === 'codex' ? new CodexAdapter() : new ClaudeAdapter()`
line no longer constructs an unused `CodexAdapter` for codex sessions —
it returns `null` for that branch, and the `HarnessSession` ctor call
inside the non-codex branch is the only consumer. `CodexAdapter` the
class is still exported because it's used for discovery (`detect()`
calls at `server.ts:2810, 2838`). The `codex exec --json` spawn path
inside the class is no longer entered for session turns.

**Code:** `packages/agent-server/src/server.ts:1890`.

**Not yet done:** deleting `packages/agent-core/src/harness/adapters/codex.ts`,
`codex-events.ts`, and the `__fixtures__/check.ts` reference. Safe to do
once the migration soaks — the file still provides `detect()` used by
the discovery code.

### 13. `[done]` MCP shim exposes `spawn_sub_agent` + `anton:web_search`
Landed in three phases (see `HARNESS_MCP_SUBAGENT_AND_SEARCH.md` for the design).

**Phase A — `anton:web_search`:**
- `tools/anton-web-search.ts` wraps existing Exa plumbing as an `AgentTool`.
- Registered in `buildAntonCoreTools()`, so every harness sees it via the
  MCP shim AND Pi SDK picks it up via the tool spread at `agent.ts:713`.
- Duplicate registration at `agent.ts:1374-1434` removed — single source of
  truth now.
- Identity prompt (`buildHarnessIdentityBlock`) gained a dedicated "Web
  search" section telling the CLI to prefer `anton:web_search` over its
  built-in search.

**Phase B — MCP progress protocol:**
- `IpcToolProvider.executeTool` gained an optional `onProgress` callback
  (`ProgressCallback = (message, progress?) => void`).
- `mcp-ipc-handler.ts` reads `_progressToken` from `tools/call` params and
  builds a callback that writes `{method:"progress", params:{…}}` frames
  back over the conn.
- `anton-mcp-shim.ts` forwards `_meta.progressToken` into the IPC request,
  listens for `method:"progress"` frames from Anton, and re-emits them as
  MCP `notifications/progress` to the host CLI. Timeout for streaming
  calls extended from 30s → 30m.
- `tool-registry.ts` gained `StreamingCapable` interface; tools that
  declare `executeStreaming` get routed through it when a callback is
  present.
- `CodexHarnessSession` subscribes to `item/mcpToolCall/progress` and maps
  progress for `anton:spawn_sub_agent` tool calls to `sub_agent_progress`
  SessionEvents — rendering inside the existing `SubAgentGroup.tsx`
  card without any UI change.

**Phase C — `spawn_sub_agent`:**
- `tools/spawn-sub-agent.ts` defines the tool with schema ports Pi SDK's
  `sub_agent` description (research/execute/verify types).
- Both `execute` (non-streaming fallback for Pi SDK callers) and
  `executeStreaming` (live progress for harness MCP callers) are wired.
- Child is always a fresh Pi SDK `Session` (ephemeral), spun up via
  `createSession()`. Parent provider not inherited in v1 — simpler and
  deterministic. Cross-provider spawning is a v2 follow-up.
- Sub-agent role prefixes + budgets + allowlists exported from `agent.ts`
  so they live in one place. Still inline in the Pi SDK `sub_agent` tool
  for now; `agent.ts:1374-1434`'s logic will consolidate later.
- Identity prompt gained a dedicated "Sub-agents" section explaining when
  the parent should prefer spawning over inline work.

**Not yet done (v2 follow-ups):**
- Cross-provider children (`provider: "codex"` override).
- Fork mode (inherits parent context — requires transporting conversation
  history through the MCP boundary, non-trivial).
- Enforcing the `SUB_AGENT_ALLOWED_TOOLS` allowlist on the child. v1
  gives the child its full Pi SDK tool set; Pi SDK's `createSession`
  doesn't accept a tool filter, so this needs a Session-level change.
- Concurrency cap on parallel children per parent turn (default 3).
- Telemetry on `anton:web_search` vs native search selection rate.
- Parent-turn cancellation → child session cancellation. Today the
  child runs to its `maxDurationMs` timeout even if the parent turn
  is aborted. Needs an AbortSignal threaded through `createSession`.
- Tests — no unit/integration coverage for the progress plumbing,
  the shape of `spawn_sub_agent`, or `anton:web_search` yet.

---

## P0 — code-quality audit (second pass, all fixed)

Separate audit after Phase A/B/C landing caught structural issues:

### 22. `[done]` Circular import via sub-agent constants
`spawn-sub-agent.ts → agent.ts → tools/factories.ts → spawn-sub-agent.ts`.
Worked at build time because reads were inside function bodies, but
fragile to reorder. Fixed by extracting to
`packages/agent-core/src/tools/sub-agent-config.ts`; both `agent.ts`
(for its inline `sub_agent` tool) and `spawn-sub-agent.ts` import from
there, and `agent.ts` re-exports for back-compat.

### 23. `[done]` Child session lost parent cwd / projectId
v0 called `createSession(id, config, { ephemeral: true })` — missing
`projectWorkspacePath` and `projectId`. Research ran against a neutral
cwd; the child couldn't see project files. Fixed:
- `AntonCoreToolContext` now carries `workspacePath`.
- `HarnessSessionContext` now carries `workspacePath`.
- `server.ts` populates it from the project's `workspacePath` when
  building harness session contexts.
- `buildSpawnSubAgentTool(ctx)` accepts `parentProjectId` +
  `parentWorkspacePath`; `runSubAgent` passes them into `createSession`.

### 24. `[done]` No wall-clock cap on child sessions
Budgets were logged but not enforced. Fixed:
- `SUB_AGENT_BUDGETS[type].maxDurationMs` added (10/20/10 minutes for
  research/execute/verify).
- `runSubAgent` passes `maxDurationMs: budget.maxDurationMs` into
  `createSession`. Hard wall-clock cap now enforced.
- Token + turn budgets remain advisory (Pi SDK's `Session` ctor
  doesn't accept them) — noted as a v2 follow-up above.

### 25. `[done]` Duplicate `sub_agent` tool visible to Pi SDK
Pi SDK's inline `sub_agent` (`agent.ts:970`) and the new harness
`spawn_sub_agent` both appeared in Pi SDK's tool list — two tools, same
job. Fixed:
- `AntonCoreToolContext.includeHarnessMcpTools?: boolean` flag added.
- `buildAntonCoreTools` only appends `spawn_sub_agent` when the flag
  is true.
- `tool-registry.ts` (harness path) sets the flag; Pi SDK's `buildTools`
  (`agent.ts`) does not, so it keeps only its inline `sub_agent`.

### 26. `[done]` Dead `progressTokens` map in shim
Populated but never read — progress-token routing is done on-wire
(server echoes the token in each `progress` frame), so the shim doesn't
need per-request mapping. Removed the map + all its accessors.

### 27. `[done]` Progress throttle dropped bursts
v0 checked "less than 200ms since last emit → skip". In a fast burst of
10 events the user saw one message and lost nine. Replaced with
`createThrottledProgress(onProgress, 200)`: keeps the LATEST pending
message, flushes on a trailing timer. No data loss in a burst — the
UI sees the first event immediately, then the most-recent one at the
end of each window.

**Code:**
- `packages/agent-core/src/tools/anton-web-search.ts` (new)
- `packages/agent-core/src/tools/spawn-sub-agent.ts` (new)
- `packages/agent-core/src/tools/factories.ts` (register both)
- `packages/agent-core/src/harness/mcp-ipc-handler.ts` (progress callback plumbing)
- `packages/agent-core/src/harness/anton-mcp-shim.ts` (progressToken + notifications/progress)
- `packages/agent-core/src/harness/tool-registry.ts` (`StreamingCapable`, dispatch)
- `packages/agent-core/src/harness/codex-harness-session.ts` (`onMcpToolCallProgress`)
- `packages/agent-core/src/agent.ts` (export `SUB_AGENT_*`, remove duplicate `web_search`)
- `packages/agent-core/src/prompt-layers.ts` (new "Sub-agents" + "Web search" sections in identity block)

---

## Non-issues (investigated, intentional)

### Subsequent-turn `buildSystemPrompt` result — **addressed by P1 #1**
Original audit flagged this as a hang; the fix (P1 #1) injects the
refreshed context as a user-message prefix when it changes.

### `isFirstTurn` local var declared and voided
Removed in the P1 #1 fix while refactoring `processMessage`.

### No startup timeout on `ensureStarted()`
Not needed — `CodexRpcClient` has a default 30s per-request timeout, so
a hanging `initialize` or `newConversation` fails with a sensible error.
