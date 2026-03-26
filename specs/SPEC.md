# anton.computer — Connection Spec

> Single source of truth for ports, protocols, and connection behavior.
> All clients (desktop, CLI) and the agent server MUST honor this spec.
> One unified version for agent, sidecar, desktop, and CLI.
>
> For the complete message-by-message API reference, see [API.md](./API.md).

---

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| **9876** | `ws://` | Primary WebSocket (plain, no TLS) |
| **9877** | `wss://` | TLS WebSocket (self-signed or CA cert) |
| **9878** | HTTP | Sidecar health/status (localhost only, exposed via Caddy at `/_anton/*`) |

- The agent server MUST listen on **both** WS ports simultaneously.
- Port 9876 (plain WS) is the **default** for all clients.
- Port 9877 (TLS) is optional — used when security is required over untrusted networks.
- Both ports use the same binary framing protocol and auth flow.

## Authentication

| Step | Direction | Channel | Message |
|------|-----------|---------|---------|
| 1 | Client → Agent | CONTROL (0x00) | `{ type: "auth", token: "<token>" }` |
| 2a | Agent → Client | CONTROL (0x00) | `{ type: "auth_ok", agentId, version, gitHash, updateAvailable? }` |
| 2b | Agent → Client | CONTROL (0x00) | `{ type: "auth_error", reason }` |

- Token format: `ak_<48 hex chars>` (24 random bytes)
- Auth timeout: 10 seconds — server closes connection if no auth received
- One active client at a time — new connection replaces the old one

### Version Info

The `auth_ok` response includes version metadata:

```typescript
{
  type: "auth_ok",
  agentId: string,
  version: string,           // unified version (e.g. "1.0.0")
  gitHash: string,           // short git commit hash
  updateAvailable?: {        // included if agent knows a newer version exists
    version: string,
    changelog: string,
    releaseUrl: string,
  }
}
```

One unified version number for agent, sidecar, desktop, and CLI. Unknown fields are ignored, unknown message types are dropped.

## Wire Protocol

Single WebSocket connection, multiplexed into 5 logical channels via binary framing:

```
Frame: [1 byte channel] [N bytes JSON payload]
```

| Channel | ID | Purpose |
|---------|-----|---------|
| CONTROL | 0x00 | Auth, ping/pong, lifecycle, config management |
| TERMINAL | 0x01 | PTY data (base64-encoded) |
| AI | 0x02 | Chat, sessions, providers, tool calls, confirmations, compaction |
| FILESYNC | 0x03 | Remote filesystem browsing |
| EVENTS | 0x04 | Status updates, notifications |

## Session Management (v0.2.0+)

Sessions are independent agent instances, each with their own model, provider, and message history. Sessions persist to `~/.anton/sessions/` on the agent VM and can be resumed across client reconnects.

**Persistence**: Sessions persist incrementally during turns (after each tool execution and turn end), not just at turn completion. On client disconnect, active turns are cancelled (`piAgent.abort()`) and the current state is persisted to disk. This ensures that when a user reconnects, `session_history` returns all messages including work completed before the disconnect.

**Reconnection**: Clients preserve conversation UI state across disconnects (conversations, active conversation, projects). Only transient state (streaming indicators, pending confirmations) is cleared. On reconnect, the client fetches `sessions_list`, resumes the active session, and fetches `session_history` to sync the full conversation.

### Session Lifecycle

| Step | Direction | Channel | Message |
|------|-----------|---------|---------|
| Create | Client → Agent | AI | `{ type: "session_create", id, provider?, model?, apiKey? }` |
| Created | Agent → Client | AI | `{ type: "session_created", id, provider, model }` |
| Resume | Client → Agent | AI | `{ type: "session_resume", id }` |
| Resumed | Agent → Client | AI | `{ type: "session_resumed", id, provider, model, messageCount, title }` |
| List | Client → Agent | AI | `{ type: "sessions_list" }` |
| List Response | Agent → Client | AI | `{ type: "sessions_list_response", sessions: [...] }` |
| History | Client → Agent | AI | `{ type: "session_history", id }` |
| History Response | Agent → Client | AI | `{ type: "session_history_response", id, messages: [...] }` |
| Destroy | Client → Agent | AI | `{ type: "session_destroy", id }` |
| Destroyed | Agent → Client | AI | `{ type: "session_destroyed", id }` |

- Messages without `sessionId` target the "default" session (auto-created)
- `apiKey` in `session_create` overrides the server-stored key for that session only (never persisted)
- Sessions auto-expire after `sessions.ttlDays` (default: 7 days)

### Session History (v0.3.0)

Clients can fetch the full message history for any session. The server reads the pi SDK message array and translates it to a client-friendly format:

```typescript
// Request
{ type: "session_history", id: "sess_abc123" }

// Response
{
  type: "session_history_response",
  id: "sess_abc123",
  messages: [
    {
      seq: 1,
      role: "user",
      content: "What changed in this screenshot?",
      ts: 1711036800000,
      attachments: [
        {
          id: "images/0001-01-screenshot.png",
          name: "screenshot.png",
          mimeType: "image/png",
          storagePath: "images/0001-01-screenshot.png",
          sizeBytes: 248193,
          data: "<base64>"
        }
      ]
    },
    { seq: 2, role: "assistant", content: "I'll set up nginx...", ts: 1711036802000 },
    { seq: 3, role: "tool_call", content: "Running: shell", toolName: "shell", toolInput: { command: "apt install nginx" }, toolId: "tc_1", ts: 1711036802500 },
    { seq: 4, role: "tool_result", content: "Reading package lists...", toolId: "tc_1", ts: 1711036803000 }
  ]
}
```

History entry fields:

| Field | Type | Description |
|-------|------|-------------|
| seq | number | Monotonically increasing sequence number |
| role | string | `"user"`, `"assistant"`, `"tool_call"`, `"tool_result"`, `"system"` |
| content | string | Message text or tool output |
| ts | number | Timestamp (ms) |
| toolName | string? | Tool name (for `tool_call`) |
| toolInput | object? | Tool input (for `tool_call`) |
| toolId | string? | Links `tool_call` to `tool_result` |
| isError | boolean? | Whether tool result is an error |
| attachments | object[]? | Image attachments, with VM-relative `storagePath` and optional base64 `data` |

This allows clients to be thin — all message history lives on the server. The desktop and CLI fetch history on session resume instead of storing messages locally.

### Chat Messages (with session support)

All AI chat messages accept an optional `sessionId` field:

```typescript
{ type: "message", content: string, sessionId?: string, attachments?: [{ id, name, mimeType, data, sizeBytes }] }
{ type: "text", content: string, sessionId?: string }
{ type: "thinking", text: string, sessionId?: string }
{ type: "tool_call", id, name, input, sessionId?: string }
{ type: "tool_result", id, output, isError?, sessionId?: string }
{ type: "confirm", id, command, reason, sessionId?: string }
{ type: "confirm_response", id, approved }
{ type: "title_update", title, sessionId?: string }
{ type: "done", sessionId?: string }
{ type: "error", message, sessionId?: string }
```

User image attachments are stored on the VM under `~/.anton/sessions/data/<sessionId>/images/` and referenced from the session's `messages.jsonl` via relative `storagePath` values.

### AI Title Generation

On the first message of a session, the server generates a conversation title using the LLM. A regex-based title is set immediately as a placeholder, then replaced asynchronously with an AI-generated title via `title_update`. Clients should update the sidebar conversation title when this event is received.

### Token Usage (v0.3.0)

The `done` message includes optional token usage for the completed turn:

```typescript
{
  type: "done",
  sessionId?: string,
  usage?: {
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number
  },
  cumulativeUsage?: {  // session lifetime totals
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number
  }
}
```

Clients can use this to display per-turn and cumulative token costs.

### Text Streaming

The agent sends `text` events as deltas (only new characters since the last emit). Clients MUST append each `text` event to the current assistant message rather than creating a new message bubble. This mirrors how the pi SDK emits accumulated text — the session translates it to deltas before sending.

### Confirmation Flow

When the agent detects a dangerous command (matches `security.confirmPatterns`), it pauses and asks the client:

```
Agent → Client: { type: "confirm", id: "c_1", command: "sudo rm -rf /var/log", reason: "Matches pattern: sudo" }
Client → Agent: { type: "confirm_response", id: "c_1", approved: true }
```

- Confirmation timeout: 60 seconds (resolves to denied if no response)
- Confirmation is per-session — the handler is wired when the session is created/resumed

### Ask User Flow

The `ask_user` interaction is the structured clarification path for the desktop client. It is intended for a short guided questionnaire before the agent proceeds with work.

```
Agent → Client: {
  type: "ask_user",
  id: "ask_1",
  questions: [
    {
      question: "What kind of dashboard do you want?",
      description: "Pick the closest fit. You can also write your own answer.",
      options: [
        { label: "Competitive analysis", description: "Track rivals, pricing, positioning, and feature gaps." },
        { label: "Internal KPI dashboard", description: "Focus on your own metrics, pipelines, and business health." }
      ],
      allowFreeText: true,
      freeTextPlaceholder: "Describe your ideal dashboard in your own words..."
    }
  ],
  sessionId: "sess_abc123"
}

Client → Agent: {
  type: "ask_user_response",
  id: "ask_1",
  answers: {
    "What kind of dashboard do you want?": "Competitive analysis"
  }
}
```

Behavior rules:

- The agent MAY send multiple clarification questions in a single `ask_user` request.
- The question set MUST stay short and focused. Current limit: 6 questions per request.
- The client MUST render the questions as a stepper: one visible question at a time.
- The client MUST show `Next` between intermediate questions and `Submit` on the final question.
- The client SHOULD allow `Back` navigation across previously answered questions.
- Each question MAY include markdown `description` text for extra guidance.
- Each option MAY be a plain string or an object with `label` and optional markdown `description`.
- If `allowFreeText !== false`, the client MUST show a custom text input for that question.
- A typed custom answer overrides the selected MCQ option for the final submitted value.
- The server waits for one `ask_user_response` matching the request `id`, then resumes the paused turn.
- Timeout remains 5 minutes if the user does not respond.

Recommended agent usage:

- Use `ask_user` when a structured answer will materially improve the result.
- Prefer 2-5 questions, even though the hard cap is 6.
- Prefer concise MCQ options with short descriptions when they help the user distinguish choices.
- Avoid large forms. The intent is a guided step-by-step clarification flow, not a long survey.

## Context Compaction (v0.3.0)

Sessions automatically manage context window usage through a two-layer compaction strategy.

### Compaction Events

| Direction | Channel | Message |
|-----------|---------|---------|
| Agent → Client | AI | `{ type: "compaction_start", sessionId? }` |
| Agent → Client | AI | `{ type: "compaction_complete", sessionId?, compactedMessages, totalCompactions }` |

### Manual Compaction

Clients can trigger compaction by sending a message containing `/compact`:

```typescript
{ type: "message", content: "/compact", sessionId: "sess_abc123" }
// Optional: "/compact Focus on the deployment steps"
```

The `/compact` command triggers an immediate LLM-based summarization of older messages, regardless of the threshold. Custom instructions after `/compact` are passed to the summarization prompt.

See [SESSIONS.md](./SESSIONS.md) for full compaction architecture.

## Scheduler (v0.3.0)

Skills can be scheduled to run automatically via cron expressions. The scheduler is managed via AI channel messages.

| Direction | Channel | Message |
|-----------|---------|---------|
| Client → Agent | AI | `{ type: "scheduler_list" }` |
| Agent → Client | AI | `{ type: "scheduler_list_response", jobs: [...] }` |
| Client → Agent | AI | `{ type: "scheduler_run", name }` |
| Agent → Client | AI | `{ type: "scheduler_run_response", name, success, error? }` |

Job entries:
```typescript
{
  name: string,
  description: string,
  schedule: string,        // cron expression
  nextRun: number,         // unix ms
  lastRun: number | null,
  enabled: boolean
}
```

## Provider Management (v0.2.0+)

Providers are managed via AI channel messages. API keys are stored in `~/.anton/config.yaml`.

| Direction | Channel | Message |
|-----------|---------|---------|
| Client → Agent | AI | `{ type: "providers_list" }` |
| Agent → Client | AI | `{ type: "providers_list_response", providers: [...], defaults }` |
| Client → Agent | AI | `{ type: "provider_set_key", provider, apiKey }` |
| Agent → Client | AI | `{ type: "provider_set_key_response", success, provider }` |
| Client → Agent | AI | `{ type: "provider_set_default", provider, model }` |
| Agent → Client | AI | `{ type: "provider_set_default_response", success, provider, model }` |
| Client → Agent | AI | `{ type: "provider_set_models", provider, models }` |
| Agent → Client | AI | `{ type: "provider_set_models_response", success, provider }` |

Provider list entries:
```typescript
{ name: string, models: string[], defaultModels: string[], hasApiKey: boolean, baseUrl?: string }
```

- `models` — currently configured model IDs (may differ from defaults if user customized)
- `defaultModels` — hardcoded defaults for "reset to defaults" action
- `provider_set_models` allows clients to update the model list for a provider (add custom models, remove unused ones)

### API Key Resolution (Priority Order)

When the agent needs an API key for an LLM call, it resolves in this order:

1. **Client-provided key** — passed in `session_create.apiKey` (temporary, never persisted)
2. **Config file key** — from `~/.anton/config.yaml` providers section
3. **Environment variable** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc.

## Filesystem Browsing (v0.4.0)

Remote filesystem access via the FILESYNC channel. Allows clients to browse directories and read files on the agent VM.

| Direction | Channel | Message |
|-----------|---------|---------|
| Client → Agent | FILESYNC | `{ type: "fs_list", path }` |
| Agent → Client | FILESYNC | `{ type: "fs_list_response", entries, error? }` |
| Client → Agent | FILESYNC | `{ type: "fs_read", path }` |
| Agent → Client | FILESYNC | `{ type: "fs_read_response", path, content, truncated, error? }` |

- `path` supports `~` for home directory
- Dotfiles are hidden by default in `fs_list`
- Files are truncated at 100KB in `fs_read`
- See [API.md](./API.md) for full message schemas

## Config Management (v0.2.0+)

System-level config queries/updates via CONTROL channel:

| Direction | Channel | Message |
|-----------|---------|---------|
| Client → Agent | CONTROL | `{ type: "config_query", key }` |
| Agent → Client | CONTROL | `{ type: "config_query_response", key, value }` |
| Client → Agent | CONTROL | `{ type: "config_update", key, value }` |
| Agent → Client | CONTROL | `{ type: "config_update_response", success, error? }` |

Valid keys: `"providers"`, `"defaults"`, `"security"`

## Client Connection Flow

### On Connect

Clients SHOULD perform these steps after `auth_ok`:

1. Send `providers_list` — get available providers and which have API keys
2. Send `sessions_list` — get existing sessions sorted by `lastActiveAt` desc
3. Auto-resume the most recent session (send `session_resume` + `session_history`)
4. If no sessions exist, create a new one with `session_create`

### On New Conversation

1. Generate session ID: `sess_<Date.now().toString(36)>`
2. Send `session_create` with desired provider/model
3. Wait for `session_created` response
4. Start sending messages with `sessionId`

### On Switch Conversation

1. Send `session_resume` for the target session
2. Wait for `session_resumed` response
3. Send `session_history` to fetch message history
4. Render messages from the history response

## Client Connection Defaults

| Setting | Default | Notes |
|---------|---------|-------|
| Port | 9876 | Plain WS |
| TLS | Off | Self-signed certs cause issues in WebViews |
| Reconnect delay | 3 seconds | Auto-reconnect on disconnect |
| Auth timeout | 10 seconds | Client-side timeout for auth response |

## Firewall / Security Groups

The following ports MUST be open inbound (TCP):

| Port | Required |
|------|----------|
| 9876 | Yes — primary connection |
| 9877 | Yes — TLS fallback |
| 22 | Yes — SSH for deployment |
| 80 | Optional — HTTP for hosted services |
| 443 | Optional — HTTPS for hosted services |

## Agent Server Startup

The agent server starts two listeners:

1. **Plain HTTP + WebSocket** on port from config (default 9876)
2. **HTTPS + WebSocket** on config port + 1 (default 9877) — uses self-signed cert from `~/.anton/certs/`

If cert generation fails, only the plain server starts.

## Config File

Location: `~/.anton/config.yaml`

```yaml
agentId: anton-<hostname>-<random>
token: ak_<48 hex chars>
port: 9876

providers:
  anthropic:
    apiKey: ""
    models:
      - claude-sonnet-4-6
      - claude-opus-4-6
      - claude-haiku-4-5
  openai:
    apiKey: ""
    models:
      - gpt-4o
      - gpt-4o-mini
      - o3
      - o4-mini
  openrouter:
    apiKey: ""
    baseUrl: "https://openrouter.ai/api/v1"
    models:
      - anthropic/claude-sonnet-4.6
      - anthropic/claude-opus-4.6
      - openai/gpt-4o
      - google/gemini-2.5-pro-preview
      - minimax/minimax-m2.5
      - meta-llama/llama-4-maverick
  ollama:
    baseUrl: "http://localhost:11434"
    models:
      - llama3
      - codellama
      - mistral
  google:
    apiKey: ""
    models:
      - gemini-2.5-pro
      - gemini-2.5-flash

defaults:
  provider: anthropic
  model: claude-sonnet-4-6

security:
  confirmPatterns: [rm -rf, sudo, shutdown, reboot, mkfs, "dd if=", ":(){ :|:& };:"]
  forbiddenPaths: [/etc/shadow, ~/.ssh/id_*, ~/.anton/config.yaml]
  networkAllowlist: [github.com, npmjs.org, pypi.org, api.anthropic.com, api.openai.com]

sessions:
  ttlDays: 7

compaction:
  enabled: true
  threshold: 0.80
  preserveRecentCount: 20
  toolOutputMaxTokens: 4000

skills: []
```

### Legacy Config Migration

If the agent detects a v0.1.0 config (single `ai:` block), it auto-migrates to the multi-provider format:

```yaml
# v0.1.0 (legacy)
ai:
  provider: anthropic
  apiKey: "sk-ant-..."
  model: claude-sonnet-4-6

# → auto-migrated to v0.2.0+
providers:
  anthropic:
    apiKey: "sk-ant-..."
    models: [claude-sonnet-4-6, ...]
defaults:
  provider: anthropic
  model: claude-sonnet-4-6
```

## Self-Update Protocol (v0.5.0)

The agent can check for updates and update itself. The desktop app can trigger and monitor updates.

### Update Manifest

The agent periodically fetches a manifest from a known URL (default: GitHub raw):

```json
{
  "version": "0.5.0",
  "specVersion": "0.5.0",
  "gitHash": "abc1234",
  "releaseUrl": "https://github.com/OmGuptaIND/anton.computer/releases",
  "changelog": "- Feature A\n- Fix B",
  "publishedAt": "2026-03-21T00:00:00Z"
}
```

### Update Messages (CONTROL channel)

| Direction | Channel | Message |
|-----------|---------|---------|
| Client → Agent | CONTROL | `{ type: "update_check" }` |
| Agent → Client | CONTROL | `{ type: "update_check_response", currentVersion, currentSpecVersion, latestVersion, latestSpecVersion, updateAvailable, changelog, releaseUrl }` |
| Client → Agent | CONTROL | `{ type: "update_start" }` |
| Agent → Client | CONTROL | `{ type: "update_progress", stage, message }` |

Update progress stages: `pulling` → `installing` → `building` → `restarting` → `done` (or `error`)

### Update Event (EVENTS channel)

When the agent detects a new version during its periodic check, it proactively notifies connected clients:

```typescript
{ type: "update_available", currentVersion, latestVersion, latestSpecVersion, changelog, releaseUrl }
```

### Self-Update Flow

1. Agent checks manifest URL every hour (and on startup)
2. If newer version found, caches manifest and includes `updateAvailable` in next `auth_ok`
3. Client shows banner: "Update available: v0.4.0 → v0.5.0"
4. User clicks "Update" → client sends `update_start`
5. Agent runs: `git pull` → `pnpm install` → `pnpm build` → writes `version.json` → `systemctl restart`
6. Agent streams `update_progress` events so the client can show a progress bar
7. After restart, client reconnects and gets the new version in `auth_ok`

### Version Matrix

| Component | Version Source | How It's Set |
|-----------|---------------|--------------|
| Agent package version | `package.json` | Bumped on release |
| Spec version | `SPEC.md` + `version.ts` | Bumped on protocol changes |
| Git hash | `git rev-parse --short HEAD` | Automatic |
| Desktop version | `tauri.conf.json` | Bumped on desktop release |
| Deployed version | `~/.anton/version.json` | Written by Makefile sync or self-update |

## Backward Compatibility

- v0.5.0 clients work with v0.4.0 agents (`minClientSpec`, `updateAvailable`, update messages ignored)
- v0.4.0 clients work with v0.3.0 agents (`provider_set_models` and filesync messages will be ignored)
- v0.3.0 clients work with v0.4.0+ agents (`defaultModels` field ignored, filesync not used)
- v0.2.0 clients work with v0.5.0 agents (messages without `sessionId` use "default" session)
- v0.1.0 clients work with v0.5.0 agents (session/provider/history/update messages ignored)
- Legacy config auto-migrates on agent startup

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-03-19 | 0.1.0 | Initial spec. Plain WS on 9876 as default, TLS on 9877. |
| 2026-03-19 | 0.2.0 | Multi-provider registry, per-session models, session persistence, config management protocol. |
| 2026-03-19 | 0.3.0 | Session history API, context compaction protocol, text streaming delta spec, token usage on `done`, scheduler protocol, client connection flow, API key resolution order. Full API reference in API.md. |
| 2026-03-19 | 0.4.0 | Provider model management (`provider_set_models`), `defaultModels` in provider list, FILESYNC channel with `fs_list` / `fs_read`, OpenRouter provider with default models. |
| 2026-03-21 | 0.5.0 | Version compatibility in `auth_ok` (`minClientSpec`, `updateAvailable`), self-update protocol (`update_check`, `update_start`, `update_progress`), `update_available` event, periodic update checker, update manifest format. |
