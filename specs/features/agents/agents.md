# Routines — Architecture Spec

## Core Idea

A routine is a conversation that runs on a schedule. Nothing more.

Every conversation in Anton already has: message history, tool access, MCP connectors, workspace, memory. A routine adds one thing: a cron schedule that triggers it automatically.

```
~/.anton/projects/{projectId}/conversations/{sessionId}/
├── meta.json          ← every conversation has this
├── messages.jsonl     ← every conversation has this
├── agent.json         ← ONLY present if this conversation is an agent
```

## agent.json

```typescript
interface RoutineRunRecord {
  startedAt: number               // When the run began
  completedAt: number | null      // When the run ended (null if still running)
  status: 'success' | 'error' | 'timeout'
  error?: string                  // Error message if failed
  durationMs?: number             // completedAt - startedAt
  trigger: 'cron' | 'manual'     // What triggered this run
}

interface RoutineMetadata {
  name: string                    // "Daily Reddit Quotes"
  description: string             // "Finds AI quotes from Reddit"
  instructions: string            // What to do on each run
  schedule?: { cron: string }     // "0 9 * * *" — null means manual-only
  originConversationId?: string   // Parent conversation (for result delivery)
  tokenBudget?: {
    perRun: number
    monthly: number
    usedThisMonth: number
  }
  status: 'idle' | 'running' | 'paused' | 'error'
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  createdAt: number
  runHistory?: RoutineRunRecord[]   // Last 20 runs (ring buffer)
}
```

## How It Works

### Creation

1. User in conversation A: "find me AI quotes from Reddit every day"
2. Anton calls `agent` tool → user sees confirmation dialog → approves
3. `AgentManager.createAgent()` creates conversation directory + `agent.json`
4. `originConversationId` set to A (the human's conversation)
5. UI shows new routine card in the Routines tab

### Execution — Fresh Session Per Run + Persistent Memory

Each run creates a **fresh conversation** with routine instructions + memory in the system prompt. No accumulated context bloat.

```
~/.anton/projects/{projectId}/conversations/{agentSessionId}/
├── agent.json     ← metadata, schedule, runHistory
├── memory.md      ← persistent memory across runs (<2000 chars)
```

1. `AgentManager.tick()` runs every 30s, checks cron schedules
2. Collects all due routines, then runs them **sequentially with await**
3. `runAgent()` loads `memory.md` from disk
4. Server creates a fresh ephemeral session (`agent-run--{agentId}--{timestamp}`)
5. System prompt includes an "Agent Context" `<system-reminder>` block with standing instructions + run history
6. Short trigger message sent (not the full instructions)
7. Routine runs autonomously (auto-approve confirms, skip ask_user)
8. On completion: extracts last assistant text as summary, saves to `memory.md`
9. Run record saved with `runSessionId` for log viewing

Each run is recorded as a `RoutineRunRecord` with start/end timestamps, duration, status, trigger type, and `runSessionId`. History capped at 20 entries.

**Run logs:** Each run's logs can be fetched via `routine_run_logs` protocol message using the `runSessionId`. Returns the full conversation from that specific run session.

### Routine Memory

Routines have a `memory.md` file that persists across runs. After each successful run, the assistant's last response is saved as memory (capped at 2000 chars). This tells the next run:
- What scripts/tooling were built and where they live
- What happened in the last run (success/failure, key metrics)
- What to re-use vs what to rebuild

The memory is injected into the system prompt via the "## Run History" section inside the "Agent Context" `<system-reminder>` block. The routine sees its instructions + run history + a short trigger — enough context to execute without rebuilding.

### First Run vs Subsequent Runs

**First run:** No memory exists. Trigger says "Build any scripts or tooling you need." Routine reads instructions from system prompt, builds everything, returns results. Summary saved to `memory.md`.

**Subsequent runs:** Memory loaded from `memory.md`. Trigger says "Re-use existing scripts." Routine reads memory ("I built generate_dashboard.py at /home/anton/..."), re-runs it. Fresh context window — no bloat from 100 previous runs.

### Result Delivery

The routine has a `deliver_result` tool. When it has meaningful results, it calls this tool with the content. The server:

1. Appends the result as a message to the `originConversationId` conversation via `appendMessageToSession()`
2. Updates the session index (`updateIndex()`) so the metadata change is synced to clients via the delta protocol
3. Sends a `routine_result_delivered` message to the client on the AI channel

The desktop client handles `routine_result_delivered` in `projectHandler.ts`:
- Refreshes the origin conversation's message history (so the user sees the new message if that conversation is open)
- Re-fetches the project sessions list (so metadata like message count updates in the UI)

External delivery (Telegram, email, Slack) is just part of the routine's instructions + MCP access. No special infrastructure needed.

### Flat Ownership

All routines are children of the root human conversation. If routine A creates routine B, B's `originConversationId` points to the original human conversation, not to A. `resolveRootConversation()` walks up the chain.

```
User's conversation
  ├── Routine A (daily reddit)
  ├── Routine B (created by A, but owned by user)
  └── Routine C (also flat)
```

### User Interaction — Conversation-First Model

Clicking a routine opens **the routine's own conversation** (its `agent--` session). This shows the actual messages from cron/manual runs — tool calls, outputs, errors.

**Flow:**
1. User clicks routine card in ProjectLanding
2. Client opens the routine's own `agent--{projectId}--{suffix}` session and requests its history
3. `RoutineEmptyState` renders: routine name, description, stats (last run, next run, run count, tokens), expandable instructions, scheduler debug panel (cron expression, status, exact next/last run timestamps), collapsible run history (last 20 runs with status, duration, trigger type, clickable to view run logs in a modal), Run/Stop button, and a chat input
4. Run history entries with >100ms duration show a terminal icon — clicking opens a modal with the full conversation trace for that run
5. User can also type messages to interact with the routine directly

**Why this model:**
- Each conversation with a routine is a distinct interaction the user can reference later
- Routine conversations show alongside regular project threads in the sidebar
- The routine's instructions and context are naturally embedded in the conversation history
- No special session resumption logic needed — it's just a conversation

**When messages exist**, `RoutineChatHeader` renders above the message list showing routine status, schedule, and run/stop controls. The breadcrumb shows `Project / RoutineName`.

**Background scheduled runs** still use the routine's own `agent--` session ID. Those are separate from user-initiated conversations and are managed by `AgentManager.tick()`.

## Files

| File | Purpose |
|------|---------|
| `packages/protocol/src/projects.ts` | `RoutineMetadata`, `RoutineSession` types |
| `packages/protocol/src/messages.ts` | Routine protocol messages |
| `packages/agent-config/src/projects.ts` | `loadAgentMetadata()`, `saveAgentMetadata()`, `listProjectAgents()` |
| `packages/agent-server/src/agents/agent-manager.ts` | CRUD + cron scheduler + sendMessage bridge |
| `packages/agent-server/src/agents/cron.ts` | Cron expression parser |
| `packages/agent-server/src/server.ts` | Routine handlers, `buildAgentActionHandler()`, `buildDeliverResultHandler()` |
| `packages/agent-core/src/tools/job.ts` | `AgentToolInput` type, `JobActionHandler` callback |
| `packages/agent-core/src/tools/deliver-result.ts` | `DeliverResultHandler` callback |
| `packages/agent-core/src/agent.ts` | `agent` tool + `deliver_result` tool definitions |
| `packages/desktop/src/components/projects/ProjectLanding.tsx` | Routine cards, `onOpenAgent` callback |
| `packages/desktop/src/components/projects/ProjectView.tsx` | `handleOpenAgent()` creates new conversation per click |
| `packages/desktop/src/components/chat/RoutineEmptyState.tsx` | Routine-specific empty state UI |
| `packages/desktop/src/components/chat/RoutineChatHeader.tsx` | Inline routine header above messages |
| `packages/desktop/src/components/RoutineChat.tsx` | Branches between routine/regular UI, injects routine context |
| `packages/desktop/src/lib/conversations.ts` | `Conversation.agentSessionId` field |
| `packages/desktop/src/lib/store.ts` | `projectRoutines: RoutineSession[]`, `getActiveAgentSession()` selector |
| `packages/desktop/src/lib/agent-utils.ts` | `cronToHuman()`, `formatRelativeTime()`, `formatDuration()`, `formatAbsoluteTime()` shared helpers |
| `packages/desktop/src/lib/store/handlers/projectHandler.ts` | `routine_result_delivered` handler, routine CRUD handlers |
| `packages/desktop/src/lib/connection.ts` | `sendRoutineCreate()`, `sendRoutinesList()`, `sendRoutineAction()` |
| `packages/agent/prompts/system.md` | Routine execution rules, tool-building instructions |

## Protocol Messages

**Client → Server:**
- `routine_create` — create a new routine
- `routines_list` — list routines in a project (returns current status from server memory)
- `routine_action` — start / stop / delete / pause / resume
- `routine_run_logs` — fetch logs for a specific run (by time window)

**Server → Client:**
- `routine_created` — routine was created
- `routines_list_response` — list of routines with live status (idle/running/error/paused)
- `routine_updated` — routine status changed (real-time push during runs)
- `routine_deleted` — routine was removed
- `routine_result_delivered` — routine sent results to origin conversation
- `routine_run_logs_response` — logs for a specific run

### Status as Source of Truth

Routine status is persisted in `agent.json` and kept in memory by `AgentManager`. The `routines_list_response` always returns the live status. The client re-fetches `routines_list` on:
- Project landing mount
- WebSocket reconnect
- `routine_updated` events update the in-memory list in real-time

Routine status values: `idle` (waiting), `running` (currently executing), `error` (last run failed), `paused` (user disabled). The UI maps these to display labels: Scheduled (idle + has cron), Running, Error, Paused, Idle (no cron).

## Session ID Format

Routine sessions use `agent--{projectId}--{suffix}` format. The `--` delimiter makes projectId extraction unambiguous regardless of what characters the projectId contains.

## Confirmation

Routine creation and deletion require user confirmation via `ask_user`. This is enforced at the tool level — the LLM cannot bypass it.

## What Routines Are NOT

- **Not sub-agents.** Sub-agents are ephemeral parallel workers that run for seconds and return results inline. Routines are persistent scheduled conversations.
- **Not shell jobs.** Routines are AI conversations, not process managers. If you need to run a shell command, the routine uses the `shell` tool inside its conversation.
- **Not a separate system.** A routine is a conversation. Same infrastructure, same persistence, same tools. The only difference is `agent.json`.
