# Agents — Architecture Spec

## Core Idea

An agent is a conversation that runs on a schedule. Nothing more.

Every conversation in Anton already has: message history, tool access, MCP connectors, workspace, memory. An agent adds one thing: a cron schedule that triggers it automatically.

```
~/.anton/projects/{projectId}/conversations/{sessionId}/
├── meta.json          ← every conversation has this
├── messages.jsonl     ← every conversation has this
├── agent.json         ← ONLY present if this conversation is an agent
```

## agent.json

```typescript
interface AgentRunRecord {
  startedAt: number               // When the run began
  completedAt: number | null      // When the run ended (null if still running)
  status: 'success' | 'error' | 'timeout'
  error?: string                  // Error message if failed
  durationMs?: number             // completedAt - startedAt
  trigger: 'cron' | 'manual'     // What triggered this run
}

interface AgentMetadata {
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
  runHistory?: AgentRunRecord[]   // Last 20 runs (ring buffer)
}
```

## How It Works

### Creation

1. User in conversation A: "find me AI quotes from Reddit every day"
2. Anton calls `agent` tool → user sees confirmation dialog → approves
3. `AgentManager.createAgent()` creates conversation directory + `agent.json`
4. `originConversationId` set to A (the human's conversation)
5. UI shows new agent card in the Agents tab

### Execution — Fresh Session Per Run + Persistent Memory

Each run creates a **fresh conversation** with agent instructions + memory in the system prompt. No accumulated context bloat.

```
~/.anton/projects/{projectId}/conversations/{agentSessionId}/
├── agent.json     ← metadata, schedule, runHistory
├── memory.md      ← persistent memory across runs (<2000 chars)
```

1. `AgentManager.tick()` runs every 30s, checks cron schedules
2. Collects all due agents, then runs them **sequentially with await**
3. `runAgent()` loads `memory.md` from disk
4. Server creates a fresh ephemeral session (`agent-run--{agentId}--{timestamp}`)
5. System prompt includes an "Agent Context" `<system-reminder>` block with standing instructions + run history
6. Short trigger message sent (not the full instructions)
7. Agent runs autonomously (auto-approve confirms, skip ask_user)
8. On completion: extracts last assistant text as summary, saves to `memory.md`
9. Run record saved with `runSessionId` for log viewing

Each run is recorded as an `AgentRunRecord` with start/end timestamps, duration, status, trigger type, and `runSessionId`. History capped at 20 entries.

**Run logs:** Each run's logs can be fetched via `agent_run_logs` protocol message using the `runSessionId`. Returns the full conversation from that specific run session.

### Agent Memory

Agents have a `memory.md` file that persists across runs. After each successful run, the assistant's last response is saved as memory (capped at 2000 chars). This tells the next run:
- What scripts/tooling were built and where they live
- What happened in the last run (success/failure, key metrics)
- What to re-use vs what to rebuild

The memory is injected into the system prompt via the "## Run History" section inside the "Agent Context" `<system-reminder>` block. The agent sees its instructions + run history + a short trigger — enough context to execute without rebuilding.

### First Run vs Subsequent Runs

**First run:** No memory exists. Trigger says "Build any scripts or tooling you need." Agent reads instructions from system prompt, builds everything, returns results. Summary saved to `memory.md`.

**Subsequent runs:** Memory loaded from `memory.md`. Trigger says "Re-use existing scripts." Agent reads memory ("I built generate_dashboard.py at /home/anton/..."), re-runs it. Fresh context window — no bloat from 100 previous runs.

### Result Delivery

The agent has a `deliver_result` tool. When it has meaningful results, it calls this tool with the content. The server:

1. Appends the result as a message to the `originConversationId` conversation via `appendMessageToSession()`
2. Updates the session index (`updateIndex()`) so the metadata change is synced to clients via the delta protocol
3. Sends an `agent_result_delivered` message to the client on the AI channel

The desktop client handles `agent_result_delivered` in `projectHandler.ts`:
- Refreshes the origin conversation's message history (so the user sees the new message if that conversation is open)
- Re-fetches the project sessions list (so metadata like message count updates in the UI)

External delivery (Telegram, email, Slack) is just part of the agent's instructions + MCP access. No special infrastructure needed.

### Flat Ownership

All agents are children of the root human conversation. If agent A creates agent B, B's `originConversationId` points to the original human conversation, not to A. `resolveRootConversation()` walks up the chain.

```
User's conversation
  ├── Agent A (daily reddit)
  ├── Agent B (created by A, but owned by user)
  └── Agent C (also flat)
```

### User Interaction — Conversation-First Model

Clicking an agent opens **the agent's own conversation** (its `agent--` session). This shows the actual messages from cron/manual runs — tool calls, outputs, errors.

**Flow:**
1. User clicks agent card in ProjectLanding
2. Client opens the agent's own `agent--{projectId}--{suffix}` session and requests its history
3. `AgentEmptyState` renders: agent name, description, stats (last run, next run, run count, tokens), expandable instructions, scheduler debug panel (cron expression, status, exact next/last run timestamps), collapsible run history (last 20 runs with status, duration, trigger type, clickable to view run logs in a modal), Run/Stop button, and a chat input
4. Run history entries with >100ms duration show a terminal icon — clicking opens a modal with the full conversation trace for that run
5. User can also type messages to interact with the agent directly

**Why this model:**
- Each conversation with an agent is a distinct interaction the user can reference later
- Agent conversations show alongside regular project threads in the sidebar
- The agent's instructions and context are naturally embedded in the conversation history
- No special session resumption logic needed — it's just a conversation

**When messages exist**, `AgentChatHeader` renders above the message list showing agent status, schedule, and run/stop controls. The breadcrumb shows `Project / AgentName`.

**Background scheduled runs** still use the agent's own `agent--` session ID. Those are separate from user-initiated conversations and are managed by `AgentManager.tick()`.

## Files

| File | Purpose |
|------|---------|
| `packages/protocol/src/projects.ts` | `AgentMetadata`, `AgentSession` types |
| `packages/protocol/src/messages.ts` | Agent protocol messages |
| `packages/agent-config/src/projects.ts` | `loadAgentMetadata()`, `saveAgentMetadata()`, `listProjectAgents()` |
| `packages/agent-server/src/agents/agent-manager.ts` | CRUD + cron scheduler + sendMessage bridge |
| `packages/agent-server/src/agents/cron.ts` | Cron expression parser |
| `packages/agent-server/src/server.ts` | Agent handlers, `buildAgentActionHandler()`, `buildDeliverResultHandler()` |
| `packages/agent-core/src/tools/job.ts` | `AgentToolInput` type, `JobActionHandler` callback |
| `packages/agent-core/src/tools/deliver-result.ts` | `DeliverResultHandler` callback |
| `packages/agent-core/src/agent.ts` | `agent` tool + `deliver_result` tool definitions |
| `packages/desktop/src/components/projects/ProjectLanding.tsx` | Agent cards, `onOpenAgent` callback |
| `packages/desktop/src/components/projects/ProjectView.tsx` | `handleOpenAgent()` creates new conversation per click |
| `packages/desktop/src/components/chat/AgentEmptyState.tsx` | Agent-specific empty state UI |
| `packages/desktop/src/components/chat/AgentChatHeader.tsx` | Inline agent header above messages |
| `packages/desktop/src/components/AgentChat.tsx` | Branches between agent/regular UI, injects agent context |
| `packages/desktop/src/lib/conversations.ts` | `Conversation.agentSessionId` field |
| `packages/desktop/src/lib/store.ts` | `projectAgents: AgentSession[]`, `getActiveAgentSession()` selector |
| `packages/desktop/src/lib/agent-utils.ts` | `cronToHuman()`, `formatRelativeTime()`, `formatDuration()`, `formatAbsoluteTime()` shared helpers |
| `packages/desktop/src/lib/store/handlers/projectHandler.ts` | `agent_result_delivered` handler, agent CRUD handlers |
| `packages/desktop/src/lib/connection.ts` | `sendAgentCreate()`, `sendAgentsList()`, `sendAgentAction()` |
| `packages/agent/prompts/system.md` | Agent execution rules, tool-building instructions |

## Protocol Messages

**Client → Server:**
- `agent_create` — create a new agent
- `agents_list` — list agents in a project (returns current status from server memory)
- `agent_action` — start / stop / delete / pause / resume
- `agent_run_logs` — fetch logs for a specific run (by time window)

**Server → Client:**
- `agent_created` — agent was created
- `agents_list_response` — list of agents with live status (idle/running/error/paused)
- `agent_updated` — agent status changed (real-time push during runs)
- `agent_deleted` — agent was removed
- `agent_result_delivered` — agent sent results to origin conversation
- `agent_run_logs_response` — logs for a specific run

### Status as Source of Truth

Agent status is persisted in `agent.json` and kept in memory by `AgentManager`. The `agents_list_response` always returns the live status. The client re-fetches `agents_list` on:
- Project landing mount
- WebSocket reconnect
- `agent_updated` events update the in-memory list in real-time

Agent status values: `idle` (waiting), `running` (currently executing), `error` (last run failed), `paused` (user disabled). The UI maps these to display labels: Scheduled (idle + has cron), Running, Error, Paused, Idle (no cron).

## Session ID Format

Agent sessions use `agent--{projectId}--{suffix}` format. The `--` delimiter makes projectId extraction unambiguous regardless of what characters the projectId contains.

## Confirmation

Agent creation and deletion require user confirmation via `ask_user`. This is enforced at the tool level — the LLM cannot bypass it.

## What Agents Are NOT

- **Not sub-agents.** Sub-agents are ephemeral parallel workers that run for seconds and return results inline. Agents are persistent scheduled conversations.
- **Not shell jobs.** Agents are AI conversations, not process managers. If you need to run a shell command, the agent uses the `shell` tool inside its conversation.
- **Not a separate system.** An agent is a conversation. Same infrastructure, same persistence, same tools. The only difference is `agent.json`.
