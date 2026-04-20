# Harness ↔ Pi SDK parity — gap audit & rollout

Goal: bring the codex / Claude Code harness path to feature parity with the
Pi SDK agent so a user on a ChatGPT or Anthropic subscription gets the same
"Anton power" as a user on the Pi SDK direct-API path.

Companion to `HARNESS_ARCHITECTURE.md`,
`HARNESS_APP_SERVER_MIGRATION.md`, `HARNESS_APP_SERVER_FOLLOWUPS.md`.

Status legend:
- `[done]` — wired in code; reference file:line.
- `[wip]` — actively in progress this pass.
- `[open]` — known gap, not yet fixed.
- `[wontfix]` — intentionally deferred with reason.

---

## Architecture recap (so the gaps below make sense)

A harness session (`HarnessSession` for Claude, `CodexHarnessSession` for
Codex) spawns a CLI subprocess and exposes Anton tools via an MCP shim
(`anton-mcp-shim.ts`) that connects back to the server over a unix socket
and is auth-scoped per-session. The shim's `tools/list` returns whatever
`AntonToolRegistry.buildToolMap(sessionId)` produces:

- `buildAntonCoreTools(ctx)` — anton-owned tools (memory, database,
  notification, publish, web_search, sub_agent, project tools).
- `connectorManager.getAllTools(surface)` — every connected service's
  tools (Gmail, Slack, GitHub, Linear, Calendar, Sheets, Telegram, GSC,
  Exa, etc.).

So the harness already has GitHub-via-connector AND codex's own native
`shell` (which can `git clone` etc.) AND its own native `fileChange` for
making/editing files. **The user's example of "clone a github repo and
work on it" already works today.**

What is **NOT** exposed via the MCP shim — and is the meat of this spec —
is the rest of Pi SDK's UI-bound tool surface. Every tool below is in
`packages/agent-core/src/agent.ts` `buildTools()` but is NOT in
`buildAntonCoreTools()`, so harness CLIs can't call it.

---

## P0 — Anton-flow critical (do first)

### 1. `[done]` `ask_user` — interactive multi-choice questions
**Why this matters:** without it, codex/Claude can only ask the user
plain-text questions inline. Pi SDK lets the model surface a proper
multiple-choice card in the desktop UI (used by routine create/delete
confirmations, for example — see `agent.ts:1157+`).

**What's missing:** `ask_user` is defined in `agent.ts:737-794` (Pi SDK
only) and uses `callbacks.getAskUserHandler()` to deliver questions to
the desktop client. Need to add it to `buildAntonCoreTools()` AND wire
the handler through `HarnessSessionContext` so the registry can invoke
the same desktop flow per session.

**Shipped:**
- `packages/agent-core/src/tools/ask-user.ts` — `buildAskUserTool(handler)`.
- `tools/factories.ts` — `AntonCoreToolContext.onAskUser`; tool registered
  when context is set AND `includeHarnessMcpTools` is on (so we don't
  double-register on Pi SDK path which has its own inline copy).
- `harness/tool-registry.ts` — `HarnessSessionContext.onAskUser`; passed
  through to `buildAntonCoreTools`.
- `agent-server/src/server.ts` — `buildHarnessAskUserHandler(sessionId)`
  reuses the same Channel.AI / pendingPrompts / promptResolvers
  round-trip as `wireAskUserHandler`. Both are now thin shells over
  `buildAskUserHandlerForSession`. Wired into the harness session
  context at construction (`harnessSessionContexts.set`).

### 2. `[done]` `artifact` — render HTML / markdown / SVG / mermaid in side panel
**Why this matters:** the desktop has a rich artifact panel (see
`packages/desktop/src/components/artifacts/ArtifactPanel.tsx`). Pi SDK
sessions can drop visual content into it via the `artifact` tool. The
harness can't, so codex/Claude users never see the side panel light up
with a rendered HTML page or a generated SVG.

**Shipped:**
- `packages/agent-core/src/tools/artifact-factory.ts` —
  `buildArtifactTool()` wraps `executeArtifact` (kept the existing
  per-tool implementation) into an `AgentTool` factory.
- `tools/factories.ts` — registered unconditionally inside
  `buildAntonCoreTools()`. Pi SDK still has its own inline copy via
  `agent.ts buildTools()`; the final dedupe pass in `buildTools` collapses
  the duplicate by name so the model sees one tool either way.
- `harness/codex-harness-session.ts` — new private
  `emitArtifactEvent(toolCallId, input)` mirrors Pi SDK's
  `Session.detectArtifact` shape. Wired in `onItemCompleted`'s
  `mcpToolCall` branch: when the recorded tool name is `anton:artifact`
  and the call didn't error, emit the `artifact` SessionEvent before the
  `tool_result`.
- `harness/adapters/claude.ts` — same translation in the Claude Code
  adapter, gated on `block.name === 'mcp__anton__artifact'` (Claude
  Code's MCP naming convention). Emits the artifact event alongside the
  normal `tool_call` event so the desktop ArtifactPanel renders
  identically across Pi SDK / codex / Claude Code paths.

### 3. `[done]` `image` — screenshot / resize / crop / convert
**Why this matters:** lets the model take a screenshot to verify a UI
change, prepare images for upload to a connector, etc. Without it, the
harness has to shell out and the result is binary data the LLM can't see
back as an attachment.

**Shipped:**
- `packages/agent-core/src/tools/image-factory.ts` — `buildImageTool()`
  wraps `executeImage` with the same TypeBox schema Pi SDK uses inline
  in `agent.ts`. Returns the operation result as text (path on disk for
  screenshots, info dump for `info`).
- `tools/factories.ts` — registered unconditionally inside
  `buildAntonCoreTools()`. Pi SDK still has the inline copy; the
  `buildTools` dedupe pass collapses it.
- Binary plumbing decision: returns text-wrapped paths (`Screenshot
  saved to /tmp/screenshot_<ts>.png`) instead of base64. Both Codex and
  Claude Code re-pick up the file via their native `read` / image
  attachment flow when the model needs to reason about pixels. The MCP
  shim's text-only content frames stay simple.

### 4. `[done]` `routine` — create / list / start / stop scheduled routines
**Why this matters:** scheduled-routine creation is a tentpole Anton
feature; codex users can't currently create one without leaving the
harness path.

**Shipped:**
- `packages/agent-core/src/tools/cron-humanize.ts` — extracted the
  `humanizeCron` helper so the Pi SDK inline tool and the harness
  factory share one source of truth (agent.ts now imports from here).
- `packages/agent-core/src/tools/routine-factory.ts` —
  `buildRoutineTool({projectId, jobActionHandler, askUser})` mirrors
  the Pi SDK inline `routine` tool exactly: same description,
  parameters, ask_user confirmation flow for create/delete, and
  `JobToolInput`-shaped dispatch.
- `tools/factories.ts` — `AntonCoreToolContext.onJobAction`; tool
  registered when `ctx.projectId` AND `ctx.onJobAction` are set
  (matches Pi SDK gating). The `askUser` argument is forwarded so the
  confirmation cards render in the desktop the same way.
- `harness/tool-registry.ts` — `HarnessSessionContext.onJobAction`
  threaded through to `buildAntonCoreTools`.
- `agent-server/src/server.ts` — wires
  `this.buildAgentActionHandler(id)` (the same handler Pi SDK uses
  inline at `server.ts:3737`) into `harnessSessionContexts.set(...)`,
  gated on `harnessProjectId` so non-project sessions don't see the
  tool. The same Channel.AI / pendingPrompts round-trip already wired
  for ask_user (#1) handles the create/delete confirmation.

---

## P1 — broaden the surface

### 5. `[done]` `browser` — interactive browser with screenshots in sidebar
**Why this matters:** Pi SDK sessions can drive a real Chromium and the
desktop sidebar shows live screenshots + lets the user watch/click. The
harness has no equivalent — codex falls back to fetch-only browsing
through its native `webSearch`.

**Shipped:**
- `packages/agent-core/src/tools/browser-factory.ts` —
  `buildBrowserTool(callbacks?)` wraps `executeBrowser` with the same
  schema Pi SDK uses inline. When callbacks are undefined the tool
  still supports `fetch` / `extract` (no live state needed); the
  full-browser ops just don't push sidebar updates.
- `tools/factories.ts` — `AntonCoreToolContext.browserCallbacks`;
  forwarded into `buildBrowserTool` when present.
- `harness/tool-registry.ts` — `HarnessSessionContext.browserCallbacks`
  threaded through.
- `harness/codex-harness-session.ts` + `harness/harness-session.ts` —
  new public `emitBrowserState(state)` and `emitBrowserClose()`. The
  Claude path required adding a `pushEvent` field that's late-bound
  inside `processMessage` (cleared in `finally`), since out-of-band
  events couldn't reach the local `eventQueue` before. Codex already
  had a turn-scoped `emit()` so it just delegates.
- `agent-server/src/server.ts` — `buildHarnessBrowserCallbacks(id)`
  late-binds via `this.sessions.get(id)`. Wired into
  `harnessSessionContexts.set(...)` for every harness session.
- **Per-session scoping caveat:** the underlying Playwright instance
  in `tools/browser.ts` is process-scoped (same as Pi SDK). If we ever
  run multiple harness sessions concurrently driving a real browser,
  we'll need to add per-session scoping there. Behavior matches Pi SDK
  today, which is the bar for parity.

### 6. `[done]` `clipboard` — read / write system clipboard
**Why this matters:** small but useful; user says "paste what I just
copied". Pi SDK has it (`agent.ts:672-691`); harness doesn't.

**Shipped:**
- `packages/agent-core/src/tools/clipboard-factory.ts` —
  `buildClipboardTool()` wraps `executeClipboard` with the same TypeBox
  schema Pi SDK uses inline.
- `tools/factories.ts` — registered unconditionally inside
  `buildAntonCoreTools()`. Pi SDK still has the inline copy; the
  `buildTools` dedupe pass collapses it.

### 7. `[done]` `task_tracker` — emit Anton-shaped task list
**Why this matters:** codex emits its own `plan` items
(`turn/plan/updated` and `item/plan/delta`), and we already translate
them into `tasks_update` events in
`codex-harness-session.ts:657-689`. So this is technically wired for
codex — but Claude Code won't emit plan items, so without an explicit
`task_tracker` MCP tool, Claude Code sessions can't update the desktop
task list at all.

**Shipped:**
- `packages/agent-core/src/tools/task-tracker-factory.ts` —
  `buildTaskTrackerTool()` reuses `executeTaskTracker` from the existing
  module. The factory passes no callback (callbacks-via-MCP would
  require a session emit reference at registry build time, which we
  don't have); the SessionEvent emission is instead handled at the
  protocol layer where the harness sees the call.
- `tools/factories.ts` — registered unconditionally inside
  `buildAntonCoreTools()`.
- `harness/codex-harness-session.ts` — new private
  `emitTasksUpdateEvent(input)` mirrors `Session.emitTasksUpdate`.
  Wired in `onItemCompleted`'s `mcpToolCall` branch, gated on
  `open?.name === 'anton:task_tracker'`. Codex's native plan path keeps
  working; this is purely additive.
- `harness/adapters/claude.ts` — same translation gated on
  `block.name === 'mcp__anton__task_tracker'`. This is the ONLY path
  Claude Code can populate the desktop checklist, since it has no
  native plan stream.

### 8. `[done]` `deliver_result` — agent → origin conversation handoff
**Why this matters:** scheduled agents need to deliver results back to
the conversation that spawned them. Pi SDK has it (`agent.ts:1232-1262`).

**Shipped:**
- `packages/agent-core/src/tools/deliver-result-factory.ts` —
  `buildDeliverResultTool(handler)` mirrors the Pi SDK inline tool.
- `tools/factories.ts` — `AntonCoreToolContext.onDeliverResult`; tool
  registered only when the context provides a handler.
- `harness/tool-registry.ts` — `HarnessSessionContext.onDeliverResult`
  threaded through to `buildAntonCoreTools`.
- `agent-server/src/server.ts` — **no live wiring yet**. All harness
  sessions today are user-driven (no origin conversation to deliver
  back to), so the context leaves `onDeliverResult` undefined and the
  tool stays hidden. The wiring is a no-op hook that the future
  scheduled-harness path can flip on by passing
  `this.buildDeliverResultHandler(sessionId, projectId)` (the same
  factory Pi SDK uses at `server.ts:3745`).

---

## Steer / cancel robustness

### 9. `[done]` Race window between `turn/start` request and `turn/started` notification
**Problem:** in `processMessage`, we fire `void rpc.request('turn/start')`
and `currentTurnId` is set either by the response or by the `turn/started`
notification — whichever lands first. Between those two events (~10ms in
practice), `currentTurnId` is `null`. If the server calls
`steer()` or `cancel()` in that window, both no-op silently:

```ts
async steer(text, attachments) {
  if (!this.currentTurnId) {
    log.warn(...)  // skip
    return
  }
  ...
}

cancel(): void {
  if (!this.rpc || !this.threadId || !this.currentTurnId) return
  ...
}
```

The server only fires steer/cancel when `activeTurns.has(sessionId)` —
which is set BEFORE `processMessage` runs. So a fast cancel can absolutely
land before we have a turn id, and disappear.

**Fix shipped:** `packages/agent-core/src/harness/codex-harness-session.ts`
- `pendingCancel` + `pendingSteer` race-window buffer fields (next to the
  other per-turn private state).
- `steer()` and `cancel()` buffer when `currentTurnId` is null but
  `currentTurn` is set (i.e. a turn was kicked off but its id hasn't
  arrived yet).
- `onTurnStarted()` drains both: cancel beats steer (a buffered cancel
  voids the buffered steer; the turn is going down anyway).
- `processMessage`'s `finally` clears the buffers so a turn that died
  before `turn/started` doesn't leak intent into the next turn.
- Extracted `fireInterrupt(turnId)` and `applySteer(text, atts, turnId)`
  so the live and buffered paths share the same RPC dance.

---

## Tools that intentionally stay Pi-SDK-only

### `[wontfix]` `shell` / `read` / `write` / `edit` / `glob` / `grep` / `git` / `http_api`
Codex and Claude Code have native equivalents that are tighter integrated
with their core prompts. Re-exposing via MCP would cause name collisions
and confuse the model about which tool to call. The identity prompt
already tells the CLI to use its native tools for local work
(`prompt-layers.ts:347-349`).

### `[wontfix]` `plan` (Pi SDK plan-and-pause tool)
Codex has its own `plan` items and a fundamentally different flow
(items are inline in the stream, not blocking). Claude Code uses its
own `ExitPlanMode`. Re-exposing the Pi SDK `plan` tool would
double-render.

### `[wontfix]` `todo`
Pi SDK's persistent local todo tool. Anton has database and memory tools
that subsume the use case for the harness path. Not worth adding a
duplicate.

### `[wontfix]` `sub_agent` (fork mode)
The fork variant of `sub_agent` clones the parent's full message history
and tools, which only works in the Pi SDK direct path because we own
the message structure. The harness already exposes typed sub-agents
via `spawn_sub_agent` (research / execute / verify) which works
bidirectionally.

### `[wontfix]` `shared_state`
Workflow agents only — and workflow agents always run on the Pi SDK
path today (they need direct API access for the scheduler). Revisit if
we ever schedule harness-backed workflow agents.

---

## Rollout order

1. ✅ P0 #1 `ask_user` — unblocks #4 routine confirmation.
2. ✅ #9 steer / cancel race fix — small, isolated, ships independently.
3. ✅ P0 #2 `artifact` — high user-visible win.
4. ✅ P0 #3 `image` — text-wrapped path return, no binary in MCP shim.
5. ✅ P0 #4 `routine` — depends on #1.
6. ✅ P1 #6 `clipboard` — trivial.
7. ✅ P1 #7 `task_tracker` — fallback path for Claude Code.
8. ✅ P1 #5 `browser` — biggest engineering, most user-visible win.
9. ✅ P1 #8 `deliver_result` — factory + ctx hook only (no live caller yet).

**All P0 + P1 items shipped.** Verification:
- `pnpm -F @anton/agent-core build` clean.
- `pnpm -F @anton/agent-server build` clean.
- `pnpm -F @anton/agent-core check:harness` — 7 fixtures + 4 registry +
  5 prompt-layer + 5 snapshot + 15 identity + 5 mem-guide + 6 mirror +
  3 round-trip + 1 replay-seed = all pass.
- `pnpm lint` — no new errors introduced (pre-existing template-literal
  warnings in `anton-mcp-shim.ts` and `console.*` noise in
  `__fixtures__/check.ts` remain; both unrelated to this work).

Each item closes when:
- factory exists in `tools/<tool>.ts`,
- `buildAntonCoreTools()` registers it,
- if it needs a callback, `HarnessSessionContext` carries it AND
  `server.ts` populates it,
- harness fixture in `__fixtures__/check.ts` covers it (existence in
  `tools/list` + a basic call where feasible),
- this doc flips `[open]` → `[done]` with file:line refs.
