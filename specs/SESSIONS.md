# Anton — Session Persistence & Compaction Spec

> How anton stores conversations, manages history, compacts context, and handles session lifecycle on the agent VM.
> Sessions are the source of truth — they live on the server, not on the client.

## Design Principles

1. **Server-first** — All session data lives on the agent VM (`~/.anton/sessions/`). Clients are thin views that fetch history on demand.
2. **Structured session logs** — Message history is stored as JSONL records that can be hydrated back into pi SDK state. Binary image payloads are stored beside the log, not embedded as anonymous UI state.
3. **Fast listing** — Session metadata is indexed separately from message content for instant UI rendering.
4. **Automatic compaction** — Long conversations are compressed transparently so users never hit context limits.

## Storage Layout

```
~/.anton/
├── config.yaml                          # agent configuration
├── sessions/
│   ├── index.json                       # lightweight index of all sessions
│   └── data/
│       ├── sess_abc123/
│       │   ├── meta.json                # session metadata (no messages)
│       │   ├── messages.jsonl           # structured message log
│       │   ├── images/                  # image attachments for this session only
│       │   │   └── 0001-01-diagram.png
│       │   └── compaction.json          # compaction state (summary, counts)
│       ├── sess_def456/
│       │   ├── meta.json
│       │   ├── messages.jsonl
│       │   ├── images/
│       │   └── compaction.json
│       └── ...
```

### Why this structure

- **index.json** — Fast listing without reading every session. The TUI and desktop app read this to show session history instantly (~1ms).
- **meta.json** — Per-session metadata. Separated from messages so metadata updates don't rewrite the message log.
- **messages.jsonl** — Structured message log. Each line is a self-contained JSON object representing one pi SDK message.
- **images/** — Session-local binary storage for user-supplied images. Files are scoped to a single chat session and referenced from `messages.jsonl` by relative path.
- **compaction.json** — Tracks compaction state: current summary, compacted message count, timestamps. Separated from messages because compaction rewrites the summary.

## index.json

Lightweight index for fast listing. Rebuilt from `data/*/meta.json` if corrupted or missing.

```json
{
  "version": 1,
  "sessions": [
    {
      "id": "sess_abc123",
      "title": "Deploy nginx with SSL",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "messageCount": 24,
      "createdAt": 1711036800000,
      "lastActiveAt": 1711038600000,
      "archived": false
    }
  ]
}
```

Sessions are sorted by `lastActiveAt` descending (most recent first).

## meta.json

Full session metadata. Source of truth for session state.

```json
{
  "id": "sess_abc123",
  "title": "Deploy nginx with SSL",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "createdAt": 1711036800000,
  "lastActiveAt": 1711038600000,
  "messageCount": 24,
  "archived": false,
  "tags": [],
  "parentSessionId": null,
  "compactionCount": 2,
  "lastCompactedAt": 1711038000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique ID, format: `sess_<base36_timestamp>` |
| title | string | Auto-generated from first user message, can be renamed |
| provider | string | AI provider (e.g., "anthropic", "openai") |
| model | string | Model ID (e.g., "claude-sonnet-4-6") |
| createdAt | number | Unix timestamp (ms) |
| lastActiveAt | number | Updated on every message |
| messageCount | number | Total messages (user + assistant + tool) |
| archived | boolean | Soft-delete: hidden from default list, still on disk |
| tags | string[] | User-applied tags for organization |
| parentSessionId | string? | If branched from another session |
| compactionCount | number? | How many times this session has been compacted |
| lastCompactedAt | number? | When the last compaction occurred |

## Session ↔ pi SDK

Each session wraps a **pi SDK Agent** instance (`@mariozechner/pi-agent-core`). The pi agent manages:

- The LLM message array (user, assistant, tool messages in provider format)
- The tool-calling loop (message → LLM → tools → execute → repeat)
- Streaming events (text deltas, tool calls, tool results)

The session adds on top:

- Persistence (save/load to disk after each turn)
- Compaction (two-layer context management)
- Confirmation flow (dangerous commands need approval)
- API key resolution (client > config > env)

### In-Memory State

```typescript
class Session {
  id: string
  provider: string
  model: string
  title: string
  createdAt: number
  lastActiveAt: number
  piAgent: PiAgent           // the actual LLM agent instance
  compactionState: CompactionState
  compactionConfig: CompactionConfig
  confirmHandler?: (command, reason) => Promise<boolean>
  clientApiKey?: string      // per-session override, never persisted
}
```

### Persistence Format

`messages.jsonl` stores one serialized pi SDK message per line. Text-only messages are stored inline. Image blocks are externalized into the session's `images/` directory and replaced with metadata that points back to the file.

Example `messages.jsonl` lines:

```json
{"role":"user","content":[{"type":"text","text":"What changed in this screenshot?"},{"type":"image","mimeType":"image/png","storagePath":"images/0001-01-screenshot.png","name":"screenshot.png","sizeBytes":248193}],"timestamp":1711036800000}
{"role":"assistant","content":[{"type":"text","text":"The header layout shifted to the left."}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-6","usage":{"input":812,"output":74,"cacheRead":0,"cacheWrite":0,"totalTokens":886,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1711036802400}
```

### Session Images

When a desktop client sends image attachments:

1. The client sends image bytes as base64 in the `message.attachments[]` payload.
2. The session runtime adds those images to the user message passed to the model.
3. On persistence, each image is written to `~/.anton/sessions/data/<sessionId>/images/`.
4. The corresponding message record stores a relative `storagePath` such as `images/0001-01-screenshot.png`.
5. On resume/history fetch, the server reads the file back from disk and hydrates the message with base64 again for the model/UI.

This gives each chat session a self-contained attachment namespace and avoids relying on client-local image state after the turn completes.

## Context Compaction

Long-running sessions accumulate messages that eventually exceed the model's context window. Compaction keeps sessions usable without losing important context.

### Two-Layer Strategy

**Layer 1: Tool Output Trimming** (runs on every LLM call via `transformContext` hook)

- Scans all messages except the most recent `preserveRecentCount` (default: 20)
- If any tool result exceeds `toolOutputMaxTokens` (default: 4000 tokens), truncates it
- Appends `[... output truncated, was ~X tokens ...]` to the truncated output
- Never mutates original messages — creates clones
- This runs silently on every turn as a preprocessing step

**Layer 2: LLM-Based Summarization** (triggered when approaching context limit)

- Triggers when estimated tokens exceed `threshold × maxContextTokens` (default: 80% of context window)
- Splits messages into two groups: **older** (to summarize) and **recent** (to preserve)
- Sends older messages to the LLM with a summarization prompt
- Replaces older messages with a single `[CONVERSATION SUMMARY]` system message
- Returns: `[summaryMessage, ...recentMessages]`

### Compaction Flow

```
Every LLM call:
  1. Apply Layer 1 (trim tool outputs) → trimmedMessages
  2. Estimate token count of trimmedMessages
  3. If tokens > threshold (80% of context window):
     a. Split: olderMessages | recentMessages (last 20)
     b. Serialize olderMessages to text
     c. Call LLM with summarization prompt
     d. Create summary message: "[CONVERSATION SUMMARY]\n{summary}"
     e. Return [summaryMessage, ...recentMessages]
  4. If tokens < threshold:
     Return trimmedMessages as-is
```

### Compaction Config

```yaml
# ~/.anton/config.yaml
compaction:
  enabled: true              # can be disabled entirely
  threshold: 0.80            # compact at 80% of context window
  preserveRecentCount: 20    # always keep last 20 messages verbatim
  toolOutputMaxTokens: 4000  # trim tool outputs longer than this (in tokens)
```

### Context Window Sizes

The compaction system infers `maxContextTokens` from the model ID:

| Model Pattern | Context Window |
|--------------|----------------|
| claude-opus-4* | 200,000 |
| claude-sonnet-4* | 200,000 |
| claude-haiku-4* | 200,000 |
| gpt-4o | 128,000 |
| gpt-4o-mini | 128,000 |
| o3, o4-mini | 200,000 |
| gemini-2.5-pro | 1,048,576 |
| gemini-2.5-flash | 1,048,576 |
| llama3* | 128,000 |
| Default | 128,000 |

### Compaction State

Tracked per-session and persisted to disk:

```typescript
interface CompactionState {
  summary: string | null          // current LLM-generated summary
  compactedMessageCount: number   // cumulative messages that have been summarized
  lastCompactedAt: number | null  // timestamp of last compaction
  compactionCount: number         // total number of compactions performed
}
```

### Manual Compaction

Users can force-compact at any time by sending `/compact` as a message:

```
/compact
/compact Focus on the deployment steps and ignore the debugging
```

Manual compaction bypasses the threshold check and always runs Layer 2. Custom instructions after `/compact` are included in the summarization prompt.

### Summarization Prompt

The LLM receives these instructions when summarizing:

- Preserve ALL file paths, function names, variable names, URLs, command outputs
- Preserve sequence of actions and their outcomes
- Note errors encountered and their resolutions
- Note current work state (what's done vs. what remains)
- Preserve user preferences and stated decisions
- Aim for < 20% of original length
- Use bullet points and structured formatting

### Token Estimation

Uses a ~4 characters per token heuristic (provider-agnostic):

```
tokens ≈ (characters / 4) + 4  // +4 per message for role/metadata overhead
```

This is deliberately rough — the goal is to trigger compaction early enough, not to be precise. Over-compacting is better than hitting the context limit.

## Session Lifecycle

### Create

```
1. Client sends: { type: "session_create", id: "sess_<base36>", provider?, model? }
2. Server creates pi SDK Agent instance with model + tools
3. Server persists initial meta.json
4. Server updates index.json
5. Server responds: { type: "session_created", id, provider, model }
```

### Message

```
1. Client sends: { type: "message", content: "...", sessionId: "sess_..." }
2. Server routes to the correct Session instance
3. Session calls piAgent.processMessage(content)
4. Session streams events back: thinking → text → tool_call → tool_result → done
5. Incremental persist: session state is saved after each tool_execution_end and turn_end
6. Final persist after turn completes (captures title, compaction state changes)
```

### Resume

```
1. Client sends: { type: "session_resume", id: "sess_..." }
2. Server checks in-memory sessions map
3. If not in memory: load from disk (meta.json + messages from PersistedSession)
4. Reconstruct pi SDK Agent with existing messages
5. Wire confirmation handler
6. Respond: { type: "session_resumed", id, provider, model, messageCount, title }
```

### Fetch History

```
1. Client sends: { type: "session_history", id: "sess_..." }
2. Server reads the pi SDK message array
3. Translates each message to client-friendly format (seq, role, content, toolName, etc.)
4. Responds: { type: "session_history_response", id, messages: [...] }
```

### Destroy

```
1. Client sends: { type: "session_destroy", id: "sess_..." }
2. Server removes from in-memory map
3. Server deletes session directory from disk
4. Server removes from index.json
5. Responds: { type: "session_destroyed", id }
```

### Auto-cleanup

```
On agent startup:
1. Read index.json
2. Archive sessions older than sessions.ttlDays (default: 7)
3. Delete sessions archived for > 7 days
4. Rebuild index.json from data/*/meta.json if index is stale
```

## Disconnect & Reconnection

### Incremental Persistence

Sessions persist incrementally during a turn, not just at the end:

- **After `tool_execution_end`** — the tool call and its result are saved to `messages.jsonl`
- **After `turn_end`** — the full assistant message is saved
- **Final persist** — captures title changes and compaction state

This means if the client disconnects mid-turn, all completed tool calls and their results are already on disk.

### On Client Disconnect

```
1. WebSocket closes (network drop, page reload, tab close)
2. Server detects disconnect in onclose handler
3. Server cancels all active turns for that client:
   a. Calls piAgent.abort() to stop in-flight LLM calls and tool executions
   b. Calls persist() to save current state to disk
4. Sessions remain in memory for fast resume
```

Active turns are **not** continued in the background. When the client disconnects, work stops. This prevents runaway costs and unexpected side effects from long-running agent tasks.

### On Client Reconnect

```
1. Client auto-reconnects (3-second retry)
2. Auth handshake completes
3. Client fetches sessions_list → syncs with local conversation cache
4. Client resumes active conversation's session
5. Client fetches session_history → receives all messages including partial turn work
6. UI renders the full conversation history up to the disconnect point
```

The client preserves conversations and UI state across disconnects. Only transient state (streaming indicators, agent steps, pending confirmations) is cleared.

## Client Architecture

### Server-First Design

Sessions are the source of truth on the agent VM. Clients behave as follows:

**On connect:**
1. Fetch `sessions_list` → populate sidebar with session titles/metadata
2. Fetch `providers_list` → populate model selector
3. Auto-resume the most recent session
4. Fetch `session_history` for the resumed session → render past messages

**On new conversation:**
1. Generate session ID client-side: `sess_<Date.now().toString(36)>`
2. Send `session_create` to server
3. Create local conversation linked to `sessionId`
4. Start chatting

**On switch conversation:**
1. Send `session_resume` to server
2. Send `session_history` to server
3. Replace displayed messages with history response

**Local state (thin cache):**
- Conversations are cached in localStorage with a `sessionId` field linking to the server session
- Messages are fetched from the server — local copies are for display only
- If local and server diverge, server wins

### Desktop App (Tauri)

The desktop app uses Zustand for state management:

```
AppState:
  connectionStatus    ← from connection.onStatusChange()
  agentStatus         ← from events channel (agent_status)
  currentSessionId    ← set on session_created/session_resumed
  currentProvider     ← set on session_created/providers_list_response
  currentModel        ← set on session_created/providers_list_response
  sessions[]          ← from sessions_list_response
  providers[]         ← from providers_list_response
  conversations[]     ← local cache linked to server sessions via sessionId
  pendingConfirm      ← from confirm messages
```

### CLI (Ink TUI)

The CLI follows the same protocol flow but stores state in-memory only (no localStorage). It auto-resumes the most recent session on connect and displays session list via `Ctrl+S`.

## Session Branching (future)

Like ChatGPT's "edit and regenerate":

```
1. User wants to branch from message seq:15
2. Create new session with parentSessionId = original
3. Copy messages 1-15 to new session
4. New session continues independently
5. Original session unchanged
```

## Search (future)

```
anton sessions search "nginx ssl"
```

Searches across:
1. Session titles (index.json)
2. Message content (messages via grep or LLM search)

Results ranked by relevance and recency.
