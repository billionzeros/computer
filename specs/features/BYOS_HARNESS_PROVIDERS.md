# BYOS: Bring Your Own Subscription (Harness Providers)

## Problem

Anton currently relies 100% on the Pi Agent SDK for LLM calls, which means users need API keys. But many users already pay for Claude Pro/Max ($20-200/mo), ChatGPT/Codex Plus ($20/mo), or Gemini subscriptions that include CLI access. They don't want to pay twice.

Products like Paperclip, OpenClaw, and Conductor already let users bring their Claude subscription. If Anton supports this, it removes the biggest adoption barrier.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Process model | Long-lived with message injection (Conductor pattern) | Faster, session continuity, hot-swap without restart |
| MCP transport for harnesses | Stdio (Conductor pattern) | Auto-scoped per session, auto-cleanup, no port/auth management, more secure |
| MCP architecture | Thin shim → IPC → Anton server | Tool logic stays in one place, shim is ~50 lines |
| External Anton MCP server | Separate feature (not part of harness) | Different concern, can be added independently later |
| Primary target | Claude Code first, then Codex + Gemini | Largest user base, best streaming support |

## Architecture (Final)

```
┌──────────────────────────────────────────────────────────────────┐
│                        Anton Server (:9876)                        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │                    Harness Manager                         │     │
│  │                                                            │     │
│  │  Adapters:  ClaudeAdapter | CodexAdapter | GeminiAdapter   │     │
│  │             (per-CLI: flags, output parsing, MCP config)   │     │
│  └────────┬────────────────────────────────────────────────┘     │
│           │                                                        │
│           │ spawn + bidirectional stream-json                      │
│           │                                                        │
│  ┌────────▼────────────────────────────────────────────────────┐  │
│  │                    CLI Process                                │  │
│  │  (claude -p / codex exec / gemini -p)                        │  │
│  │                                                               │  │
│  │  Built-in tools: file, shell, git, web search, etc.          │  │
│  │  Anton tools via MCP: connectors, memory, agents, workflows  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────┐                         │  │
│  │  │ Anton MCP Shim (stdio, ~50 LOC) │                         │  │
│  │  │ stdin/stdout ←→ JSON-RPC        │                         │  │
│  │  │ Relays to Anton Server via IPC  │                         │  │
│  │  └──────────────┬──────────────────┘                         │  │
│  └─────────────────│────────────────────────────────────────────┘  │
│                    │                                                │
│           Unix socket IPC (/tmp/anton-<pid>.sock)                  │
│                    │                                                │
│  ┌─────────────────▼──────────────────────────────────────────┐   │
│  │              Anton Tool Registry                             │   │
│  │                                                              │   │
│  │  Connectors: Slack, Gmail, GitHub, Linear, Notion, etc.     │   │
│  │  Memory: save, recall, list, forget (persistent)            │   │
│  │  Agents: create, schedule, list, stop (cron-based)          │   │
│  │  Workflows: activate, shared state, coordination            │   │
│  │  Database: SQLite query/execute                              │   │
│  │  Browser: Playwright automation                              │   │
│  │  Notifications: desktop alerts                               │   │
│  │  Publish: artifacts → self-contained HTML                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Why Stdio MCP (Not HTTP)

We considered HTTP MCP (OpenClaw pattern) vs Stdio MCP (Conductor pattern). Chose Stdio because:

1. **Auto-scoped** — MCP server is a child of the CLI process, inherently scoped to that session
2. **Auto-cleanup** — CLI dies → MCP shim dies. No orphaned servers or port leaks
3. **No auth needed** — process-local, no tokens or port management
4. **More secure** — no network surface, even on localhost
5. **Conductor proves it works** — battle-tested pattern at scale

An external-facing HTTP MCP server for Anton (for VS Code, other tools, `claude mcp add anton`) is a separate feature we can build independently later. The harness MCP and the external MCP are different concerns.

### How MCP Registration Works Per CLI

**Claude Code** (inline, easiest):
```bash
claude -p "message" --mcp-config '{"mcpServers":{"anton":{"command":"node","args":["/path/to/anton-mcp-shim.js"],"env":{"ANTON_SOCK":"/tmp/anton.sock","ANTON_SESSION":"<id>"}}}}'
```

**Codex** (write to config.toml before first spawn):
```toml
# ~/.codex/config.toml — written programmatically by Anton
[mcp_servers.anton]
command = "node"
args = ["/path/to/anton-mcp-shim.js"]
env = { ANTON_SOCK = "/tmp/anton.sock" }
```
Session ID passed via env var `ANTON_SESSION` when spawning `codex exec`.

**Gemini** (write to settings.json before first spawn):
```json
{
  "mcpServers": {
    "anton": {
      "command": "node",
      "args": ["/path/to/anton-mcp-shim.js"],
      "env": { "ANTON_SOCK": "/tmp/anton.sock" }
    }
  }
}
```
Session ID passed via env var `ANTON_SESSION` when spawning `gemini -p`.

---

## Part 1: Harness Adapter Interface

Each CLI is different in flags and output format. The adapter interface normalizes them:

```typescript
// packages/agent-core/src/harness/adapter.ts

interface HarnessAdapter {
  /** Unique ID for this harness type */
  readonly id: string
  /** Display name */
  readonly name: string
  /** CLI command name */
  readonly command: string

  /** Check if CLI is installed, return version */
  detect(): Promise<{ installed: boolean; version?: string; path?: string }>

  /** Build spawn args for a new session */
  buildSpawnArgs(opts: {
    message: string
    sessionId: string
    resumeSessionId?: string
    systemPrompt?: string
    mcpConfigPath?: string     // path to MCP config (for Claude) or null
    model?: string
    maxBudgetUsd?: number
    cwd: string
  }): string[]

  /** Build env vars for the spawned process */
  buildEnv(opts: {
    sessionId: string
    antonSocketPath: string
  }): Record<string, string>

  /** Parse a line of NDJSON output into SessionEvents */
  parseEvent(line: string): SessionEvent[]

  /** Extract session ID from output events (for resume) */
  extractSessionId(event: unknown): string | null

  /** Register Anton MCP shim with this CLI (one-time setup) */
  registerMcp(shimPath: string, socketPath: string): Promise<void>

  /** Build args to write a follow-up message to stdin (bidirectional) */
  buildStdinMessage(message: string, sessionId: string): string
}
```

### Claude Code Adapter

```typescript
// packages/agent-core/src/harness/adapters/claude.ts

class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  readonly command = 'claude'

  async detect() {
    try {
      const { stdout: path } = await execAsync('which claude')
      const { stdout: version } = await execAsync('claude --version')
      return { installed: true, version: version.trim(), path: path.trim() }
    } catch {
      return { installed: false }
    }
  }

  buildSpawnArgs(opts) {
    const args = ['-p', opts.message]

    args.push('--output-format', 'stream-json')
    args.push('--input-format', 'stream-json')
    args.push('--verbose')

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId)
    } else {
      args.push('--session-id', opts.sessionId)
    }

    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt)
    }

    if (opts.mcpConfigPath) {
      args.push('--mcp-config', opts.mcpConfigPath)
    }

    if (opts.maxBudgetUsd) {
      args.push('--max-budget-usd', String(opts.maxBudgetUsd))
    }

    if (opts.model) {
      args.push('--model', opts.model)
    }

    // Clean subprocess: skip hooks/plugins, auto-approve
    args.push('--bare')
    args.push('--permission-mode', 'auto')

    return args
  }

  buildEnv(opts) {
    return {
      ANTON_SESSION: opts.sessionId,
      ANTON_SOCK: opts.antonSocketPath,
    }
  }

  parseEvent(line: string): SessionEvent[] {
    const event = JSON.parse(line)
    const events: SessionEvent[] = []

    switch (event.type) {
      case 'system':
        // init event — extract session_id, model, tools
        break

      case 'assistant': {
        const msg = event.message
        if (!msg?.content) break
        for (const block of msg.content) {
          if (block.type === 'text') {
            events.push({ type: 'text', content: block.text })
          }
          if (block.type === 'tool_use') {
            events.push({
              type: 'tool_call',
              id: block.id,
              name: block.name,
              input: block.input,
            })
          }
          if (block.type === 'tool_result') {
            events.push({
              type: 'tool_result',
              id: block.tool_use_id,
              output: typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
              isError: block.is_error ?? false,
            })
          }
        }
        if (msg.usage) {
          events.push({
            type: 'usage',
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
          })
        }
        break
      }

      case 'result':
        if (event.is_error) {
          events.push({ type: 'error', message: event.result || 'CLI error' })
        }
        events.push({
          type: 'cost_update',
          totalCostUsd: event.total_cost_usd,
          durationMs: event.duration_ms,
        })
        break
    }

    return events
  }

  extractSessionId(event: unknown): string | null {
    const e = event as any
    if (e?.type === 'result' && e?.session_id) return e.session_id
    if (e?.type === 'system' && e?.session_id) return e.session_id
    return null
  }

  async registerMcp(shimPath: string, socketPath: string) {
    // Claude Code: no-op — we pass --mcp-config inline per spawn
  }

  buildStdinMessage(message: string, sessionId: string): string {
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
      session_id: sessionId,
    })
  }
}
```

### Codex Adapter

```typescript
// packages/agent-core/src/harness/adapters/codex.ts

class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex'
  readonly name = 'Codex (OpenAI)'
  readonly command = 'codex'

  async detect() {
    try {
      const { stdout: path } = await execAsync('which codex')
      const { stdout: version } = await execAsync('codex --version')
      return { installed: true, version: version.trim(), path: path.trim() }
    } catch {
      return { installed: false }
    }
  }

  buildSpawnArgs(opts) {
    // codex exec "message" --json
    const args = ['exec', opts.message, '--json']

    if (opts.model) args.push('--model', opts.model)

    // Codex uses --full-auto for non-interactive
    args.push('--full-auto')

    if (opts.cwd) args.push('--cd', opts.cwd)

    return args
  }

  buildEnv(opts) {
    return {
      ANTON_SESSION: opts.sessionId,
      ANTON_SOCK: opts.antonSocketPath,
    }
  }

  parseEvent(line: string): SessionEvent[] {
    const event = JSON.parse(line)
    const events: SessionEvent[] = []

    // Codex JSONL event types:
    // thread.started, turn.started, turn.completed, turn.failed, item.*
    switch (event.type) {
      case 'item.text':
        events.push({ type: 'text', content: event.text })
        break
      case 'item.tool_use':
        events.push({
          type: 'tool_call',
          id: event.id,
          name: event.name,
          input: event.input,
        })
        break
      case 'item.tool_result':
        events.push({
          type: 'tool_result',
          id: event.tool_use_id,
          output: event.output,
          isError: event.is_error ?? false,
        })
        break
      case 'turn.completed':
        // Contains session info and usage
        break
      case 'error':
        events.push({ type: 'error', message: event.message })
        break
    }

    return events
  }

  extractSessionId(event: unknown): string | null {
    const e = event as any
    if (e?.type === 'thread.started' && e?.session_id) return e.session_id
    return null
  }

  async registerMcp(shimPath: string, socketPath: string) {
    // Write to ~/.codex/config.toml if not already registered
    const configPath = join(homedir(), '.codex', 'config.toml')
    // Check if anton entry already exists, if not add it
    // [mcp_servers.anton]
    // command = "node"
    // args = [shimPath]
    // env = { ANTON_SOCK = socketPath }
  }

  buildStdinMessage(message: string, sessionId: string): string {
    // Codex may not support bidirectional stdin — use per-message spawn
    // with `codex resume <sessionId>` for follow-ups
    return ''
  }
}
```

### Gemini Adapter

```typescript
// packages/agent-core/src/harness/adapters/gemini.ts

class GeminiAdapter implements HarnessAdapter {
  readonly id = 'gemini'
  readonly name = 'Gemini CLI'
  readonly command = 'gemini'

  async detect() {
    try {
      const { stdout: path } = await execAsync('which gemini')
      const { stdout: version } = await execAsync('gemini --version')
      return { installed: true, version: version.trim(), path: path.trim() }
    } catch {
      return { installed: false }
    }
  }

  buildSpawnArgs(opts) {
    const args = ['-p', opts.message]

    args.push('--output-format', 'stream-json')

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId)
    }

    if (opts.model) args.push('--model', opts.model)

    return args
  }

  buildEnv(opts) {
    return {
      ANTON_SESSION: opts.sessionId,
      ANTON_SOCK: opts.antonSocketPath,
    }
  }

  parseEvent(line: string): SessionEvent[] {
    const event = JSON.parse(line)
    const events: SessionEvent[] = []

    // Gemini stream-json events:
    // init, message, tool_use, tool_result, error, result
    switch (event.type) {
      case 'message':
        events.push({ type: 'text', content: event.text })
        break
      case 'tool_use':
        events.push({
          type: 'tool_call',
          id: event.id,
          name: event.name,
          input: event.input,
        })
        break
      case 'tool_result':
        events.push({
          type: 'tool_result',
          id: event.tool_use_id,
          output: event.output,
          isError: event.is_error ?? false,
        })
        break
      case 'result':
        // Final event
        break
      case 'error':
        events.push({ type: 'error', message: event.message })
        break
    }

    return events
  }

  extractSessionId(event: unknown): string | null {
    const e = event as any
    if (e?.type === 'result' && e?.session_id) return e.session_id
    return null
  }

  async registerMcp(shimPath: string, socketPath: string) {
    // Write to ~/.gemini/settings.json if not already registered
    // { "mcpServers": { "anton": { "command": "node", "args": [shimPath],
    //   "env": { "ANTON_SOCK": socketPath } } } }
  }

  buildStdinMessage(message: string, sessionId: string): string {
    // Gemini may not support bidirectional stdin — use per-message spawn
    // with --resume for follow-ups
    return ''
  }
}
```

---

## Part 2: Harness Session (Process Manager)

The `HarnessSession` manages the CLI process lifecycle. Follows Conductor's pattern:
long-lived process, message injection via async generator, graceful shutdown with escalation.

```typescript
// packages/agent-core/src/harness/harness-session.ts

import { createInterface } from 'node:readline'
import { spawn, type ChildProcess } from 'node:child_process'

interface HarnessSessionOptions {
  id: string
  adapter: HarnessAdapter
  projectPath: string
  systemPrompt?: string
  antonSocketPath: string
  maxBudgetUsd?: number
  model?: string
}

class HarnessSession {
  readonly id: string
  private proc: ChildProcess | null = null
  private abortController = new AbortController()
  private cliSessionId: string | null = null
  private readline: AsyncIterableIterator<string> | null = null

  title: string = ''
  lastActiveAt: number = Date.now()

  constructor(
    private opts: HarnessSessionOptions,
    private adapter: HarnessAdapter,
  ) {
    this.id = opts.id
  }

  /**
   * Mirrors Session.processMessage() — yields SessionEvents.
   *
   * First message: spawns CLI process.
   * Follow-up messages: writes to stdin (if adapter supports bidirectional)
   *                     or spawns new process with --resume.
   */
  async *processMessage(
    userMessage: string,
    attachments: ChatImageAttachmentInput[] = [],
  ): AsyncGenerator<SessionEvent> {
    this.lastActiveAt = Date.now()

    const canResume = this.cliSessionId && this.adapter.buildStdinMessage('', '')
    if (this.proc && canResume) {
      // Bidirectional: write follow-up to existing stdin
      yield* this.sendToStdin(userMessage)
    } else {
      // Spawn new process (first message or CLI doesn't support stdin injection)
      if (this.proc) await this.shutdown()
      yield* this.spawnAndStream(userMessage)
    }
  }

  // ─── Spawn & Stream ────────────────────────────────────────

  private async *spawnAndStream(message: string): AsyncGenerator<SessionEvent> {
    // Generate MCP config (for Claude: temp file; for Codex/Gemini: already registered)
    const mcpConfigPath = this.adapter.id === 'claude-code'
      ? this.generateMcpConfigFile()
      : undefined

    const args = this.adapter.buildSpawnArgs({
      message,
      sessionId: this.id,
      resumeSessionId: this.cliSessionId ?? undefined,
      systemPrompt: this.opts.systemPrompt,
      mcpConfigPath,
      model: this.opts.model,
      maxBudgetUsd: this.opts.maxBudgetUsd,
      cwd: this.opts.projectPath,
    })

    const env = {
      ...process.env,
      ...this.adapter.buildEnv({
        sessionId: this.id,
        antonSocketPath: this.opts.antonSocketPath,
      }),
    }

    this.proc = spawn(this.adapter.command, args, {
      cwd: this.opts.projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: this.abortController.signal,
      env,
      windowsHide: true,
    })

    // Stderr: log but don't crash
    if (this.proc.stderr) {
      const stderrRl = createInterface({ input: this.proc.stderr })
      ;(async () => {
        for await (const line of stderrRl) {
          log.debug({ harness: this.adapter.id, stderr: line }, 'CLI stderr')
        }
      })()
    }

    // Stdout: parse NDJSON events
    const rl = createInterface({ input: this.proc.stdout! })

    // Process exit handling
    let processExited = false
    let exitError: string | null = null
    this.proc.on('exit', (code, signal) => {
      processExited = true
      if (code && code !== 0) {
        exitError = `CLI exited with code ${code}`
      }
      if (signal) {
        exitError = `CLI killed by signal ${signal}`
      }
    })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const raw = JSON.parse(line)

        // Extract CLI session ID for resume
        const sid = this.adapter.extractSessionId(raw)
        if (sid) this.cliSessionId = sid

        // Translate to SessionEvents
        const events = this.adapter.parseEvent(line)
        for (const ev of events) {
          yield ev
        }
      } catch {
        // Skip non-JSON lines
        continue
      }
    }

    // After stdout closes
    if (exitError) {
      yield { type: 'error', message: exitError }
    }
    yield { type: 'done' }
    this.proc = null
  }

  // ─── Bidirectional Stdin (Claude Code) ─────────────────────

  private async *sendToStdin(message: string): AsyncGenerator<SessionEvent> {
    const stdinMsg = this.adapter.buildStdinMessage(message, this.id)
    if (!stdinMsg || !this.proc?.stdin?.writable) {
      // Fallback: spawn new process with --resume
      yield* this.spawnAndStream(message)
      return
    }
    this.proc.stdin.write(stdinMsg + '\n')
    // Events come from the persistent readline on stdout
    // They'll be yielded by the spawnAndStream loop that's still running
  }

  // ─── MCP Config ────────────────────────────────────────────

  private generateMcpConfigFile(): string {
    const shimPath = join(__dirname, 'anton-mcp-shim.js')
    const config = {
      mcpServers: {
        anton: {
          command: 'node',
          args: [shimPath],
          env: {
            ANTON_SOCK: this.opts.antonSocketPath,
            ANTON_SESSION: this.id,
          },
        },
      },
    }
    const tmpPath = join(tmpdir(), `anton-mcp-${this.id}.json`)
    writeFileSync(tmpPath, JSON.stringify(config))
    return tmpPath
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  /**
   * Graceful shutdown with escalation (Conductor pattern):
   * 1. End stdin
   * 2. Wait 2s
   * 3. SIGTERM
   * 4. Wait 5s
   * 5. SIGKILL
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return

    const proc = this.proc
    this.proc = null

    // End stdin — signal CLI to finish current work
    try { proc.stdin?.end() } catch {}

    // Wait for graceful exit
    const exited = await Promise.race([
      new Promise<boolean>(resolve => proc.on('exit', () => resolve(true))),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
    ])
    if (exited) return

    // SIGTERM
    proc.kill('SIGTERM')
    const terminated = await Promise.race([
      new Promise<boolean>(resolve => proc.on('exit', () => resolve(true))),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
    ])
    if (terminated) return

    // SIGKILL
    proc.kill('SIGKILL')
  }

  abort(): void {
    this.abortController.abort()
    this.proc?.kill('SIGTERM')
  }

  get resumeId(): string | null {
    return this.cliSessionId
  }
}
```

---

## Part 3: Anton MCP Shim

The shim is a tiny stdio MCP server (~80 lines) that relays JSON-RPC to the Anton server via unix socket IPC. All tool logic lives in the Anton server — the shim is just a pipe.

```typescript
// packages/agent-core/src/harness/anton-mcp-shim.ts
// Runs as: node anton-mcp-shim.js
// Env: ANTON_SOCK (unix socket path), ANTON_SESSION (session ID)

import { createInterface } from 'node:readline'
import { connect } from 'node:net'

const PROTOCOL_VERSION = '2024-11-05'
const SOCK = process.env.ANTON_SOCK!
const SESSION = process.env.ANTON_SESSION!

// Connect to Anton server via unix socket
const ipc = connect(SOCK)
let ipcBuffer = ''

// IPC: receive responses from Anton server
ipc.on('data', (chunk) => {
  ipcBuffer += chunk.toString()
  let newline: number
  while ((newline = ipcBuffer.indexOf('\n')) !== -1) {
    const line = ipcBuffer.slice(0, newline)
    ipcBuffer = ipcBuffer.slice(newline + 1)
    if (line.trim()) {
      // Write response to stdout (back to CLI)
      process.stdout.write(line + '\n')
    }
  }
})

// Stdin: receive JSON-RPC from CLI
const rl = createInterface({ input: process.stdin })

for await (const line of rl) {
  if (!line.trim()) continue

  try {
    const msg = JSON.parse(line)

    // Handle initialize locally (don't relay)
    if (msg.method === 'initialize') {
      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'anton', version: '1.0.0' },
        },
      })
      process.stdout.write(response + '\n')
      continue
    }

    // Handle ping locally
    if (msg.method === 'ping') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n'
      )
      continue
    }

    // Everything else (tools/list, tools/call): relay to Anton server
    // Tag with session ID so Anton knows the context
    const relayMsg = JSON.stringify({
      ...msg,
      _antonSession: SESSION,
    })
    ipc.write(relayMsg + '\n')
  } catch {
    // Skip invalid JSON
  }
}

// Cleanup on exit
process.on('SIGTERM', () => {
  ipc.end()
  process.exit(0)
})
```

### Anton Server: MCP IPC Handler

The Anton server listens on the unix socket and handles relayed MCP requests:

```typescript
// packages/agent-server/src/mcp-ipc-handler.ts

import { createServer, type Server } from 'node:net'

class McpIpcHandler {
  private server: Server

  constructor(
    private socketPath: string,
    private toolRegistry: AntonToolRegistry,
  ) {
    this.server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        let newline: number
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.trim()) {
            this.handleMessage(socket, JSON.parse(line))
          }
        }
      })
    })
  }

  start(): void {
    this.server.listen(this.socketPath)
  }

  stop(): void {
    this.server.close()
    try { unlinkSync(this.socketPath) } catch {}
  }

  private async handleMessage(socket: net.Socket, msg: any): Promise<void> {
    const sessionId = msg._antonSession
    delete msg._antonSession

    switch (msg.method) {
      case 'tools/list': {
        const tools = this.toolRegistry.getToolsForSession(sessionId)
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: tools.map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        }
        socket.write(JSON.stringify(response) + '\n')
        break
      }

      case 'tools/call': {
        const { name, arguments: args } = msg.params
        try {
          const result = await this.toolRegistry.executeTool(
            sessionId, name, args,
          )
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result,
          }) + '\n')
        } catch (err) {
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            },
          }) + '\n')
        }
        break
      }
    }
  }
}
```

### Anton Tool Registry

Wraps existing Anton tools into MCP-compatible format:

```typescript
// packages/agent-core/src/harness/tool-registry.ts

class AntonToolRegistry {
  constructor(
    private connectorManager: ConnectorManager,
    private memoryStore: MemoryStore,
    private agentManager: AgentManager,
    private scheduler: Scheduler,
  ) {}

  getToolsForSession(sessionId: string): McpToolDefinition[] {
    const tools: McpToolDefinition[] = []

    // ── Connector tools (dynamic, from all active connectors) ──
    for (const connector of this.connectorManager.getActiveConnectors()) {
      for (const tool of connector.getTools()) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: typeboxToJsonSchema(tool.parameters),
          execute: (args) => tool.execute(`mcp-${Date.now()}`, args),
        })
      }
    }

    // ── Memory tools ──
    tools.push({
      name: 'memory_save',
      description: 'Save information to persistent memory (survives across sessions)',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Topic/key' },
          content: { type: 'string', description: 'Content to remember' },
          scope: { type: 'string', enum: ['global', 'conversation'] },
        },
        required: ['key', 'content'],
      },
      execute: async (args) => ({
        content: [{ type: 'text', text: this.memoryStore.save(args.key, args.content, args.scope ?? 'global') }],
      }),
    })

    tools.push({
      name: 'memory_recall',
      description: 'Recall information from persistent memory',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      execute: async (args) => ({
        content: [{ type: 'text', text: this.memoryStore.recall(args.query) }],
      }),
    })

    // ── Agent/scheduling tools ──
    tools.push({
      name: 'agent_create',
      description: 'Create a background agent that runs on a cron schedule',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          prompt: { type: 'string', description: 'Standing instructions' },
          schedule: { type: 'string', description: 'Cron expression' },
        },
        required: ['name', 'prompt'],
      },
      execute: async (args) => ({
        content: [{ type: 'text', text: await this.agentManager.create(args) }],
      }),
    })

    // ── Workflow, database, notification, browser, publish tools ──
    // (same pattern: wrap existing implementations)

    return tools
  }

  async executeTool(sessionId: string, name: string, args: unknown) {
    const tools = this.getToolsForSession(sessionId)
    const tool = tools.find(t => t.name === name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute(args as Record<string, unknown>)
  }
}
```

---

## Part 4: Server Integration

### AgentServer Changes

```typescript
// packages/agent-server/src/server.ts — additions

class AgentServer {
  private harnessSessions = new Map<string, HarnessSession>()
  private mcpIpcHandler: McpIpcHandler
  private adapters: Map<string, HarnessAdapter>

  constructor() {
    // Register adapters
    this.adapters = new Map([
      ['claude-code', new ClaudeAdapter()],
      ['codex', new CodexAdapter()],
      ['gemini', new GeminiAdapter()],
    ])

    // Start MCP IPC handler
    const socketPath = join(tmpdir(), `anton-mcp-${process.pid}.sock`)
    this.mcpIpcHandler = new McpIpcHandler(socketPath, this.toolRegistry)
    this.mcpIpcHandler.start()
  }

  /** Create session — routes to Pi SDK or Harness based on provider */
  createSession(opts: CreateSessionOpts): Session | HarnessSession {
    const providerConfig = this.config.providers[opts.provider]

    if (providerConfig?.type === 'harness') {
      const adapter = this.adapters.get(opts.provider)
      if (!adapter) throw new Error(`Unknown harness: ${opts.provider}`)

      const session = new HarnessSession({
        id: opts.sessionId,
        adapter,
        projectPath: opts.projectPath || process.cwd(),
        systemPrompt: this.buildHarnessSystemPrompt(opts),
        antonSocketPath: this.mcpIpcHandler.socketPath,
        model: opts.model,
        maxBudgetUsd: opts.maxBudgetUsd,
      }, adapter)

      this.harnessSessions.set(opts.sessionId, session)
      return session
    }

    // Default: Pi SDK session
    return this.createPiSession(opts)
  }

  private buildHarnessSystemPrompt(opts: CreateSessionOpts): string {
    return [
      'You are running inside Anton, an AI-native personal computer.',
      'You have access to Anton tools via MCP (prefixed mcp__anton__).',
      '',
      'Anton capabilities available to you:',
      '- Send Slack/Telegram messages, create GitHub issues, send emails',
      '- Save/recall persistent memory across sessions',
      '- Create background agents on cron schedules',
      '- Activate multi-agent workflows',
      '- Query SQLite database, send desktop notifications',
      '- Automate browser with Playwright',
      '',
      opts.workspaceRules || '',
      opts.memories || '',
    ].filter(Boolean).join('\n')
  }

  /** Detect all installed CLI harnesses */
  async detectHarnesses(): Promise<Record<string, {
    installed: boolean; version?: string; path?: string
  }>> {
    const results: Record<string, any> = {}
    for (const [id, adapter] of this.adapters) {
      results[id] = await adapter.detect()
    }
    return results
  }
}
```

### Config

```yaml
# ~/.anton/config.yaml

providers:
  # API providers (existing)
  anthropic:
    apiKey: sk-ant-...
    models: [claude-sonnet-4-6]

  # Harness providers (NEW)
  claude-code:
    type: harness
    # No apiKey — uses subscription
    # Command auto-resolved from adapter

  codex:
    type: harness

  gemini:
    type: harness

defaults:
  provider: claude-code          # can be a harness
  model: claude-code             # model managed by CLI
```

---

## Part 5: Desktop UI Changes

### Provider Selector

```
┌─────────────────────────────────┐
│ Choose Provider                  │
│                                  │
│  API Providers                   │
│  ○ Anthropic           [key]    │
│  ○ OpenAI              [key]    │
│  ○ Google              [key]    │
│  ○ Anton (Proxy)       [key]    │
│                                  │
│  Your Subscriptions              │
│  ● Claude Code  (SUB)  [✓]     │
│  ○ Codex        (SUB)  [✓]     │
│  ○ Gemini CLI   (SUB)  [!]     │  ← not installed
│                                  │
│  [Detect Installed CLIs]         │
└─────────────────────────────────┘
```

- Harness providers grouped under "Your Subscriptions"
- Green check if CLI detected, warning if not installed
- No API key field — show "Uses your subscription" instead
- No model selector for harness providers (CLI manages its own)

### Settings Page (per harness)

```
┌──────────────────────────────────────────────┐
│ Claude Code (Harness Provider)                │
│                                               │
│ Status: ✓ Installed (v2.1.109)               │
│ Path:   /usr/local/bin/claude                 │
│ Auth:   Uses your Claude subscription         │
│                                               │
│ Anton Tools (exposed via MCP):                │
│ [x] Connectors (Slack, Gmail, GitHub, etc.)   │
│ [x] Persistent memory                         │
│ [x] Background agents & scheduling            │
│ [x] Workflows                                 │
│ [ ] Browser automation (Playwright)           │
│ [x] Database (SQLite)                         │
│ [x] Desktop notifications                     │
│                                               │
│ Budget limit per message: [___] USD            │
│ Permission mode: [auto ▼]                      │
└──────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Claude Code Harness + MCP Shim (MVP)
- [ ] `HarnessAdapter` interface + `ClaudeAdapter` implementation
- [ ] `HarnessSession` class (spawn, readline, stream-json parsing, graceful shutdown)
- [ ] `ClaudeStreamEvent` → `SessionEvent` translator
- [ ] Anton MCP Shim (stdio → unix socket relay, ~80 lines)
- [ ] `McpIpcHandler` (server-side unix socket listener)
- [ ] `AntonToolRegistry` with memory + notification + database tools
- [ ] MCP config file generation (temp JSON for `--mcp-config`)
- [ ] `AgentServer.createSession()` routing (Pi SDK vs Harness)
- [ ] `detectHarness()` check for Claude CLI
- [ ] Config support for `type: harness` providers
- [ ] Desktop: provider selector with "Your Subscriptions" group
- [ ] Session persistence for harness sessions (messages.jsonl)

### Phase 2: Connector Bridge + Session Continuity
- [ ] Tool registry: expose all active connector tools via MCP
- [ ] `--resume` session continuity across messages
- [ ] `--append-system-prompt` for Anton context injection
- [ ] Cost tracking from `result` event (total_cost_usd)
- [ ] Error recovery: CLI crash → auto-restart with --resume
- [ ] Desktop: tool call rendering for harness sessions
- [ ] Desktop: harness settings page with tool toggles
- [ ] Idle session sweep (kill processes idle > 30min)

### Phase 3: Multi-Harness + Deep Integration
- [ ] `CodexAdapter` implementation (codex exec --json)
- [ ] `GeminiAdapter` implementation (gemini -p --output-format stream-json)
- [ ] MCP registration for Codex (write config.toml) and Gemini (write settings.json)
- [ ] Tool registry: agent/scheduling, workflow, browser, publish tools
- [ ] Bidirectional stdin for Claude Code (long-lived process, message injection)
- [ ] Hot-swap model/permissions without restart (control messages)
- [ ] Harness sessions usable in scheduled skills/agents

### Phase 4: Polish
- [ ] Custom harness config (user-defined CLI commands)
- [ ] Harness health monitoring and version detection
- [ ] Unified memory across harness and native sessions
- [ ] Session forking for undo (--resume-session-at + --fork-session)
- [ ] Git checkpointing (Conductor pattern, optional)

---

## Appendix A: Reference Implementations

### A. Conductor (Deep Dive)

Conductor is a Mac desktop app that runs multiple Claude Code instances in parallel workspaces. Its implementation is the most mature CLI bridge.

#### Architecture: Three Layers

```
Electron Frontend (React)
    ↕ JSON-RPC over Unix socket
Sidecar Process (Node.js, /tmp/conductor-sidecar-<PID>.sock)
    ↕ spawn + bidirectional stdio
Claude Code CLI Process
```

1. **Sidecar** — Standalone Node process. Manages Claude processes, session state, idle sweeps. Survives tab reloads.
2. **ProcessTransport** — Low-level: spawn, stdin/stdout piping, abort, graceful shutdown.
3. **ClaudeAgentRunner** — High-level: long-lived processes, multi-turn message injection, hot-swap.

#### Key Pattern: Long-Lived Process with Message Injection

Conductor does NOT spawn a new process per message. One long-lived process handles multiple turns via an async message queue:

```javascript
// Async generator yields messages on demand
const promptInput = (async function*() {
  while (!stopped) {
    let msg = messageQueue.length > 0
      ? messageQueue.shift()
      : await new Promise(resolve => { waitingForMessage = resolve })
    yield {
      type: 'user',
      message: { role: 'user', content: msg },
      session_id: sessionId,
    }
  }
})()

// CLI reads from this generator via --input-format stream-json
```

#### Turn Management: Hot-Swap Without Restart

```javascript
// FastMode change → must restart
if (requestedFastMode !== live.currentFastMode) {
  this.stopSession({ sessionId })
  live = this.startGenerator(sessionId, config, { resume: sessionId })
}
// Model/thinking/permissions → hot-swap via control messages (no restart!)
if (config.model !== live.currentModel)
  await live.queryResult.setModel(newModel)
```

#### Bidirectional Control Protocol

The CLI and SDK exchange control requests over stdin/stdout:
- `can_use_tool` — CLI asks permission before tool execution
- `hook_callback` — CLI triggers registered hooks
- `mcp_message` — MCP routing through the SDK
- `elicitation` — CLI asks user for input

#### Graceful Shutdown with Escalation

```
1. End stdin (signal to finish)
2. Wait 2s
3. SIGTERM
4. Wait 5s
5. SIGKILL
```

#### Idle Session Sweeping

```javascript
const MAX_IDLE_MS = 1800 * 1000  // 30 min
const MAX_SESSIONS = 5
setInterval(sweepIdleSessions, 60_000)
```

#### Git Checkpointing

Private refs at `refs/conductor-checkpoints/session-<id>-turn-<n>-{start|end}`. Stores HEAD OID, index tree, and worktree tree. Non-disruptive (no HEAD movement). Restore via `git reset --hard` + `git read-tree`.

---

### B. OpenClaw (Deep Dive)

OpenClaw (358K GitHub stars) is a personal AI assistant OS with 25+ messaging bridges.

#### CLI Backend Config

```json5
{
  "backend": {
    "type": "claude-code",
    "command": "claude",
    "args": ["-p"],
    "inputMode": "arg",           // or "stdin" if prompt > maxPromptArgChars
    "outputFormat": "jsonl",
    "sessionArg": "--session-id",
    "sessionMode": "always",
    "resumeArgs": ["--resume"],
    "sessionIdFields": ["session_id"],
    "serialize": true,            // sequential turns
    "bundleMcp": true,           // inject gateway tools via MCP
    "maxPromptArgChars": 100000,
    "sessionTtl": "7d"
  }
}
```

#### MCP Bridging

Uses HTTP loopback MCP server on port 18796 with per-session `OPENCLAW_MCP_TOKEN`. Different from Conductor's stdio approach — chose HTTP because it supports 25+ messaging bridges (not just desktop).

#### 4-Layer Memory

1. Session context (per-turn injection)
2. Daily logs (automated summaries)
3. Curated MEMORY.md (LLM-maintained)
4. Vector search (SQLite + embeddings)

#### Important: Anthropic OAuth Ban (April 2026)

Anthropic blocked subscription OAuth tokens from third-party harnesses. Spawning `claude -p` directly is fine — the CLI itself is included in the subscription. Using OAuth tokens for raw API access is banned.

---

### C. Paperclip

Paperclip uses per-task process spawning (heartbeat model) with 6 built-in adapters. Simpler but no session continuity. Injects skills via `~/.claude/skills/` symlinks instead of MCP.

---

### D. Comparison Matrix

| Feature | Conductor | OpenClaw | Paperclip | Anton (This Spec) |
|---------|-----------|----------|-----------|-------------------|
| **Process model** | Long-lived | Per-message or long-lived | Per-task | Long-lived (Phase 3) |
| **MCP transport** | Stdio | HTTP loopback | Skill symlinks | Stdio → IPC |
| **CLIs supported** | Claude only | Claude, Codex, Gemini, Cursor | Claude, Codex, Gemini, Cursor, Pi | Claude, Codex, Gemini |
| **Session continuity** | --resume + --fork | --session-id + --resume | None | --resume + --fork |
| **Permission handling** | Bidirectional control | Auto-approve | Auto-approve | Auto-approve (Phase 1) |
| **Hot-swap** | Model/thinking/perms | No | No | Model/perms (Phase 3) |
| **Git checkpoints** | Yes | No | No | Optional (Phase 4) |
| **Unique tools exposed** | ~4 (AskUser, Diff, etc.) | Gateway tools | Task skills | 80+ (connectors, memory, agents, workflows) |

---

## Why This Makes Anton Unique

Without BYOS, Anton competes with every other AI chat app on model access alone. With BYOS:

1. **Zero marginal cost** — Users already paying for Claude/Codex/Gemini get Anton for free
2. **Best of both worlds** — CLI's agent loop + Anton's ecosystem (connectors, memory, agents, workflows)
3. **Network effect** — Every connector added to Anton makes every harness more powerful
4. **Lock-in via value, not vendor** — Users stay because Anton makes their existing subscription more valuable
5. **Scheduling + CLI** — No other product lets you run scheduled Claude Code sessions with Slack/Gmail/GitHub access
6. **Universal** — Same architecture works across Claude Code, Codex, and Gemini CLI

The stdio MCP shim is the key architectural insight: a ~80-line relay that gives any CLI access to Anton's full ecosystem, with automatic lifecycle management and zero auth overhead. Anton doesn't try to replace the CLI's capabilities — it augments them with things no CLI has.
