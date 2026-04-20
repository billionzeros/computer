#!/usr/bin/env node
/**
 * Anton MCP Shim — standalone MCP server that relays tool calls to Anton.
 *
 * Spawned by Claude Code as an MCP child process. Communicates with
 * the Anton server over a unix domain socket for tool listing/execution.
 *
 * Protocol: JSON-RPC 2.0 over stdio, MCP version 2024-11-05
 *
 * Environment:
 *   ANTON_SOCK    — path to Anton's harness IPC unix socket
 *   ANTON_SESSION — session ID for tool scoping
 *   ANTON_AUTH    — per-session token used to authenticate with Anton
 */

import * as net from 'node:net'
import * as readline from 'node:readline'

const ANTON_SOCK = process.env.ANTON_SOCK
const ANTON_SESSION = process.env.ANTON_SESSION
const ANTON_AUTH = process.env.ANTON_AUTH

if (!ANTON_SOCK || !ANTON_SESSION || !ANTON_AUTH) {
  process.stderr.write(
    'anton-mcp-shim: ANTON_SOCK, ANTON_SESSION and ANTON_AUTH env vars required\n',
  )
  process.exit(1)
}

// ── IPC connection to Anton server ──────────────────────────────────

/** Reserved JSON-RPC id for the auth handshake. Regular requests start at 1. */
const AUTH_ID = 0

let socket: net.Socket | null = null
const pendingRequests = new Map<string | number, (result: unknown) => void>()

function connectToAnton(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let authed = false
    let authTimer: NodeJS.Timeout | null = null

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
          process.stderr.write('anton-mcp-shim: auth handshake timed out\n')
          sock.destroy()
          reject(new Error('auth timeout'))
        }
      }, 5_000)
    })

    sock.on('error', (err) => {
      if (authTimer) clearTimeout(authTimer)
      process.stderr.write(`anton-mcp-shim: socket error: ${err.message}\n`)
      if (!authed) reject(err)
    })

    // Read responses from Anton server (newline-delimited JSON)
    const rl = readline.createInterface({ input: sock })
    rl.on('line', (line) => {
      let msg: {
        id?: string | number
        method?: string
        result?: { ok?: boolean }
        error?: { message?: string }
        params?: { _progressToken?: string | number; message?: string; progress?: number }
      }
      try {
        msg = JSON.parse(line)
      } catch {
        // Ignore malformed responses
        return
      }

      if (!authed && msg.id === AUTH_ID) {
        if (authTimer) clearTimeout(authTimer)
        if (msg.result?.ok === true) {
          authed = true
          socket = sock
          resolve(sock)
        } else {
          const message = msg.error?.message || 'auth rejected'
          process.stderr.write(`anton-mcp-shim: ${message}\n`)
          sock.destroy()
          reject(new Error(message))
        }
        return
      }

      // Progress frames from Anton — forward as MCP notifications/progress
      // to whatever client is driving the shim (Codex / Claude Code).
      // These frames have no `id` (they are notifications on the Anton side
      // too); the caller receives them with the original progressToken so
      // it can associate the update with the original tools/call.
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

      if (msg.id !== undefined && msg.id !== null) {
        const resolver = pendingRequests.get(msg.id)
        if (resolver) {
          pendingRequests.delete(msg.id)
          resolver(msg.result)
        }
      }
    })
  })
}

let requestId = 1

async function sendToAnton(
  method: string,
  params: Record<string, unknown>,
  progressToken?: string | number,
  timeoutMs = 30_000,
): Promise<unknown> {
  if (!socket) {
    await connectToAnton()
  }

  const id = requestId++
  const forwarded: Record<string, unknown> = { ...params, _antonSession: ANTON_SESSION }
  // Progress token is echoed back inside each `method:"progress"` frame
  // from Anton, so we don't need to map it by request id — the server
  // passes it through and we forward it 1:1 to the caller.
  if (progressToken !== undefined) forwarded._progressToken = progressToken
  const request = JSON.stringify({ jsonrpc: '2.0', id, method, params: forwarded })

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, resolve)
    socket!.write(`${request}\n`, (err) => {
      if (err) {
        pendingRequests.delete(id)
        reject(err)
      }
    })

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('Request timed out'))
      }
    }, timeoutMs)
  })
}

// ── JSON-RPC / MCP handler ──────────────────────────────────────────

function sendResponse(id: string | number | null, result: unknown) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(`${response}\n`)
}

function sendError(id: string | number | null, code: number, message: string) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
  process.stdout.write(`${response}\n`)
}

async function handleRequest(msg: {
  id?: string | number
  method: string
  params?: Record<string, unknown>
}) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      sendResponse(id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'anton-mcp-shim', version: '1.0.0' },
      })
      break

    case 'notifications/initialized':
      // No response needed for notifications
      break

    case 'ping':
      sendResponse(id ?? null, {})
      break

    case 'tools/list': {
      try {
        const result = await sendToAnton('tools/list', params || {})
        sendResponse(id ?? null, result)
      } catch (err) {
        sendError(id ?? null, -32000, `Failed to list tools: ${(err as Error).message}`)
      }
      break
    }

    case 'tools/call': {
      try {
        // MCP spec: callers request streaming progress by setting
        // `_meta.progressToken` on the tools/call request. We forward
        // the token to Anton as `_progressToken` on the IPC request so
        // the server-side handler can emit progress frames bound to it.
        // Streaming tool calls get a 30-minute budget since a research
        // sub-agent can legitimately run many minutes; non-streaming
        // stays at the default 30s.
        const meta = params?._meta as { progressToken?: string | number } | undefined
        const progressToken = meta?.progressToken
        const timeoutMs = progressToken !== undefined ? 30 * 60_000 : 30_000
        const result = await sendToAnton('tools/call', params || {}, progressToken, timeoutMs)
        sendResponse(id ?? null, result)
      } catch (err) {
        sendError(id ?? null, -32000, `Failed to call tool: ${(err as Error).message}`)
      }
      break
    }

    default:
      sendError(id ?? null, -32601, `Method not found: ${method}`)
  }
}

// ── Main: read stdin JSON-RPC ───────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line)
    handleRequest(msg).catch((err) => {
      process.stderr.write(`anton-mcp-shim: unhandled error: ${err.message}\n`)
    })
  } catch {
    // Ignore malformed input
  }
})

// Graceful cleanup
process.on('SIGTERM', () => {
  socket?.destroy()
  process.exit(0)
})

process.on('SIGINT', () => {
  socket?.destroy()
  process.exit(0)
})
