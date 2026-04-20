/**
 * MCP IPC Handler — server-side unix domain socket listener that handles
 * relayed JSON-RPC requests from MCP shim processes.
 *
 * Each harness session spawns its own MCP shim, which connects here to
 * access Anton's tool implementations.
 *
 * Auth model: every connection must present an {sessionId, token} pair as
 * its first message. Tokens are registered by the server before spawning
 * the CLI. Once authed, the connection is bound to that sessionId for its
 * entire lifetime — any subsequent tools/call whose params claim a
 * different `_antonSession` is rejected.
 */

import { existsSync, unlinkSync } from 'node:fs'
import * as net from 'node:net'
import { createInterface } from 'node:readline'
import { createLogger } from '@anton/logger'

const log = createLogger('mcp-ipc')

export interface McpToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/**
 * Callback passed into `executeTool` when the MCP caller requested
 * progress updates (MCP's `_meta.progressToken` → our IPC
 * `_progressToken`). Tools call it zero or more times during
 * execution to surface intermediate status; the handler forwards each
 * call back over the IPC connection as a `method: "progress"` frame,
 * which the shim then emits as `notifications/progress` to the caller.
 */
export type ProgressCallback = (message: string, progress?: number) => void

export interface IpcToolProvider {
  getTools(sessionId: string): McpToolSchema[]
  executeTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<McpToolResult>
}

export interface McpIpcServer {
  readonly server: net.Server
  registerSession(sessionId: string, token: string): void
  unregisterSession(sessionId: string): void
  close(): Promise<void>
}

interface JsonRpcRequest {
  jsonrpc: string
  id: string | number
  method: string
  params?: Record<string, unknown> & { _antonSession?: string }
}

/** Time a connection has to present its auth frame before being dropped. */
const AUTH_TIMEOUT_MS = 5_000

/**
 * Create a unix domain socket server that handles MCP tool requests
 * from harness shim processes.
 */
export function createMcpIpcServer(socketPath: string, provider: IpcToolProvider): McpIpcServer {
  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {
      // Ignore
    }
  }

  // sessionId → expected token
  const registeredSessions = new Map<string, string>()

  const server = net.createServer((conn) => {
    log.debug('MCP shim connected')

    /** Set to the sessionId once the connection successfully authenticates. */
    let authedSessionId: string | null = null

    // Drop unauthenticated connections after a short grace period
    const authTimer = setTimeout(() => {
      if (!authedSessionId) {
        log.warn('MCP shim connection dropped: auth timeout')
        try {
          sendError(conn, null, -32001, 'unauthenticated: auth timeout')
        } catch {
          // connection may already be dead
        }
        conn.destroy()
      }
    }, AUTH_TIMEOUT_MS)

    const rl = createInterface({ input: conn })

    rl.on('line', async (line) => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line)
      } catch {
        return
      }

      // First frame must be auth
      if (!authedSessionId) {
        if (request.method !== 'auth') {
          sendError(conn, request.id, -32001, 'unauthenticated: auth frame required first')
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        const claimedSession = request.params?.sessionId as string | undefined
        const claimedToken = request.params?.token as string | undefined

        if (!claimedSession || !claimedToken) {
          sendError(conn, request.id, -32001, 'unauthenticated: missing sessionId or token')
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        const expected = registeredSessions.get(claimedSession)
        if (!expected || expected !== claimedToken) {
          log.warn({ claimedSession }, 'MCP shim auth rejected: bad token or unknown session')
          sendError(conn, request.id, -32001, 'unauthenticated: bad token or unknown session')
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        authedSessionId = claimedSession
        clearTimeout(authTimer)
        sendResponse(conn, request.id, { ok: true })
        log.debug({ sessionId: authedSessionId }, 'MCP shim authenticated')
        return
      }

      // Enforce session scoping — the connection is bound to one sessionId.
      const claimedSession = request.params?._antonSession
      if (claimedSession && claimedSession !== authedSessionId) {
        log.warn(
          { authedSessionId, claimedSession, method: request.method },
          'MCP shim session mismatch — rejecting',
        )
        sendError(conn, request.id, -32002, 'session_mismatch')
        return
      }

      const sessionId = authedSessionId

      try {
        let result: unknown

        switch (request.method) {
          case 'tools/list': {
            const tools = provider.getTools(sessionId)
            result = {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            }
            break
          }

          case 'tools/call': {
            const toolName = request.params?.name as string
            const toolArgs = (request.params?.arguments || {}) as Record<string, unknown>
            const progressToken = request.params?._progressToken as string | number | undefined

            if (!toolName) {
              sendError(conn, request.id, -32602, 'Missing tool name')
              return
            }

            // Build the progress callback only if the caller opted in.
            // Streaming tools call this during execution; non-streaming
            // tools ignore it. Failures to write are swallowed — the
            // final response still gets sent over the same connection.
            const onProgress: ProgressCallback | undefined = progressToken
              ? (message: string, progress?: number) => {
                  try {
                    const frame = JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'progress',
                      params: { _progressToken: progressToken, message, progress },
                    })
                    conn.write(`${frame}\n`)
                  } catch (err) {
                    log.debug(
                      { err: (err as Error).message, sessionId },
                      'progress write failed — continuing',
                    )
                  }
                }
              : undefined

            const toolResult = await provider.executeTool(sessionId, toolName, toolArgs, onProgress)
            result = toolResult
            break
          }

          default:
            sendError(conn, request.id, -32601, `Unknown method: ${request.method}`)
            return
        }

        sendResponse(conn, request.id, result)
      } catch (err) {
        log.error({ err, method: request.method, sessionId }, 'IPC request failed')
        sendError(conn, request.id, -32000, (err as Error).message)
      }
    })

    conn.on('close', () => {
      clearTimeout(authTimer)
    })

    conn.on('error', (err) => {
      log.debug({ err: err.message }, 'MCP shim connection error')
    })
  })

  server.listen(socketPath, () => {
    log.info({ socketPath }, 'MCP IPC server listening')
  })

  server.on('error', (err) => {
    log.error({ err }, 'MCP IPC server error')
  })

  return {
    server,
    registerSession(sessionId: string, token: string) {
      registeredSessions.set(sessionId, token)
    },
    unregisterSession(sessionId: string) {
      registeredSessions.delete(sessionId)
    },
    close() {
      return new Promise<void>((resolve) => {
        registeredSessions.clear()
        server.close(() => resolve())
      })
    },
  }
}

function sendResponse(conn: net.Socket, id: string | number | null, result: unknown) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
  conn.write(`${msg}\n`)
}

function sendError(conn: net.Socket, id: string | number | null, code: number, message: string) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  conn.write(`${msg}\n`)
}
