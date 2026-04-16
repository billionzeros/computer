# Harness Architecture — Anton + External CLI

> **Status:** authoritative design for how Anton integrates with external coding CLIs (Codex, Claude Code, Gemini).
> **Supersedes:** context-flow and session-management sections of [BYOS_HARNESS_PROVIDERS.md](./BYOS_HARNESS_PROVIDERS.md). That doc remains valid for the *why* (subscription reuse, product positioning) and for the original decision log. This doc is the current architectural source of truth.
> **Relationship to Pi SDK:** Pi SDK is still a first-class execution backend. The harness path is a peer, not a replacement. Both must offer identical end-user capabilities.

## Problem

We added Codex and Claude Code as harness providers, but the integration is shallow:

- The CLI gets a flat string system prompt with project name / cwd / date. Nothing else.
- Only 5 tools reach the CLI via the MCP shim (`memory_save/recall/list`, `notify`, `database_query`). Connectors, workflows, sub-agents, scheduling — none of it is exposed.
- `systemPrompt` is frozen at `HarnessSession` construction. Per-turn context assembly (memory lookup, workflow catalog, cross-conversation memory) — which Pi SDK does via `loadConversationContext()` — does not happen.
- Conversation history lives only inside the CLI's own session tape (via `--resume`). Anton has no mirror. Provider switching is impossible without data loss. Export/audit/search of harness conversations doesn't work.
- IPC socket has no authentication. Any local process can impersonate a session.

Net effect: using the harness path today loses most of what makes Anton Anton.

## Design Principle

**Anton orchestrates, CLI executes, Shim bridges.** These are three layers with distinct ownership, not a question of "who drives whom."

```
┌─────────────────────────────────────────────────────────────┐
│  ANTON  — orchestrator + truth                              │
│  owns: conversation record, memory, projects, workflows,    │
│         connectors, scheduling, surface routing             │
│  decides: what context each turn carries, when to send      │
│  mirrors: every CLI output into its own store               │
└────────────────┬────────────────────────────────────────────┘
                 │  per-turn system prompt delta + user msg
                 │  (--resume <cliSid> when continuing)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  CLI  — execution runtime (Codex / Claude Code / Gemini)    │
│  owns: tool loop, filesystem edits, code reasoning,         │
│         short-term state, compaction, its own resume tape   │
│  acts as: hot cache for conversation state within a session │
└────────────────┬────────────────────────────────────────────┘
                 │  MCP tools/call over stdio
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  SHIM  — MCP bridge (anton-mcp-shim.ts, ~180 LOC)           │
│  transport: stdio ↔ Unix domain socket (no TCP, no port)    │
│  relays: tools/list & tools/call to Anton's tool registry   │
│  auth: per-session token in ANTON_AUTH env                  │
└─────────────────────────────────────────────────────────────┘
```

## Ownership Matrix

| Concern | Owner | Rationale |
|---|---|---|
| Conversation history (source of truth) | **Anton** | Provider-portable, searchable, exportable, auditable. CLI's tape can be lost. |
| Short-term execution state within a conversation | **CLI** (`--resume`) | Free compaction, warm prompt cache, native tool-approval memory. Don't fight it. |
| Long-term / cross-conversation memory | **Anton** | Outlives any single CLI session. Reachable from CLI via MCP `memory_*`. |
| Project context, instructions, summary | **Anton** | Anton-level concept. Injected per-turn via system prompt. |
| Workflow catalog & execution | **Anton → MCP → CLI** | Anton's unique capability. CLI discovers via `workflow_list`, runs via `workflow_run`. |
| Connector tools (Slack, GitHub, Linear, …) | **Anton → MCP → CLI** | One tool per connector, registered dynamically. |
| Sub-agents, scheduling, publish, notify | **Anton → MCP → CLI** | Exposed identically to Pi SDK. |
| Filesystem / shell / code edits | **CLI** | What the CLI is *for*. Don't reimplement. |
| Surface awareness (Slack/Telegram formatting) | **Anton** | Injected as system-prompt hint. |
| MCP transport | **Shim** | Stdio both sides; socket is Unix-domain only. |

## Session Lifecycle

### Turn flow (steady state, same provider)

1. User message arrives at Anton server
2. Anton loads: conversation history summary, keyword-matched memories, project context, workflow catalog
3. Anton assembles **per-turn context delta** — only what changed since the last turn (plus a stable base on turn 1)
4. Anton spawns the CLI with `--resume <cliSid>` if we have one, else fresh
5. System prompt is written via `--append-system-prompt` (Claude) or `-c instructions=…` (Codex)
6. CLI runs its internal loop; tool calls flow through the shim → IPC → Anton tool registry
7. Every event from the CLI (`text`, `tool_call`, `tool_result`, `usage`, `done`) is streamed AND mirrored to Anton's conversation store
8. Anton persists updated `cliSid ↔ conversationId` mapping

### Provider switch mid-conversation

1. User selects a different provider for an existing conversation
2. Anton compacts its own conversation record into a first-turn seed (context summary + last N turns verbatim)
3. New CLI spawns fresh (no `--resume`); seed is written as initial user message + system prompt
4. New `cliSid` is captured, old mapping archived

### CLI session lost / expired / crashed

1. `--resume` fails with "unknown session"
2. Anton rebuilds from its own store using the same compaction pipeline as provider-switch
3. New `cliSid` replaces the old one

### Rule

`--resume` is a **cache**, never a **database**. If it's gone, Anton rebuilds. Correctness never depends on it; performance does.

## Context Assembly (per turn)

Mirror Pi SDK's [`loadConversationContext()`](../../packages/agent-core/src/session.ts) pipeline, adapted for the harness. On each turn `HarnessSession.processMessage()` must:

| Step | Data | Destination |
|---|---|---|
| 1 | Base identity ("running inside Anton…") | system prompt |
| 2 | Project: name, description, workspace, type, instructions, summary | system prompt |
| 3 | Keyword-matched memories (global + conversation + cross-convo) | system prompt (first turn); MCP `memory_recall` thereafter |
| 4 | Workflow catalog (name, description, whenToUse) | system prompt hint (pointer), MCP `workflow_list` for detail |
| 5 | Surface hints (Slack/Telegram formatting) | system prompt |
| 6 | Agent standing instructions (if in scheduled-agent context) | system prompt |
| 7 | Date, timezone | system prompt |
| 8 | User message | CLI arg |

Context on turn 1 is the full bundle. On turn 2+ with `--resume`, only *deltas* need re-sending via `--append-system-prompt` (additive by nature).

## MCP Tool Surface

All tools currently available to the Pi SDK agent must be exposable via the MCP shim. No tool lives in only one path.

Grouped by area:

- **memory**: `memory_save`, `memory_recall`, `memory_list`, `memory_forget`
- **workflows**: `workflow_list`, `workflow_run`, `workflow_activate`, `workflow_shared_state_get/set`
- **connectors**: dynamically registered — one tool per connected service (Slack, GitHub, Linear, Gmail, Notion, …)
- **sub-agents**: `agent_spawn`, `agent_list`, `agent_stop`
- **scheduling**: `schedule_create`, `schedule_list`, `schedule_update`, `schedule_delete`
- **database**: `database_query`, `database_execute`
- **publish**: `publish_artifact` (artifact → self-contained HTML)
- **surface**: `notify` (desktop), `surface_post` (route to Slack/Telegram/etc.)
- **browser**: `browser_navigate`, `browser_action` (Playwright)

Registration lives in [`tool-registry.ts`](../../packages/agent-core/src/harness/tool-registry.ts). Each tool is a thin adapter over existing Anton subsystems — no new business logic.

Connectors are enumerated at session start and registered dynamically so only connected services appear in `tools/list`.

## Security

- **IPC socket auth**: `ANTON_AUTH=<random-token>` passed via env to the CLI → shim → socket. First socket message is `{"method":"auth","params":{"token":"…","sessionId":"…"}}`. Mismatch → connection closed.
- **Session scoping**: every `tools/call` carries `_antonSession`. The IPC handler rejects mismatches between the authed session and the claimed session.
- **Tool authorization**: sensitive tools (connector writes, scheduling, publish) respect the same authorization model as Pi SDK.
- **No TCP**: the socket is Unix-domain (`/tmp/anton-<pid>-<session>.sock`). macOS/Linux filesystem permissions gate access.
- **Env hygiene**: `ANTON_AUTH` and `ANTON_SESSION` are stripped from any child process the CLI spawns recursively (shim responsibility).

## Storage Model

| Data | Location | Format |
|---|---|---|
| Anton conversation record | `~/.anton/conversations/<convId>/messages.jsonl` | Existing Pi SDK format, now shared |
| CLI session ID mapping | `~/.anton/conversations/<convId>/meta.json` | `{ cliSid, provider, model, harnessVersion }` |
| Compacted context seed | `~/.anton/conversations/<convId>/context-seed.md` | Written on provider switch or restore |
| Per-session socket | `/tmp/anton-<pid>-<sessionId>.sock` | Transient |
| Memory | `~/.anton/memory/*.md` (global), `~/.anton/conversations/<convId>/memory/*.md` | Existing; now reachable from harness |

## Non-Goals

- **External HTTP MCP server** — separate feature. The in-harness shim and the external MCP server are different concerns. Build independently later.
- **Pi SDK deprecation** — Pi SDK remains a supported backend. Users with API keys and no CLI subscription should never be forced onto a harness.
- **CLI modification** — we do not fork or patch Codex / Claude Code / Gemini. We pass flags they already support.
- **Persistent long-lived subprocess** — not needed. `--resume` gives us the performance benefit of persistence without the lifecycle complexity. Revisit only if measured hot-path latency demands it.

## Open Questions

1. **Compaction strategy on provider switch** — summarize via Pi SDK? Use the CLI's own summarizer? Neither? Needs benchmarking for fidelity.
2. **Tool namespacing** — do connector tools collide with CLI built-ins? (e.g. both may have a generic `search`.) May need `anton.*` prefixes.
3. **MCP elicitation / prompts** — MCP protocol supports richer patterns beyond tools. Out of scope v1; revisit if CLIs start consuming them.
4. **Surface-routed turns** — when the "user" is actually Slack, message routing differs. How does the harness know? Probably via system-prompt hint + a `surface_*` tool surface.

## Phased Delivery

Detailed implementation plan lives below the line. This spec is architecture only; phase ordering is a separate conversation.

---

## Phased Plan (informal — subject to revision)

### Phase 1 — Harden (trust before extending)
- Add `ANTON_AUTH` token flow through shim and IPC handler
- Reject tool calls where `_antonSession` doesn't match authed session
- Fixtures + tests for `parseEvent` on both adapters
- Distinguish auth / runtime / startup errors in UI

### Phase 2 — Expand MCP tool surface
- Workflows (`workflow_list`, `workflow_run`, `workflow_activate`, shared-state get/set)
- Connectors — dynamic registration at session start, one tool per connected service
- Sub-agents (`agent_spawn`, `agent_list`, `agent_stop`)
- Scheduling (`schedule_*`)
- Publish, surface routing, browser
- Each tool is a thin adapter; re-use existing subsystems

### Phase 3 — Per-turn context assembly
- Replace frozen `systemPrompt` with a builder called per `processMessage()`
- Port `loadConversationContext()` logic: keyword extraction, memory lookup, project enrichment
- Wire workflow catalog into the prompt
- First-turn bundle vs subsequent-turn delta

### Phase 4 — Conversation mirror
- Persist every `SessionEvent` from the harness into `messages.jsonl`
- Populate `meta.json` with `cliSid` mapping
- Build compaction pipeline for provider switch / session loss

### Phase 5 — Complete provider coverage
- Gemini adapter
- Per-provider prompt tuning (Codex likes terser system prompts than Claude)
- Capability detection (which providers support which MCP features)

### Phase 6 — Stretch
- External HTTP MCP server (separate spec)
- Measured-hot-path review: do we need a persistent subprocess after all?
