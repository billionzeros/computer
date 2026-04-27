# Anton — Session Log Architecture

> Unified persistence + transport model for sessions. One append-only log per session is the source of truth; multiple clients subscribe to a per-session broadcast channel; provider runtimes (Pi SDK, harness) and every other event producer (webhooks, scheduler, sub-agents, compaction, memory) are translators that funnel into the same writer.

## Status

Proposed. Replaces parts of `SESSIONS.md`, `CONCURRENT_CONVERSATIONS.md`, and `features/core/text-stream-buffer.md`. Subsumes the ad-hoc `meta.json` / `tasks.json` / `compaction.json` / `sub-agent-history.jsonl` sidecars into a single event log.

---

## 1. Goals

1. **A single tab is not the bottleneck.** Any number of clients (web, desktop, mobile, dashboard, MCP, future surfaces) can attach to the same agent and see consistent state in real time.
2. **Persistence is connection-agnostic.** What gets written to disk does not depend on whether anyone is watching, what provider produced it, or whether the turn finished cleanly.
3. **Pi SDK and harness behave the same way.** Both produce the same on-disk format, the same wire events, the same replay semantics. Adding a provider is one adapter file.
4. **One source of truth per session.** No more `meta.json` + `messages.jsonl` + `tasks.json` + `compaction.json` + `sub-agent-history.jsonl` parallel files; metadata is a derived projection of the log.
5. **Crash recovery is replay.** The same code path that catches a reconnecting tab up also reconstructs state after an agent restart.
6. **Production scale.** O(1) appends. Paginated reads via index. No full-file rewrites. No per-event fsync.

## 2. Non-goals

- Multi-writer support per session (still single-writer; the agent process owns the log).
- Distributed/replicated logs. We're a local sidecar. Not Kafka.
- Strict ACID durability. We pick "lose ≤50ms of an in-flight turn on power-cut" — same as Postgres async commit.
- Real-time collaborative editing of in-flight assistant text. Deltas are still ephemeral; durable boundaries are at message/tool granularity.

## 3. Bug catalog (today)

Concrete, reproducible problems in the current system. Cited so anyone can verify.

### 3.1 Multi-tab severs other tabs

**Repro:** open the same conversation in two browser tabs.
**What happens:** tab 2's auth replaces `this.activeClient = ws` (`agent-server/src/server.ts:322,833`). All `sendToClient` (`server.ts:6654`) target only the latest. Tab 1 stops receiving updates; its WS appears alive but no events arrive.
**User-visible:** tab 1 shows a frozen "Manifesting…" timer; tab 2 shows a partial conversation. (Reproduced in `attachments/image-v4.png` and `image-v5.png`.)

### 3.2 Late-joining client misses the in-flight turn

**Repro:** join a session that's currently streaming.
**What happens:** the auth handler (`server.ts:833–888`) sends `auth_ok`, active turn statuses, and pending prompts — but no replay of buffered text deltas, tool calls, or assistant blocks already streamed.
**User-visible:** the new tab sees the conversation up through the previous turn, then nothing until the live turn completes (or until they manually refresh history).

### 3.3 Harness flushes only at turn end

**Repro:** open history of an active 25-minute Codex turn from a fresh tab.
**What happens:** harness mirror calls `appendFileSync` exactly once per turn at `onTurnEnd` (`agent-core/harness/mirror.ts:287–297`, called from `server.ts:2462`). `tryReadHarnessHistory` reads `messages.jsonl` exclusively (`mirror.ts:335`). Mid-turn the file holds only the previous turn.
**User-visible:** the new tab shows nothing about the in-flight turn until it completes.

### 3.4 Pi SDK rewrites whole `messages.jsonl` per persist

**Repro:** any tool call in a long session.
**What happens:** `Session.persist()` (`agent-core/session.ts:1074`) → `saveSession()` (`agent-config/config.ts:963`) does `writeFileSync(...messages.jsonl...)` — a full rewrite — on every `tool_execution_end` and `turn_end`.
**Impact:** O(N) write per tool boundary. Tens of MB rewritten every few seconds in long sessions. Latent perf issue independent of the multi-tab bug.

### 3.5 Three overlapping sync paths

`chat_event`, `session_history_response`, `session_sync`, `tasks_update`, `tool_call_started`, `tool_result`, `text_delta`, `thinking_delta` are all separate top-level message types with their own client handlers. Reconstructing state on a fresh tab takes a different code path from reconstructing during a live turn. Cross-cutting bugs (e.g. tasks not showing on reconnect) keep cropping up because each path reconstructs differently.

### 3.6 Persistence asymmetry between providers

| | Pi SDK | Harness |
|---|---|---|
| Mid-turn in-memory state | Authoritative (`session.ts:1424`) | None (no in-memory cache; relies on disk) |
| Mid-turn on disk | Lags by up to one tool boundary | Empty for current turn |
| `getHistory()` mid-turn | Returns up-to-now (in-memory) | Returns previous turn only (disk) |

Same client request, different semantics depending on which provider is running. Bug-prone.

### 3.7 Status is ephemeral

`done`, `error`, `working`, `idle` are emitted as events but never persisted (`harness/mirror.ts:175–177` explicitly drops them from the mirror; Pi SDK keeps `_lastStatus` in memory only).
**User-visible:** after a crash or reconnect, the client doesn't know the last-known status. The client mitigates with a 90s "stuck state" auto-recover timeout (`desktop/sessionStore.ts:557`) — which exists *because* of this gap.

### 3.8 Steering is lost from history

User mid-turn redirection (`AiSteerMessage`, `protocol/messages.ts`) doesn't get persisted. Only the synthesized turn ends up in `messages.jsonl`. There's no record of "user told the agent to stop and try X instead at second 45 of the turn."

### 3.9 Tasks live in a sidecar, not as events

`tasks.json` is rewritten directly by `saveSessionTasks()` (`config.ts:1036–1040`) outside the event stream. A reconstruction from disk has to read the sidecar separately. Order of operations between `tasks_update` event broadcast and `tasks.json` write is not enforced.

### 3.10 Compaction lives in a sidecar, not as events

`compaction.json` (`config.ts:987–991`) holds the rolling summary. A `compaction` event is emitted (`session.ts:346`) but the durable record is the sidecar, not the event. Event consumers can see compaction happen; replay consumers cannot reconstruct it.

### 3.11 No write-ahead log; no torn-write recovery

Pi SDK `saveSession()` does `writeFileSync` directly. Harness `appendHarnessTurn()` does `appendFileSync` of a pre-formed batch. Neither has a recovery path for a partial write. Crash mid-write leaves a corrupt last record; no detection on next boot.

### 3.12 Out-of-order WS arrival relies on TCP

The protocol has no per-session sequence numbers. Clients render frames in arrival order. TCP usually orders within a connection, but reconnects and multiplexed channels can interleave. Today this is mostly safe by accident.

### 3.13 Sub-agent history is yet another sidecar

`sub-agent-history.jsonl` (`config.ts:1005–1011`) records sub-agent runs. Parent session's events reference them but the linkage is by `parentToolCallId`, not by event seq. Reconstruction has to merge two streams.

### 3.14 Pre-creation drafts vanish on refresh

Hero composer lets the user type before a session exists. Text is in zustand state with no session id. Refresh = lost.

### 3.15 Provider/model switch is silent on disk

`SessionProviderSwitchMessage` updates `session.provider` and `session.model` and `meta.json`, but emits no event into the message log. Replaying the log can't tell you which model was active at which point in the conversation.

### 3.16 Reconnect has no message queue

If the client types and submits during a WS disconnect, the message is dropped. There's no client-side outbox, no "send when reconnected" queue.

### 3.17 Sessions list sync overlaps with session events

`sessions_sync_response` + `session_sync` (`desktop/store/handlers/sessionHandler.ts:243,380`) maintain the sidebar separately. A session-level event (e.g. title change) goes through *both* the per-session event channel and the sessions-list sync channel, with potential for them to disagree.

### 3.18 Status timeouts mask protocol gaps

`STUCK_STATE_TIMEOUT_MS = 90_000` (`sessionStore.ts:556`) auto-recovers stuck `working` state. This is a band-aid for "we might have missed an `idle` event" and shouldn't exist if events are reliable.

## 4. Core invariants (target)

1. **Disk is the source of truth.** In-memory state is a derived projection.
2. **Every state-mutating operation produces exactly one durable event.** Appended to the session's log, then broadcast.
3. **Token-grain streaming is ephemeral.** It exists only on the broadcast channel and an in-memory "current block" buffer. When the block finalizes, the durable event subsumes it.
4. **One writer per session, many readers.** No locks, no cross-process coordination.
5. **`sinceSeq` is the universal sync primitive.** Fresh open, reconnect, missed messages, multi-tab, mobile after sleep — all the same protocol.
6. **Producers don't write to disk directly.** They call `channel.publishDurable(event)`; the channel owns the log.
7. **Sidecars are cache, not source.** `meta.json`, derived task list, latest compaction summary — all rebuilt from the log on demand. Cached for fast listing only.

## 5. Event taxonomy

### 5.1 Durable events (`SessionEvent`)

Append to log. Broadcast. Survive crash.

| `kind` | Payload (sketch) | Replaces today |
|---|---|---|
| `user_message` | `{ content, attachments[], mode? }` | `appendMessageToSession` user role |
| `user_steering` | `{ content, atSeq }` | (new — was lost) |
| `assistant_message` | `{ blocks: [{ type:'text'|'thinking', value }] }` | assistant role in `messages.jsonl` |
| `tool_call` | `{ toolId, name, input }` | tool_use block |
| `tool_result` | `{ toolId, content, isError, contentRef? }` | tool_result block |
| `status_change` | `{ status: 'idle'|'working'|'waiting_user'|'error', detail? }` | (new — was ephemeral) |
| `task_update` | `{ tasks: TaskItem[] }` | `tasks.json` |
| `meta_update` | `{ title?, provider?, model?, thinkingLevel? }` | `meta.json` mutations + provider switch |
| `usage` | `{ tokenUsage }` | `meta.json` usage + per-turn |
| `compaction` | `{ summary, replacedSeqRange }` | `compaction.json` |
| `attachment_added` | `{ attachmentId, kind, byteLen, ref }` | `images/` filesystem refs |
| `subagent_started` | `{ subagentSessionId, parentToolId, type }` | `sub-agent-history.jsonl` start |
| `subagent_finished` | `{ subagentSessionId, result, parentToolId }` | `sub-agent-history.jsonl` end |
| `ask_user` | `{ promptId, questions }` | `AiAskUserMessage` |
| `ask_user_response` | `{ promptId, answers }` | `AiAskUserResponse` |
| `plan_confirm` | `{ promptId, plan }` | `AiPlanConfirmMessage` |
| `plan_response` | `{ promptId, approved, feedback? }` | `AiPlanConfirmResponse` |
| `confirm` | `{ promptId, command, reason }` | `AiConfirmMessage` |
| `confirm_response` | `{ promptId, approved }` | `AiConfirmResponse` |
| `memory_extracted` | `{ scope: 'global'|'project', entries }` | (new — was fire-and-forget) |
| `session_destroyed` | `{ reason? }` | tombstone |

Every durable event:
```ts
interface SessionEvent<K extends EventKind = EventKind> {
  v: 1
  seq: number          // monotonic per session, gap-free
  ts: number           // ms epoch
  turnId?: string      // groups events into turns
  parentSeq?: number   // tool_result → tool_call, response → prompt, etc.
  kind: K
  payload: PayloadOf<K>
}
```

### 5.2 Ephemeral deltas (`SessionDelta`)

Broadcast only. Never on disk.

| `kind` | Payload | Lifetime |
|---|---|---|
| `text_delta` | `{ blockId, value }` | until `assistant_message` finalizes |
| `thinking_delta` | `{ blockId, value }` | until `assistant_message` finalizes |
| `tool_progress` | `{ toolId, message }` | until `tool_result` |
| `heartbeat` | `{ blockId, elapsedMs }` | turn duration |

```ts
interface SessionDelta<K extends DeltaKind = DeltaKind> {
  sessionId: string
  blockId: string
  kind: K
  value: string | number
  ts: number
}
```

When the assistant block finalizes, the server emits `assistant_message` (durable) and clients drop the `blockId`'s in-flight buffer in favor of the durable record.

## 6. Producers — full catalog

Everything that mutates session state. All funnel through `channel.publishDurable` (or `publishDelta` for ephemerals). Today these are scattered across many files with bespoke persistence.

| Producer | Today | Emits (new model) |
|---|---|---|
| **User chat input** | `AiUserMessage` → `appendMessageToSession` (`config.ts:1047`) | `user_message`, plus `attachment_added` per attachment |
| **User steering** | `AiSteerMessage` (`protocol/messages.ts`) — not persisted | `user_steering` |
| **Pi SDK runtime** | `session.ts` events → `persist()` → full file rewrite | `assistant_message`, `tool_call`, `tool_result`, `usage`, `task_update`, `compaction`, `meta_update` (title), `status_change`, deltas |
| **Harness runtime** | `harness/mirror.ts:synthesizeHarnessTurn` at turn end | same set as Pi SDK; per-event |
| **Sub-agent (child session)** | own session dir + parent's `sub-agent-history.jsonl` | child has its own log; parent emits `subagent_started` / `subagent_finished` linking to child sessionId |
| **Scheduler (cron routines)** | `scheduler.ts` → `appendMessageToSession` on target | `user_message` (system-style) on the target session |
| **Webhooks (Slack/Telegram/GitHub/generic)** | `webhooks/agent-runner.ts` → `appendMessageToSession` | `user_message` (with origin metadata) |
| **`set_session_title` tool** | updates `meta.json`, emits `title_update` event | `meta_update` with `{title}` |
| **Provider/model switch** | updates `meta.json` silently | `meta_update` with `{provider, model}` |
| **Task tracker tool** | writes `tasks.json` + emits `tasks_update` | `task_update` |
| **Token usage tracking** | `lastTurnUsage` / `cumulativeUsage` in memory | `usage` per turn |
| **Compaction** | `compaction.json` + `compaction` event | `compaction` (with `replacedSeqRange`) |
| **Background memory extraction** | fire-and-forget; not in session | `memory_extracted` |
| **`ask_user` tool** | `AiAskUserMessage` | `ask_user`; response → `ask_user_response` |
| **Plan confirm** | `AiPlanConfirmMessage` | `plan_confirm`; response → `plan_response` |
| **Confirm prompt** | `AiConfirmMessage` | `confirm`; response → `confirm_response` |
| **Image / file attachment** | `images/<msgIndex>-<blockIndex>-name.ext` | `attachment_added`; binary lives in `attachments/` |
| **Session deletion** | `rmSync` of dir | `session_destroyed` then dir removal (tombstone in sessions list) |

Adding a new producer is one rule: **emit a durable event through the channel; never write to disk directly**.

## 7. Subscribers — full catalog

Everything that consumes session state. All use `session_subscribe { sinceSeq }`.

| Subscriber | Today | New model |
|---|---|---|
| **Chat view** | many handlers (`chatHandler`, `toolHandler`, `interactionHandler`, `sessionHandler`) | one reducer over `session_event` + `session_delta` |
| **Sidebar / TasksListView** | `sessionsList` sync + per-session badges | subscribes to sessions list channel + thin per-session status events |
| **Mobile (`packages/mobile`)** | mirrors desktop handlers | same as desktop; identical protocol |
| **RoutinesView / dashboards** | reads routine session metadata | subscribes to per-routine sessions |
| **Slack/Telegram/GitHub bots** | listens for `done`/`error` events | subscribes to target session, replies on `assistant_message` finalization |
| **MCP server consumers (future)** | n/a | subscribes to a session over MCP transport; same event types |
| **Replay / recovery on agent boot** | replays `messages.jsonl` into in-memory `Session` | replays `events.jsonl` into projection |

## 8. SessionLog — durable storage

### 8.1 Storage layout (new)

```
~/.anton/sessions/data/sess_abc123/
├── meta.json              # cached projection: title, provider, model, lastSeq, lastActiveAt
├── events.jsonl           # append-only log, one SessionEvent per line
├── events.idx             # binary index: seq (u32) → byteOffset (u64)
└── attachments/           # large payloads externalized from events
    ├── 0042.bin
    └── 0043.png
```

`meta.json` is no longer authoritative. It's a derived cache, used only by the sidebar's fast-list path. Rebuilt from `events.jsonl` if missing or stale. Same goes for what was `tasks.json` (rebuild = scan events for last `task_update`) and `compaction.json` (= scan events for last `compaction`).

### 8.2 `events.jsonl`

- Each line is a complete JSON `SessionEvent`.
- Lines kept under 4KB so POSIX `O_APPEND` writes are atomic. Larger payloads externalized to `attachments/<seq>.bin` and referenced as `{ kind:'tool_result', payload:{ contentRef:{ seq:42, byteLen:131072 } } }`.
- Reader tolerates a torn last line: scan from end, drop any partial JSON, truncate.
- `seq` is gap-free and monotonic; readers verify on load.

### 8.3 `events.idx`

- Fixed-size records `[u32 seq][u64 offset]`. ~12 bytes per event.
- Built lazily on first read. Rebuilt from log if missing or trailing.
- Enables O(log N) seek for `read(sinceSeq)` and O(1) tail reads.

### 8.4 Writer interface

```ts
interface SessionLog {
  append<K>(input: AppendInput<K>): SessionEvent<K>
  read(opts: { sinceSeq?: number; beforeSeq?: number; limit?: number }): SessionEvent[]
  tail(): { lastSeq: number; lastTurnId?: string }
  flush(): Promise<void>
  close(): Promise<void>
}

interface AppendInput<K> {
  kind: K
  payload: PayloadOf<K>
  turnId?: string
  parentSeq?: number
}
```

### 8.5 `append` semantics

```
append(input):
  seq    = lastSeq + 1
  event  = { v:1, seq, ts: now, ...input }
  line   = JSON.stringify(event) + "\n"
  if line.length > LINE_MAX: externalize payload to attachments/<seq>.bin
  fd.writeSync(line)        // single syscall, O_APPEND
  idx.appendSync(seq, byteOffset)
  scheduleFsync()           // batched
  lastSeq = seq
  return event
```

### 8.6 fsync policy

- Background timer: fsync every 50ms if dirty.
- Force fsync on: turn-end `status_change`, `session_destroyed`, process shutdown.
- Trade: power-cut window ≤50ms of in-flight events.

### 8.7 Recovery (boot path)

```
for each session dir:
  open events.jsonl
  scan from end:
    drop trailing partial line if JSON.parse fails
    truncate file to last valid newline
  rebuild events.idx if missing or tail stale
  load lastSeq into meta cache
  do NOT replay into memory — clients drive that on subscribe
```

Recovery is bounded: scan is `O(tail)` not `O(N)`.

## 9. SessionChannel — broadcast

In-memory, per session. Owned by the agent-server.

```ts
class SessionChannel {
  readonly sessionId: string
  private subscribers = new Set<ClientConn>()
  private inFlightBlock: InFlightBlock | null = null
  private log: SessionLog

  subscribe(client: ClientConn, sinceSeq: number): SubscribeReply
  unsubscribe(client: ClientConn): void
  publishDurable<K>(input: AppendInput<K>): SessionEvent<K>
  publishDelta(d: SessionDelta): void
}

interface SubscribeReply {
  sessionId: string
  currentSeq: number
  backlog: SessionEvent[]
  hasMore: boolean
  snapshot: InFlightBlock | null
}

interface InFlightBlock {
  blockId: string
  kind: 'text_delta' | 'thinking_delta'
  partial: string
  startedAt: number
}
```

### 9.1 Backpressure

Each subscriber has a bounded outbound queue (64KB or 256 frames, whichever first).
- Soft limit: drop oldest `session_delta`, keep all `session_event`.
- Hard limit: disconnect the slow subscriber. It reconnects with `sinceSeq` and catches up.

Durable events are never dropped on the wire from the server's side. If the client missed any, `sinceSeq` recovers them.

### 9.2 In-flight block buffer

Single buffer per session. Maximum one assistant message streaming at a time (Pi SDK + harness both serialize within a turn). When the block finalizes via durable `assistant_message`, the buffer clears. Memory cost: O(active sessions × current block size) — kilobytes.

## 10. Wire protocol

### 10.1 Client → Server

```ts
type ClientFrame =
  | { type: 'session_subscribe',   sessionId: string, sinceSeq: number }
  | { type: 'session_unsubscribe', sessionId: string }
  | { type: 'session_history',     sessionId: string, beforeSeq: number, limit?: number }
  | { type: 'session_input',       sessionId: string, input: UserInput }   // replaces ai_message + steer
  | { type: 'session_response',    sessionId: string, promptId: string, response: PromptResponse }
```

### 10.2 Server → Client

```ts
type ServerFrame =
  | { type: 'session_subscribed',   reply: SubscribeReply }
  | { type: 'session_event',        event: SessionEvent }
  | { type: 'session_delta',        delta: SessionDelta }
  | { type: 'session_history_page', sessionId: string, events: SessionEvent[], hasMore: boolean }
  | { type: 'session_error',        sessionId: string, code: string, message: string }
```

### 10.3 Sessions list channel

The list of sessions has its own log of meta-events: `session_created`, `session_meta_changed`, `session_destroyed`. Same protocol, different log file (`~/.anton/sessions/sessions-meta.jsonl`). Sidebars subscribe with `sinceSeq` like everything else.

This kills `sessions_sync_response` and `session_sync` as separate frames; they become events on the meta channel.

## 11. Provider adapters

Adapters do one job: translate provider events into `publishDurable` / `publishDelta` calls. They do not touch the log directly.

### 11.1 Pi SDK adapter

```
piSession.on('text_delta',          d => channel.publishDelta({ kind:'text_delta', blockId:d.blockId, value:d.value }))
piSession.on('thinking_delta',      d => channel.publishDelta({ kind:'thinking_delta', blockId:d.blockId, value:d.value }))
piSession.on('tool_call_started',   c => channel.publishDurable({ kind:'tool_call', payload:{ toolId:c.id, name:c.name, input:c.input }, turnId }))
piSession.on('tool_execution_end',  r => channel.publishDurable({ kind:'tool_result', payload:{ toolId:r.id, content:r.content, isError:r.isError }, parentSeq:r.toolCallSeq, turnId }))
piSession.on('assistant_message',   m => channel.publishDurable({ kind:'assistant_message', payload:{ blocks:m.blocks }, turnId }))
piSession.on('tasks_update',        t => channel.publishDurable({ kind:'task_update', payload:{ tasks:t }, turnId }))
piSession.on('usage',               u => channel.publishDurable({ kind:'usage', payload:{ tokenUsage:u }, turnId }))
piSession.on('compaction',          c => channel.publishDurable({ kind:'compaction', payload:{ summary:c.summary, replacedSeqRange:c.range }, turnId }))
piSession.on('turn_end',            x => channel.publishDurable({ kind:'status_change', payload:{ status:'idle' }, turnId }))
```

Replaces `Session.persist()` (`agent-core/session.ts:1074`) and the full-rewrite in `saveSession()` (`agent-config/config.ts:1003`).

### 11.2 Harness adapter

The harness CLI emits a stream we already parse. Today we batch and call `appendHarnessTurn` at `onTurnEnd`. Replace with per-event `publishDurable` calls during streaming. `mirror.ts` becomes ~30 lines of parser routing, no batching.

## 12. Edge cases & invariants

### 12.1 Agent process restart mid-turn

- Last durable event up to ~50ms before crash is on disk.
- In-flight assistant block (deltas) is lost.
- On boot: `recover()` truncates any torn line; lastSeq advances.
- Server emits no events on its own; but on first reconnecting client subscribe, the client gets the durable backlog and a `null` snapshot. The client renders the conversation with the last-known status (`status_change` from the log). If status was `working` at crash time, the client should treat it as stale and surface a "turn was interrupted" indicator — derived purely from "last status was working AND no subsequent event for >TIMEOUT."

### 12.2 Parallel sub-agents

- A sub-agent is its own session with its own log.
- Parent emits `subagent_started` (durable) at spawn time, with the child's sessionId and the parent tool call.
- Parent emits `subagent_finished` when result returns.
- Concurrent sub-agents do not write to the parent. They write to their own logs.
- Subscribers wanting live sub-agent visibility subscribe to the child sessionId.

### 12.3 Out-of-order WS arrival

- Clients reorder by `seq` always. Never by arrival order.
- Deltas are not seqd; they're tied to `blockId`. Out-of-order text deltas are concatenated by arrival into the in-flight buffer; if a delta arrives after the durable `assistant_message` for that block (rare but possible across reconnect), it's discarded.
- On reconnect, client always sends `sinceSeq = local.lastSeq` and trusts the backlog reply to fill any gaps.

### 12.4 Pre-creation drafts

- Drafts are client-only (zustand + localStorage), keyed by a transient `draftId`.
- On submit: client sends `session_input` with a `createIfMissing: { provider, model, projectId }` hint. Server creates the session, appends the `user_message` event, returns the new sessionId.
- Refresh during draft: localStorage preserves the draft; on reload the user can re-submit. No cross-tab draft sync (out of scope; can use `BroadcastChannel` later).

### 12.5 WS reconnect

- Client reconnects, reauthenticates, resubscribes to all sessions it cares about with their respective `sinceSeq` values.
- Server replies with backlog + snapshot per session.
- Client outbox: messages composed during disconnect (rare — typically the UI gates input on connection state) are queued in localStorage and flushed on `session_subscribed`.

### 12.6 Session deletion

- Server appends `session_destroyed` to the event log (durable).
- Server emits `session_destroyed` on the sessions-list channel.
- Server schedules dir removal after a short tombstone window (e.g. 5 minutes) so any in-flight subscribers finish gracefully.
- Subscribers receive `session_destroyed`; they unsubscribe.

### 12.7 Session rename / model switch

- `meta_update` event with the changed fields. Durable. Replayable.
- `meta.json` cache file is updated as a side effect; it's not authoritative.

### 12.8 Compaction

- `compaction` event records `{ summary, replacedSeqRange }`.
- Subsequent reads of "context for next turn" use the latest compaction event + events after `replacedSeqRange.end`. The replaced events stay in the log (durable history) but are not loaded into the LLM context.
- Long-term: roll-over compaction (snapshot summary + truncate prefix to a frozen "snapshot.jsonl"). Out of scope for v1.

### 12.9 Memory extraction

- Runs after turn end; emits `memory_extracted` event for observability.
- Memory contents themselves are written to `~/.anton/memory/` (or project memory) by an existing path — that's not session state.
- The event is the audit trail: "at seq N, we extracted these N memories from this conversation."

### 12.10 Prompted interactions (`ask_user`, `plan_confirm`, `confirm`)

- Prompt event is durable: e.g. `ask_user { promptId, questions }`.
- Response event is durable, with `parentSeq` pointing at the prompt: `ask_user_response { promptId, answers }`.
- A reconnecting client sees both, in order, and renders the resolved Q&A. A late joiner mid-prompt sees the unresolved prompt and can answer it.
- Server side: the agent's wait for the response is keyed by `promptId`; the response event triggers resolution.

### 12.11 Webhook-originated input

- Webhook receives a message → `channel.publishDurable({ kind:'user_message', payload:{ content, attachments, origin:{ source:'slack', userId, threadTs } } })`.
- The bot's reply is just a subscriber that reacts to `assistant_message` events for that session.
- Origin metadata travels with the event so any subscriber can render "via Slack from @user" badges.

## 13. Today's storage layout (for migration reference)

What we're replacing:

```
~/.anton/conversations/
├── index.json                           # SessionIndex {syncVersion, sessions[], deltas[]}
└── <sessionId>/
    ├── meta.json                        # title, provider, model, messageCount, usage, compactionCount
    ├── messages.jsonl                   # one SessionMessage per line
    ├── compaction.json                  # {summary, compactedMessageCount, …}
    ├── tasks.json                       # PersistedTaskItem[]
    ├── sub-agent-history.jsonl          # PersistedSubAgentHistoryEntry[]
    └── images/
        └── <msgIndex>-<blockIndex>-name.ext

~/.anton/projects/<projectId>/conversations/    # mirrors the global tree
```

Mapping to new layout:

| Today | New | Notes |
|---|---|---|
| `messages.jsonl` (user/assistant/tool blocks) | `events.jsonl` (typed events) | one-shot reader translates legacy → events on first open |
| `meta.json` | rebuilt from events; cached for fast list | not authoritative |
| `tasks.json` | rebuilt from latest `task_update` event | not authoritative |
| `compaction.json` | rebuilt from latest `compaction` event | not authoritative |
| `sub-agent-history.jsonl` | parent emits `subagent_started`/`subagent_finished`; child has its own log | linkage by sub-agent sessionId |
| `images/<n>-<m>-name.ext` | `attachments/<seq>.bin` + `attachment_added` event | content-addressable by seq |
| `index.json` | `sessions-meta.jsonl` (event log) | sidebar subscribes |

## 14. End-to-end trace

User in tab 1 types a question. Tab 2 is open. Tab 3 opens mid-turn.

```
tab1 ──► server: { type:'session_input', sessionId, input:{text:"..."} }

server: channel.publishDurable({ kind:'user_message', payload:{...} })
        → log.append → seq=42, fsync scheduled
        → fan-out  session_event(seq=42)  → tab1, tab2

server: channel.publishDurable({ kind:'status_change', status:'working' })
        → seq=43 → fan-out

server starts turn → provider.run()

provider streams "Looking…"
  channel.publishDelta(text_delta, blockId=B1)
  → in-flight buffer = "Looking…"
  → fan-out session_delta → tab1, tab2

provider issues tool_call
  channel.publishDurable({ kind:'tool_call', payload:{...}, turnId })
  → seq=44 → fan-out

[tab3 connects here]
tab3 ──► server: { type:'session_subscribe', sessionId, sinceSeq:0 }
server: backlog = log.read({sinceSeq:1}) = [seq 1..44]
        snapshot = inFlightBlock { B1, partial:"Looking…" }
        reply: session_subscribed { backlog, snapshot, currentSeq:44 }
tab3 renders backlog + partial assistant block. caught up.

tool_result returns
  channel.publishDurable({ kind:'tool_result', payload:{...}, parentSeq:44 })
  → seq=45 → fan-out → tab1, tab2, tab3

block finalizes
  channel.publishDurable({ kind:'assistant_message', payload:{blocks:[...]}, turnId })
  → seq=46 → fan-out
  → inFlightBlock = null

turn ends
  channel.publishDurable({ kind:'status_change', status:'idle' })
  → seq=47 → fan-out, fsync flushed
```

If the agent crashes between seq 45 and 46: on restart, `recover()` finds last valid line is seq=45 (or earlier if 45 was torn). The in-flight assistant text is gone (deltas were ephemeral). Tabs reconnecting see status `working` from seq=43 with no subsequent transition; client surfaces "turn interrupted."

## 15. Acceptance scenarios

These must pass before a phase is considered done.

### Phase 1 (SessionLog)

- A1. `append → read` returns identical events in seq order.
- A2. Torn last line on disk: `recover()` truncates and `tail().lastSeq` matches the last well-formed event.
- A3. Append 100k events; `read({sinceSeq:90000, limit:1000})` runs in < 50ms (with index).
- A4. Concurrent reader during writes does not see partial JSON.
- A5. Payload > LINE_MAX is externalized; round-trip read returns the original bytes via `contentRef`.

### Phase 2 (SessionChannel + multi-client)

- B1. Two simulated WS clients subscribe; both receive the same events in the same order.
- B2. Client B connects mid-stream; receives backlog + snapshot of in-flight block; subsequent durable events arrive only once.
- B3. Slow client falls behind; deltas drop under soft limit; durables are preserved or it's disconnected at hard limit.
- B4. No `auth_ok` from a second client severs the first client.

### Phase 3 (Pi SDK adapter)

- C1. A turn produces the same logical event set on disk as a snapshot of pre-migration `messages.jsonl` (after format conversion).
- C2. `Session.persist()` is no longer called; no `writeFileSync(...messages.jsonl...)` happens. (Verified by FS spy.)
- C3. Mid-turn `getHistory()` returns events through last finalized event.

### Phase 4 (Harness adapter)

- D1. Mid-turn second tab sees in-flight events: every harness `tool_call`, `tool_result`, and finalized assistant block appears within 100ms of provider emission.
- D2. 25-minute Codex run is observable in real time; `appendHarnessTurn` is no longer called.
- D3. Agent killed mid-turn; restart; on subscribe, last durable event matches the last completed harness event.

### Phase 5 (Wire protocol)

- E1. Three tabs of same session: identical state on every event.
- E2. Mobile + desktop simultaneously connected: identical state.
- E3. Reconnect with `sinceSeq = N` returns exactly events from N+1 onward.

### Phase 6 (Cleanup)

- F1. `STUCK_STATE_TIMEOUT_MS` deleted.
- F2. No `chat_event` / `session_history_response` / `sessions_sync_response` in the codebase.
- F3. `tasks.json`, `compaction.json`, `sub-agent-history.jsonl` no longer written; old files readable for migration.

## 16. Compatibility & rollout

- **Feature flag** `session_log_v2` gates new code paths in agent-server. Defaults off.
- Phases 1–4 land with the flag off. Code is built but not exercised on real sessions.
- Phase 5 enables the flag in dev; both old and new clients can connect.
- **Dual-write window** (one release): when flag is on, server writes to both `events.jsonl` and the legacy sidecars. Lets us roll back without data loss.
- **Old client + new server**: server detects `session_subscribe` absence, falls back to legacy frames synthesized from event log.
- **New client + old server**: client falls back to legacy frames if `session_subscribed` reply not received within 1s of `session_subscribe`.
- Phase 6 removes the dual-write and the legacy code paths.

## 17. Migration plan

Phased, additive, reversible.

### Phase 1 — Build `SessionLog` (agent-core)

- New package: `packages/agent-core/src/session-log/`
  - `index.ts` — `SessionLog` class
  - `format.ts` — schema + version
  - `index-file.ts` — binary `.idx` reader/writer
  - `legacy-reader.ts` — read existing `messages.jsonl` (Pi SDK + harness formats), `meta.json`, `tasks.json`, `compaction.json`, `sub-agent-history.jsonl` into `SessionEvent[]`
  - `tests/` — A1–A5

### Phase 2 — Build `SessionChannel` + multi-client WS

- `packages/agent-server/src/session-channel.ts`
- `packages/agent-server/src/session-registry.ts` — `Map<sessionId, SessionChannel>`
- Replace `activeClient` with `Set<ClientConn>`. Auth no longer displaces.
- Tests: B1–B4.

### Phase 3 — Pi SDK adapter

- `packages/agent-core/src/providers/pi-adapter.ts`
- Stop calling `Session.persist()` / `saveSession()`.
- Tests: C1–C3.

### Phase 4 — Harness adapter

- Replace `mirror.ts:appendHarnessTurn` with per-event `publishDurable`.
- `tryReadHarnessHistory` becomes a passthrough to `log.read`.
- Tests: D1–D3.

### Phase 5 — Wire protocol + clients

- Add `session_subscribe` / `session_event` / `session_delta` to `packages/protocol`.
- Client (`packages/desktop`, `packages/mobile`): on conversation open, send `session_subscribe { sinceSeq }`. On reconnect, resubscribe with current local `lastSeq`. Drop ad-hoc handlers.
- Tests: E1–E3.

### Phase 6 — Cleanup

- Delete `chat_event` / per-message ad-hoc frames.
- Delete `requestSessionHistory` from open path; keep only as `session_history` for explicit pagination.
- Delete `STUCK_STATE_TIMEOUT_MS`.
- Trim `conversationCache.ts` migration code.
- Stop dual-writing legacy sidecars.
- Tests: F1–F3.

Each phase independently shippable.

## 18. Risks & open questions

| Risk | Mitigation |
|---|---|
| Append-only log grows unbounded | Compaction roll-over (snapshot+truncate); not blocking v1 |
| `events.idx` and `events.jsonl` get out of sync on crash | Tail-rebuild the index from the log on every boot |
| Large tool results inflate line size | Externalize payloads >LINE_MAX (4KB) to `attachments/<seq>.bin` |
| Schema evolution | `v` field on every line; reader skips unknown `kind` with warning |
| Slow client stalls fan-out | Per-subscriber bounded queue; drop deltas under pressure; disconnect on hard limit |
| Concurrent producers (webhook + user input) | Channel serializes appends per session; all producers funnel through the same writer |
| Two agent processes accidentally writing same session | Lockfile in session dir; second process refuses to start writer |
| Mid-turn block deltas vs durable assistant_message ordering on reconnect | Client always trusts durable; discards deltas for an already-finalized blockId |
| Webhook origin metadata leaking into LLM context | Origin lives in event payload but provider adapter strips before building LLM messages |
| Sub-agent storms (many spawn at once) | Each child has its own log; no per-parent serialization needed |

### Open questions

1. Do we want `session_event_ack` from clients to enable server-side cleanup of broadcast queues for slow clients? **Recommend: no.** Disconnect + replay is simpler.
2. Should `SessionDelta` carry a monotonic `deltaSeq`? **Recommend: no.** Block lifetime is short; snapshot is enough.
3. Index file format: binary fixed-record (proposed) vs jsonl sidecar (debug-friendlier)? **Recommend binary.** Behind a dev flag, also emit jsonl for debugging.
4. Where do tasks live during a turn — events only, or also a derived in-memory projection on the server? **Recommend: derived from log on demand; no separate state.**
5. Memory extraction event payload: full extracted entries, or just a count? **Recommend: count + scope only; entries live in the memory store, not the session log.** (Avoids duplicating PII.)
6. Should we keep a write-through `meta.json` cache for sidebar speed, or compute from log on each list request? **Recommend: write-through cache, rebuild on mismatch.**

## 19. What this kills

- Single-active-client model.
- Pi SDK / harness asymmetry in persistence.
- Full-file rewrite of `messages.jsonl` per persist.
- Overlap between `chat_event`, `session_history_response`, `session_sync`, `tasks_update`.
- `STUCK_STATE_TIMEOUT_MS` band-aid.
- `tasks.json`, `compaction.json`, `sub-agent-history.jsonl` as authoritative sidecars.
- Status events being ephemeral.
- Steering being lost from history.
- Provider/model switch being silent on disk.
- "Tab 2 silently drops the live turn" bug.

## 20. Appendix — type sketches

```ts
// packages/agent-core/src/session-log/format.ts

export type EventKind =
  | 'user_message'
  | 'user_steering'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'status_change'
  | 'task_update'
  | 'meta_update'
  | 'usage'
  | 'compaction'
  | 'attachment_added'
  | 'subagent_started'
  | 'subagent_finished'
  | 'ask_user'
  | 'ask_user_response'
  | 'plan_confirm'
  | 'plan_response'
  | 'confirm'
  | 'confirm_response'
  | 'memory_extracted'
  | 'session_destroyed'

export type DeltaKind = 'text_delta' | 'thinking_delta' | 'tool_progress' | 'heartbeat'

export interface SessionEvent {
  v: 1
  seq: number
  ts: number
  turnId?: string
  parentSeq?: number
  kind: EventKind
  payload: unknown   // narrowed per kind via PayloadOf<K>
}

export interface SessionDelta {
  sessionId: string
  blockId: string
  kind: DeltaKind
  value: string | number
  ts: number
}

// packages/agent-core/src/session-log/index.ts

export class SessionLog {
  static open(dir: string): Promise<SessionLog>
  append<K extends EventKind>(input: { kind: K, payload: PayloadOf<K>, turnId?: string, parentSeq?: number }): SessionEvent
  read(opts: { sinceSeq?: number, beforeSeq?: number, limit?: number }): SessionEvent[]
  tail(): { lastSeq: number, lastTurnId?: string }
  flush(): Promise<void>
  close(): Promise<void>
  // recover() runs implicitly in open()
}
```
