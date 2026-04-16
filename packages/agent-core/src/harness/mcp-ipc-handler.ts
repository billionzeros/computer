/**
 * MCP IPC Handler — server-side unix domain socket listener that handles
 * relayed JSON-RPC requests from MCP shim processes.
 *
 * Each harness session spawns its own MCP shim, which connects here to
 * access Anton's tool implementations.
 */

import * as net from 'node:net'
import { createInterface } from 'node:readline'
import { existsSync, unlinkSync } from 'node:fs'
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

export interface IpcToolProvider {
  getTools(sessionId: string): McpToolSchema[]
  executeTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult>
}

interface JsonRpcRequest {
  jsonrpc: string
  id: string | number
  method: string
  params?: Record<string, unknown> & { _antonSession?: string }
}

/**
 * Create a unix domain socket server that handles MCP tool requests
 * from harness shim processes.
 */
export function createMcpIpcServer(socketPath: string, provider: IpcToolProvider): net.Server {
  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {
      // Ignore
    }
  }

  const server = net.createServer((conn) => {
    log.debug('MCP shim connected')

    const rl = createInterface({ input: conn })

    rl.on('line', async (line) => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line)
      } catch {
        return
      }

      const sessionId = request.params?._antonSession || 'unknown'

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

            if (!toolName) {
              sendError(conn, request.id, -32602, 'Missing tool name')
              return
            }

            const toolResult = await provider.executeTool(sessionId, toolName, toolArgs)
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

  return server
}

function sendResponse(conn: net.Socket, id: string | number, result: unknown) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
  conn.write(msg + '\n')
}

function sendError(conn: net.Socket, id: string | number, code: number, message: string) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  conn.write(msg + '\n')
}
