#!/usr/bin/env node
/**
 * Anton MCP Shim — standalone MCP server that relays tool calls to Anton.
 *
 * Spawned by a harness CLI (Codex / Claude Code) as an MCP child process.
 * Speaks JSON-RPC 2.0 / MCP 2024-11-05 on stdio to the CLI, and a
 * newline-delimited JSON dialect to the Anton server over a unix domain
 * socket.
 *
 * Environment:
 *   ANTON_SOCK    — path to Anton's harness IPC unix socket
 *   ANTON_SESSION — session ID for tool scoping
 *   ANTON_AUTH    — per-session token used to authenticate with Anton
 *
 * ─────────────────────────────────────────────────────────────────────
 * Connection state machine
 * ─────────────────────────────────────────────────────────────────────
 *
 *          ┌──────┐         first call           ┌────────────┐
 *          │ idle │ ─────────────────────────▶   │ connecting │
 *          └──────┘                              └─────┬──────┘
 *                ▲                                     │
 *                │                                auth OK
 *                │                                     ▼
 *          connect fail                          ┌──────────┐
 *                │     ◀── socket close/end ── │  authed  │
 *                │     ◀── ping timeout ───── └──────────┘
 *                │     ◀── server "bye" ─────
 *                ▼
 *          ┌──────────┐  ensureAuthed() on next call,   ┌────────────┐
 *          │   lost   │ ───────── backoff ────────────▶│ connecting │
 *          └──────────┘                                 └────────────┘
 *
 * The previous implementation stored the socket in a module-level
 * `socket: net.Socket | null` and only checked `!socket` before writing.
 * It had no `'close'` / `'end'` handler, no drain-on-disconnect, and no
 * reconnect path. A single half-close left every subsequent `tools/call`
 * writing to a dead fd and hanging 30s on the per-request timeout — and
 * even after the timeout fired, the shim never recovered for the rest of
 * its life. This rewrite makes the connection an explicitly-owned
 * resource with one transition point (`transitionToLost`) that every
 * failure mode funnels into.
 *
 * Everything logs as newline-delimited JSON on stderr (the harness CLI
 * captures our stderr) and — when we have a live IPC connection — also
 * mirrors to the Anton server as `log` notifications so the server can
 * tag the entry with our sessionId and surface it under the `mcp-shim`
 * module.
 */

import { readFileSync } from 'node:fs'
import * as net from 'node:net'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const ANTON_SOCK = process.env.ANTON_SOCK
const ANTON_SESSION = process.env.ANTON_SESSION
const ANTON_AUTH = process.env.ANTON_AUTH

// Resolved once at module load. Host logs this on `initialize` so we can
// detect version skew between the server binary and the shim on disk
// (e.g. a half-synced deploy).
const SHIM_VERSION: string = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

if (!ANTON_SOCK || !ANTON_SESSION || !ANTON_AUTH) {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      source: 'anton-mcp-shim',
      msg: 'missing required env vars',
      required: ['ANTON_SOCK', 'ANTON_SESSION', 'ANTON_AUTH'],
    })}\n`,
  )
  process.exit(1)
}

// ── Timing constants ────────────────────────────────────────────────

const AUTH_ID = 0
const AUTH_TIMEOUT_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const STREAMING_REQUEST_TIMEOUT_MS = 30 * 60_000
const PING_INTERVAL_MS = 20_000
const PING_TIMEOUT_MS = 5_000
/** Backoff schedule in ms, indexed by attempt number (clamped to length-1). */
const RECONNECT_BACKOFF_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const

// ── Logging ─────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured log. Always writes a JSON line to stderr; additionally
 * mirrors to the Anton server as a `log` notification when we have a
 * live authed IPC connection (the server module `mcp-shim` forwards it
 * into our normal logger with sessionId attached).
 *
 * Never throws — logging must not become the failure mode of the thing
 * it's describing.
 */
function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    source: 'anton-mcp-shim',
    sessionId: ANTON_SESSION,
    shimVersion: SHIM_VERSION,
    msg,
    ...(fields ?? {}),
  }
  try {
    process.stderr.write(`${JSON.stringify(entry)}\n`)
  } catch {
    /* best-effort */
  }
  if (state.tag === 'authed') {
    try {
      const frame = JSON.stringify({
        jsonrpc: '2.0',
        method: 'log',
        params: { level, msg, fields: fields ?? {} },
      })
      state.socket.write(`${frame}\n`, () => {
        /* swallow — we already persisted to stderr */
      })
    } catch {
      /* best-effort */
    }
  }
}

// ── Connection state machine ────────────────────────────────────────

type ConnState =
  | { tag: 'idle' }
  | { tag: 'connecting'; attempt: number; startedAt: number }
  | { tag: 'authed'; socket: net.Socket; since: number }
  | { tag: 'lost'; reason: string; at: number; attempt: number }

interface PendingEntry {
  method: string
  sentAt: number
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

let state: ConnState = { tag: 'idle' }
/** In-flight connect attempt, so concurrent ensureAuthed() callers share it. */
let connectInflight: Promise<net.Socket> | null = null
let pingTimer: NodeJS.Timeout | null = null
const pendingRequests = new Map<string | number, PendingEntry>()
let requestId = 1

function clearPingTimer(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
}

/**
 * Single funnel for every connection failure mode: post-auth socket
 * `close`/`end`/`error`, a server-sent `bye`, a ping timeout. Destroys
 * the socket, drains every pending request with a structured rejection,
 * and latches state so the next `ensureAuthed()` knows to reconnect
 * (with backoff).
 *
 * Idempotent — if we're already in `lost`, does nothing.
 */
function transitionToLost(reason: string): void {
  if (state.tag === 'lost') return

  const prevTag = state.tag
  const attempt = state.tag === 'connecting' ? state.attempt : 0
  const prevSocket = state.tag === 'authed' ? state.socket : null
  const pendingCount = pendingRequests.size
  const livedMs = state.tag === 'authed' ? Date.now() - state.since : 0

  clearPingTimer()

  if (prevSocket) {
    try {
      prevSocket.destroy()
    } catch {
      /* already dead, fine */
    }
  }

  // Drain pending with a structured error — every stuck `tools/call`
  // fails fast with a clear reason instead of hanging on per-request
  // timeout.
  const err = new Error(`ipc disconnected: ${reason}`)
  for (const entry of pendingRequests.values()) {
    clearTimeout(entry.timeout)
    try {
      entry.reject(err)
    } catch {
      /* best-effort */
    }
  }
  pendingRequests.clear()

  state = { tag: 'lost', reason, at: Date.now(), attempt }
  connectInflight = null

  log('warn', 'connection lost', {
    reason,
    prevTag,
    pendingDrained: pendingCount,
    livedMs,
  })
}

/**
 * Ensure we have a live, authed IPC socket. Shared across concurrent
 * callers (via `connectInflight`) so a burst of tool calls triggers one
 * connect attempt, not N.
 *
 * Backoff is applied on transitions from `lost` — the attempt counter
 * persists across losses so a flapping server doesn't get hammered.
 */
async function ensureAuthed(): Promise<net.Socket> {
  if (state.tag === 'authed') return state.socket
  if (connectInflight) return connectInflight

  const lastAttempt = state.tag === 'lost' ? state.attempt : 0
  const nextAttempt = lastAttempt + 1

  connectInflight = (async (): Promise<net.Socket> => {
    if (state.tag === 'lost' && state.attempt > 0) {
      const delayMs =
        RECONNECT_BACKOFF_MS[Math.min(state.attempt - 1, RECONNECT_BACKOFF_MS.length - 1)]
      log('debug', 'reconnect backoff', { attempt: nextAttempt, delayMs })
      await new Promise((r) => setTimeout(r, delayMs))
    }

    const startedAt = Date.now()
    state = { tag: 'connecting', attempt: nextAttempt, startedAt }
    log('debug', 'connecting', { attempt: nextAttempt, sock: ANTON_SOCK })

    try {
      const sock = await doConnect()
      // A server-sent `bye` arriving in the same readline chunk as our
      // auth_ok would have run `transitionToLost` synchronously — setting
      // state='lost' — before this microtask resumed. Blindly assigning
      // state='authed' here would clobber that transition and hand out a
      // socket the server has already half-closed. Detect it and treat
      // the attempt as failed so the caller sees a clean error and the
      // backoff/reconnect path runs. Double-cast escapes control-flow
      // narrowing from the `state = { tag: 'connecting', ... }` above;
      // `state` is a module-level `let` and may have been mutated
      // synchronously inside readline while we were awaited.
      const stateNow = state as unknown as ConnState
      if (stateNow.tag === 'lost') {
        try {
          sock.destroy()
        } catch {
          /* */
        }
        throw new Error(`connection lost during handshake: ${stateNow.reason}`)
      }
      const since = Date.now()
      state = { tag: 'authed', socket: sock, since }
      startPing()
      log('info', 'connection authed', {
        attempt: nextAttempt,
        handshakeMs: since - startedAt,
      })
      return sock
    } catch (err) {
      const message = (err as Error).message
      state = {
        tag: 'lost',
        reason: `connect failed: ${message}`,
        at: Date.now(),
        attempt: nextAttempt,
      }
      log('error', 'connect failed', { attempt: nextAttempt, error: message })
      throw err
    } finally {
      connectInflight = null
    }
  })()

  return connectInflight
}

/**
 * Open a single UDS connection, perform the auth handshake, and wire
 * up every failure signal (`error`, `close`, `end`, server `bye`) to
 * `transitionToLost`. Returns the socket on auth success; rejects on
 * any failure before auth completes.
 */
function doConnect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let authed = false
    let settled = false
    let authTimer: NodeJS.Timeout | null = null

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (authTimer) clearTimeout(authTimer)
      fn()
    }

    const sock = net.connect(ANTON_SOCK!, () => {
      const authMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: AUTH_ID,
        method: 'auth',
        params: { token: ANTON_AUTH, sessionId: ANTON_SESSION },
      })
      sock.write(`${authMsg}\n`)
      authTimer = setTimeout(() => {
        if (!authed) {
          settle(() => {
            try {
              sock.destroy()
            } catch {
              /* */
            }
            reject(new Error('auth handshake timed out'))
          })
        }
      }, AUTH_TIMEOUT_MS)
    })

    sock.on('error', (err) => {
      if (!authed) {
        settle(() => reject(err))
      } else {
        // Post-auth error — funnel into the single transition path.
        // We also expect 'close'/'end' to fire immediately after; the
        // idempotence of transitionToLost handles the overlap.
        transitionToLost(`socket error: ${err.message}`)
      }
    })

    sock.on('close', (hadError) => {
      if (!authed) {
        settle(() => reject(new Error(`socket closed before auth${hadError ? ' (error)' : ''}`)))
      } else {
        transitionToLost(`socket closed${hadError ? ' (error)' : ''}`)
      }
    })

    sock.on('end', () => {
      if (authed) transitionToLost('socket ended by peer')
    })

    // Read responses / server notifications line-by-line.
    const rl = readline.createInterface({ input: sock })
    rl.on('line', (line) => {
      let msg: {
        id?: string | number
        method?: string
        result?: { ok?: boolean }
        error?: { message?: string }
        params?: {
          _progressToken?: string | number
          message?: string
          progress?: number
          reason?: string
        }
      }
      try {
        msg = JSON.parse(line)
      } catch {
        log('debug', 'dropped malformed line from server', { line: line.slice(0, 200) })
        return
      }

      // Auth reply
      if (!authed && msg.id === AUTH_ID) {
        if (msg.result?.ok === true) {
          authed = true
          settle(() => resolve(sock))
        } else {
          const message = msg.error?.message || 'auth rejected'
          settle(() => {
            try {
              sock.destroy()
            } catch {
              /* */
            }
            reject(new Error(message))
          })
        }
        return
      }

      // Server → shim notifications (no id)
      if ((msg.id === undefined || msg.id === null) && typeof msg.method === 'string') {
        if (msg.method === 'bye') {
          const reason = msg.params?.reason ?? 'server requested disconnect'
          log('info', 'received bye from server', { reason })
          // Transition explicitly so pending calls fail with the server's
          // reason; the socket close that follows is then a no-op.
          transitionToLost(`bye: ${reason}`)
          return
        }

        if (msg.method === 'progress' && msg.params) {
          const token = msg.params._progressToken
          const message = msg.params.message ?? ''
          const progress = msg.params.progress
          if (token !== undefined) {
            const notif = JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params:
                progress !== undefined
                  ? { progressToken: token, progress, message }
                  : { progressToken: token, message },
            })
            process.stdout.write(`${notif}\n`)
          }
          return
        }

        // Unknown notification — log once at debug so it's discoverable
        // without being noisy.
        log('debug', 'unknown server notification', { method: msg.method })
        return
      }

      // Reply to a pending request
      if (msg.id !== undefined && msg.id !== null) {
        const entry = pendingRequests.get(msg.id)
        if (entry) {
          pendingRequests.delete(msg.id)
          clearTimeout(entry.timeout)
          if (msg.error) {
            entry.reject(new Error(msg.error.message || 'server error'))
          } else {
            entry.resolve(msg.result)
          }
        }
      }
    })
  })
}

function startPing(): void {
  clearPingTimer()
  pingTimer = setInterval(() => {
    if (state.tag !== 'authed') return
    const startedAt = Date.now()
    sendToAnton('ping', {}, undefined, PING_TIMEOUT_MS)
      .then(() => {
        log('debug', 'ping ok', { rttMs: Date.now() - startedAt })
      })
      .catch((err) => {
        if (state.tag === 'authed') {
          transitionToLost(`ping failed: ${(err as Error).message}`)
        }
      })
  }, PING_INTERVAL_MS)
  // Don't keep the event loop alive on the ping alone — if stdin closes
  // and no other work is pending, we should exit cleanly.
  pingTimer.unref?.()
}

/**
 * Send a request to Anton over IPC. Handles reconnect on a lost
 * connection, per-request timeout, and write-error propagation. Every
 * path either resolves with the reply's `result` or rejects with an
 * Error that carries enough context to diagnose — no silent hangs.
 */
async function sendToAnton(
  method: string,
  params: Record<string, unknown>,
  progressToken?: string | number,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const sock = await ensureAuthed()

  const id = requestId++
  const forwarded: Record<string, unknown> = { ...params, _antonSession: ANTON_SESSION }
  if (progressToken !== undefined) forwarded._progressToken = progressToken
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: forwarded })

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`request timed out after ${timeoutMs}ms (method=${method})`))
      }
    }, timeoutMs)
    timeout.unref?.()

    pendingRequests.set(id, {
      method,
      sentAt: Date.now(),
      resolve,
      reject,
      timeout,
    })

    sock.write(`${payload}\n`, (err) => {
      if (err) {
        // Sync/async write failure — drain this one and let the
        // transition funnel clean up the socket if it's dead.
        const entry = pendingRequests.get(id)
        if (entry) {
          pendingRequests.delete(id)
          clearTimeout(entry.timeout)
          reject(err)
        }
        if (state.tag === 'authed') {
          transitionToLost(`write error: ${err.message}`)
        }
      }
    })
  })
}

// ── MCP JSON-RPC handler (stdio) ────────────────────────────────────

function sendResponse(id: string | number | null, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function sendError(id: string | number | null, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

async function handleRequest(msg: {
  id?: string | number
  method: string
  params?: Record<string, unknown>
}): Promise<void> {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      log('info', 'initialize', { clientProto: params?.protocolVersion })
      sendResponse(id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'anton-mcp-shim', version: SHIM_VERSION },
      })
      return

    case 'notifications/initialized':
      return

    case 'ping':
      sendResponse(id ?? null, {})
      return

    case 'tools/list': {
      const startedAt = Date.now()
      log('debug', 'tools/list received', { id })
      try {
        const result = await sendToAnton('tools/list', params || {})
        const toolCount = Array.isArray((result as { tools?: unknown[] })?.tools)
          ? (result as { tools: unknown[] }).tools.length
          : 0
        log('info', 'tools/list served', { id, toolCount, durationMs: Date.now() - startedAt })
        sendResponse(id ?? null, result)
      } catch (err) {
        const message = (err as Error).message
        log('error', 'tools/list failed', {
          id,
          error: message,
          durationMs: Date.now() - startedAt,
        })
        sendError(id ?? null, -32000, `Failed to list tools: ${message}`)
      }
      return
    }

    case 'tools/call': {
      const startedAt = Date.now()
      const toolName = (params?.name as string | undefined) ?? 'unknown'
      // MCP spec: callers request streaming progress by setting
      // `_meta.progressToken` on the tools/call request. We forward it
      // to Anton as `_progressToken` on the IPC request so the server-
      // side handler can emit progress frames bound to it. Streaming
      // tool calls get a 30-minute budget since a research sub-agent
      // can legitimately run many minutes; non-streaming stays at the
      // default 30s.
      const meta = params?._meta as { progressToken?: string | number } | undefined
      const progressToken = meta?.progressToken
      const timeoutMs =
        progressToken !== undefined ? STREAMING_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS

      log('info', 'tools/call received', {
        id,
        tool: toolName,
        streaming: progressToken !== undefined,
      })
      try {
        const result = await sendToAnton('tools/call', params || {}, progressToken, timeoutMs)
        const isError = Boolean((result as { isError?: boolean })?.isError)
        log(isError ? 'warn' : 'info', 'tools/call completed', {
          id,
          tool: toolName,
          durationMs: Date.now() - startedAt,
          isError,
        })
        sendResponse(id ?? null, result)
      } catch (err) {
        const message = (err as Error).message
        log('error', 'tools/call failed', {
          id,
          tool: toolName,
          error: message,
          durationMs: Date.now() - startedAt,
        })
        sendError(id ?? null, -32000, `Failed to call tool ${toolName}: ${message}`)
      }
      return
    }

    default:
      log('warn', 'unknown MCP method', { method, id })
      sendError(id ?? null, -32601, `Method not found: ${method}`)
  }
}

// ── Main: read stdin JSON-RPC ───────────────────────────────────────

const stdinRl = readline.createInterface({ input: process.stdin })

stdinRl.on('line', (line) => {
  let msg: { id?: string | number; method: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(line)
  } catch {
    log('debug', 'dropped malformed stdin line', { line: line.slice(0, 200) })
    return
  }
  handleRequest(msg).catch((err) => {
    log('error', 'unhandled error in handleRequest', {
      method: msg.method,
      error: (err as Error).message,
    })
  })
})

stdinRl.on('close', () => {
  log('info', 'stdin closed — shutting down')
  clearPingTimer()
  if (state.tag === 'authed') {
    try {
      state.socket.destroy()
    } catch {
      /* */
    }
  }
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('info', 'received SIGTERM')
  clearPingTimer()
  if (state.tag === 'authed') {
    try {
      state.socket.destroy()
    } catch {
      /* */
    }
  }
  process.exit(0)
})

process.on('SIGINT', () => {
  log('info', 'received SIGINT')
  clearPingTimer()
  if (state.tag === 'authed') {
    try {
      state.socket.destroy()
    } catch {
      /* */
    }
  }
  process.exit(0)
})

log('info', 'shim started', {
  antonSock: ANTON_SOCK,
  pid: process.pid,
})
