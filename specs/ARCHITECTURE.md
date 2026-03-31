# anton.computer — Architecture

## One-Liner

A TypeScript agent daemon on your VPS + Go sidecar for health/status + native desktop app + CLI on your machine, connected by WebSocket pipes. The agent uses pi SDK to think and act. Sessions live on the server. The sidecar reports VM health to antoncomputer.in.

## System Diagram

```
YOUR DESKTOP                                          YOUR VPS / CLOUD SERVER
┌────────────────────────┐                             ┌──────────────────────────────┐
│  Desktop App (Tauri)   │      WebSocket (TLS)        │  Caddy (:443 TLS)            │
│  or CLI (Ink TUI)      │◄──────────────────────────►│  ├── /* → Agent (:9876)      │
│                        │   Single multiplexed conn   │  └── /_anton/* → Sidecar     │
│  ┌──────────────────┐  │                             │                              │
│  │ Terminal (xterm)  │──┼─── PTY channel ──────────►│  ┌────────────────────────┐  │
│  │ AI Agent Chat     │──┼─── AI channel ───────────►│  │  Agent (Node.js :9876) │  │
│  │ Model Selector    │──┼─── AI channel ───────────►│  │  ├── WebSocket Server  │  │
│  │ Session Sidebar   │──┼─── AI channel ───────────►│  │  ├── Session Router    │  │
│  │ Notifications     │◄─┼─── Event channel ────────┤  │  └── Tool Execution    │  │
│  └──────────────────┘  │                             │  └────────────────────────┘  │
│                        │                             │                              │
│  Zustand state store   │                             │  ┌────────────────────────┐  │
│  localStorage cache    │                             │  │  Sidecar (Go :9878)    │  │
│                        │                             │  │  ├── /health           │  │
│  Rust: shell, notify   │                             │  │  ├── /status           │  │
└────────────────────────┘                             │  │  └── System checks     │  │
                                                       │  └────────────────────────┘  │
antoncomputer.in                                       │                              │
┌────────────────────────┐    /_anton/status            │  ~/.anton/                    │
│  Polls sidecar for     │◄──────────────────────────►│  ├── config.yaml             │
│  provisioning status   │    every 3s during deploy   │  ├── sessions/               │
└────────────────────────┘                             │  └── certs/                  │
                                                       └──────────────────────────────┘
```

## Project Structure

```
anton.computer/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── SPEC.md                   # Wire protocol spec (v0.3.0)
├── SESSIONS.md               # Session persistence & compaction spec
├── ARCHITECTURE.md           # This file
├── PROVIDERS.md              # Supported AI providers
├── GOALS.md                  # Product vision & roadmap
│
├── sidecar/                     # Health & status service (Go)
│   ├── main.go
│   ├── Makefile
│   └── internal/                # config, server, middleware, handlers, checks
│
├── packages/
│   ├── agent/                # The daemon (runs on VPS)
│   │   └── src/
│   │       ├── index.ts      # Entry point — start server
│   │       ├── config.ts     # Load config, session persistence, provider registry
│   │       ├── server.ts     # WebSocket server + pipe multiplexer + session routing
│   │       ├── session.ts    # pi SDK agent wrapper, streaming, confirmation
│   │       ├── compaction.ts # Two-layer context compaction engine
│   │       ├── compaction-prompt.ts  # LLM prompts for summarization
│   │       ├── agent.ts      # System prompt + tool definitions
│   │       └── tools/        # Shell, filesystem, browser, process, network
│   │
│   ├── protocol/             # Shared types & wire format
│   │   └── src/
│   │       ├── messages.ts   # All message type definitions (control, AI, terminal, events)
│   │       ├── pipes.ts      # Channel enum (CONTROL, TERMINAL, AI, FILESYNC, EVENTS)
│   │       └── codec.ts      # Binary frame encode/decode
│   │
│   ├── desktop/              # Tauri v2 native app
│   │   ├── src-tauri/        # Rust backend (shell, notification plugins)
│   │   └── src/              # React 19 + Tailwind 4 + Zustand 5
│   │       ├── App.tsx       # Root — connection gate + workspace shell
│   │       ├── components/
│   │       │   ├── Connect.tsx       # Connection form + saved machines
│   │       │   ├── Sidebar.tsx       # Session list + skills library
│   │       │   ├── AgentChat.tsx     # Chat orchestrator
│   │       │   ├── Terminal.tsx      # xterm.js remote terminal
│   │       │   └── chat/
│   │       │       ├── ChatInput.tsx      # Message input + slash commands
│   │       │       ├── MessageList.tsx    # Auto-scrolling message view
│   │       │       ├── MessageBubble.tsx  # Per-message rendering
│   │       │       ├── ModelSelector.tsx  # Provider/model dropdown
│   │       │       ├── ToolCallBlock.tsx  # Expandable tool call display
│   │       │       ├── ConfirmDialog.tsx  # Dangerous command approval
│   │       │       └── MarkdownRenderer.tsx  # GFM markdown + syntax highlighting
│   │       └── lib/
│   │           ├── connection.ts    # WebSocket client + binary codec
│   │           ├── store.ts         # Zustand store + message handler wiring
│   │           ├── conversations.ts # Local conversation cache (linked to server sessions)
│   │           └── skills.ts        # Skill definitions
│   │
│   └── cli/                  # Terminal client (Ink-based TUI)
│       └── src/
│           ├── lib/
│           │   └── connection.ts    # WebSocket client (ws package)
│           ├── ui/
│           │   ├── App.tsx          # Main TUI with keybindings
│           │   ├── MessageList.tsx  # Chat display
│           │   ├── ChatInput.tsx    # Text input
│           │   ├── SessionList.tsx  # Session picker (Ctrl+S)
│           │   ├── ModelPicker.tsx  # Model selector (Ctrl+M)
│           │   ├── ProviderPanel.tsx # API key manager (Ctrl+P)
│           │   └── StatusBar.tsx    # Connection + model info
│           └── commands/
│               ├── connect.ts
│               ├── chat.ts
│               ├── shell.ts
│               └── status.ts
```

## Agent Architecture

### Server (server.ts)

The WebSocket server is the hub that connects clients to sessions:

```
Client WebSocket → Auth → Message Router
                            │
                  ┌─────────┼──────────┐
                  │         │          │
            CONTROL    AI Channel   TERMINAL
            (ping,     (messages,   (PTY I/O)
             config)    sessions,
                        providers)
                            │
                  ┌─────────┼──────────┐
                  │         │          │
              Session A  Session B  Session C
              (Claude)   (GPT-4o)   (Gemini)
```

Key behaviors:
- **One client at a time** — new connections replace old ones
- **Session map** — routes messages to the correct `Session` instance by `sessionId`
- **Lazy loading** — sessions are loaded from disk on first access, not on server start
- **Confirmation wiring** — each session gets a confirm handler that sends requests to the client and awaits response (60s timeout)

### Session (session.ts)

Each session is an independent pi SDK Agent:

```
Session "sess_abc123"
├── pi SDK Agent
│   ├── Model: claude-sonnet-4-6 (Anthropic)
│   ├── System Prompt: CORE_SYSTEM_PROMPT + <system-reminder> layers
│   ├── Tools: shell, filesystem, browser, process, network
│   └── Messages: [user, assistant, tool, ...] (in memory)
│
├── Compaction Engine
│   ├── Config: { threshold: 0.8, preserveRecent: 20, toolOutputMax: 4000 }
│   ├── State: { summary: "...", compactedCount: 42, compactionCount: 3 }
│   └── Runs via transformContext hook on every LLM call
│
├── Persistence
│   ├── Saves after each turn: messages + meta + compaction state
│   └── Format: pi SDK message array (standard LLM format)
│
└── Streaming
    ├── processMessage() is an async generator
    ├── Yields: thinking → text (deltas) → tool_call → tool_result → done
    └── Text deltas: tracks lastEmittedTextLength, emits only new chars
```

### Compaction (compaction.ts)

Two-layer context management, inspired by Claude Code:

```
Layer 1: Tool Output Trimming
  - Runs on every LLM call (transformContext hook)
  - Preserves last 20 messages verbatim
  - Truncates older tool results > 4000 tokens
  - Silent — no events emitted

Layer 2: LLM Summarization
  - Triggers at 80% context window usage
  - Splits: older messages | recent 20 messages
  - Sends older to LLM for summarization
  - Replaces older with a conversation summary message
  - Emits compaction_start + compaction_complete events

Token estimation: ~4 chars/token heuristic
Threshold: configurable per config.yaml
Manual trigger: /compact command
```

### Message Flow (end to end)

```
1. User types in desktop chat input
2. Desktop: addMessage(user) to store → sendAiMessageToSession(text, sessionId)
3. Connection: encodes [AI channel byte][JSON] → WebSocket.send()
4. Server: decodes frame → routes to Session by sessionId
5. Session: piAgent.processMessage(text)
6. pi SDK: calls LLM → gets response → may call tools → loops

   For each event:
   7. Session: translateEvent(piEvent) → yields SessionEvent
   8. Server: sends event to client as [AI channel][JSON]
   9. Connection: decodes → dispatches to store handler
   10. Store:
       - text → appendAssistantText() (append to last assistant message)
       - tool_call → addMessage(tool)
       - tool_result → addMessage(tool)
       - done → setAgentStatus('idle')

11. Session: persist() after turn completes
```

### Tool Confirmation Flow

```
1. Session calls shell tool with "sudo rm -rf /var/log"
2. Tool checks against security.confirmPatterns → match!
3. Session calls confirmHandler(command, reason)
4. Server sends: { type: "confirm", id: "c_1", command, reason }
5. Client shows ConfirmDialog
6. User clicks Approve/Deny
7. Client sends: { type: "confirm_response", id: "c_1", approved: true/false }
8. Server resolves the Promise in confirmHandler
9. If approved: tool executes. If denied: tool returns error.
10. 60-second timeout: auto-denies
```

## Protocol

See [SPEC.md](./SPEC.md) for the full wire protocol specification.

Key design choices:
- **Single WebSocket** — multiplexed via 1-byte channel prefix
- **JSON payloads** — human-readable, debuggable, good enough for chat
- **Base64 for PTY** — binary safety over JSON transport
- **Stateless frames** — each frame is self-contained, no sequence numbers at the wire level

## Security Model

1. **Auth**: Shared secret token (`ak_<hex>`) generated on agent install
2. **TLS**: Self-signed cert at `~/.anton/certs/`, port 9877
3. **Confirmation**: Dangerous patterns require client approval (60s timeout)
4. **Forbidden paths**: Agent cannot read/write sensitive files
5. **Network allowlist**: Sandboxed commands restricted to approved domains
6. **One client**: Only one active connection at a time — prevents conflicts
7. **API key isolation**: Client-provided keys are session-scoped and never persisted

## Client Architecture

### Desktop (Tauri v2)

```
React 19 + Tailwind 4 + Zustand 5

App.tsx
├── Connect screen (if not connected)
│   ├── New connection form (host, token, name, TLS toggle)
│   └── Saved machines list (from localStorage)
│
├── Connected workspace
│   ├── Sidebar
│   │   ├── New task button (creates session on server)
│   │   ├── Conversation list (linked to server sessions via sessionId)
│   │   └── Skills library
│   │
│   ├── AgentChat
│   │   ├── ModelSelector dropdown (providers with API keys)
│   │   ├── MessageList (auto-scroll, scroll button)
│   │   ├── ChatInput (auto-expanding, slash commands)
│   │   └── ConfirmDialog (for dangerous commands)
│   │
│   └── Terminal (xterm.js, base64 PTY data)
│
└── Connection events → Zustand store → React re-renders
```

### CLI (Ink)

```
Keybindings:
  Ctrl+P  Provider panel (manage API keys)
  Ctrl+M  Model picker (switch model)
  Ctrl+S  Session list (view/switch/create)
  Ctrl+Q  Quit

Same protocol, same session management, text-only interface.
Auto-resumes most recent session on connect.
```

## Tool Calling

### How the Agent Loop Works

The agent uses pi SDK's agentic loop. When a user sends a message, pi SDK handles the entire think → act → observe cycle:

```
User message
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  pi SDK Agent Loop                                              │
│                                                                 │
│  1. Build prompt: system prompt + message history + user msg    │
│  2. Call LLM (Claude/GPT/Gemini/etc)                           │
│  3. LLM responds with text AND/OR tool_use blocks              │
│                                                                 │
│  If tool_use in response:                                       │
│    4. beforeToolCall hook → confirmation check                  │
│    5. tool.execute(toolCallId, params) → run the tool           │
│    6. Feed tool result back to LLM as tool_result message       │
│    7. GOTO step 2 (LLM may call more tools or produce text)    │
│                                                                 │
│  If no tool_use (just text):                                    │
│    8. Turn complete → yield done event                          │
│                                                                 │
│  Events emitted at each step:                                   │
│    message_update → text deltas                                 │
│    tool_execution_start → tool_call event                       │
│    tool_execution_end → tool_result event                       │
│    turn_end → token usage                                       │
└─────────────────────────────────────────────────────────────────┘
```

The LLM decides when and which tools to call. pi SDK handles parsing the response, executing tools, and feeding results back. The session just translates events and manages persistence.

### Tool Definitions

Tools are defined in `packages/agent-core/src/agent.ts` using pi SDK's schema system:

```typescript
{
  name: 'shell',
  label: 'Shell',
  description: 'Execute a shell command on the server',
  parameters: Type.Object({
    command: Type.String({ description: 'Command to execute' }),
    timeout_seconds: Type.Optional(Type.Number()),
    working_directory: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params) {
    const output = await executeShell(params, config)
    return { content: [{ type: 'text', text: output }] }
  },
}
```

Each tool has a name, description, typed parameter schema, and an async `execute` function. pi SDK passes these to the LLM as function definitions and calls `execute` when the LLM requests a tool.

### Available Tools

| Tool | Operations | What it does |
|------|-----------|-------------|
| **shell** | execute | Run any shell command with timeout, streaming output |
| **filesystem** | read, write, list, search, tree | Full file operations on the server |
| **browser** | fetch, screenshot, extract | HTTP requests, web scraping (curl-based) |
| **process** | list, kill, info | View and manage running processes |
| **network** | ports, curl, dns, ping | Port scanning, HTTP calls, DNS lookups |

### Tool Results in the LLM Context

Tool results become part of the message history in the standard LLM format:

```json
[
  { "role": "user", "content": [{ "type": "text", "text": "install nginx" }] },
  { "role": "assistant", "content": [
    { "type": "text", "text": "I'll install nginx for you." },
    { "type": "tool_use", "id": "tc_1", "name": "shell", "input": { "command": "apt install -y nginx" } }
  ]},
  { "role": "tool", "tool_use_id": "tc_1", "content": [
    { "type": "text", "text": "Reading package lists... Done\nSetting up nginx..." }
  ]},
  { "role": "assistant", "content": [
    { "type": "text", "text": "Nginx is installed and running." }
  ]}
]
```

This history is:
- Kept in memory by pi SDK during the session
- Persisted to disk after each turn (the full array)
- Subject to compaction when it gets too long (tool outputs are trimmed first)

### Confirmation Flow (Dangerous Commands)

Only shell commands are subject to confirmation. The flow:

```
pi SDK: beforeToolCall(shell, { command: "sudo rm -rf /tmp" })
    │
    ▼
Session: Does "sudo rm -rf /tmp" match any confirmPattern?
    │    Patterns: ["rm -rf", "sudo", "shutdown", "reboot", "mkfs", "dd if="]
    │
    ├─ NO match → tool executes immediately
    │
    ├─ YES match → call confirmHandler(command, reason)
    │    │
    │    ▼
    │  Server: send { type: "confirm", id: "c_1", command, reason } to client
    │    │
    │    ▼
    │  Client: shows ConfirmDialog ("Agent wants to run: sudo rm -rf /tmp")
    │    │
    │    ├─ User clicks Approve → { type: "confirm_response", id: "c_1", approved: true }
    │    │    → tool executes
    │    │
    │    ├─ User clicks Deny → { type: "confirm_response", id: "c_1", approved: false }
    │    │    → tool blocked, LLM told "Command denied by user"
    │    │
    │    └─ 60s timeout → auto-deny
    │         → tool blocked
```

The confirmation is a blocking `Promise` — the entire agent loop pauses until the user responds or the timeout fires.

### Tools Are Stateless

All tools receive the `AgentConfig` at creation time (for security rules) but hold no state between calls. The pi SDK manages the conversation state and tool results.

## Sidecar (Health & Status Service)

A lightweight Go binary running as a systemd service on each VM. Provides health checks, status, and system telemetry. Exposed via Caddy at `/_anton/*`.

### Architecture

```
Internet → Caddy (:443 TLS)
              ├── /_anton/* → sidecar (127.0.0.1:9878)
              └── /*        → agent   (127.0.0.1:9876)
```

The sidecar is the single source of truth for VM status. antoncomputer.in polls it directly instead of relying on callbacks.

### Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /_anton/health` | None (rate limited) | Liveness probe: `{ status, uptime }` |
| `GET /_anton/status` | None (rate limited) | Full VM status: agent, caddy, DNS, TLS, system metrics |
| `* /_anton/*` (future) | Bearer ANTON_TOKEN | Reserved for control endpoints (restart, logs, exec) |

### Status Response

```json
{
  "status": "ready | provisioning | error",
  "agent": { "healthy": true },
  "caddy": { "running": true },
  "dns": { "resolved": true, "ip": "103.x.x.x" },
  "tls": { "valid": true },
  "system": {
    "cpuPercent": 12,
    "memUsedMB": 512,
    "memTotalMB": 4096,
    "diskUsedGB": 3,
    "diskTotalGB": 10,
    "uptimeSeconds": 3600
  },
  "domain": "username.antoncomputer.in",
  "version": "1.0.0"
}
```

Top-level `status` is derived: `"ready"` only when agent healthy + caddy running + DNS resolved + TLS valid.

### Security

- Sidecar listens on `127.0.0.1:9878` only (never directly exposed)
- Caddy provides TLS for all `/_anton/*` traffic
- Public endpoints rate-limited (60/min health, 30/min status)
- Protected endpoints (future) require Bearer token (ANTON_TOKEN)
- No sensitive data exposed on public endpoints

### Provisioning Flow

```
1. VM boots → cloud-init installs agent + sidecar + Caddy
2. Sidecar starts first (reports "provisioning")
3. Caddy starts → TLS provisioned → sidecar becomes reachable via HTTPS
4. Agent starts → sidecar reports "ready"
5. antoncomputer.in polls https://{domain}/_anton/status every 3s
6. Frontend shows status progression: provisioning → dns → caddy → agent → running
```

### Project Structure

```
sidecar/
├── main.go                     # Entry point
├── go.mod
├── Makefile                    # Cross-compile targets
└── internal/
    ├── config/config.go        # Env: ANTON_TOKEN, AGENT_PORT, DOMAIN
    ├── server/server.go        # Fiber HTTP server
    ├── middleware/
    │   ├── auth.go             # Bearer token auth
    │   └── ratelimit.go        # Token bucket rate limiter
    ├── handlers/
    │   ├── health.go           # GET /health
    │   └── status.go           # GET /status
    └── checks/
        ├── agent.go            # Agent health check (localhost:9876/health)
        ├── caddy.go            # systemctl is-active caddy
        ├── dns.go              # net.LookupHost
        ├── tls.go              # TLS handshake check
        └── system.go           # CPU, RAM, disk, uptime
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent runtime | Node.js 22 + TypeScript |
| Sidecar | Go + Fiber (health, status, telemetry) |
| AI engine | pi SDK (`@mariozechner/pi-agent-core` + `pi-ai`) |
| Desktop app | Tauri v2 (Rust) + React 19 |
| Desktop UI | Tailwind 4 + Framer Motion + Shiki + react-markdown |
| CLI | Ink (React for terminals) |
| Terminal | xterm.js 5.5 |
| State | Zustand 5 (desktop), in-memory (CLI) |
| Protocol | Custom binary framing over WebSocket |
| Config | YAML (`~/.anton/config.yaml`) |
| Sessions | JSON + pi SDK message format on disk |
