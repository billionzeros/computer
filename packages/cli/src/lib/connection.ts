/**
 * WebSocket connection manager for Node.js CLI.
 * Same protocol as desktop but using `ws` package.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (primary, default)
 *   Port 9877 → wss:// with --tls flag
 */

import { Channel, decodeFrame, encodeFrame, parseJsonPayload } from '@anton/protocol'
import type { ChannelId, ControlMessage } from '@anton/protocol'
import WebSocket from 'ws'
import { checkAgentCompatibility } from './version.js'

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error'

export interface ConnectionConfig {
  host: string
  port: number
  token: string
  useTLS: boolean
}

export type MessageHandler = (channel: number, message: unknown) => void
export type StatusListener = (status: ConnectionStatus, detail?: string) => void

export class Connection {
  private ws: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private handlers: MessageHandler[] = []
  private statusListeners: StatusListener[] = []
  private _status: ConnectionStatus = 'disconnected'
  private _agentId = ''
  private _agentVersion = ''
  private _agentSpecVersion = ''
  private _agentGitHash = ''
  private _agentMinClientSpec = ''

  get status() {
    return this._status
  }
  get agentId() {
    return this._agentId
  }
  get agentVersion() {
    return this._agentVersion
  }
  get agentSpecVersion() {
    return this._agentSpecVersion
  }
  get agentGitHash() {
    return this._agentGitHash
  }
  get agentMinClientSpec() {
    return this._agentMinClientSpec
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  onStatusChange(listener: StatusListener) {
    this.statusListeners.push(listener)
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener)
    }
  }

  connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    return new Promise((resolve, reject) => {
      const { host, port, token, useTLS } = config

      this.setStatus('connecting')

      const protocol = useTLS ? 'wss' : 'ws'
      const url = `${protocol}://${host}:${port}`

      try {
        this.ws = new WebSocket(url, {
          rejectUnauthorized: false, // self-signed certs
        })
      } catch (err: unknown) {
        this.setStatus('error', (err as Error).message)
        reject(err)
        return
      }

      this.ws.on('open', () => {
        this.setStatus('authenticating')
        this.send(Channel.CONTROL, { type: 'auth', token })
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const frame = decodeFrame(new Uint8Array(data))
          const payload = parseJsonPayload<ControlMessage>(frame.payload)

          // Handle auth response
          if (frame.channel === Channel.CONTROL && payload.type === 'auth_ok') {
            const p = payload as unknown as Record<string, unknown>
            this._agentId = payload.agentId
            this._agentVersion = payload.version
            this._agentSpecVersion = (p.specVersion as string) ?? ''
            this._agentGitHash = (p.gitHash as string) ?? ''
            this._agentMinClientSpec = (p.minClientSpec as string) ?? ''

            // Check spec version compatibility
            if (this._agentSpecVersion) {
              const compat = checkAgentCompatibility(this._agentSpecVersion)
              if (compat) {
                console.warn(`  Warning: ${compat}`)
              }
            }

            this.setStatus('connected', `Agent: ${this._agentId}`)
            resolve()
          } else if (frame.channel === Channel.CONTROL && payload.type === 'auth_error') {
            this.setStatus('error', `Auth failed: ${payload.reason}`)
            this.ws?.close()
            reject(new Error(`Auth failed: ${payload.reason}`))
            return
          }

          // Dispatch to handlers
          for (const handler of this.handlers) {
            handler(frame.channel, payload)
          }
        } catch {
          // ignore decode errors
        }
      })

      this.ws.on('close', () => {
        if (this._status === 'connected') {
          this.setStatus('disconnected', 'Connection lost')
        }
      })

      this.ws.on('error', (err) => {
        this.setStatus('error', err.message)
        reject(err)
      })
    })
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'User disconnect')
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  send(channel: ChannelId, message: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(encodeFrame(channel, message))
  }

  sendAiMessage(content: string) {
    this.send(Channel.AI, { type: 'message', content })
  }

  sendConfirmResponse(id: string, approved: boolean) {
    this.send(Channel.AI, { type: 'confirm_response', id, approved })
  }

  sendTerminalSpawn(id: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: 'pty_spawn', id, cols, rows })
  }

  sendTerminalData(id: string, data: string) {
    this.send(Channel.TERMINAL, { type: 'pty_data', id, data })
  }

  sendTerminalResize(id: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: 'pty_resize', id, cols, rows })
  }

  sendPing() {
    this.send(Channel.CONTROL, { type: 'ping' })
  }

  // ── Session management ──────────────────────────────────────────

  sendSessionCreate(id: string, opts?: { provider?: string; model?: string; apiKey?: string }) {
    this.send(Channel.AI, {
      type: 'session_create',
      id,
      ...opts,
    })
  }

  sendSessionResume(id: string) {
    this.send(Channel.AI, { type: 'session_resume', id })
  }

  sendSessionsList() {
    this.send(Channel.AI, { type: 'sessions_list' })
  }

  sendSessionDestroy(id: string) {
    this.send(Channel.AI, { type: 'session_destroy', id })
  }

  sendAiMessageToSession(content: string, sessionId: string) {
    this.send(Channel.AI, { type: 'message', content, sessionId })
  }

  // ── Provider management ─────────────────────────────────────────

  sendProvidersList() {
    this.send(Channel.AI, { type: 'providers_list' })
  }

  sendProviderSetKey(provider: string, apiKey: string) {
    this.send(Channel.AI, { type: 'provider_set_key', provider, apiKey })
  }

  sendProviderSetDefault(provider: string, model: string) {
    this.send(Channel.AI, { type: 'provider_set_default', provider, model })
  }

  // ── Config management ───────────────────────────────────────────

  sendConfigQuery(key: 'providers' | 'defaults' | 'security') {
    this.send(Channel.CONTROL, { type: 'config_query', key })
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this._status = status
    for (const listener of this.statusListeners) {
      listener(status, detail)
    }
  }
}
