# Harness Architecture — Anton + External CLI

> **Status:** authoritative description of the shipped harness path as of Apr 2026.
> **Supersedes:** all context-flow and session-management discussion in [BYOS_HARNESS_PROVIDERS.md](./BYOS_HARNESS_PROVIDERS.md). That doc remains valid for the original product rationale (subscription reuse, positioning); this doc is the live architectural reference.
> **Relationship to Pi SDK:** Pi SDK is still a first-class execution backend. The harness path is a peer, not a replacement. Both expose the same Anton capability surface to the user.

## Design Principle

**Anton orchestrates, CLI executes, Shim bridges.** Three layers with distinct ownership, not a question of "who drives whom."

```
┌─────────────────────────────────────────────────────────────┐
│  ANTON  — orchestrator + truth                              │
│  owns: conversation record, memory, projects, workflows,    │
│         connectors, scheduling, surface routing             │
│  decides: what context each turn carries, when to send      │
│  mirrors: every CLI output into its own store               │
└────────────────┬────────────────────────────────────────────┘
                 │  per-turn system prompt (identity + layers)
                 │  + user message
                 │  (--resume <cliSid> when continuing)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  CLI  — execution runtime (Codex / Claude Code / Gemini*)   │
│  owns: tool loop, filesystem edits, code reasoning,         │
│         short-term state, compaction, its own resume tape   │
│  acts as: hot cache for conversation state within a session │
└────────────────┬────────────────────────────────────────────┘
                 │  MCP tools/call over stdio
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  SHIM  — MCP bridge (anton-mcp-shim.ts, ~180 LOC)           │
│  transport: stdio ↔ Unix domain socket (no TCP, no port)    │
│  relays: tools/list + tools/call to Anton's tool registry   │
│  auth: per-session 32-byte token in ANTON_AUTH env          │
│  spawn: buildMcpSpawnConfig() — execPath + import.meta.url  │
│  health: probeMcpShim() on boot + every 60s                 │
└─────────────────────────────────────────────────────────────┘

  *Gemini adapter is planned (Phase 5); not yet implemented.
```

## Ownership Matrix

| Concern | Owner | Rationale |
|---|---|---|
| Conversation history (source of truth) | **Anton** (`messages.jsonl`) | Provider-portable, searchable, exportable, auditable. CLI's tape can be lost. |
| Short-term execution state within a conversation | **CLI** (`--resume <cliSid>`) | Free compaction, warm prompt cache, native tool-approval memory. |
| Long-term / cross-conversation memory | **Anton** | Lives in `~/.anton/memory/*.md`. Reachable from CLI via MCP `memory` tool. |
| Background memory extraction | **Anton** (`runHarnessMemoryExtraction`) | Pi-SDK-parity cheap-LLM extractor runs on the mirror after every turn. |
| Project context / instructions / summary | **Anton** | Injected per-turn via system prompt. |
| Workflow activation | **Anton → MCP → CLI** | CLI sees available workflows in prompt block; calls `activate_workflow`. |
| Connector tools (Slack, GitHub, Linear, …) | **Anton → MCP → CLI** | One tool per connected service, registered dynamically at session start. |
| Publish, notification, database | **Anton → MCP → CLI** | Exposed identically to Pi SDK via the shared `buildAntonCoreTools` catalog. |
| Filesystem / shell / code edits / git / web search | **CLI** | What the CLI is *for*. Anton does not re-expose these. |
| Subagents | **CLI** | Both Claude Code and Codex have native subagent primitives. Anton's `sub_agent` is **intentionally not** exposed to the harness. |
| Surface awareness (Slack/Telegram formatting) | **Anton** | Injected as system-prompt hint. |
| MCP transport | **Shim** | Stdio both sides; socket is Unix-domain only. |

## Session Lifecycle

### Turn flow (steady state, same provider)

1. User message arrives at Anton server.
2. `HarnessSession.processMessage()` runs; calls `buildSystemPrompt(userMessage, turnIndex)`.
3. Builder invokes:
   - `buildHarnessContextPrompt({projectContext, projectId, workspacePath, memoryData, availableWorkflows})`
   - On turn 0: `assembleConversationContext(sessionId, userMessage, projectId)` loads memory; `context_info` emits to desktop.
4. CLI spawns via the adapter (`--resume <cliSid>` if we have one, else fresh). Stdin is closed immediately to prevent Codex hang.
5. Every NDJSON event → `adapter.parseEvent()` → `SessionEvent`. The event is yielded to the server AND pushed onto a per-turn buffer.
6. On `done`, `HarnessSession.onTurnEnd(turn)` fires — the server uses it to:
   - `synthesizeHarnessTurn()` → SessionMessage[]
   - `appendHarnessTurn()` → write to messages.jsonl, update meta.json
   - Parse `update_project_context` tool results → `appendSessionHistory`, `updateProjectContext`
   - Fire-and-forget `runHarnessMemoryExtraction()` → cheap LLM scans new messages, writes memories
7. CLI's `cliSessionId` is captured from `system`/`result`/`thread.started` events for next-turn `--resume`.

### Provider switch mid-conversation (`session_provider_switch`)

1. User picks a different harness provider from the desktop composer (`HarnessProviderSwitch` component).
2. Server:
   - Validates session is a harness session and the target provider is harness-type.
   - `existing.shutdown()` — SIGTERM → SIGKILL ladder on the running CLI.
   - Unregisters IPC auth token + session context.
   - `buildReplaySeed({sessionId, projectId})` — reads `messages.jsonl`, renders a `<system-reminder># Prior Conversation>` block with turns / tool calls / truncated tool results. Drops oldest turns first if over budget.
   - `createHarnessSession({id, providerName, model, projectId, replaySeedForFirstTurn})` — rebuilds with the new adapter; the seed is appended to the system prompt on turn 0 only.
   - `updateHarnessSessionMeta()` overwrites meta.json's provider/model.
3. Server sends `session_provider_switched` ack.
4. Client updates current session + conversation record. No history reload needed (mirror is untouched).
5. Next turn runs under the new CLI; its own `--resume` kicks in from turn 1 onward.

### CLI session lost / expired / crashed

1. `--resume` fails (e.g. CLI purged its state).
2. Effectively equivalent to a provider switch to the same provider: next turn spawns fresh, replay seed carries the history.
3. `cliSid` is re-captured.

### Rule

`--resume` is a **cache**, never a **database**. If it's gone, Anton rebuilds from `messages.jsonl`. Correctness never depends on it; performance does.

## System-prompt assembly (per turn)

`buildHarnessContextPrompt()` composes these blocks, in order, and they're appended to the CLI's own core prompt via `--append-system-prompt` (Claude) / `-c instructions=…` (Codex):

| # | Block | Source | Notes |
|---|---|---|---|
| 1 | **`<system-reminder># Anton`** — identity | `buildHarnessIdentityBlock()` | Role ("serving as execution engine for Anton"), dual-identity rule, answer scripts for "who are you" / "what is Anton", per-tool usage hints, **MCP server preference** section (prefer `anton:*` over `codex_apps:*`), scope paragraph preserving native CLI tools. |
| 2 | **`# Memory Usage`** | `buildMemoryGuidelinesLayer()` — extracted at runtime from Pi SDK's `system.md` `## Memory guidelines` section | Same wording Pi SDK sessions see (types, when-to-save, when-NOT-to-save, content format). |
| 3 | **`# Current Context`** | `buildCurrentContextLayer()` | Project context block + workspace path + date. |
| 4 | **`# Current Surface`** | `buildSurfaceLayer()` | Only for non-desktop surfaces (Slack mrkdwn / Telegram legacy-md). |
| 5 | **`# Memory`** (data) | `buildMemoryLayer(memoryData)` | Global + conversation + cross-conversation memories loaded via `assembleConversationContext()` on turn 0. |
| 6 | **`# Project Memory Instructions`** | `buildProjectMemoryInstructionsLayer(projectId)` | Only for project-scoped sessions; tells the CLI to call `update_project_context` once near end. |
| 7 | **`# Agent Context`** | `buildAgentContextLayer(instructions, memory)` | Only for scheduled-agent runs. |
| 8 | **`# Available Workflows`** | `buildWorkflowsLayer(workflows)` | For auto-suggestion; CLI calls `activate_workflow` after user approval. |
| 9 | **`# Prior Conversation`** (optional, one-shot) | `buildReplaySeed()` | Injected only on turn 0 after a provider switch. Subsequent turns rely on the new CLI's `--resume` tape. |

Shared block builders live in [`packages/agent-core/src/prompt-layers.ts`](../../packages/agent-core/src/prompt-layers.ts) — same module Pi SDK's `Session.getSystemPrompt()` uses for the overlap layers. Single source.

## MCP shim spawn + health

### Spawn config (single source of truth)

`buildMcpSpawnConfig()` in [`packages/agent-core/src/harness/mcp-spawn-config.ts`](../../packages/agent-core/src/harness/mcp-spawn-config.ts) is the **only** place that constructs the shim command line. Both `HarnessSession` and `CodexHarnessSession` accept a `mcp.spawn: McpSpawnConfig` from the server, so there's no per-adapter path logic.

```ts
interface McpSpawnConfig {
  command: string    // always process.execPath
  args: string[]     // [ SHIM_PATH ]
  shimPath: string   // absolute path to anton-mcp-shim.js on disk
}
```

Two invariants the config enforces:

- **`command = process.execPath`** — not the literal `"node"`. systemd services don't inherit PATH reliably; `execPath` is guaranteed to be the node binary currently running the server. This matters on VPS deployments running under `NodeJS` + systemd.
- **`shimPath` via `import.meta.url`** — resolved from the module's own location on disk, independent of `HOME` or cwd. The previous implementation composed the path from `homedir() + '../node_modules/...'`, which broke on VPS where the host process runs as `anton@/home/anton` but the install actually lives at `/opt/anton`.

### Health probe

`probeMcpShim(spawnConfig, timeoutMs)` spawns the shim in isolation, completes one `initialize` JSON-RPC round-trip, and tears down. It's called on server boot and then every 60s (the interval is `.unref()`ed so it doesn't hold the event loop open).

The probe confirms:
1. The shim binary exists at the expected path.
2. Node loads it without syntax errors or missing imports.
3. JSON-RPC framing works end to end.
4. Reported `serverInfo.version` matches `getExpectedShimVersion()` (warn on mismatch — symptom of a partial deploy).

It does **not** verify the IPC auth path; that's exercised by every live session the first time a tool is called.

### Capability-block gating

If the most recent probe failed (`mcpHealth?.ok === false`), the server **omits the harness capability block** from the system prompt and passes an empty connector list to `buildHarnessContextPrompt`. The model therefore never believes it has tools it can't call — preventing the failure mode where a broken shim path caused harness CLIs to confidently attempt `anton:gmail_search_emails` against a shim that couldn't be spawned.

The probe's stderr tail and resolved `shimPath` are logged at error level on every failed interval so ops can diagnose deploy issues without shelling into the box.

## MCP tool surface (what the CLI sees via `tools/list`)

Shipped today — all served by `AntonToolRegistry` over the Unix socket:

### Anton-core tools (shared with Pi SDK, one source of truth)

Defined by `buildAntonCoreTools(ctx)` in [`packages/agent-core/src/tools/factories.ts`](../../packages/agent-core/src/tools/factories.ts). Each tool is co-located with its implementation (`tools/memory.ts`, `tools/database.ts`, etc.):

| Tool | Gating | Notes |
|---|---|---|
| `memory` | always | Operations: save / recall / list / forget. Scope: global or conversation. |
| `database` | always | SQLite at `~/.anton/data.db`. Operations: query / execute / tables / schema. |
| `notification` | always | OS desktop notifications. |
| `publish` | always | Renders content to a public URL. Accepts html/markdown/svg/mermaid/code. |
| `update_project_context` | `projectId` set | Returns structured JSON captured by `onTurnEnd` for project history. |
| `activate_workflow` | `projectId` + `onActivateWorkflow` handler | Installs a workflow's agents. |

### Connector tools

Enumerated per session from `connectorManager.getAllTools(surface)`. One tool per connected service (examples: `slack_send`, `github_list_issues`, `linear_create_ticket`, `gmail_search_emails`). Adapted to MCP via `agentToolToMcpDefinition()` — the same `AgentTool` objects Pi SDK consumes, reused verbatim.

### Deliberately not exposed to the harness

- `sub_agent` — CLI has its own subagent primitive.
- `shell`, `read`, `write`, `edit`, `glob`, `grep`, `git`, `http_api`, `browser`, `artifact` — CLI's native tools handle these; re-exposing would collide.
- `shared_state` — deferred; workflow-agent-internal coordination still to be wired.

Routine dispatch is **not** a tool — it arrives via `AgentManager.runAgent()` → `SendMessageHandler`. When the dispatched agent's provider is a harness (`codex`, `claude-code`), `server.ts` builds an ephemeral harness session with `background: true` (no `onAskUser`, no `session_created` broadcast, no `conversation` pool slot) and runs the turn. Scheduler coordination is wired the same way as the Pi SDK path.

Extension rule: **edit `buildAntonCoreTools()` or the relevant `tools/<name>.ts` factory — never inline a tool in `tool-registry.ts`.**

## Storage model

| Data | Location | Owner | Notes |
|---|---|---|---|
| Conversation history | `~/.anton/conversations/<id>/messages.jsonl` (global) or `~/.anton/projects/<projectId>/sessions/<id>/messages.jsonl` (project-scoped) | Anton | Same path layout Pi SDK uses. Pi-SDK-compatible `SessionMessage` shape. Append-only. |
| Session meta | `…/<id>/meta.json` | Anton | `{id, title, provider, model, createdAt, lastActiveAt, messageCount, …}`. Overwritten on provider switch with the new provider/model. |
| Per-session memories | `~/.anton/conversations/<id>/memory/*.md` | Anton | Conversation-scoped; created by `memory` tool with `scope=conversation`. |
| Global memories | `~/.anton/memory/*.md` | Anton | Cross-conversation; created by `memory` tool with `scope=global` AND by background extraction. |
| IPC socket | `~/.anton/harness.sock` | Anton | Unix-domain; single server socket serving all harness sessions (per-connection auth). |
| MCP config (Claude) | `${tmpdir}/anton-harness/mcp-<id>-<nonce>.json` | Anton | Temp file per spawn; unlinked in `finally`. |
| MCP config (Codex) | inline via `-c mcp_servers.anton.*` args | Anton | Codex doesn't read `--mcp-config`; we use config overrides. |
| CLI's own session tape | `~/.claude/sessions/` or Codex-equivalent | CLI | Opaque to Anton. `--resume <cliSid>` uses it. |

There is **no** `context-seed.md` file — the replay seed is built on demand from the mirror and injected inline; never persisted separately.

## Security

- **IPC socket auth**: per-session 32-byte random token in `ANTON_AUTH` env. Shim sends `{"method":"auth","params":{"token":"…","sessionId":"…"}}` as its first frame; unauthenticated connections are dropped after 5s.
- **Session scoping**: the IPC handler binds each connection to its authed sessionId. Any subsequent `tools/call` whose `_antonSession` param differs is rejected with `-32002 session_mismatch` (no tool executes). Connection-level binding means a compromised shim cannot impersonate another session.
- **No TCP**: the socket is Unix-domain (`~/.anton/harness.sock`). macOS/Linux filesystem permissions gate access.
- **Env scope**: Codex uses `-c mcp_servers.anton.env.ANTON_AUTH=…` to pass the token into the shim explicitly — not inherited from the CLI's process env.
- **Tool authorization**: connector writes + publish respect Pi SDK's existing authorization model; they flow through the same `AgentTool` definitions.

## Error classification

Harness error events carry a `code` field for UI routing:

| Code | Origin |
|---|---|
| `not_installed` | `proc.on('error')` with ENOENT |
| `not_authed` | adapter `parseEvent` (matches 401 / unauthorized / not logged in / authentication failed) |
| `startup_timeout` | 30s window with no JSON event from stdout |
| `runtime` | everything else |

Desktop `interactionHandler` decorates the rendered message with actionable prefixes per code (e.g. "**Authentication required** — Sign in to the provider from Settings → Providers and try again.").

## Non-goals

- **External HTTP MCP server** — separate feature. The in-harness shim and any external MCP server are different concerns.
- **Pi SDK deprecation** — Pi SDK remains a supported backend. Users with API keys and no CLI subscription should never be forced onto a harness.
- **CLI modification** — we do not fork or patch Codex / Claude Code / Gemini. We pass flags they already support.
- **Persistent long-lived subprocess** — `--resume` gives us the perf benefit without the lifecycle complexity. Revisit only if measured hot-path latency demands it.

## Open questions (still open)

1. **Tool namespacing collisions** — the MCP server-preference block in the identity prompt steers away from vendor MCP collisions (e.g. `codex_apps:gmail_*`). If we find the CLI still reaches for vendor tools after the prompt change, the next lever is stripping the CLI's vendor MCP config at spawn.
2. **MCP elicitation / prompts** — MCP supports richer patterns beyond tools (prompts, resources). Not used yet; revisit if a CLI starts consuming them.
3. **Surface-routed turns** — Slack/Telegram replies currently ride the same harness path with a system-prompt hint. The `surface_*` tool surface envisioned in earlier drafts hasn't been needed.
4. **Compaction on replay** — `buildReplaySeed` currently truncates oldest-first with a character budget. We haven't needed LLM-based summarization; add if conversations routinely exceed the budget.

## Delivery status

| Phase | Name | Status |
|---|---|---|
| 1 | **Harden** — IPC auth, session scoping, adapter fixtures, classified error codes | ✅ Shipped |
| 2 | **Tool surface** — connector tools via `agentToolToMcpDefinition`, publish, `activate_workflow`, `update_project_context` | ✅ Shipped |
| 3 | **Per-turn context assembly** — `buildHarnessContextPrompt` with memory/workflows/surface/agent layers + identity block | ✅ Shipped |
| — | **De-dupe pass** — single-source tool factories (`tools/*.ts` + `buildAntonCoreTools`) and prompt layer builders (`prompt-layers.ts`); Session imports shared | ✅ Shipped |
| 4 | **Conversation mirror** — append-only write to `messages.jsonl`, `ensureHarnessSessionInit`, `update_project_context` capture, `readHarnessHistory` fast-path in `session_history` | ✅ Shipped |
| — | **Identity prompt** — identity block with dual-identity rule, answer scripts, MCP server-preference section | ✅ Shipped |
| — | **Memory Usage guidelines** — ported from `system.md` at runtime | ✅ Shipped |
| — | **Background memory extraction** — `runHarnessMemoryExtraction` fire-and-forget after each turn | ✅ Shipped |
| — | **Provider switch** — `session_provider_switch` message, `buildReplaySeed`, `createHarnessSession` refactor, desktop `HarnessProviderSwitch` component | ✅ Shipped |
| — | **Codex adapter — mcp_tool_call** — new item type + field names (server/tool/object args+result) | ✅ Shipped |
| — | **MCP production hardening** — `buildMcpSpawnConfig` single-source spawn, `probeMcpShim` health check on boot + 60s, capability-block gating on probe failure, version handshake, `process.execPath` instead of `"node"` | ✅ Shipped |
| — | **Session lifecycle** — `SessionRegistry` with partitioned LRU pools, pin-during-turn, awaited shutdown on `session_destroy`; see [SESSION_LIFECYCLE.md](./SESSION_LIFECYCLE.md) | ✅ Shipped |
| 5 | **Gemini adapter + per-provider tuning** | ⏳ Planned |
| — | **Per-provider prompt variants** | ⏳ Planned (revisit with usage telemetry) |
| — | **External HTTP MCP server** | ⏳ Planned (separate spec) |
| — | **Persistent subprocess** | ⏳ Deferred — no measured need |

## Key file map

| Concern | File |
|---|---|
| Adapter interface | `packages/agent-core/src/harness/adapter.ts` |
| Claude adapter | `packages/agent-core/src/harness/adapters/claude.ts` |
| Codex adapter | `packages/agent-core/src/harness/adapters/codex.ts` |
| Session lifecycle | `packages/agent-core/src/harness/harness-session.ts` |
| MCP shim (stdio↔IPC relay) | `packages/agent-core/src/harness/anton-mcp-shim.ts` |
| MCP spawn config + health probe | `packages/agent-core/src/harness/mcp-spawn-config.ts` |
| IPC server (auth + tool dispatch) | `packages/agent-core/src/harness/mcp-ipc-handler.ts` |
| Session registry (LRU + shutdown) | `packages/agent-core/src/session-registry.ts` |
| Tool registry | `packages/agent-core/src/harness/tool-registry.ts` |
| Shared tool catalog | `packages/agent-core/src/tools/factories.ts` (`buildAntonCoreTools`) |
| Per-tool factories | `packages/agent-core/src/tools/{memory,database,notification,publish,activate-workflow,update-project-context}.ts` |
| Prompt layer builders (shared with Pi SDK) | `packages/agent-core/src/prompt-layers.ts` |
| Conversation mirror | `packages/agent-core/src/harness/mirror.ts` |
| Provider-switch replay | `packages/agent-core/src/harness/replay.ts` |
| Background memory extraction | `packages/agent-core/src/harness/memory-extract.ts` |
| Fixture + snapshot tests | `packages/agent-core/src/harness/__fixtures__/` |
| Server wiring | `packages/agent-server/src/server.ts` — `createHarnessSession`, `handleSessionProviderSwitch`, `runHarnessMemoryExtraction`, `tryReadHarnessHistory` |
| Desktop provider picker | `packages/desktop/src/components/chat/HarnessProviderSwitch.tsx` |
