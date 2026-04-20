# Anton Tools via MCP: `spawn_sub_agent` + `anton:web_search`

Status: **Proposed**. Tracked as Task #6 in the harness migration plan.
Companion docs: `HARNESS_APP_SERVER_MIGRATION.md`, `HARNESS_APP_SERVER_FOLLOWUPS.md`.
Estimate: 1.5–2 focused engineer-days.

---

## 1. Goal

Give Codex-backed harness sessions access to two Anton-owned tools via the
existing MCP shim:

1. **`spawn_sub_agent`** — lets GPT-5.4 delegate subtasks to isolated child
   sessions (research, execute, verify, or fork-from-parent). Mirrors Pi
   SDK's existing `sub_agent` tool (`agent.ts:970-1206`). Essential for
   parallel work without polluting the parent's context window.
2. **`anton:web_search`** — routes search through Anton's Exa integration
   (`tools/web-search.ts`) instead of Codex's built-in `web_search`. Unifies
   provider, citations, caching, cost, and telemetry across Pi SDK and harness.

Non-goals:
- Replacing Codex's native web_search for users who prefer it.
- Changing Pi SDK's `sub_agent` tool behavior.
- Building a new search provider. We reuse the existing Exa plumbing.

---

## 2. Grounding — what exists today

All file:line anchors verified via `packages/agent-core/src/...` exploration.

### 2.1 The MCP shim is request/response only

- `harness/anton-mcp-shim.ts:158-197` handles `initialize`, `tools/list`,
  `tools/call`. Returns `Method not found` for anything else. **No progress
  notifications are forwarded today.**
- `harness/mcp-ipc-handler.ts:156-186` mirrors that on the server side — a
  single request/response over the unix socket.
- `harness/tool-registry.ts:44-68` adapts a Pi SDK `AgentTool` into an MCP
  `ToolDefinition`. The `execute` wrapper returns a single `McpToolResult`;
  no streaming path.

### 2.2 Codex already has the progress notification we need

- `harness/codex-proto/v2/McpToolCallProgressNotification.ts` defines:
  ```ts
  { threadId: string, turnId: string, itemId: string, message: string }
  ```
- `CodexHarnessSession` (`codex-harness-session.ts:515-548`) does **not**
  subscribe to `item/mcpToolCall/progress` yet. Wiring it is one line.

### 2.3 Pi SDK `sub_agent` is fully implemented — we can mirror it

- `agent.ts:970-1206`. Three typed modes + fork.
- `SUB_AGENT_ALLOWED_TOOLS` (lines 75-114) per-type tool allowlists.
- `SUB_AGENT_BUDGETS` (lines 117-121) — research 100k/30 turns,
  execute 200k/50 turns, verify 100k/30 turns.
- `SUB_AGENT_TYPE_PREFIXES` (lines 123-196) — role-specialized system prompts.

### 2.4 Exa web search is already wired for Pi SDK

- `tools/web-search.ts` — implements `searchExa(provider, { query, numResults, category, dates })`.
- OAuth-provisioned via config: `agent-config/src/config.ts:1677` (connector `id: exa-search`, oauthProvider `websearch`).
- Tool registration reads the connector in `agent.ts:1379-1383`.
- Only Exa is wired — no fallback provider today.

### 2.5 The harness system prompt already has a tool-preference clause

- `prompt-layers.ts:288-326` `buildHarnessIdentityBlock()` tells the CLI
  it's serving as Anton's execution engine, with a section at lines 313-320
  saying "prefer `anton:` tools over vendor MCP servers". This is where we
  add explicit sub-agent and web-search guidance.
- `buildHarnessContextPrompt()` (lines 349-371) assembles the full
  per-turn prompt from identity + memory + surface + context layers.
- There is no `buildCodexInstructions()` — the harness identity block
  serves both Claude Code and Codex.

---

## 3. What we can learn from reference systems

This section extracts steering patterns from three systems. Where I don't
have reliable documentation I say so — we should validate before adopting.

### 3.1 Conductor (the workspace we're in)

Conductor orchestrates many concurrent coding agents via **worktree
isolation**. Lessons directly transferable:

- **One worktree per agent.** Each sibling agent works in its own copy of
  the repo. State isolation is physical, not logical.
- **`.context/` directory for cross-agent artifacts.** Explicit, opt-in
  sharing via filesystem, never through shared memory.
- **Parallel by default.** The orchestrator fires multiple agents
  simultaneously; there's no serialization at the user level.
- **Diff as the unit of review.** `GetWorkspaceDiff` + `DiffComment` turn
  an agent's entire run into a reviewable patch.

Implications for our sub-agent:
- **Child sessions should run in an isolated cwd or with an explicit
  tool allowlist**, not share state with the parent by default.
- **Fork mode is the exception**, not the default — it inherits context
  and should only be used when the parent's history is essential.
- **Return the diff/result, not streaming internals**, as the primary
  artifact of the sub-agent. Progress is for UX, the result is what
  the parent agent consumes.

### 3.2 Claude Agent SDK (what this assistant is built on)

The SDK's `Task` tool is the reference implementation we should study
closest. Key patterns:

- **Subagent selection by `subagent_type`.** The parent picks a named
  specialist (general-purpose, Explore, Plan, domain-specific). Each
  type has its own system prompt + tool set. Exactly mirrors Pi SDK's
  research/execute/verify split.
- **Tool description does the steering.** The `Task` tool's description
  is long and prescriptive — it tells the caller *when* to spawn
  (multi-step tasks, independent work), *when not to* (known target,
  simple lookup), and *how* to write the prompt (self-contained, state
  the goal, give context the child doesn't have).
- **Parallel tool_calls in one assistant message.** Multiple `Task`
  invocations in one response run concurrently. Caller budgets are per
  invocation, not shared.
- **No mid-task steering of children.** Once spawned, a subagent runs
  to completion. The parent interrupts at most by cancelling the
  whole turn.
- **Result is a final text summary.** The parent consumes the `tool_result`
  as a normal tool output. Internal streaming events are not replayed.
- **Hooks + stop conditions** isolate the child from the parent's
  hooks/permissions.

Implications for our design:
- **Tool description is load-bearing.** We should port the full Pi SDK
  sub_agent description verbatim, possibly expanded with Codex-specific
  hints ("prefer `spawn_sub_agent(type='research')` over your built-in
  `web_search` when the question needs multi-page synthesis").
- **Parallelism is free** — Codex supports parallel tool_calls natively;
  we don't need to do anything.
- **Steering the child is out of scope for v1.** Match the Agent SDK's
  fire-and-forget model. `interruptConversation` on the parent kills
  the whole turn, which cancels in-flight children.
- **Final text as tool_result** — just like Pi SDK's
  `toolResult(finalText, hadError)` at `agent.ts:1205`.

### 3.3 Forgecode (reference needed)

I don't have direct documentation for Forgecode's internal architecture.
Based on the name and context I'd expect patterns like:

- **Planner/executor split** — one model produces a plan, specialist
  workers execute steps.
- **Structured output contracts** — results schema-validated at the boundary.
- **Replay / determinism** — runs are reproducible from the input + seed.

**Action:** ask the user for Forgecode docs or a pointer to their
`spawn_agent`/`task`-equivalent if they want those patterns in v1.
Otherwise we build Pi SDK + Agent SDK parity first and borrow later.

### 3.4 Synthesis — the design baseline

Take the Agent SDK / Pi SDK pattern literally:

- `spawn_sub_agent` is a named tool with a typed role selector.
- Each type has a system prompt, token budget, turn budget, tool allowlist.
- Parent model calls it like any other tool. Tool result is a single
  summary string.
- **Addition**: expose *progress* (the child's text + tool calls) through
  MCP progress notifications so the UI can render a live SubAgentGroup
  card — this is the single place we extend beyond the Agent SDK pattern,
  and it's what makes the UX feel alive.

---

## 4. Architecture

### 4.1 Data flow (sub-agent call)

```
┌─────────────────────────────────────────────────────────────┐
│  Parent CodexHarnessSession                                 │
│    codex app-server (GPT-5.4)                               │
│                                                             │
│    Parent decides to spawn_sub_agent(type="research",       │
│                                       task="…")             │
└─────────────────┬───────────────────────────────────────────┘
                  │ tools/call + _meta.progressToken
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Anton MCP shim (anton-mcp-shim.ts, spawned by codex)       │
│  Receives the request, forwards over unix socket            │
│  KEY CHANGE: also listens for `notifications/progress`      │
│  from the Anton server and forwards them to codex with      │
│  the original progressToken.                                │
└─────────────────┬───────────────────────────────────────────┘
                  │ IPC framing (RPC + progress stream)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Anton IPC server (mcp-ipc-handler.ts)                      │
│  Routes to AntonToolRegistry.executeStreaming(…)            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  AntonToolRegistry                                          │
│    spawn_sub_agent handler:                                 │
│      • Create child Session (Pi SDK) OR CodexHarnessSession │
│      • Wire: every child SessionEvent → MCP progress        │
│        notification (throttled, summarized)                 │
│      • await child.processMessage(task) to completion       │
│      • Return final accumulated text as tool_result         │
└─────────────────────────────────────────────────────────────┘
                  │ progress events flow back ─────┐
                  │                                │
                  │ final result (sync response)   │
                  ▼                                ▼
           ┌──────────────┐         ┌──────────────────────────┐
           │ shim returns │         │ shim forwards progress    │
           │ final result │         │ as MCP notifications/     │
           │ to codex     │         │ progress                  │
           └──────┬───────┘         └──────────────┬───────────┘
                  │                                │
                  ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│  Codex app-server receives final result + progress stream   │
│    Emits:                                                   │
│      • item/mcpToolCall/progress (one per progress)         │
│      • item/mcpToolCall/end (final result)                  │
└─────────────────┬───────────────────────────────────────────┘
                  │ notifications to CodexHarnessSession
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  CodexHarnessSession adapter                                │
│    Maps progress → sub_agent_progress SessionEvent          │
│    Maps end → sub_agent_end SessionEvent                    │
│    (parent tool_call_id matches the spawn_sub_agent call)   │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
              Anton UI (SubAgentGroup card renders live)
```

### 4.2 What changes, per layer

| Layer | File | Change |
|---|---|---|
| Child-session spawner | new: `harness/sub-agent-runner.ts` | Wraps `createSession` or `CodexHarnessSession` construction; exposes `AsyncIterable<SessionEvent>` for one task, collects final text. |
| Tool registry | `harness/tool-registry.ts` | Add `executeStreaming(name, args, session, onProgress) → Promise<McpToolResult>`; keeps `executeTool` for non-streaming. |
| IPC handler (server) | `harness/mcp-ipc-handler.ts` | Add a `tools/call/stream` or extend `tools/call` to accept a `progressToken`; open a channel for progress messages. |
| MCP shim (client) | `harness/anton-mcp-shim.ts` | Forward `_meta.progressToken` to Anton, and emit MCP `notifications/progress` back to codex as messages stream in. |
| Sub-agent tool | new: `tools/spawn-sub-agent.ts` | The `AgentTool` definition — schema + description + execute. Mirrors Pi SDK's `sub_agent` one-to-one. |
| Web-search tool | new: `tools/anton-web-search.ts` (thin wrapper) | Re-export of `web-search.ts` shaped as an AgentTool so it can be registered in `buildAntonCoreTools`. |
| Core tool builder | `tools/factories.ts` | Push both new tools into `buildAntonCoreTools`. |
| Codex adapter | `harness/codex-harness-session.ts` | Subscribe to `item/mcpToolCall/progress`; emit `sub_agent_progress` keyed by the parent call_id. |
| Identity prompt | `prompt-layers.ts:313-320` | Extend the "prefer anton:" clause with explicit `spawn_sub_agent` + `anton:web_search` usage guidance. |

### 4.3 Why not use Codex's native collab agents?

Codex has `collab_agent_spawn_begin/end` events built in. We already
subscribed to those in `CodexHarnessSession` and map them to
`sub_agent_*` events (`codex-harness-session.ts` around line 860).

The difference:
- **Codex collab agents** are Codex-to-Codex. The child is another Codex
  thread, same provider, visible to Codex's own machinery.
- **Anton `spawn_sub_agent`** can target Pi SDK (Claude, Anthropic API)
  OR Codex (GPT-5.4). The parent does not have to match the child.

Both mechanisms coexist. Codex GPT-5.4 may prefer its own collab agents
for tight-loop work; our tool is the escape hatch when you want a
different provider or Anton-specific tool set.

---

## 5. Tool specifications

### 5.1 `spawn_sub_agent`

**Description (verbatim port from Pi SDK + Codex-specific addendum):**

> Spawn an autonomous sub-agent to handle a delimited sub-task. Choose
> `type` to specialize:
>
> - `research`: information gathering, no file changes. Uses web_search,
>   browser, read, grep, glob, http_api, memory, git. Token budget 100k,
>   max 30 turns.
> - `execute`: build/change tasks with verification. Full write access.
>   Token budget 200k, max 50 turns.
> - `verify`: runs tests/checks, reports PASS/FAIL/PARTIAL. Read-only.
>   Token budget 100k, max 30 turns.
>
> Omit `type` to create a *fork* that inherits your full conversation
> context. Fork is expensive — use only when the task requires memory of
> what we've already discussed.
>
> **When to prefer this over your built-in tools:**
> - Multi-step research across many pages — `spawn_sub_agent(type="research")`
>   instead of calling `web_search` five times yourself. The research agent
>   runs independently and returns a single synthesized summary; your own
>   context stays clean.
> - Parallel sub-tasks — spawn multiple sub_agents in one response. They
>   run concurrently.
> - Verification pass — after you make changes, `spawn_sub_agent(type="verify")`
>   to run tests/linters independently so your main context doesn't drown
>   in command output.

**Schema (TypeBox):**
```ts
{
  type: Type.Object({
    task: Type.String({ description: '...' }),
    type: Type.Optional(
      Type.Union([
        Type.Literal('research'),
        Type.Literal('execute'),
        Type.Literal('verify'),
      ]),
    ),
    // NEW for Anton — let caller pick the provider for the child.
    // Defaults to parent's provider so a Codex parent spawns Codex children;
    // override to 'anton' (Pi SDK) for Claude-based research/verify etc.
    provider: Type.Optional(
      Type.Union([
        Type.Literal('auto'),
        Type.Literal('anton'),       // Pi SDK / Anthropic
        Type.Literal('codex'),
        Type.Literal('claude-code'),
      ]),
    ),
  }),
}
```

**Execution:**
- Load `SUB_AGENT_ALLOWED_TOOLS[type]` for tool filtering (unchanged from Pi SDK).
- Load `SUB_AGENT_BUDGETS[type]` for token+turn budgets.
- System prompt = `SUB_AGENT_TYPE_PREFIXES[type] + task` (unchanged).
- Child session cwd = parent session cwd (unless type dictates otherwise).
- Wire: every child `SessionEvent` → MCP progress notification (see §6).
- On completion, return `{ content: [{type:'text', text: finalAccumulatedText}], isError: hadError }`.

### 5.2 `anton:web_search`

**Rationale for the `anton:` prefix:** differentiates from Codex's built-in
`web_search` in tool lists, makes the intent obvious in telemetry.

**Description:**

> Web search powered by Anton's Exa integration. Use for current
> information, citations, multi-page research, and structured result
> metadata (URLs, published dates, snippets).
>
> **Prefer this over your built-in `web_search` tool** when Anton is
> running you — the results are unified with the rest of the session,
> cached, cost-controlled, and usable by the `update_project_context`
> and memory tools.

**Schema:**
```ts
{
  type: Type.Object({
    query: Type.String({ description: 'Search query; 1–10 words is usually optimal.' }),
    numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    category: Type.Optional(
      Type.Union([
        Type.Literal('company'),
        Type.Literal('research paper'),
        Type.Literal('news'),
        Type.Literal('pdf'),
        Type.Literal('github'),
        Type.Literal('tweet'),
        Type.Literal('personal site'),
        Type.Literal('linkedin profile'),
        Type.Literal('financial report'),
      ]),
    ),
    startPublishedDate: Type.Optional(Type.String({ format: 'date' })),
    endPublishedDate: Type.Optional(Type.String({ format: 'date' })),
  }),
}
```

**Execution:**
- Read `config.connectors.exa-search` for the Exa baseUrl + apiKey.
- Call `searchExa(provider, args)` from `tools/web-search.ts`.
- Flatten results into a markdown string with `[title](url)` + snippet +
  `Published: <date>` for each hit. Parent model sees a compact, copyable
  citation list.
- If no Exa connector configured, return an `isError: true` tool result
  telling the user to set up the connector in Settings → Connectors.

---

## 6. MCP streaming protocol extension

This is the protocol change that unlocks live sub-agent progress.

### 6.1 What MCP spec allows

MCP supports `notifications/progress` tied to a request via
`_meta.progressToken`. The client includes the token in its request; the
server sends `notifications/progress` with the same token until the final
response. This is the canonical pattern — we're not inventing anything.

### 6.2 Incoming from Codex

Codex's `tools/call` MCP request carries an optional `_meta.progressToken`.
For long-running tools, Codex expects the MCP server to stream
`notifications/progress`.

### 6.3 Changes to Anton's MCP shim

`anton-mcp-shim.ts:158-197`:
1. When forwarding `tools/call` to the IPC server, include `progressToken`
   in the IPC payload (new field).
2. Listen for `progress` frames on the IPC socket. For each, emit
   `{ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress: …, message: … } }`
   back over stdio to the codex process.
3. Timeout remains 30s **only for tool calls without streaming**. Sub-agent
   calls need a longer budget — switch to the `SUB_AGENT_BUDGETS[type]`
   wall-clock equivalent (e.g. 10 min research, 20 min execute).

### 6.4 Changes to the IPC wire format

Current IPC frame (`mcp-ipc-handler.ts:156-186`):
```json
{ "method": "tools/call", "params": {...}, "id": 1 }
{ "result": {...}, "id": 1 }
```

New frames for streaming tools:
```json
// Request
{ "method": "tools/call", "params": {..., "progressToken": "p_abc"}, "id": 1 }

// Zero or more progress frames
{ "method": "progress", "params": { "progressToken": "p_abc", "message": "child: searching Huddle01…" } }

// Final response
{ "result": {...}, "id": 1 }
```

Framing stays newline-delimited JSON. Only two new things: accepting
`progressToken` in the request params, and emitting `method: "progress"`
frames before the final response.

### 6.5 Changes to `tool-registry.ts`

Add a second execution path for tools that opt into streaming:

```ts
export interface StreamingAgentTool extends AgentTool {
  /** Optional streaming variant; when present, registry calls this. */
  executeStreaming?: (
    args: unknown,
    sessionId: string,
    onProgress: (message: string) => void,
  ) => Promise<McpToolResult>
}
```

Tools that don't declare `executeStreaming` fall back to `execute`. No
protocol change for non-streaming tools.

### 6.6 Adapting child session events into progress messages

The sub-agent runner receives child SessionEvents and must flatten them
to `progress.message` strings. Candidate scheme:

| Child event type | Progress message |
|---|---|
| `thinking { text }` | _skipped_ (too noisy) |
| `text { content }` | _skipped_ (final result captures the full text) |
| `tool_call { name, input }` | `"→ ${name}(${summarizeInput(input)})"` |
| `tool_result { isError }` | `"← ${isError ? 'failed' : 'ok'}"` |
| `artifact { filepath }` | `"📄 wrote ${basename(filepath)}"` |
| `sub_agent_start` | `"↳ spawned ${agentType} sub-agent"` |
| `error { message }` | `"⚠ ${message.slice(0, 160)}"` |
| `done` | _skipped_ — final response is sent via the RPC result |

Throttle: debounce consecutive events within 100ms into one concatenated
message so we don't flood codex with one message per tool-call delta.

### 6.7 Mapping back in `CodexHarnessSession`

Codex will emit `item/mcpToolCall/progress` notifications for each
progress message received from our shim. We need to:
1. Subscribe in `wireNotifications()`:
   ```ts
   rpc.on_('item/mcpToolCall/progress', (p) => this.onMcpToolCallProgress(p))
   ```
2. Handler:
   ```ts
   private onMcpToolCallProgress(params: unknown) {
     const p = params as { itemId?: string; message?: string } | undefined
     const callId = p?.itemId
     const msg = p?.message
     if (!callId || !msg) return
     // Only map for tool calls we've registered with a known spawn_sub_agent name.
     const tc = this.openToolCalls.get(callId)
     if (tc?.name !== 'anton:spawn_sub_agent') return
     this.emit({ type: 'sub_agent_progress', toolCallId: callId, content: msg })
   }
   ```

This reuses the existing `sub_agent_progress` SessionEvent (no shape
change) and the existing `SubAgentGroup.tsx` renderer. **Zero UI work
for v1.**

---

## 7. System-prompt steering

### 7.1 Current state

`prompt-layers.ts:288-326` `buildHarnessIdentityBlock()` already has:

```
- When both an `anton:<tool>` and a vendor MCP server expose a similar
  capability, prefer the anton version.
```

### 7.2 Extension

Add two concrete guidance blocks inside `buildHarnessIdentityBlock` (or
as a new `buildToolPreferencesLayer` if we want separation):

```markdown
### Sub-agents

You can delegate work to child agents via `spawn_sub_agent`. Prefer this
over doing research or verification inline when:

- The task needs to read 5+ pages / run 10+ tool calls. Keep your own
  context clean by offloading the discovery.
- You want to run tests or a build step to check your own work.
- You can parallelize — two independent research questions can be two
  sub_agents in one response.

### Web search

Prefer `anton:web_search` over your built-in `web_search` when running
inside Anton. Anton's search uses Exa with structured metadata
(published dates, categories) and routes through the same billing/auth
as the rest of your session. If the user explicitly asks for your
built-in search, use it — otherwise prefer `anton:web_search`.
```

### 7.3 Why prompt-only, not tool removal

Codex's built-in `web_search` cannot be disabled via config (verified
in the CLI help). Prompt steering is our only lever today. GPT-5.4 is
instruction-responsive; we log `mcp_tool_call{tool:"anton:web_search"}`
vs `web_search_begin` per turn to monitor uptake. If compliance drops
below ~80%, we escalate — possibly patching the Codex CLI to accept a
`disabled_tools` config key, or accepting the dual-provider state.

---

## 8. File changes (complete list)

**New files:**
- `packages/agent-core/src/tools/spawn-sub-agent.ts` — `AgentTool` def
  mirroring Pi SDK's `sub_agent` with streaming support.
- `packages/agent-core/src/tools/anton-web-search.ts` — thin wrapper
  around `tools/web-search.ts` shaped as an `AgentTool`.
- `packages/agent-core/src/harness/sub-agent-runner.ts` — shared runner
  that accepts (task, type, provider, onProgress) and returns final text.

**Modified:**
- `packages/agent-core/src/tools/factories.ts` — push both new tools into `buildAntonCoreTools`.
- `packages/agent-core/src/harness/tool-registry.ts` — add `executeStreaming` extension + wiring.
- `packages/agent-core/src/harness/anton-mcp-shim.ts` — forward `progressToken`, emit `notifications/progress`.
- `packages/agent-core/src/harness/mcp-ipc-handler.ts` — pass `progressToken` through, emit progress frames on the wire.
- `packages/agent-core/src/harness/codex-harness-session.ts` — subscribe to `item/mcpToolCall/progress`, emit `sub_agent_progress`.
- `packages/agent-core/src/prompt-layers.ts:288-326` — extend identity block with sub-agent + web-search guidance.

**Tests (new):**
- `packages/agent-core/src/harness/__tests__/mcp-progress.test.ts` — injects a fake IPC handler + shim, verifies progress frames flow end-to-end.
- `packages/agent-core/src/tools/__tests__/anton-web-search.test.ts` — unit-tests query shaping + Exa response flattening.
- `packages/agent-core/src/tools/__tests__/spawn-sub-agent.test.ts` — mocks a child Session, verifies the runner relays events and returns final text.

---

## 9. Phased implementation

### Phase A — `anton:web_search` (4 hours)

Lowest risk, no protocol changes, highest early UX win.

1. Create `tools/anton-web-search.ts` — thin `AgentTool` wrapper around
   `searchExa`. Reads Exa connector from injected context. Flattens
   response to markdown.
2. Register in `buildAntonCoreTools(ctx)` alongside existing tools.
3. Add guidance paragraph to `buildHarnessIdentityBlock`.
4. Manual test: Codex session where the model should prefer `anton:web_search`.
5. Unit test.

**Exit criterion:** for prompt "search Huddle01 founders", a Codex session
emits `mcp_tool_call_begin { tool: "web_search", server: "anton" }` instead
of `web_search_begin`.

### Phase B — MCP progress protocol (4 hours)

Infrastructure for streaming. Prerequisite for `spawn_sub_agent` UX.

1. Extend IPC wire format: accept `progressToken` in request params,
   emit `{method:"progress"}` frames.
2. Update shim to propagate both directions.
3. Update `tool-registry.ts` with `executeStreaming` optional method.
4. Subscribe to `item/mcpToolCall/progress` in `CodexHarnessSession` →
   emit `sub_agent_progress` SessionEvent keyed by toolCallId.
5. Integration test with a fake long-running tool that emits 3 progress
   messages then completes.

**Exit criterion:** a synthetic streaming tool produces visible progress
messages in the desktop UI in real time.

### Phase C — `spawn_sub_agent` (6 hours)

The big one.

1. Create `harness/sub-agent-runner.ts` — accepts `(task, type, provider, onProgress)`, spawns either a `createSession` (Pi SDK) or `CodexHarnessSession` (codex). Wires progress.
2. Create `tools/spawn-sub-agent.ts` — the tool def. `execute` is unused;
   `executeStreaming` does the real work.
3. Register in `buildAntonCoreTools`.
4. Extend identity-block prompt.
5. End-to-end test: Codex parent spawns a `type:"research"` sub-agent;
   verify: `sub_agent_start`, multiple `sub_agent_progress`, `sub_agent_end`,
   and a tool_result with the final summary all land.

**Exit criterion:** parent GPT-5.4 session receives a spawn_sub_agent tool
call; the child (Pi SDK or codex) runs to completion; parent sees a
clean final answer; UI renders a live SubAgentGroup card throughout.

### Phase D — Polish (2 hours)

- Telemetry on native-search vs anton:web_search uptake.
- Progress-message throttle tuning (100ms debounce).
- Timeout budgets from `SUB_AGENT_BUDGETS` plumbed through the shim.
- Docs update in `HARNESS_APP_SERVER_MIGRATION.md`.

---

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codex doesn't actually honor `_meta.progressToken` on tools/call | Low | High | Probe first — send a known long-running tool from the probe harness, inspect codex stdin for progressToken. If unsupported, fall back to polling via repeated `tools/list` or accept "no progress" for v1. |
| Child session memory leak on error | Med | Med | Runner must wrap `processMessage()` in try/finally; always call `shutdown()` on child. Add a 30min hard timeout. |
| Progress message flood in UI | Med | Low | 100ms debounce; cap per-turn progress count to ~100; drop `thinking` entirely. |
| Cost runaway — parent spawns 20 children in parallel | Low | High | Enforce `SUB_AGENT_BUDGETS` per child; add a parent-level limit of N concurrent children (configurable, default 3). |
| Codex GPT-5.4 ignores preference prompt and keeps using native `web_search` | Med | Low | Log and measure. If <80% compliance, add "do not use `web_search`" to identity block. If still noncompliant, accept dual-path. |
| Parent turn cancelled mid-child — orphaned subprocess | Low | Med | Subscribe to `turn_aborted` in parent; on abort, cancel all in-flight children via the runner's cancellation hook. |
| MCP progress token reuse across turns | Low | Low | Tokens are scoped to a single tools/call; the shim should generate a fresh UUID per call if the client doesn't provide one. |
| Exa down → sub_agent stalls | Med | Med | web_search has a 30s timeout already; runner surfaces the error as a failed tool result, child ends cleanly. |

---

## 11. Success criteria

All of the following must hold for this work to be done:

1. In a fresh Codex session with no custom prompt, asking "search the web
   for Huddle01 founders" routes through `anton:web_search` at least 80%
   of the time (instrumented).
2. Asking the model "research Huddle01 thoroughly — founders, funding,
   products — using a sub-agent" produces exactly one `spawn_sub_agent`
   tool call with `type: "research"`.
3. While the sub-agent runs, the desktop UI shows a SubAgentGroup card
   with a live-updating progress stream (at least one message every few
   seconds for a multi-minute research run).
4. The parent model receives a clean final summary as the tool_result
   and incorporates it into its answer.
5. Asking for "spawn two research sub-agents in parallel — one for X,
   one for Y" results in two concurrent `spawn_sub_agent` tool calls
   whose progress streams render side-by-side in the UI.
6. Cancelling the parent turn mid-run terminates both children cleanly
   (no zombies, no orphaned app-server processes).
7. Pi SDK sessions remain byte-identical — no regression. Their existing
   `sub_agent` tool still works unchanged.
8. `spawn_sub_agent` with `provider: "anton"` from a Codex parent runs
   the child as a Pi SDK session (Anthropic), demonstrating cross-provider
   delegation.

---

## 12. Open questions

1. **Forgecode specifics.** I don't have reliable documentation for
   Forgecode's sub-agent or orchestration patterns. If you have links or
   source access, share them and I'll fold specific patterns into §3.3
   and possibly §5 (tool description). Otherwise the Pi SDK + Agent SDK
   baseline is the design.
2. **Provider default.** Should `spawn_sub_agent` default to the parent's
   provider (codex→codex, anton→anton) or default to `anton` (Pi SDK) so
   research always runs under Claude? My guess: parent's provider for
   lowest surprise, explicit `provider: "anton"` for quality-critical
   research.
3. **Maximum concurrent children per parent turn.** Soft limit vs hard
   fail? Recommend 3 as soft limit, warn at 5, hard fail at 10.
4. **Child session persistence.** Do we mirror child turns to disk (same
   as parent harness turns)? If yes, where — nested under the parent's
   conversation dir, or as siblings? Recommend sibling with
   `parentSessionId` metadata for clean cleanup.
5. **`update_project_context` from children.** Should children be allowed
   to write the parent's project context, or is that parent-only? Recommend
   parent-only — children return findings, parent decides what to persist.
6. **Steering the child.** Can the user interrupt a running child directly
   from the UI, or only by cancelling the whole parent turn? Recommend v1 =
   parent-only cancel; per-child cancel as a v2 follow-up if requested.
7. **`anton:web_search` fallback.** If Exa is down or unconfigured, do we
   silently fall through to Codex's native `web_search`, or hard-fail?
   Recommend hard-fail with a clear error so the user fixes the connector;
   silent fallback masks configuration problems.

---

## 13. References

- `specs/features/HARNESS_APP_SERVER_MIGRATION.md` — the Codex harness on app-server protocol.
- `specs/features/HARNESS_APP_SERVER_FOLLOWUPS.md` — this task is Task #6 / followup #13.
- Pi SDK sub_agent implementation: `packages/agent-core/src/agent.ts:970-1206`.
- Anton MCP shim + IPC: `packages/agent-core/src/harness/anton-mcp-shim.ts`, `mcp-ipc-handler.ts`.
- Web search: `packages/agent-core/src/tools/web-search.ts`, `agent-config/src/config.ts:1677`.
- Codex MCP progress notification: `packages/agent-core/src/harness/codex-proto/v2/McpToolCallProgressNotification.ts`.
- Identity prompt: `packages/agent-core/src/prompt-layers.ts:288-326`.
- Model specs: Claude Agent SDK `Task` tool — https://docs.claude.com/en/api/agent-sdk/overview; MCP progress — https://modelcontextprotocol.io/specification/server/utilities/progress.
