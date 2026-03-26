# anton.computer — WebSocket API Reference

> **Version 0.4.0** — Single source of truth for every message that flows over the wire.
>
> This file is the contract. If the code and this doc disagree, one of them has a bug.
> TypeScript types live in `packages/protocol/src/messages.ts`.

---

## Wire Format

```
Frame: [1 byte channel ID] [N bytes JSON payload]
```

All payloads are UTF-8 JSON. Channel byte determines routing.

| Channel | ID | Direction | Purpose |
|---------|------|-----------|---------|
| CONTROL | `0x00` | Bidirectional | Auth, ping/pong, config |
| TERMINAL | `0x01` | Bidirectional | PTY stdin/stdout (base64) |
| AI | `0x02` | Bidirectional | Sessions, chat, providers, scheduler |
| FILESYNC | `0x03` | Bidirectional | Remote filesystem browsing |
| EVENTS | `0x04` | Server → Client | Status updates, notifications |

---

## CONTROL Channel (0x00)

### `auth`

Client authenticates with the agent.

| | |
|---|---|
| Direction | Client → Agent |
| When | Immediately after WebSocket opens |
| Timeout | Agent closes connection after 10s if not received |

```typescript
{ type: "auth", token: string }
// token format: "ak_<48 hex chars>"
```

### `auth_ok`

Agent confirms authentication.

| | |
|---|---|
| Direction | Agent → Client |
| When | Token is valid |

```typescript
{
  type: "auth_ok",
  agentId: string,       // e.g. "anton-myserver-a1b2c3"
  version: string,       // agent package version
  gitHash: string,       // build git hash
  specVersion: string    // protocol version, e.g. "0.3.0"
}
```

### `auth_error`

Agent rejects authentication.

| | |
|---|---|
| Direction | Agent → Client |
| When | Token is invalid or missing |
| Side effect | Agent closes the WebSocket |

```typescript
{ type: "auth_error", reason: string }
```

### `ping` / `pong`

Keepalive.

| | |
|---|---|
| Direction | Either direction |

```typescript
{ type: "ping" }
{ type: "pong" }
```

### `config_query`

Client requests a config section.

| | |
|---|---|
| Direction | Client → Agent |

```typescript
{ type: "config_query", key: "providers" | "defaults" | "security" }
```

### `config_query_response`

Agent returns the requested config.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "config_query_response", key: string, value: unknown }
```

### `config_update`

Client updates a config section.

| | |
|---|---|
| Direction | Client → Agent |

```typescript
{ type: "config_update", key: string, value: unknown }
```

### `config_update_response`

Agent confirms or rejects the update.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "config_update_response", success: boolean, error?: string }
```

---

## TERMINAL Channel (0x01)

### `pty_spawn`

Client requests a new terminal session.

| | |
|---|---|
| Direction | Client → Agent |

```typescript
{
  type: "pty_spawn",
  id: string,        // terminal session ID, e.g. "t1"
  cols: number,      // initial columns
  rows: number,      // initial rows
  shell?: string     // optional shell path, defaults to user's shell
}
```

### `pty_data`

Terminal I/O data.

| | |
|---|---|
| Direction | Bidirectional |
| Encoding | Base64 (binary safety over JSON) |

```typescript
{
  type: "pty_data",
  id: string,       // terminal session ID
  data: string      // base64-encoded bytes
}
```

- Client → Agent: user keystrokes
- Agent → Client: command output

### `pty_resize`

Client reports terminal size change.

| | |
|---|---|
| Direction | Client → Agent |

```typescript
{ type: "pty_resize", id: string, cols: number, rows: number }
```

### `pty_close`

Either side closes the terminal.

| | |
|---|---|
| Direction | Bidirectional |

```typescript
{ type: "pty_close", id: string }
```

---

## AI Channel (0x02) — Session Management

### `session_create`

Client creates a new AI session.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `session_created` or `error` |

```typescript
{
  type: "session_create",
  id: string,            // client-generated, format: "sess_<base36_timestamp>"
  provider?: string,     // optional, defaults to config default
  model?: string,        // optional, defaults to config default
  apiKey?: string        // optional, per-session override (NEVER persisted on server)
}
```

### `session_created`

Agent confirms session was created.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "session_created",
  id: string,
  provider: string,      // resolved provider
  model: string          // resolved model
}
```

### `session_resume`

Client resumes an existing session from disk.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `session_resumed` or `error` |
| Side effect | Loads session from `~/.anton/sessions/` if not in memory |

```typescript
{ type: "session_resume", id: string }
```

### `session_resumed`

Agent confirms session was resumed.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "session_resumed",
  id: string,
  provider: string,
  model: string,
  messageCount: number,  // total messages in history
  title: string          // auto-generated or user-set title
}
```

### `sessions_list`

Client requests all sessions.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `sessions_list_response` |

```typescript
{ type: "sessions_list" }
```

### `sessions_list_response`

Agent returns session metadata. Sorted by `lastActiveAt` descending.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "sessions_list_response",
  sessions: [{
    id: string,
    title: string,
    provider: string,
    model: string,
    messageCount: number,
    createdAt: number,      // unix ms
    lastActiveAt: number    // unix ms
  }]
}
```

Merges in-memory sessions with persisted (disk) sessions. No message content is included — only metadata.

### `session_history`

Client requests full message history for a session.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `session_history_response` or `error` |
| Side effect | Loads session from disk if not in memory |

```typescript
{ type: "session_history", id: string }
```

### `session_history_response`

Agent returns the session's message history in client-friendly format.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "session_history_response",
  id: string,
  messages: SessionHistoryEntry[]
}
```

**`SessionHistoryEntry`:**

```typescript
{
  seq: number,           // monotonically increasing
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system",
  content: string,       // message text or tool output
  ts: number,            // unix ms
  toolName?: string,     // for tool_call
  toolInput?: object,    // for tool_call
  toolId?: string,       // links tool_call ↔ tool_result
  isError?: boolean,     // for tool_result
  attachments?: [{       // present on user/tool_result entries that include images
    id: string,
    name: string,
    mimeType: string,
    storagePath: string, // relative to ~/.anton/sessions/data/<sessionId>/
    sizeBytes: number,
    data?: string        // base64 payload returned for UI rendering
  }]
}
```

The server translates from pi SDK's internal format (content arrays with `text`, `tool_use`, `tool_result` blocks) into this flat format.

### `session_destroy`

Client deletes a session.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `session_destroyed` |
| Side effect | Removes from memory AND disk |

```typescript
{ type: "session_destroy", id: string }
```

### `session_destroyed`

Agent confirms deletion.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "session_destroyed", id: string }
```

---

## AI Channel (0x02) — Chat Messages

### `message`

Client sends a chat message to a session.

| | |
|---|---|
| Direction | Client → Agent |
| Response | Stream of `thinking` → `text` → `tool_call` → `tool_result` → `done` |
| Side effect | Auto-creates session if `sessionId` doesn't exist |

```typescript
{
  type: "message",
  content: string,          // user's message text
  sessionId?: string,       // target session (defaults to "default")
  attachments?: [{          // optional image attachments
    id: string,
    name: string,
    mimeType: string,
    data: string,           // base64 image payload
    sizeBytes: number
  }]
}
```

Special content: `/compact` triggers manual context compaction. `/compact <instructions>` passes custom instructions to the summarizer.

### `thinking`

Agent is reasoning (extended thinking / chain of thought).

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Display as system/thinking indicator |

```typescript
{ type: "thinking", text: string, sessionId?: string }
```

### `text`

Agent response text **delta**.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | **APPEND** to the current assistant message. Do NOT create a new message bubble. |

```typescript
{ type: "text", content: string, sessionId?: string }
```

The server emits only the new characters since the last `text` event. Multiple `text` events compose a single assistant response.

### `tool_call`

Agent is invoking a tool.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Display tool name + input |

```typescript
{
  type: "tool_call",
  id: string,               // unique tool call ID (links to tool_result)
  name: string,             // tool name, e.g. "shell", "filesystem"
  input: object,            // tool input parameters
  sessionId?: string
}
```

### `tool_result`

Tool execution completed.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Display output, highlight errors |

```typescript
{
  type: "tool_result",
  id: string,               // matches tool_call.id
  output: string,           // tool output text
  isError?: boolean,        // true if execution failed
  sessionId?: string
}
```

### `confirm`

Agent requests approval for a dangerous command.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Show confirmation dialog |
| Timeout | 60 seconds — auto-denied if no response |

```typescript
{
  type: "confirm",
  id: string,               // confirmation ID
  command: string,           // the dangerous command
  reason: string,            // why it's flagged, e.g. "Matches pattern: sudo"
  sessionId?: string
}
```

Triggered when a shell command matches `security.confirmPatterns` in config.

### `confirm_response`

Client approves or denies a dangerous command.

| | |
|---|---|
| Direction | Client → Agent |
| Side effect | Unblocks the session's tool execution |

```typescript
{
  type: "confirm_response",
  id: string,               // matches confirm.id
  approved: boolean
}
```

### `ask_user`

Agent requests a short structured clarification flow.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Render a stepper wizard: one visible question at a time, `Next` between questions, `Submit` on the last step |
| Timeout | 5 minutes — resolves to an empty answer object if no response |

```typescript
{
  type: "ask_user",
  id: string,               // request ID
  questions: AskUserQuestion[],
  sessionId?: string
}
```

**`AskUserQuestion`:**

```typescript
{
  question: string,                     // visible prompt
  description?: string,                 // optional markdown helper text
  options?: Array<string | {
    label: string,
    description?: string                // optional markdown helper text
  }>,
  allowFreeText?: boolean,              // default: true
  freeTextPlaceholder?: string          // optional custom placeholder
}
```

Rules:

- Current hard cap: 6 questions per request.
- Each question is shown one at a time in the client UI.
- `options` may be simple strings or richer objects with `label` and `description`.
- If `allowFreeText !== false`, the client should always offer a custom text field.
- If both an option and custom text are present, custom text wins for the submitted answer.

### `ask_user_response`

Client submits the answers collected by the stepper flow.

| | |
|---|---|
| Direction | Client → Agent |
| Side effect | Unblocks the session and resumes the agent turn |

```typescript
{
  type: "ask_user_response",
  id: string,               // matches ask_user.id
  answers: Record<string, string>
}
```

`answers` is keyed by the original question text. Each value is the final submitted answer for that step, either the selected option label or the typed custom text.

### `done`

Agent finished processing the current turn.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Set agent status to idle, display token usage if present |

```typescript
{
  type: "done",
  sessionId?: string,
  usage?: TokenUsage,            // this turn's token usage
  cumulativeUsage?: TokenUsage   // session lifetime totals
}
```

**`TokenUsage`:**

```typescript
{
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
}
```

### `error`

Something went wrong.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Display error message, set agent status to error |

```typescript
{ type: "error", message: string, sessionId?: string }
```

---

## AI Channel (0x02) — Provider Management

### `providers_list`

Client requests available providers.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `providers_list_response` |

```typescript
{ type: "providers_list" }
```

### `providers_list_response`

Agent returns all configured providers and the current defaults.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "providers_list_response",
  providers: [{
    name: string,          // e.g. "anthropic", "openai"
    models: string[],      // currently configured model IDs
    defaultModels: string[], // hardcoded defaults (for "reset to defaults")
    hasApiKey: boolean,    // true if API key is configured
    baseUrl?: string       // for self-hosted (e.g. Ollama)
  }],
  defaults: {
    provider: string,
    model: string
  }
}
```

The `defaultModels` field contains the hardcoded default model list for each provider. Clients can use this to offer a "reset to defaults" action when the user has customized their model list. `models` reflects the current state (which may differ from defaults if the user has added/removed models).

### `provider_set_key`

Client sets an API key for a provider.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `provider_set_key_response` |
| Side effect | Persists to `~/.anton/config.yaml` |

```typescript
{ type: "provider_set_key", provider: string, apiKey: string }
```

### `provider_set_key_response`

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "provider_set_key_response", success: boolean, provider: string }
```

### `provider_set_default`

Client changes the default provider/model.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `provider_set_default_response` |
| Side effect | Persists to `~/.anton/config.yaml` |

```typescript
{ type: "provider_set_default", provider: string, model: string }
```

### `provider_set_default_response`

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "provider_set_default_response", success: boolean, provider: string, model: string }
```

### `provider_set_models`

Client updates the model list for a provider.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `provider_set_models_response` |
| Side effect | Persists to `~/.anton/config.yaml` |

```typescript
{ type: "provider_set_models", provider: string, models: string[] }
```

If the provider doesn't exist in config, it is created with an empty API key and the given models. This allows clients to configure model lists before setting an API key.

### `provider_set_models_response`

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{ type: "provider_set_models_response", success: boolean, provider: string }
```

After a successful response, clients SHOULD send `providers_list` to refresh the full provider state.

---

## FILESYNC Channel (0x03)

### `fs_list`

Client requests a directory listing.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `fs_list_response` |

```typescript
{
  type: "fs_list",
  path: string           // directory path; "~" resolved to home dir
}
```

### `fs_list_response`

Agent returns directory entries.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "fs_list_response",
  entries: [{
    name: string,        // filename
    type: "file" | "dir" | "link",
    size: string         // human-readable, e.g. "4.2K", "1.3M"
  }],
  error?: string         // set if path doesn't exist or no permissions
}
```

Dotfiles are hidden by default (entries starting with `.` are filtered out).

### `fs_read`

Client requests file contents.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `fs_read_response` |

```typescript
{ type: "fs_read", path: string }
```

### `fs_read_response`

Agent returns file contents (truncated at 100KB).

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "fs_read_response",
  path: string,
  content: string,       // file contents (UTF-8)
  truncated: boolean,    // true if file was larger than 100KB
  error?: string
}
```

---

## AI Channel (0x02) — Context Compaction

### `compaction_start`

Agent is beginning context compaction (LLM summarization).

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Show "compacting context..." indicator |

```typescript
{ type: "compaction_start", sessionId?: string }
```

### `compaction_complete`

Context compaction finished.

| | |
|---|---|
| Direction | Agent → Client |
| Client behavior | Show summary of what was compacted |

```typescript
{
  type: "compaction_complete",
  sessionId?: string,
  compactedMessages: number,     // how many messages were summarized
  totalCompactions: number       // lifetime compaction count for this session
}
```

---

## AI Channel (0x02) — Scheduler

### `scheduler_list`

Client requests all scheduled jobs (skills).

| | |
|---|---|
| Direction | Client → Agent |
| Response | `scheduler_list_response` |

```typescript
{ type: "scheduler_list" }
```

### `scheduler_list_response`

Agent returns all jobs.

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "scheduler_list_response",
  jobs: [{
    name: string,
    description: string,
    schedule: string,           // cron expression
    nextRun: number,            // unix ms
    lastRun: number | null,     // unix ms
    enabled: boolean
  }]
}
```

### `scheduler_run`

Client triggers a job to run immediately.

| | |
|---|---|
| Direction | Client → Agent |
| Response | `scheduler_run_response` |

```typescript
{ type: "scheduler_run", name: string }
```

### `scheduler_run_response`

| | |
|---|---|
| Direction | Agent → Client |

```typescript
{
  type: "scheduler_run_response",
  name: string,
  success: boolean,
  error?: string
}
```

---

## EVENTS Channel (0x04)

All events flow from server to client. Clients do not send on this channel.

### `agent_status`

Agent's current work state changed.

```typescript
{
  type: "agent_status",
  status: "idle" | "working" | "error",
  detail?: string
}
```

### `file_changed`

A file was modified on the server.

```typescript
{
  type: "file_changed",
  path: string,
  change: "created" | "modified" | "deleted" | "renamed"
}
```

### `port_changed`

A network port opened or closed.

```typescript
{
  type: "port_changed",
  port: number,
  status: "opened" | "closed",
  process?: string
}
```

### `task_completed`

A background task finished.

```typescript
{ type: "task_completed", summary: string }
```

---

## Client Connection Sequence

The expected sequence after WebSocket opens:

```
1. Client → auth { token }
2. Agent  → auth_ok { agentId, version, specVersion }
3. Client → providers_list
4. Client → sessions_list
5. Agent  → providers_list_response { providers, defaults }
6. Agent  → sessions_list_response { sessions }
7. Client → session_resume { id: latest_session }
8. Client → session_history { id: latest_session }
9. Agent  → session_resumed { id, provider, model, messageCount, title }
10. Agent → session_history_response { id, messages }

   — Ready for chat —

11. Client → message { content, sessionId }
12. Agent  → thinking { text }
13. Agent  → text { content }       ← may repeat (deltas)
14. Agent  → tool_call { id, name, input }
15. Agent  → tool_result { id, output }
16. Agent  → text { content }       ← may repeat
17. Agent  → done { usage, cumulativeUsage }
```

If no sessions exist, skip steps 7-10 and create a new session:

```
7. Client → session_create { id, provider, model }
8. Agent  → session_created { id, provider, model }
```

---

## Tool Calling Flow

Tools are **server-side only**. The client never executes tools — it only observes events. Here's the sequence for a single tool call:

```
Client                              Agent
  │                                   │
  │  message { "install nginx" }      │
  │ ─────────────────────────────────►│
  │                                   │  LLM decides to call shell tool
  │                                   │
  │  tool_call { id: "tc_1",         │
  │    name: "shell",                 │
  │    input: { command: "apt..." } } │
  │ ◄─────────────────────────────────│  Tool starts executing
  │                                   │
  │  tool_result { id: "tc_1",       │
  │    output: "Reading packages..." }│
  │ ◄─────────────────────────────────│  Tool finished
  │                                   │
  │  text { "Nginx is installed." }   │  LLM produces final response
  │ ◄─────────────────────────────────│
  │                                   │
  │  done { usage: {...} }            │
  │ ◄─────────────────────────────────│
```

### Multi-tool sequence

The LLM can call multiple tools in one turn. Each tool call produces a `tool_call` → `tool_result` pair:

```
message → tool_call A → tool_result A → tool_call B → tool_result B → text → done
```

The LLM may also interleave text between tool calls.

### With confirmation

If a shell command matches `security.confirmPatterns`, the flow pauses:

```
Client                              Agent
  │                                   │
  │  tool_call { shell, "sudo..." }   │
  │ ◄─────────────────────────────────│
  │                                   │
  │  confirm { id: "c_1",            │  ← Agent pauses here
  │    command: "sudo rm -rf /tmp",   │
  │    reason: "Matches: sudo" }      │
  │ ◄─────────────────────────────────│
  │                                   │
  │  confirm_response { id: "c_1",   │
  │    approved: true }               │
  │ ─────────────────────────────────►│  ← Agent unblocks
  │                                   │
  │  tool_result { id, output }       │
  │ ◄─────────────────────────────────│
```

If the user denies or 60s elapses, the tool is blocked and the LLM receives "Command denied by user."

### Client responsibilities

- Display `tool_call` events (show tool name + input)
- Display `tool_result` events (show output, highlight if `isError`)
- Show confirmation dialog on `confirm` events
- Send `confirm_response` promptly (60s timeout)
- The `id` field links `tool_call` ↔ `tool_result` and `confirm` ↔ `confirm_response`

## Error Handling

- Any request can produce an `error` response instead of the expected response
- Errors on the AI channel: `{ type: "error", message: string, sessionId?: string }`
- Auth errors close the connection immediately
- Config update errors include the `error` field with details
- Session not found: returns `error` with descriptive message
- If the client sends a message type the server doesn't recognize, it is silently ignored (forward compatibility)

---

## Invariants

1. **One client** — Only one WebSocket connection is active at a time. New connections replace old ones.
2. **Auth first** — No messages are processed until auth succeeds. 10-second timeout.
3. **Session isolation** — Each session has its own model, provider, message history, and compaction state.
4. **Text deltas** — `text` events are deltas, not full messages. Clients must append.
5. **Confirm blocks** — A `confirm` message blocks the session until `confirm_response` is received or 60s elapses.
6. **API keys never leak** — Client-provided `apiKey` in `session_create` is held in memory only, never written to disk.
7. **Server is source of truth** — Session data lives on the server. Clients are thin views that fetch on demand.
