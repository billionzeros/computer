/**
 * WebSocket connection manager for Tauri desktop app.
 * Handles connecting to the agent, auth handshake, multiplexed pipes,
 * and reconnection.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (primary, default)
 *   Port 9877 → wss:// when "Use TLS" is checked
 */

import { Channel, type ChatImageAttachmentInput } from '@anton/protocol'

/**
 * Loose type for decoded WS payloads — all messages have a `type` discriminant.
 * Callers narrow via switch on `msg.type` and cast to specific message shapes.
 */
export interface WsPayload extends Record<string, unknown> {
  type: string
}

// We inline the codec here to avoid Uint8Array issues in browser context
function encodeFrame(channel: number, payload: object): ArrayBuffer {
  const json = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(json)
  const frame = new Uint8Array(1 + payloadBytes.length)
  frame[0] = channel
  frame.set(payloadBytes, 1)
  return frame.buffer
}

function decodeFrame(data: ArrayBuffer): { channel: number; payload: WsPayload } {
  const bytes = new Uint8Array(data)
  const channel = bytes[0]
  const payloadBytes = bytes.slice(1)
  const text = new TextDecoder().decode(payloadBytes)
  return { channel, payload: JSON.parse(text) }
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error'

export interface ConnectionConfig {
  host: string // IP or hostname
  port: number // default 9876
  token: string // auth token from agent install
  useTLS: boolean // wss:// vs ws://
}

export type MessageHandler = (channel: number, message: WsPayload) => void

export class Connection {
  private ws: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private handlers: MessageHandler[] = []
  private statusListeners: ((status: ConnectionStatus, detail?: string) => void)[] = []
  private _status: ConnectionStatus = 'disconnected'
  private reconnectTimer: number | null = null
  private agentId = ''
  private agentVersion = ''

  get status() {
    return this._status
  }

  get currentConfig() {
    return this.config
  }

  get currentAgentId() {
    return this.agentId
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  onStatusChange(listener: (status: ConnectionStatus, detail?: string) => void) {
    this.statusListeners.push(listener)
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener)
    }
  }

  connect(config: ConnectionConfig) {
    // Clear persisted UI state so every connection starts fresh,
    // but preserve machine credentials and model preference
    const preserve = ['anton.machines', 'anton.lastMachineId', 'anton.selectedModel']
    const saved = preserve.map((k) => [k, localStorage.getItem(k)] as const)
    localStorage.clear()
    for (const [k, v] of saved) {
      if (v !== null) localStorage.setItem(k, v)
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
      console.warn(`[WS SEND] Dropped (not connected): ch=${channel}`, message)
      return
    }
    console.log(`[WS SEND] ch=${channel}`, message)
    this.ws.send(encodeFrame(channel, message))
  }

  sendAiMessage(content: string, attachments?: ChatImageAttachmentInput[]) {
    this.send(Channel.AI, { type: 'message', content, attachments })
  }

  sendTerminalData(sessionId: string, data: string) {
    this.send(Channel.TERMINAL, { type: 'pty_data', id: sessionId, data })
  }

  sendTerminalSpawn(sessionId: string, cols: number, rows: number, cwd?: string) {
    this.send(Channel.TERMINAL, {
      type: 'pty_spawn',
      id: sessionId,
      cols,
      rows,
      ...(cwd && { cwd }),
    })
  }

  sendTerminalResize(sessionId: string, cols: number, rows: number) {
    this.send(Channel.TERMINAL, { type: 'pty_resize', id: sessionId, cols, rows })
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

  // ── Session management ──────────────────────────────────────────

  sendSessionCreate(
    id: string,
    opts?: { provider?: string; model?: string; apiKey?: string; projectId?: string },
  ) {
    this.send(Channel.AI, { type: 'session_create', id, ...opts })
  }

  sendSessionsList() {
    this.send(Channel.AI, { type: 'sessions_list' })
  }

  sendSessionDestroy(id: string) {
    this.send(Channel.AI, { type: 'session_destroy', id })
  }

  sendSessionHistory(id: string, opts?: { before?: number; limit?: number }) {
    this.send(Channel.AI, { type: 'session_history', id, ...opts })
  }

  sendAiMessageToSession(
    content: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
  ) {
    this.send(Channel.AI, { type: 'message', content, sessionId, attachments })
  }

  sendSteerMessage(content: string, sessionId: string) {
    this.send(Channel.AI, { type: 'steer', content, sessionId })
  }

  sendCancelTurn(sessionId: string) {
    this.send(Channel.AI, { type: 'cancel_turn', sessionId })
  }

  // ── Provider management ─────────────────────────────────────────

  sendProvidersList() {
    this.send(Channel.AI, { type: 'providers_list' })
  }

  sendProviderSetKey(provider: string, apiKey: string) {
    this.send(Channel.AI, { type: 'provider_set_key', provider, apiKey })
  }

  sendProviderSetModels(provider: string, models: string[]) {
    this.send(Channel.AI, { type: 'provider_set_models', provider, models })
  }

  sendProviderSetDefault(provider: string, model: string) {
    this.send(Channel.AI, { type: 'provider_set_default', provider, model })
  }

  // ── Config management ───────────────────────────────────────────

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

  // ── Update management ──────────────────────────────────────────

  sendUpdateCheck() {
    this.send(Channel.CONTROL, { type: 'update_check' })
  }

  sendUpdateStart() {
    this.send(Channel.CONTROL, { type: 'update_start' })
  }

  // ── Projects ──────────────────────────────────────────────────

  sendProjectCreate(project: {
    name: string
    description?: string
    icon?: string
    color?: string
  }) {
    this.send(Channel.AI, { type: 'project_create', project })
  }

  sendProjectsList() {
    this.send(Channel.AI, { type: 'projects_list' })
  }

  sendProjectUpdate(id: string, changes: Record<string, unknown>) {
    this.send(Channel.AI, { type: 'project_update', id, changes })
  }

  sendProjectDelete(id: string) {
    this.send(Channel.AI, { type: 'project_delete', id })
  }

  sendProjectContextUpdate(id: string, field: 'notes' | 'summary', value: string) {
    this.send(Channel.AI, { type: 'project_context_update', id, field, value })
  }

  sendProjectInstructionsGet(projectId: string) {
    this.send(Channel.AI, { type: 'project_instructions_get', projectId })
  }

  sendProjectInstructionsSave(projectId: string, content: string) {
    this.send(Channel.AI, { type: 'project_instructions_save', projectId, content })
  }

  sendProjectPreferencesGet(projectId: string) {
    this.send(Channel.AI, { type: 'project_preferences_get', projectId })
  }

  sendProjectPreferenceAdd(projectId: string, title: string, content: string) {
    this.send(Channel.AI, { type: 'project_preference_add', projectId, title, content })
  }

  sendProjectPreferenceDelete(projectId: string, preferenceId: string) {
    this.send(Channel.AI, { type: 'project_preference_delete', projectId, preferenceId })
  }

  sendProjectFileUpload(
    projectId: string,
    filename: string,
    content: string,
    mimeType: string,
    sizeBytes: number,
  ) {
    this.send(Channel.AI, {
      type: 'project_file_upload',
      projectId,
      filename,
      content,
      mimeType,
      sizeBytes,
    })
  }

  sendProjectFileTextCreate(projectId: string, filename: string, content: string) {
    this.send(Channel.AI, { type: 'project_file_text_create', projectId, filename, content })
  }

  sendProjectFileDelete(projectId: string, filename: string) {
    this.send(Channel.AI, { type: 'project_file_delete', projectId, filename })
  }

  sendProjectFilesList(projectId: string) {
    this.send(Channel.AI, { type: 'project_files_list', projectId })
  }

  sendProjectSessionsList(projectId: string) {
    this.send(Channel.AI, { type: 'project_sessions_list', projectId })
  }

  // ── Agents ─────────────────────────────────────────────────────

  sendAgentCreate(
    projectId: string,
    agent: {
      name: string
      description?: string
      instructions: string
      schedule?: string
      originConversationId?: string
    },
  ) {
    this.send(Channel.AI, { type: 'agent_create', projectId, agent })
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

  sendAgentRunLogs(
    projectId: string,
    sessionId: string,
    startedAt: number,
    completedAt: number,
    runSessionId?: string,
  ) {
    this.send(Channel.AI, {
      type: 'agent_run_logs',
      projectId,
      sessionId,
      startedAt,
      completedAt,
      runSessionId,
    })
  }

  // ── Workflows ──────────────────────────────────────────────────

  sendWorkflowRegistryList() {
    this.send(Channel.AI, { type: 'workflow_registry_list' })
  }

  sendWorkflowCheckConnectors(workflowId: string) {
    this.send(Channel.AI, { type: 'workflow_check_connectors', workflowId })
  }

  sendWorkflowInstall(projectId: string, workflowId: string, userInputs: Record<string, unknown>) {
    this.send(Channel.AI, { type: 'workflow_install', projectId, workflowId, userInputs })
  }

  sendWorkflowsList(projectId: string) {
    this.send(Channel.AI, { type: 'workflows_list', projectId })
  }

  sendWorkflowUninstall(projectId: string, workflowId: string) {
    this.send(Channel.AI, { type: 'workflow_uninstall', projectId, workflowId })
  }

  // ── Connectors ─────────────────────────────────────────────────

  sendConnectorsList() {
    this.send(Channel.AI, { type: 'connectors_list' })
  }

  sendConnectorAdd(connector: {
    id: string
    name: string
    description?: string
    icon?: string
    type: 'mcp' | 'api' | 'oauth'
    command?: string
    args?: string[]
    env?: Record<string, string>
    apiKey?: string
    baseUrl?: string
    enabled: boolean
  }) {
    this.send(Channel.AI, { type: 'connector_add', connector })
  }

  sendConnectorUpdate(id: string, changes: Record<string, unknown>) {
    this.send(Channel.AI, { type: 'connector_update', id, changes })
  }

  sendConnectorRemove(id: string) {
    this.send(Channel.AI, { type: 'connector_remove', id })
  }

  sendConnectorToggle(id: string, enabled: boolean) {
    this.send(Channel.AI, { type: 'connector_toggle', id, enabled })
  }

  sendConnectorTest(id: string) {
    this.send(Channel.AI, { type: 'connector_test', id })
  }

  sendConnectorRegistryList() {
    this.send(Channel.AI, { type: 'connector_registry_list' })
  }

  sendConnectorOAuthStart(provider: string) {
    this.send(Channel.AI, { type: 'connector_oauth_start', provider })
  }

  sendConnectorOAuthDisconnect(provider: string) {
    this.send(Channel.AI, { type: 'connector_oauth_disconnect', provider })
  }

  // ── Filesystem ─────────────────────────────────────────────────

  sendFilesystemList(path: string) {
    this.send(Channel.FILESYNC, { type: 'fs_list', path })
  }

  sendFilesystemRead(path: string) {
    this.send(Channel.FILESYNC, { type: 'fs_read', path })
  }

  onFilesystemResponse(
    handler: (
      entries: { name: string; type: 'file' | 'dir' | 'link'; size: string }[],
      error?: string,
    ) => void,
  ) {
    return this.onMessage((channel, msg) => {
      if (channel === Channel.FILESYNC && msg.type === 'fs_list_response') {
        if (msg.error) {
          handler([], msg.error as string)
        } else {
          handler(
            (msg.entries || []) as { name: string; type: 'file' | 'dir' | 'link'; size: string }[],
          )
        }
      }
    })
  }

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

    this.ws.onmessage = (event) => {
      try {
        const { channel, payload } = decodeFrame(event.data)
        console.log(`[WS RAW] channel=${channel} payload.type=${payload.type}`, payload)

        // Handle auth response
        if (channel === Channel.CONTROL && payload.type === 'auth_ok') {
          this.agentId = payload.agentId as string
          this.agentVersion = payload.version as string
          this.setStatus('connected', `Agent: ${this.agentId}`)
        } else if (channel === Channel.CONTROL && payload.type === 'auth_error') {
          this.setStatus('error', `Auth failed: ${payload.reason}`)
          this.ws?.close()
          return
        }

        // Dispatch to handlers
        for (const handler of this.handlers) {
          handler(channel, payload)
        }
      } catch (err) {
        console.error('Failed to decode message:', err)
      }
    }

    this.ws.onclose = (event) => {
      console.log(
        `[WS] Closed: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`,
      )
      if (this._status === 'connected') {
        this.setStatus('disconnected', 'Connection lost')
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err)
      this.setStatus('error', 'Connection failed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.config && this._status !== 'connected') {
        console.log('Reconnecting...')
        this.doConnect()
      }
    }, 3000)
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this._status = status
    for (const listener of this.statusListeners) {
      listener(status, detail)
    }
  }
}

// Singleton connection instance
export const connection = new Connection()
