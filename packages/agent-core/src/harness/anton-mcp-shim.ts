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
 */

import * as net from 'node:net'
import * as readline from 'node:readline'

const ANTON_SOCK = process.env.ANTON_SOCK
const ANTON_SESSION = process.env.ANTON_SESSION

if (!ANTON_SOCK || !ANTON_SESSION) {
  process.stderr.write('anton-mcp-shim: ANTON_SOCK and ANTON_SESSION env vars required\n')
  process.exit(1)
}

// ── IPC connection to Anton server ──────────────────────────────────

let socket: net.Socket | null = null
const pendingRequests = new Map<string | number, (result: unknown) => void>()

function connectToAnton(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(ANTON_SOCK!, () => {
      socket = sock
      resolve(sock)
    })

    sock.on('error', (err) => {
      process.stderr.write(`anton-mcp-shim: socket error: ${err.message}\n`)
      reject(err)
    })

    // Read responses from Anton server (newline-delimited JSON)
    const rl = readline.createInterface({ input: sock })
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line)
        const resolver = pendingRequests.get(msg.id)
        if (resolver) {
          pendingRequests.delete(msg.id)
          resolver(msg.result)
        }
      } catch {
        // Ignore malformed responses
      }
    })
  })
}

let requestId = 1

async function sendToAnton(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!socket) {
    await connectToAnton()
  }

  const id = requestId++
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _antonSession: ANTON_SESSION },
  })

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, resolve)
    socket!.write(request + '\n', (err) => {
      if (err) {
        pendingRequests.delete(id)
        reject(err)
      }
    })

    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('Request timed out'))
      }
    }, 30_000)
  })
}

// ── JSON-RPC / MCP handler ──────────────────────────────────────────

function sendResponse(id: string | number | null, result: unknown) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(response + '\n')
}

function sendError(id: string | number | null, code: number, message: string) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
  process.stdout.write(response + '\n')
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
        const result = await sendToAnton('tools/call', params || {})
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
