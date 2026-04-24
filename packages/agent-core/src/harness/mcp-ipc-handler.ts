/**
 * MCP IPC Handler — server-side unix domain socket listener that handles
 * relayed JSON-RPC requests from MCP shim processes.
 *
 * Each harness session spawns its own MCP shim, which connects here to
 * access Anton's tool implementations.
 *
 * Auth model: every connection must present an {sessionId, token} pair
 * as its first message. Tokens are registered by the server before
 * spawning the CLI. Once authed, the connection is bound to that
 * sessionId for its entire lifetime — any subsequent tools/call whose
 * params claim a different `_antonSession` is rejected.
 *
 * Lifecycle contract with `anton-mcp-shim.ts`:
 *   - Server sends `{method: 'bye', params: {reason}}` as a notification
 *     when a session is unregistered (evicted / destroyed). The shim
 *     transitions its own state to `lost`, drains pending requests, and
 *     reconnects on the next call if/when the session id is re-
 *     registered.
 *   - Shim may send `{method: 'log', params: {level, msg, fields}}` as
 *     a notification to surface its structured logs with session
 *     context — the server re-logs them under the `mcp-shim` module
 *     with sessionId attached.
 *   - Shim periodically sends `{method: 'ping', id: N}` to detect
 *     half-close. We reply `{}` immediately.
 *
 * Everything above auth is tolerant of connection loss: if either side
 * disappears, the other releases its bookkeeping (authed connection set
 * on the server, pending-request map on the shim) within one event
 * loop turn.
 */

import { existsSync, unlinkSync } from 'node:fs'
import * as net from 'node:net'
import { createInterface } from 'node:readline'
import { type Logger, createLogger } from '@anton/logger'

const log = createLogger('mcp-ipc')
const shimLog = createLogger('mcp-shim')

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
 * `_progressToken`). Tools call it zero or more times during execution
 * to surface intermediate status; the handler forwards each call back
 * over the IPC connection as a `method: "progress"` frame, which the
 * shim then emits as `notifications/progress` to the caller.
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
  /**
   * Unregister a session. Sends a `bye` notification to every authed
   * shim connection bound to this session, then half-closes each. The
   * shim treats the bye as a clean "server is done with me" and
   * transitions out of `authed` — any in-flight call fails with
   * `ipc disconnected: bye: …` instead of hanging.
   */
  unregisterSession(sessionId: string, reason?: string): void
  /** Current connection snapshot — diagnostics only. */
  debugStats(): { authedSessions: number; totalConns: number }
  close(): Promise<void>
}

interface JsonRpcRequest {
  jsonrpc: string
  id?: string | number
  method: string
  params?: Record<string, unknown> & { _antonSession?: string }
}

interface ShimLogParams {
  level?: 'debug' | 'info' | 'warn' | 'error'
  msg?: string
  fields?: Record<string, unknown>
}

/** Time a connection has to present its auth frame before being dropped. */
const AUTH_TIMEOUT_MS = 5_000

/**
 * Create a unix domain socket server that handles MCP tool requests
 * from harness shim processes.
 */
export function createMcpIpcServer(socketPath: string, provider: IpcToolProvider): McpIpcServer {
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {
      /* stale socket; ignore */
    }
  }

  // sessionId → expected token
  const registeredSessions = new Map<string, string>()
  // sessionId → authed connections bound to it. Tracked so
  // `unregisterSession` can proactively bye + half-close each one.
  const authedConnections = new Map<string, Set<net.Socket>>()

  const server = net.createServer((conn) => {
    const connStartedAt = Date.now()
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
          /* connection may already be dead */
        }
        conn.destroy()
      }
    }, AUTH_TIMEOUT_MS)

    const rl = createInterface({ input: conn })

    rl.on('line', (line) => {
      // Outer boundary — any throw from the async body (including a
      // sync throw in `sendError`/`sendResponse` when the peer socket
      // is already destroyed) must not escape as an unhandledRejection.
      void (async () => {
        try {
          await processLine(line)
        } catch (err) {
          log.error(
            { err: (err as Error).message, sessionId: authedSessionId },
            'IPC line handler threw — dropping frame',
          )
        }
      })()
    })

    const processLine = async (line: string): Promise<void> => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line)
      } catch {
        return
      }

      // First frame must be auth
      if (!authedSessionId) {
        if (request.method !== 'auth') {
          sendError(conn, request.id ?? null, -32001, 'unauthenticated: auth frame required first')
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        const claimedSession = request.params?.sessionId as string | undefined
        const claimedToken = request.params?.token as string | undefined

        if (!claimedSession || !claimedToken) {
          sendError(conn, request.id ?? null, -32001, 'unauthenticated: missing sessionId or token')
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        const expected = registeredSessions.get(claimedSession)
        if (!expected || expected !== claimedToken) {
          log.warn({ claimedSession }, 'MCP shim auth rejected: bad token or unknown session')
          sendError(
            conn,
            request.id ?? null,
            -32001,
            'unauthenticated: bad token or unknown session',
          )
          conn.destroy()
          clearTimeout(authTimer)
          return
        }

        authedSessionId = claimedSession
        clearTimeout(authTimer)

        let set = authedConnections.get(authedSessionId)
        if (!set) {
          set = new Set()
          authedConnections.set(authedSessionId, set)
        }
        set.add(conn)

        sendResponse(conn, request.id ?? null, { ok: true })
        log.info(
          { sessionId: authedSessionId, handshakeMs: Date.now() - connStartedAt },
          'MCP shim authenticated',
        )
        return
      }

      // Notifications (no id) from shim — handle before the request switch.
      if (request.id === undefined || request.id === null) {
        if (request.method === 'log') {
          handleShimLog(authedSessionId, request.params as ShimLogParams | undefined)
          return
        }
        // Unknown notification — log once at debug so we can see it.
        log.debug(
          { sessionId: authedSessionId, method: request.method },
          'unknown shim notification',
        )
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
          case 'ping': {
            // Shim's liveness probe. Reply fast, no bookkeeping.
            result = {}
            break
          }

          case 'tools/list': {
            const tools = provider.getTools(sessionId)
            log.info(
              {
                sessionId,
                toolCount: tools.length,
                toolNames: tools.map((t) => t.name),
              },
              'tools/list served to harness',
            )
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

            log.info(
              {
                sessionId,
                tool: toolName,
                streaming: progressToken !== undefined,
                requestId: request.id,
              },
              'tools/call received',
            )

            const callStartedAt = Date.now()

            // Build the progress callback only if the caller opted in.
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
            log.info(
              {
                sessionId,
                tool: toolName,
                durationMs: Date.now() - callStartedAt,
                isError: Boolean(toolResult.isError),
                requestId: request.id,
              },
              'tools/call completed',
            )
            result = toolResult
            break
          }

          default:
            log.warn(
              { sessionId, method: request.method, id: request.id },
              'unknown MCP method from shim',
            )
            sendError(conn, request.id, -32601, `Unknown method: ${request.method}`)
            return
        }

        sendResponse(conn, request.id, result)
      } catch (err) {
        log.error({ err, method: request.method, sessionId }, 'IPC request failed')
        sendError(conn, request.id, -32000, (err as Error).message)
      }
    }

    conn.on('close', (hadError) => {
      clearTimeout(authTimer)
      if (authedSessionId) {
        const set = authedConnections.get(authedSessionId)
        if (set) {
          set.delete(conn)
          if (set.size === 0) authedConnections.delete(authedSessionId)
        }
        log.info(
          {
            sessionId: authedSessionId,
            livedMs: Date.now() - connStartedAt,
            hadError,
          },
          'MCP shim disconnected',
        )
      }
    })

    conn.on('error', (err) => {
      log.debug({ err: err.message, sessionId: authedSessionId }, 'MCP shim connection error')
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
      log.debug({ sessionId }, 'session auth registered')
    },
    unregisterSession(sessionId: string, reason = 'session_unregistered') {
      registeredSessions.delete(sessionId)
      const set = authedConnections.get(sessionId)
      if (!set || set.size === 0) {
        log.debug({ sessionId, reason }, 'session unregistered (no live conn)')
        return
      }
      const byeFrame = JSON.stringify({
        jsonrpc: '2.0',
        method: 'bye',
        params: { reason },
      })
      let sent = 0
      for (const conn of set) {
        try {
          conn.write(`${byeFrame}\n`)
          sent += 1
          // Half-close — gives the shim a chance to flush its own writes
          // (including drain-on-lost log notifications) before the TCP/
          // UDS RST. The shim will destroy its side on seeing `bye`.
          conn.end()
        } catch (err) {
          log.debug(
            { err: (err as Error).message, sessionId },
            'write bye failed — shim likely already gone',
          )
        }
      }
      authedConnections.delete(sessionId)
      log.info({ sessionId, reason, byeSent: sent }, 'session unregistered')
    },
    debugStats() {
      let totalConns = 0
      for (const set of authedConnections.values()) totalConns += set.size
      return {
        authedSessions: authedConnections.size,
        totalConns,
      }
    },
    close() {
      return new Promise<void>((resolve) => {
        registeredSessions.clear()
        // Best-effort bye to every authed conn before we stop the server,
        // so shims see a clean reason instead of a raw RST on shutdown.
        const byeFrame = JSON.stringify({
          jsonrpc: '2.0',
          method: 'bye',
          params: { reason: 'server_shutdown' },
        })
        for (const [sessionId, set] of authedConnections) {
          for (const conn of set) {
            try {
              conn.write(`${byeFrame}\n`)
              conn.end()
            } catch {
              /* already gone */
            }
          }
          log.debug({ sessionId }, 'bye sent on server close')
        }
        authedConnections.clear()
        server.close(() => resolve())
      })
    },
  }
}

/**
 * Fan a shim-sourced log event into our normal logger. Clamps the level
 * to something known, stamps sessionId into the record so filtering
 * works, and never throws — a malformed log frame shouldn't tear down
 * the IPC connection.
 */
function handleShimLog(sessionId: string, params: ShimLogParams | undefined): void {
  if (!params) return
  const level = params.level ?? 'info'
  const msg = typeof params.msg === 'string' ? params.msg : '(shim log)'
  const fields = (params.fields ?? {}) as Record<string, unknown>
  const fn = pickLevel(shimLog, level)
  try {
    fn.call(shimLog, { sessionId, ...fields }, msg)
  } catch {
    /* logger should never throw, but if it does, don't cascade */
  }
}

function pickLevel(logger: Logger, level: 'debug' | 'info' | 'warn' | 'error'): Logger['info'] {
  switch (level) {
    case 'debug':
      return logger.debug.bind(logger)
    case 'warn':
      return logger.warn.bind(logger)
    case 'error':
      return logger.error.bind(logger)
    default:
      return logger.info.bind(logger)
  }
}

/**
 * Write a JSON-RPC frame to a connection. Swallows errors because the
 * write is meaningful only if the peer is still listening — if the shim
 * hung up, we have no one to report to, and surfacing the throw through
 * the async line-handler would turn a dead connection into an
 * unhandledRejection crash.
 */
function safeWrite(conn: net.Socket, frame: string): void {
  if (conn.destroyed || conn.writableEnded) return
  try {
    conn.write(`${frame}\n`)
  } catch (err) {
    log.debug({ err: (err as Error).message }, 'IPC frame write failed — peer likely gone')
  }
}

function sendResponse(conn: net.Socket, id: string | number | null, result: unknown): void {
  safeWrite(conn, JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function sendError(
  conn: net.Socket,
  id: string | number | null,
  code: number,
  message: string,
): void {
  safeWrite(conn, JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
}
