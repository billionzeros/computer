/**
 * MCP Client — manages a single MCP server connection over stdio.
 *
 * Communicates via JSON-RPC 2.0 over stdin/stdout of a spawned child process.
 * Follows the MCP initialize handshake, then exposes tool discovery + execution.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { createLogger } from '@anton/logger'

// ── JSON-RPC 2.0 types ─────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// ── MCP types ───────────────────────────────────────────────────────

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown> // JSON Schema
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
  /**
   * Surfaces this MCP connector may appear on. `undefined` (the default) =
   * all surfaces. Set to e.g. `['desktop']` to keep a developer-machine
   * MCP server from leaking its tools into Slack / Telegram conversations
   * where the user context is different. Values are free-form strings so
   * new surfaces can be added without touching agent-core; the current
   * well-known set matches `ConnectorSurface` in @anton/connectors.
   */
  surfaces?: string[]
}

// ── MCP Client ──────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2024-11-05'
const INIT_TIMEOUT = 15_000
const CALL_TIMEOUT = 60_000

export class McpClient extends EventEmitter {
  readonly config: McpServerConfig
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private connected = false
  private tools: McpTool[] = []
  private buffer = ''
  /** Serializes requests to prevent concurrent stdin writes to non-thread-safe MCP servers */
  private requestQueue: Promise<void> = Promise.resolve()
  /** Ring buffer of the most recent stderr lines, surfaced in handshake errors. */
  private stderrTail: string[] = []
  private static readonly STDERR_TAIL_MAX = 40
  /** Process exit details captured before rejectAllPending fires. */
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null
  private log

  constructor(config: McpServerConfig) {
    super()
    this.config = config
    this.log = createLogger('mcp-client').child({ connector: config.id })
  }

  isConnected(): boolean {
    return this.connected
  }

  getTools(): McpTool[] {
    return this.tools
  }

  /**
   * Spawn the MCP server process, perform the initialize handshake,
   * and discover available tools.
   */
  async connect(): Promise<void> {
    if (this.connected) return

    const env = { ...process.env, ...this.config.env }

    this.log.info(
      {
        command: this.config.command,
        args: this.config.args,
        envKeys: this.config.env ? Object.keys(this.config.env) : [],
      },
      'spawning MCP server',
    )

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      // Don't let the child keep the parent alive
      detached: false,
    })

    // Wire up stdout line-by-line parsing
    if (this.process.stdout) {
      const rl = createInterface({ input: this.process.stdout })
      rl.on('line', (line) => this.handleLine(line))
    }

    // Capture stderr into a ring buffer and log it. The buffer is attached
    // to handshake errors so we can see *why* a server died on startup.
    if (this.process.stderr) {
      const rl = createInterface({ input: this.process.stderr })
      rl.on('line', (line) => {
        this.stderrTail.push(line)
        if (this.stderrTail.length > McpClient.STDERR_TAIL_MAX) {
          this.stderrTail.shift()
        }
        // During handshake, promote to warn so it surfaces alongside the failure.
        if (this.connected) {
          this.log.error({ stream: 'stderr' }, line)
        } else {
          this.log.warn({ stream: 'stderr', phase: 'handshake' }, line)
        }
      })
    }

    this.process.on('error', (err) => {
      this.log.error({ err }, 'process error')
      this.connected = false
      this.emit('error', err)
    })

    this.process.on('exit', (code, signal) => {
      this.exitInfo = { code, signal }
      this.log.info(
        {
          exitCode: code,
          signal,
          pendingRequests: this.pending.size,
          wasConnected: this.connected,
        },
        'process exited',
      )
      this.connected = false
      const reason =
        signal !== null
          ? `MCP server killed by signal ${signal}`
          : `MCP server exited with code ${code}`
      this.rejectAllPending(new Error(reason))
      this.emit('disconnected', code)
    })

    // MCP initialize handshake
    try {
      const initResult = (await this.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'anton', version: '1.0.0' },
        },
        INIT_TIMEOUT,
      )) as {
        protocolVersion: string
        capabilities: Record<string, unknown>
        serverInfo?: { name: string }
      }

      this.log.info(
        { server: initResult.serverInfo?.name ?? 'unknown', protocol: initResult.protocolVersion },
        'initialized',
      )

      // Send initialized notification
      this.notify('notifications/initialized', {})

      this.connected = true

      // Discover tools
      await this.refreshTools()
    } catch (err) {
      const cause = (err as Error).message
      const tail = this.stderrTail.slice(-10)
      const exitDetail = this.exitInfo
        ? ` [exit: code=${this.exitInfo.code}${
            this.exitInfo.signal ? ` signal=${this.exitInfo.signal}` : ''
          }]`
        : ''
      const stderrDetail = tail.length > 0 ? ` [stderr tail: ${tail.join(' | ')}]` : ''
      this.log.error(
        {
          err,
          cause,
          exitInfo: this.exitInfo,
          stderrTail: tail,
          command: this.config.command,
        },
        'handshake failed',
      )
      this.kill()
      throw new Error(
        `Failed to initialize MCP server "${this.config.id}": ${cause}${exitDetail}${stderrDetail}`,
      )
    }
  }

  /**
   * Gracefully disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected && !this.process) return
    this.connected = false
    this.tools = []
    this.rejectAllPending(new Error('Client disconnecting'))
    this.kill()
  }

  /**
   * Refresh the list of available tools from the server.
   */
  async refreshTools(): Promise<McpTool[]> {
    const result = (await this.request('tools/list', {})) as { tools: McpTool[] }
    this.tools = result.tools || []
    this.log.info(
      { count: this.tools.length, tools: this.tools.map((t) => t.name) },
      'discovered tools',
    )
    return this.tools
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.request(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT,
    )) as McpToolResult
    return result
  }

  /** Health check — returns true if the MCP server responds within 5s. */
  async ping(): Promise<boolean> {
    try {
      await this.request('ping', {}, 5_000)
      return true
    } catch {
      return false
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private request(
    method: string,
    params: Record<string, unknown>,
    timeout = CALL_TIMEOUT,
  ): Promise<unknown> {
    // Serialize: chain onto the request queue so only one request is in-flight at a time.
    // This prevents interleaving stdin writes to non-thread-safe MCP servers.
    const execute = (): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (!this.process?.stdin?.writable) {
          return reject(new Error(`MCP server "${this.config.id}" stdin not writable`))
        }

        const id = this.nextId++
        const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }

        const timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`MCP request "${method}" timed out after ${timeout}ms`))
        }, timeout)

        this.pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer)
            resolve(v)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })

        this.process.stdin.write(`${JSON.stringify(msg)}\n`)
      })

    // Chain onto the queue — previous request must complete before this one starts
    const result = this.requestQueue.then(() => execute())
    // Update queue head, swallow errors so one failure doesn't block the chain
    this.requestQueue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    this.process.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: JsonRpcResponse
    try {
      msg = JSON.parse(trimmed)
    } catch {
      // Non-JSON stdout is a common MCP bug (servers logging to stdout).
      // During handshake this silently swallows the initialize response, so
      // surface it — quietly once we're past initialize.
      if (!this.connected) {
        this.log.warn({ stream: 'stdout', phase: 'handshake', line: trimmed }, 'non-JSON stdout')
      } else {
        this.log.debug({ stream: 'stdout', line: trimmed }, 'non-JSON stdout')
      }
      return
    }

    if (!msg.jsonrpc) return

    // It's a response to a request
    if ('id' in msg && msg.id != null) {
      const handler = this.pending.get(msg.id)
      if (handler) {
        this.pending.delete(msg.id)
        if (msg.error) {
          handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`))
        } else {
          handler.resolve(msg.result)
        }
      }
    }
    // Could also be a notification from server — ignore for now
  }

  private rejectAllPending(err: Error): void {
    for (const [id, handler] of this.pending) {
      handler.reject(err)
      this.pending.delete(id)
    }
  }

  private kill(): void {
    if (this.process) {
      try {
        this.process.stdin?.end()
        this.process.kill('SIGTERM')
        // Force kill after 3s
        setTimeout(() => {
          try {
            this.process?.kill('SIGKILL')
          } catch {}
        }, 3000)
      } catch {}
      this.process = null
    }
  }
}
