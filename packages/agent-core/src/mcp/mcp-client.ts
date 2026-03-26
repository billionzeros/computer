/**
 * MCP Client — manages a single MCP server connection over stdio.
 *
 * Communicates via JSON-RPC 2.0 over stdin/stdout of a spawned child process.
 * Follows the MCP initialize handshake, then exposes tool discovery + execution.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'

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

  constructor(config: McpServerConfig) {
    super()
    this.config = config
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

    // Log stderr but don't crash
    if (this.process.stderr) {
      const rl = createInterface({ input: this.process.stderr })
      rl.on('line', (line) => {
        console.error(`[mcp:${this.config.id}] stderr: ${line}`)
      })
    }

    this.process.on('error', (err) => {
      console.error(`[mcp:${this.config.id}] process error:`, err.message)
      this.connected = false
      this.emit('error', err)
    })

    this.process.on('exit', (code) => {
      console.log(`[mcp:${this.config.id}] process exited with code ${code}`)
      this.connected = false
      this.rejectAllPending(new Error(`MCP server exited with code ${code}`))
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
      )) as { protocolVersion: string; capabilities: Record<string, unknown>; serverInfo?: { name: string } }

      console.log(
        `[mcp:${this.config.id}] initialized — server: ${initResult.serverInfo?.name ?? 'unknown'}, protocol: ${initResult.protocolVersion}`,
      )

      // Send initialized notification
      this.notify('notifications/initialized', {})

      this.connected = true

      // Discover tools
      await this.refreshTools()
    } catch (err) {
      this.kill()
      throw new Error(
        `Failed to initialize MCP server "${this.config.id}": ${(err as Error).message}`,
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
    console.log(
      `[mcp:${this.config.id}] discovered ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`,
    )
    return this.tools
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.request('tools/call', { name, arguments: args }, CALL_TIMEOUT)) as McpToolResult
    return result
  }

  // ── Private helpers ─────────────────────────────────────────────

  private request(method: string, params: Record<string, unknown>, timeout = CALL_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
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
      // Not JSON — ignore (some servers emit non-JSON on stdout)
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
