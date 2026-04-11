/**
 * WebSocket connection manager for React Native.
 * Adapted from the desktop Tauri client — same protocol, same auth flow.
 */

import {
  type AiMessage,
  Channel,
  type ChatImageAttachmentInput,
  type ControlMessage,
  type EventMessage,
} from '@anton/protocol'

export type IncomingMessage = ControlMessage | AiMessage | EventMessage

function encodeFrame(channel: number, payload: object): ArrayBuffer {
  const json = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(json)
  const frame = new Uint8Array(1 + payloadBytes.length)
  frame[0] = channel
  frame.set(payloadBytes, 1)
  return frame.buffer
}

function decodeFrame(data: ArrayBuffer): { channel: number; payload: IncomingMessage } {
  const bytes = new Uint8Array(data)
  const channel = bytes[0]
  const payloadBytes = bytes.slice(1)
  const text = new TextDecoder().decode(payloadBytes)
  return { channel, payload: JSON.parse(text) as IncomingMessage }
}

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

export type MessageHandler = (channel: number, message: IncomingMessage) => void
type RawPayload = { type: string; [key: string]: unknown }
type RawMessageHandler = (channel: number, payload: RawPayload) => void

export class Connection {
  private ws: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private handlers: MessageHandler[] = []
  private rawHandlers: RawMessageHandler[] = []
  private statusListeners: ((status: ConnectionStatus, detail?: string) => void)[] = []
  private _status: ConnectionStatus = 'disconnected'
  private _statusDetail = ''
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private agentId = ''
  private agentVersion = ''

  get status() {
    return this._status
  }

  get statusDetail() {
    return this._statusDetail
  }

  get currentConfig() {
    return this.config
  }

  get currentAgentId() {
    return this.agentId
  }

  get currentAgentVersion() {
    return this.agentVersion
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  onRawMessage(handler: RawMessageHandler) {
    this.rawHandlers.push(handler)
    return () => {
      this.rawHandlers = this.rawHandlers.filter((h) => h !== handler)
    }
  }

  onStatusChange(listener: (status: ConnectionStatus, detail?: string) => void) {
    this.statusListeners.push(listener)
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener)
    }
  }

  connect(config: ConnectionConfig) {
    // Clean up any existing connection / pending reconnect first
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close(1000, 'New connection')
      this.ws = null
    }
    this.config = config
    this.doConnect()
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'User disconnect')
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  send(channel: number, message: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WS →] DROPPED (not connected): ch=${channel}`, message)
      return
    }
    const msgType = (message as { type?: string }).type ?? 'unknown'
    console.log(`[WS →] ${msgType}`, (message as Record<string, unknown>).sessionId ?? (message as Record<string, unknown>).id ?? '')
    this.ws.send(encodeFrame(channel, message))
  }

  // ── Chat ──────────────────────────────────────────────────────────

  sendAiMessage(content: string, attachments?: ChatImageAttachmentInput[]) {
    this.send(Channel.AI, { type: 'message', content, attachments })
  }

  sendAiMessageToSession(
    content: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
  ) {
    this.send(Channel.AI, { type: 'message', content, sessionId, attachments })
  }

  sendSteerMessage(content: string, sessionId: string, attachments?: ChatImageAttachmentInput[]) {
    this.send(Channel.AI, { type: 'steer', content, sessionId, attachments })
  }

  sendCancelTurn(sessionId: string) {
    this.send(Channel.AI, { type: 'cancel_turn', sessionId })
  }

  sendConfirmResponse(id: string, approved: boolean) {
    this.send(Channel.AI, { type: 'confirm_response', id, approved })
  }

  sendPlanResponse(id: string, approved: boolean, feedback?: string) {
    this.send(Channel.AI, { type: 'plan_confirm_response', id, approved, feedback })
  }

  sendAskUserResponse(id: string, answers: Record<string, string>) {
    this.send(Channel.AI, { type: 'ask_user_response', id, answers })
  }

  // ── Sessions ──────────────────────────────────────────────────────

  sendSessionCreate(
    id: string,
    opts?: {
      provider?: string
      model?: string
      projectId?: string
      thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
    },
  ) {
    this.send(Channel.AI, { type: 'session_create', id, ...opts })
  }

  sendSessionsSync(lastSyncVersion: number) {
    this.send(Channel.AI, { type: 'sessions_sync', lastSyncVersion })
  }

  sendSessionDestroy(id: string) {
    this.send(Channel.AI, { type: 'session_destroy', id })
  }

  sendSessionHistory(id: string, opts?: { before?: number; limit?: number; projectId?: string }) {
    this.send(Channel.AI, { type: 'session_history', id, ...opts })
  }

  // ── Providers ─────────────────────────────────────────────────────

  sendProvidersList() {
    this.send(Channel.AI, { type: 'providers_list' })
  }

  sendProviderSetDefault(provider: string, model: string) {
    this.send(Channel.AI, { type: 'provider_set_default', provider, model })
  }

  // ── Projects ──────────────────────────────────────────────────────

  sendProjectsList() {
    this.send(Channel.AI, { type: 'projects_list' })
  }

  sendProjectSessionsList(projectId: string) {
    this.send(Channel.AI, { type: 'project_sessions_list', projectId })
  }

  sendAgentsList(projectId: string) {
    this.send(Channel.AI, { type: 'agents_list', projectId })
  }

  sendAgentAction(
    projectId: string,
    sessionId: string,
    action: 'start' | 'stop' | 'delete' | 'pause' | 'resume',
  ) {
    this.send(Channel.AI, { type: 'agent_action', projectId, sessionId, action })
  }

  // ── Connectors ────────────────────────────────────────────────────

  sendConnectorsList() {
    this.send(Channel.AI, { type: 'connectors_list' })
  }

  // ── Config ────────────────────────────────────────────────────────

  sendConfigQuery(
    key: 'providers' | 'defaults' | 'security' | 'system_prompt' | 'memories',
    sessionId?: string,
    projectId?: string,
  ) {
    this.send(Channel.CONTROL, {
      type: 'config_query',
      key,
      ...(sessionId && { sessionId }),
      ...(projectId && { projectId }),
    })
  }

  // ── Internal ──────────────────────────────────────────────────────

  private doConnect() {
    if (!this.config) return
    const { host, port, token, useTLS } = this.config

    this.setStatus('connecting')

    const protocol = useTLS ? 'wss' : 'ws'
    const url = `${protocol}://${host}:${port}`

    try {
      this.ws = new WebSocket(url)
      this.ws.binaryType = 'arraybuffer'
    } catch (err: unknown) {
      this.setStatus('error', (err as Error).message)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.setStatus('authenticating')
      this.send(Channel.CONTROL, { type: 'auth', token })
    }

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const { channel, payload } = decodeFrame(event.data)

        if (channel === Channel.CONTROL) {
          if (payload.type === 'auth_ok') {
            const m = payload as import('@anton/protocol').AuthOkMessage
            this.agentId = m.agentId
            this.agentVersion = m.version
            this.setStatus('connected', `Agent: ${this.agentId}`)
          } else if (payload.type === 'auth_error') {
            const m = payload as import('@anton/protocol').AuthErrorMessage
            this.setStatus('error', `Auth failed: ${m.reason}`)
            this.ws?.close()
            return
          }
        }

        for (const handler of this.handlers) {
          handler(channel, payload)
        }
        for (const handler of this.rawHandlers) {
          handler(channel, payload as unknown as RawPayload)
        }
      } catch (err) {
        console.error('Failed to decode message:', err)
      }
    }

    this.ws.onclose = () => {
      if (
        this._status === 'connected' ||
        this._status === 'authenticating' ||
        this._status === 'connecting'
      ) {
        this.setStatus('disconnected', 'Connection lost')
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.setStatus('error', 'Connection failed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.config && this._status !== 'connected') {
        this.doConnect()
      }
    }, 3000)
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    console.log(`[WS] Status: ${this._status} → ${status}`, detail ?? '')
    this._status = status
    this._statusDetail = detail ?? ''
    for (const listener of this.statusListeners) {
      listener(status, detail)
    }
  }
}

export const connection = new Connection()
