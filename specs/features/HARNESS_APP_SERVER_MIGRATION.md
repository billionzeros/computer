# Harness Migration to `codex app-server`

Status: **Proposed** — validated by live probe (`codex-cli 0.107.0`, 2026-04-19).
Owner: Harness / Agent-Core.
Supersedes: the `codex exec --json` subset of `specs/features/HARNESS_ARCHITECTURE.md`.
Scope: replaces the Codex harness backend only. **Pi SDK path is untouched.**

---

## 1. Goal

Give harness-backed conversations (Codex / GPT-5.4) the same quality of experience Pi SDK conversations already have:

- **Token-by-token streaming** of assistant text and reasoning.
- **Real tool call visibility** — web searches, shell commands, MCP tool calls all surface as they execute, not in a post-hoc blob.
- **First-class sub-agents** — when Codex spawns a collaborator agent, it renders as a live `SubAgentGroup` card with its prompt and trace.
- **Real steering** — user messages mid-turn actually interrupt the model and inject context.
- **File-system coherence** — Codex edits files in the same project workspace the user sees in `ProjectFilesView` and that Pi SDK sessions use. Artifacts emit.
- **Unchanged surface area** — everything above the `HarnessSession` interface continues to work as-is.

Non-goals:
- Replacing Pi SDK.
- Changing how Anton projects or sessions are modeled.
- Adding new event types to the Pi SDK `SessionEvent` union (we map INTO it, not past it).

---

## 2. Context (Current State)

Anton runs two agent tracks behind one `SessionEvent` stream:

```
                    ┌─────────────────────────────────────────┐
                    │              Anton Server               │
                    │   (packages/agent-server/src/server.ts) │
                    └──────────────┬──────────────────────────┘
                                   │  SessionEvent stream
                ┌──────────────────┼──────────────────┐
                ▼                                     ▼
        ┌───────────────┐                   ┌──────────────────┐
        │  Pi SDK path  │                   │   Harness path   │
        │  Session      │                   │  HarnessSession  │
        │  (session.ts) │                   │ (harness-…ts)    │
        └───────┬───────┘                   └─────────┬────────┘
                │                                     │
                │ direct Anthropic API calls          │ spawns `codex exec --json`
                │ + Pi tools (write/read/shell/…)     │ parses JSONL items
                │                                     │
                ▼                                     ▼
       Streaming text + thinking +            Post-hoc item events;
       tool_call + tool_result +              no deltas, dropped web_search,
       sub_agent events + artifacts           no sub-agents, no steer
```

The harness path's deficits (enumerated in `.context/harness-app-server-design.md`):
- No text deltas (one `agent_message` blob per turn).
- No reasoning deltas.
- `web_search` items dropped — `toolCallCount: 0` in server logs despite 10+ searches.
- `sub_agent_*` events not emitted at all.
- Steer is a silent no-op (`server.ts:4164-4176` skips harness sessions).
- Each turn respawns the CLI, closing stdin — no mid-turn channel.

---

## 3. Target Architecture

### 3.1 Two tracks, one protocol, one filesystem

```
                    ┌─────────────────────────────────────────┐
                    │              Anton Server               │
                    └──────────────┬──────────────────────────┘
                                   │  SessionEvent stream
                ┌──────────────────┼──────────────────┐
                ▼                                     ▼
        ┌───────────────┐                   ┌──────────────────┐
        │  Pi SDK path  │                   │ Harness path (NEW) │
        │  Session      │                   │  HarnessSession  │
        │               │                   │   • persistent   │
        │               │                   │     codex app-   │
        │               │                   │     server pid   │
        │               │                   │   • JSON-RPC     │
        │               │                   │   • v2 notif.    │
        └───────┬───────┘                   └─────────┬────────┘
                │                                     │
                └────────────┬───────────┬────────────┘
                             │           │
                             ▼           ▼
                  ┌──────────────────────────────────────────────┐
                  │   Shared substrate                           │
                  │   • project.workspacePath = session cwd      │
                  │   • Anton MCP shim (anton-mcp-shim.ts) +     │
                  │     IPC handler (mcp-ipc-handler.ts) +       │
                  │     tool registry (tool-registry.ts)         │
                  │   • Forbidden-path checks (security.ts)      │
                  │   • ProjectFilesView (RPC polling)           │
                  │   • SessionEvent → UI rendering pipeline     │
                  └──────────────────────────────────────────────┘
```

Everything in the "shared substrate" is unchanged. The only new code lives in the harness dir plus a thin guard-removal on the server.

### 3.2 HarnessSession internal structure

```
┌────────────────────────── HarnessSession ──────────────────────────┐
│                                                                    │
│   spawn(codex app-server --listen stdio://)   ← one process/session│
│                                                                    │
│   ┌──────────────┐     stdin (JSON-RPC requests)      ┌──────────┐ │
│   │              │ ────────────────────────────────▶  │          │ │
│   │  Node side   │                                    │  codex   │ │
│   │  RPC client  │ ◀──────────────────────────────── │  proc.   │ │
│   │              │     stdout (newline-delim          │          │ │
│   │              │             responses + notifs)    │          │ │
│   └──────┬───────┘                                    └──────────┘ │
│          │                                                         │
│          │ notifications                                           │
│          ▼                                                         │
│   ┌─────────────────────────┐                                      │
│   │  Codex adapter          │                                      │
│   │  (adapters/codex.ts)    │ ─── emits ───▶ SessionEvent stream   │
│   └─────────────────────────┘                                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Lifetime: **one app-server subprocess per HarnessSession**, **one conversation per subprocess**. Multiplexing is possible protocol-wise but adds no value for v1.

---

## 4. Data Flow

### 4.1 Session creation

```
User creates conversation in project P
  │
  ▼
AntonServer resolves project.workspacePath  ← e.g. /Users/omg/Anton/linkedin-scraper
  │
  ▼
new HarnessSession({ cwd: project.workspacePath, model: "gpt-5.4", ... })
  │
  ▼
spawn("codex", ["app-server", "--listen", "stdio://"], { cwd, env: {RUST_LOG:"error"}})
  │
  ▼
send: initialize { clientInfo: { name:"anton", version } }
recv: { result: { userAgent } }                ← logged for version compat check
  │
  ▼
send: newConversation {
  cwd: project.workspacePath,
  approvalPolicy: "never",
  sandbox: "workspace-write",
  config: {
    model_reasoning_summary: "detailed",       ← enables reasoning_delta stream
    mcp_servers: {
      anton: {
        command: "node",
        args: [shimPath],
        env: { ANTON_SOCK, ANTON_SESSION, ANTON_AUTH }  ← same wiring as today
      }
    }
  },
  developerInstructions: buildCodexInstructions()      ← Anton system prompt
}
recv: { result: { conversationId, model, reasoningEffort, rolloutPath } }
  │
  ▼
send: addConversationListener { conversationId }
recv: { result: { subscriptionId } }
  │
  ▼
Ready. Session transitions to "idle", waiting for user turn.
```

### 4.2 User turn → streaming response

```
User hits enter on "Search huddle01 founders"
  │
  ▼
HarnessSession.send(text)
  │
  ▼
send: sendUserTurn {
  conversationId,
  items: [{ type:"text", data:{ text, text_elements:[] } }],
  cwd, approvalPolicy:"never",
  sandboxPolicy: {
    type:"workspace-write",
    network_access: true,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false
  },
  model: "gpt-5.4",
  effort: "low",
  summary: "detailed"
}
  │                                      (returns ack {result:{}})
  │
  ▼  Notifications begin streaming
  │
  │  turn/started                        ────▶  (internal: reset stream buffer)
  │  item/started  UserMessage           ────▶  (internal)
  │  item/completed UserMessage          ────▶  (internal)
  │  item/started Reasoning              ────▶  (internal: open thinking block)
  │  item/reasoning/textDelta "I'll…"    ────▶  SessionEvent{ type:"thinking",
  │  item/reasoning/textDelta " search"                         delta:"I'll" }
  │  …                                            etc — streams live
  │  item/completed Reasoning            ────▶  (close thinking block)
  │  item/started AgentMessage phase=    ────▶  (open commentary block)
  │     "commentary"
  │  item/agentMessage/delta "Searching"  ────▶ SessionEvent{ type:"text",
  │  item/agentMessage/delta " for"                           delta:"Searching",
  │                                                           phase:"commentary"}
  │  item/completed AgentMessage         ────▶  (close commentary block)
  │  item/started WebSearch              ────▶  SessionEvent{ type:"tool_call",
  │                                                           toolName:"web_search",
  │                                                           toolCallId: call_id,
  │                                                           args:{query:""}}
  │  web_search_begin                    ────▶  (update tool_call with call_id)
  │  web_search_end { query, queries }   ────▶  SessionEvent{ type:"tool_result",
  │                                                           toolCallId,
  │                                                           output: {queries,
  │                                                                    action}}
  │  item/completed WebSearch            ────▶  (no-op; already emitted)
  │  item/started Reasoning              ────▶  (open thinking block)
  │  item/reasoning/textDelta …          ────▶  more thinking deltas
  │  item/completed Reasoning            ────▶  (close)
  │  item/started AgentMessage phase=    ────▶  (open final answer block)
  │     "final_answer"
  │  item/agentMessage/delta (×56)       ────▶  56× SessionEvent{text,delta,
  │                                                             phase:"final_answer"}
  │  item/completed AgentMessage         ────▶  (close; emit full-text sanity)
  │  thread/tokenUsage/updated           ────▶  SessionEvent{ type:"token_update",
  │                                                           tokens:{…}}
  │  turn/completed { last_agent_message} ────▶ SessionEvent{ type:"done" }
  ▼
Session returns to "idle".
```

### 4.3 Tool call flow (three classes)

**Class A — Codex native tools** (`web_search`, `exec_command`, `patch_apply`, `view_image`):

```
item/started <ToolType>  ──▶ emit SessionEvent tool_call
<tool>_begin             ──▶ update with call_id
(optional)
  exec_command_output_delta ──▶ progress update on tool_call
<tool>_end               ──▶ emit SessionEvent tool_result
item/completed <ToolType>──▶ no-op
```

**Class B — Anton MCP tools via shim** (Anton-native `spawn_sub_agent`, `anton:web_search`, memory, browser, etc.):

```
mcp_tool_call_begin      ──▶ emit SessionEvent tool_call
                             toolName = "anton:<name>"
(tool runs in Anton server via IPC; may emit sub-events)
mcp_tool_call_end        ──▶ emit SessionEvent tool_result
```

**Class C — Collaborative sub-agents** (Codex native `collab_*` events):

```
collab_agent_spawn_begin { call_id, sender_thread_id, prompt }
                         ──▶ emit SessionEvent sub_agent_start
                             { toolCallId:call_id, task:prompt, agentType:"codex"}
collab_agent_interaction_begin { call_id, prompt }
                         ──▶ emit SessionEvent sub_agent_progress
                             { parentToolCallId:call_id, content:prompt }
(sub-agent events stream with different thread_id in the notifications;
 adapter routes them by sender/receiver thread_id)
collab_agent_interaction_end   { status, prompt }
                         ──▶ emit SessionEvent sub_agent_progress
                             { content: last_response }
collab_agent_spawn_end         { status }
                         ──▶ emit SessionEvent sub_agent_end
                             { toolCallId:call_id, success: status === "ok" }
```

Result: sub-agents render via the existing `SubAgentGroup.tsx` with zero UI changes.

### 4.4 Reasoning / thought process

The Pi SDK `thinking` event union accepts deltas. Codex app-server emits reasoning in three complementary streams; we fold them into one UI block per Reasoning item:

| Codex notification | Consumed as |
|---|---|
| `item/started` with `item.type==="Reasoning"` | open thinking block (scoped to `item.id`) |
| `item/reasoning/textDelta` | append `delta` as `thinking` event with matching blockId |
| `item/reasoning/summaryTextDelta` | same, but flagged as summary stream |
| `item/reasoning/summaryPartAdded` | marker — used for "new sub-thought" visual break |
| `item/completed` for the Reasoning | close the block |

Cost control: `model_reasoning_summary="detailed"` in `NewConversationParams.config` — set once, toggle from user preferences later if noisy.

### 4.5 File system integration

Anton's model is simple: **one project = one directory at `project.workspacePath`**. Codex joins that model without additional plumbing because the protocol makes cwd explicit.

```
Project P
├── workspacePath = /Users/omg/Anton/linkedin-scraper
│
├── .anton.json                       ← project link file (hidden in UI)
├── src/
├── README.md
└── …

HarnessSession for P:
   spawn("codex app-server", { cwd: "/Users/omg/Anton/linkedin-scraper" })
      ↓
   NewConversationParams.cwd        = "/Users/omg/Anton/linkedin-scraper"
   SendUserTurnParams.cwd           = "/Users/omg/Anton/linkedin-scraper"
   SendUserTurnParams.sandboxPolicy = { type:"workspace-write",
                                        network_access: true,
                                        exclude_tmpdir_env_var: false,
                                        exclude_slash_tmp: false }
```

Consequences:
- Codex's `workspace-write` sandbox confines file writes to `cwd` + `$TMPDIR` + `/tmp`. It will **not** write outside the project. Codex enforces this itself — no extra check needed.
- Codex's `exec_command` runs with that cwd — `pwd` in a shell tool == project root.
- Pi SDK forbidden-path checks (`security.ts:106-132`) already apply globally; Codex running inside the workspace does not bypass them for anything Pi-SDK-owned (SSH keys, credentials, etc.) because **Pi SDK forbidden paths don't gate Codex writes**.

Closing that gap: **extend `sandboxPolicy.workspace-write` with a deny-roots enforcement at the Anton layer.** After each `patch_apply_begin` or `exec_command_begin`, the adapter inspects the target paths against `config.security.forbiddenPaths` and, if a violation is detected, sends `interruptConversation` + an error reply. For v1, this is an audit-only warning in logs; full enforcement comes in a follow-up once we measure false-positive rate.

### 4.6 File changes → artifacts

Today, Pi SDK emits `artifact` events when the `write` tool completes (session.ts:1659-1695). Codex has a direct equivalent:

```
patch_apply_begin { fileChanges, auto_approved }   ← pre-write intent
patch_apply_end   { fileChanges, success }         ← post-write with final state
```

Mapping:

```
patch_apply_end ──▶ for each FileChange c in c.fileChanges:
                      emit SessionEvent {
                        type: "artifact",
                        artifactType: "file",
                        filepath: c.path,
                        filename: basename(c.path),
                        content: readFileSync(c.path),    ← source of truth
                        language: inferFromExtension(c.path),
                        renderType: inferRender(extension)
                      }
```

The UI already handles artifact events. `ProjectFilesView` picks up new files on its next RPC poll (or we can hint an immediate refetch on artifact).

### 4.7 Steer (interrupt + inject)

```
User sends message while turn is in flight:
  │
  ▼
HarnessSession.steer(text)
  │
  ▼
send: interruptConversation { conversationId }
recv: { result } (or notif turn_aborted → we treat as interrupt ack)
  │
  ▼
send: sendUserMessage {
  conversationId,
  items: [{ type:"text", data:{ text, text_elements:[] } }]
}
  │
  ▼
A new turn begins. Codex sees the new message appended after the aborted turn's
partial assistant output. GPT-5.4 adapts its plan to include the new input.
```

Server-side, remove the `!isHarnessSession(session)` guard at `server.ts:4164-4176`. Harness `steer()` becomes a real method.

---

## 5. Event Mapping Reference

The canonical table. Everything Codex emits that we care about, and the Pi SDK SessionEvent it becomes.

| App-server notification | EventMsg type | Pi SDK SessionEvent | Payload shape |
|---|---|---|---|
| `item/started` Reasoning | — | (open block for item.id) | — |
| `item/reasoning/textDelta` | — | `thinking` | `{ delta, blockId: item.id, kind: "raw" }` |
| `item/reasoning/summaryTextDelta` | — | `thinking` | `{ delta, blockId: item.id, kind: "summary" }` |
| `item/completed` Reasoning | — | (close block) | — |
| `item/started` AgentMessage phase="commentary" | — | (open text block; tag as commentary) | — |
| `item/started` AgentMessage phase="final_answer" | — | (open text block; tag as final) | — |
| `item/agentMessage/delta` | `agent_message_delta` | `text` | `{ delta, phase, blockId: item.id }` |
| `item/completed` AgentMessage | `agent_message` | (close block; optional full-text sanity) | — |
| `item/started` WebSearch | — | `tool_call` | `{ toolCallId: item.id, toolName: "web_search", args: {} }` |
| `codex/event/web_search_begin` | `web_search_begin` | (annotate existing tool_call with call_id) | — |
| `codex/event/web_search_end` | `web_search_end` | `tool_result` | `{ toolCallId, output: { query, queries, action } }` |
| `item/started` CommandExecution | — | `tool_call` | `{ toolCallId: item.id, toolName: "shell", args: { cmd, cwd } }` |
| `item/commandExecution/outputDelta` | `exec_command_output_delta` | progress update | partial stdout/stderr |
| `codex/event/exec_command_end` | `exec_command_end` | `tool_result` | `{ toolCallId, exitCode, stdout, stderr }` |
| `codex/event/mcp_tool_call_begin` | `mcp_tool_call_begin` | `tool_call` | `{ toolCallId: call_id, toolName: server_name + ":" + tool_name, args }` |
| `codex/event/mcp_tool_call_end` | `mcp_tool_call_end` | `tool_result` | `{ toolCallId, output }` |
| `codex/event/patch_apply_begin` | `patch_apply_begin` | (internal: pre-write intent) | — |
| `codex/event/patch_apply_end` | `patch_apply_end` | one `artifact` per changed file | see §4.6 |
| `codex/event/collab_agent_spawn_begin` | `collab_agent_spawn_begin` | `sub_agent_start` | `{ toolCallId:call_id, task:prompt, agentType:"codex" }` |
| `codex/event/collab_agent_interaction_begin` | `collab_agent_interaction_begin` | `sub_agent_progress` | `{ parentToolCallId:call_id, content:prompt }` |
| `codex/event/collab_agent_interaction_end` | `collab_agent_interaction_end` | `sub_agent_progress` | `{ parentToolCallId, content: response }` |
| `codex/event/collab_agent_spawn_end` | `collab_agent_spawn_end` | `sub_agent_end` | `{ toolCallId:call_id, success }` |
| `item/plan/delta` | `plan_delta` | `tasks_update` | `{ tasks: PlanItem[] }` |
| `thread/name/updated` | `thread_name_updated` | `title_update` | `{ title }` |
| `thread/tokenUsage/updated` | — (v2 only) | `token_update` | `{ tokens, mid_turn: true }` |
| `codex/event/token_count` | `token_count` | `token_update` | `{ tokens, mid_turn: false }` |
| `codex/event/context_compacted` | `context_compacted` | `compaction` | — |
| `codex/event/apply_patch_approval_request` | `apply_patch_approval_request` | `confirm` | (no-op when approvalPolicy="never") |
| `codex/event/exec_approval_request` | `exec_approval_request` | `confirm` | (no-op) |
| `turn/started` | `task_started` | (internal: reset stream buffer) | — |
| `turn/completed` | `task_complete` | `done` | `{ last_agent_message, tokens }` |
| `codex/event/error` | `error` | `error` | |
| `codex/event/stream_error` | `stream_error` | `error` | |
| `codex/event/turn_aborted` | `turn_aborted` | `error` type="aborted" | on steer |

Strategy: **prefer v2 notifications** (`item/*`, `turn/*`, `thread/*`) where they exist; fall back to `codex/event/*` otherwise. Both are emitted in parallel — a single dispatch table keyed by notification method handles it cleanly.

---

## 6. File Changes

### 6.1 Files rewritten

| Path | Action |
|---|---|
| `packages/agent-core/src/harness/harness-session.ts` | Full rewrite. Persistent subprocess, JSON-RPC client, lifecycle hooks. |
| `packages/agent-core/src/harness/adapters/codex.ts` | Rewrite. Consumes app-server notifications; emits Pi SDK SessionEvents. |
| `packages/agent-core/src/harness/codex-events.ts` | Replaced by the vendored bindings in `codex-proto/`. Delete. |

### 6.2 New files

| Path | Purpose |
|---|---|
| `packages/agent-core/src/harness/codex-proto/` | Vendored TypeScript bindings from `codex app-server generate-ts`. One-file index plus leaf types we consume. |
| `packages/agent-core/src/harness/codex-rpc.ts` | Thin JSON-RPC 2.0 client over a child_process stdio pair. Request/response + notification dispatch. |
| `scripts/regen-codex-proto.sh` | One-liner that re-runs `codex app-server generate-ts --out packages/agent-core/src/harness/codex-proto` and commits the diff. Run on CLI version bump. |

### 6.3 Minimal edits

| Path | Change |
|---|---|
| `packages/agent-server/src/server.ts:4164-4176` | Remove `!isHarnessSession(session)` guard on steer; route to `session.steer(text)`. |
| `packages/agent-core/src/harness/HARNESS_ARCHITECTURE.md` | Update the "Codex" subsection to reference this migration doc and the new protocol. |

### 6.4 Untouched (for clarity)

- `session.ts` (Pi SDK) — entire file and turn loop.
- `agent.ts` — all tools including `sub_agent`.
- `anton-mcp-shim.ts` — the shim binary stays identical; only how we invoke it changes (config param instead of `-c` flag).
- `mcp-ipc-handler.ts` — unchanged.
- `tool-registry.ts` — unchanged for v1; extended in Phase 2 to register `spawn_sub_agent` / `anton:web_search` for MCP exposure.
- UI — no component changes. All events already map to existing renderers (`TextStreamBuffer`, `ThinkingBlock`, `ToolCallBlock`, `SubAgentGroup`, `ProjectFilesView`).

---

## 7. Phased Implementation

### Phase 0 — Groundwork (½ day)

1. Vendor bindings: `scripts/regen-codex-proto.sh` + first run, commit output.
2. Pin CLI version in a new `packages/agent-core/src/harness/codex-version.ts` with a supported-range check. Warn if user has a CLI outside the tested range.
3. Reusable probe stays at `.context/codex-probe/`.

### Phase 1 — RPC client + session skeleton (1 day)

1. Write `codex-rpc.ts`: spawn, read stdout line-by-line, match responses by id, dispatch notifications via a registered handler map.
2. Rewrite `harness-session.ts` to use it. Implement `start()`, `close()`, `send()` with a pending-turn flag.
3. Smoke test: same prompt as probe ("Search huddle01 founders") — verify we see conversationId, subscriptionId, and turn notifications logged.

### Phase 2 — Adapter (1 day)

1. Rewrite `adapters/codex.ts` with the mapping from §5.
2. Implement per-item block tracking (reasoning block, agent message block by phase, tool call by id).
3. Unit tests: feed captured notification streams from the probe log, assert expected SessionEvents emitted in order.

### Phase 3 — Steer (½ day)

1. Implement `HarnessSession.steer(text)` = `interruptConversation` + `sendUserMessage`.
2. Remove the `isHarnessSession` guard at `server.ts:4164-4176`.
3. Manual test: send a message mid-turn, observe the model adapting.

### Phase 4 — File system & artifacts (½ day)

1. Wire `patch_apply_end` → one `artifact` event per changed file. Read content from disk, not from the event (source of truth).
2. Verify `ProjectFilesView` picks up new files.
3. Emit a lightweight UI hint event to trigger immediate dir re-list (optional; poll interval might be fine).

### Phase 5 — Sub-agents (½ day)

1. Wire `collab_agent_*` events → `sub_agent_*` SessionEvents.
2. Verify `SubAgentGroup.tsx` renders without changes.
3. Test with a prompt that induces Codex to spawn a collaborator.

### Phase 6 — MCP surface (2 days, separate)

Not part of this migration; scheduled after v1 is stable.

1. Register `spawn_sub_agent` in the Anton tool registry exposed through the MCP shim. Handler spawns a child `HarnessSession` (or Pi Session) and streams its events back as MCP progress notifications.
2. Register `anton:web_search` (Exa-backed) through the same shim.
3. Update `buildCodexInstructions()` to tell GPT-5.4 when to prefer Anton tools over Codex native tools.

### Phase 7 — Compat & hardening (ongoing)

1. Audit-only forbidden-path checks on `patch_apply_*` and `exec_command_*` events.
2. Crash recovery: if app-server dies mid-turn, emit `error` and tear session down cleanly.
3. Version-compat tests in CI against supported CLI version range.

**Total to reach "streaming Codex UI parity with Pi SDK":** ≈ 3.5 engineer-days (Phases 0–5). Phase 6 adds another 2 after.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `codex app-server` marked experimental; breaking protocol change in CLI bump | Med | High | Pin CLI version; vendor schema; version-check at session start; regen script in CI |
| Persistent subprocess leaks / zombies | Med | Med | `close()` always ends stdin + `kill(SIGTERM)`; parent server already owns HarnessSession lifecycle |
| Stdin backpressure on large system prompts | Low | Low | Use `stream.write()` + `once('drain')`; prompts are bounded |
| Duplicate events from v1+v2 dual stream | Med | Low | Single dispatch table; v1 handlers skip what v2 already produced |
| Forbidden path bypass via Codex shell | Med | High | Audit-only now; enforcement in Phase 7; Codex's own `workspace-write` already confines to cwd |
| Steer race — user message arrives between `interruptConversation` ack and `sendUserMessage` | Low | Low | Serialize both calls; queue user-side; no-op if session is mid-shutdown |
| Large reasoning_delta volume in context | Low | Med | `summary="detailed"` gives compact summaries; switch to `"concise"` if noisy |

---

## 9. Success Criteria

This migration is done when all of the following are true on a freshly-created project with a Codex session:

1. Typing "Search huddle01 founders" produces visible text within 2 seconds, with text streaming char-by-char, not as a single blob.
2. Web search queries appear in the UI with all queried URLs visible as chips, as they execute.
3. Reasoning blocks appear live, showing the model's plan unfolding.
4. Typing a second message mid-turn interrupts the first turn and incorporates the new context.
5. Asking Codex to write a file creates the file in `project.workspacePath`, a `ProjectFilesView` refresh shows it, and an `artifact` card appears in the chat.
6. Asking Codex to "research X and Y in parallel" triggers `collab_agent_*` events that render as two side-by-side SubAgentGroup cards in the UI.
7. Closing the conversation cleanly terminates the `codex app-server` subprocess (verified with `ps`).
8. Pi SDK conversations on the same Anton instance continue to work identically.

---

## 10. Open Questions

1. **Do we want the MCP shim config passed via `-c` flag or `NewConversationParams.config`?** Both work. `config` field is per-conversation and cleaner; `-c` is process-global. Recommend `config` for isolation.
2. **Should we reuse one app-server subprocess for a whole Anton window (multiple conversations) or one per session?** One-per-session is simpler, matches current model, easier teardown. Revisit if spawn cost becomes measurable.
3. **Reasoning summary mode — `"detailed"` or `"concise"` as default?** `"detailed"` for now (matches probe); add user setting once we see UX volume.
4. **Artifact content source** — re-read from disk (source of truth, handles post-write modifications) vs use the event's embedded diff (faster, but can lie)? Disk read by default; event-based for v2.
5. **Version compat strategy** — do we ship codex CLI with Anton (vendored binary) or require the user to install it? Currently it's vendored (`Library/Application Support/com.conductor.app/bin/codex`). Continue vendoring to control version.

---

## 11. References

- Live probe: `.context/codex-probe/probe.mjs` + `stream.log` (2026-04-19)
- Short design notes: `.context/harness-app-server-design.md`
- Generated protocol bindings: `/tmp/codex-proto/` (to be vendored by Phase 0)
- Existing harness architecture: `specs/features/HARNESS_ARCHITECTURE.md`
- Pi SDK SessionEvent definitions: `packages/agent-core/src/session.ts:209-263`
- Anton project model: `packages/protocol/src/projects.ts:22-41`, `packages/agent-config/src/projects.ts:114-192`
- Project workspace path flow: `packages/desktop/src/components/files/ProjectFilesView.tsx:132-146`
