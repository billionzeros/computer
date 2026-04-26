/**
 * WebSocket connection manager for Tauri desktop app.
 * Handles connecting to the agent, auth handshake, multiplexed pipes,
 * and reconnection.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 → plain ws:// (primary, default)
 *   Port 9877 → wss:// when "Use TLS" is checked
 */

import {
  type AiMessage,
  Channel,
  type ChatImageAttachmentInput,
  type ControlMessage,
  type EventMessage,
  type TerminalMessage,
  type ThinkingLevel,
} from '@anton/protocol'

/**
 * Union of all typed protocol messages across all channels.
 * Decoded once at the WS boundary — handlers receive properly typed unions.
 */
export type IncomingMessage = ControlMessage | AiMessage | EventMessage | TerminalMessage

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
  host: string // IP or hostname
  port: number // default 9876
  token: string // auth token from agent install
  useTLS: boolean // wss:// vs ws://
}

export type MessageHandler = (channel: number, message: IncomingMessage) => void

/** Untyped handler for channels not yet in the protocol union (e.g. FILESYNC) */
type RawPayload = { type: string; [key: string]: unknown }
type RawMessageHandler = (channel: number, payload: RawPayload) => void

export class Connection {
  private ws: WebSocket | null = null
  private config: ConnectionConfig | null = null
  private handlers: MessageHandler[] = []
  private rawHandlers: RawMessageHandler[] = []
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

  /** Register a handler for channels not in the typed protocol union (e.g. FILESYNC) */
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
    // Clear persisted UI state so every connection starts fresh,
    // but preserve machine credentials, model preference, session cache, and active conversation
    const preserve = [
      'anton.machines',
      'anton.lastMachineId',
      'anton.selectedModel',
      'anton.sessionCache',
      'anton.activeConversationId',
      'anton.conversations', // keep until migration to sessionCache is complete
    ]
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

  sendAiMessage(
    content: string,
    attachments?: ChatImageAttachmentInput[],
    opts?: { mode?: 'research' },
  ) {
    this.send(Channel.AI, {
      type: 'message',
      content,
      attachments,
      ...(opts?.mode ? { mode: opts.mode } : {}),
    })
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
    opts?: {
      provider?: string
      model?: string
      apiKey?: string
      projectId?: string
      thinkingLevel?: ThinkingLevel
    },
  ) {
    this.send(Channel.AI, { type: 'session_create', id, ...opts })
  }

  sendSessionSetThinkingLevel(sessionId: string, level: ThinkingLevel) {
    this.send(Channel.AI, { type: 'session_set_thinking_level', sessionId, level })
  }

  sendSessionsSync(lastSyncVersion: number) {
    this.send(Channel.AI, { type: 'sessions_sync', lastSyncVersion })
  }

  sendSessionDestroy(id: string) {
    this.send(Channel.AI, { type: 'session_destroy', id })
  }

  /**
   * Swap the provider/model of an existing harness (BYOS) session.
   * Server tears down the running CLI, rebuilds with the new provider,
   * and seeds the new CLI with a replay of the mirrored conversation.
   */
  sendSessionProviderSwitch(id: string, provider: string, model: string) {
    this.send(Channel.AI, { type: 'session_provider_switch', id, provider, model })
  }

  sendSessionHistory(id: string, opts?: { before?: number; limit?: number; projectId?: string }) {
    this.send(Channel.AI, { type: 'session_history', id, ...opts })
  }

  sendAiMessageToSession(
    content: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
    opts?: { mode?: 'research' },
  ) {
    this.send(Channel.AI, {
      type: 'message',
      content,
      sessionId,
      attachments,
      ...(opts?.mode ? { mode: opts.mode } : {}),
    })
  }

  sendSteerMessage(content: string, sessionId: string, attachments?: ChatImageAttachmentInput[]) {
    this.send(Channel.AI, { type: 'steer', content, sessionId, attachments })
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

  sendDetectHarnesses() {
    this.send(Channel.AI, { type: 'detect_harnesses' })
  }

  sendHarnessSetup(
    harnessId: string,
    action: 'install' | 'login' | 'login_code' | 'status',
    code?: string,
  ) {
    this.send(Channel.AI, { type: 'harness_setup', harnessId, action, code })
  }

  // ── Config management ───────────────────────────────────────────

  sendConfigQuery(
    key: 'providers' | 'defaults' | 'security' | 'system_prompt' | 'memories' | 'sessions',
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

  sendSessionsConfigUpdate(value: {
    disconnectMode?: 'attached' | 'detached'
    detachedTurnMaxMs?: number
  }) {
    this.send(Channel.CONTROL, {
      type: 'config_update',
      key: 'sessions',
      value,
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

  sendProjectSessionsList(projectId: string) {
    this.send(Channel.AI, { type: 'project_sessions_list', projectId })
  }

  // ── Routines ───────────────────────────────────────────────────

  sendRoutineCreate(
    projectId: string,
    routine: {
      name: string
      description?: string
      instructions: string
      schedule?: string
      originConversationId?: string
    },
  ) {
    this.send(Channel.AI, { type: 'routine_create', projectId, routine })
  }

  sendRoutinesList(projectId: string) {
    this.send(Channel.AI, { type: 'routines_list', projectId })
  }

  sendRoutineAction(
    projectId: string,
    sessionId: string,
    action: 'start' | 'stop' | 'delete' | 'pause' | 'resume',
  ) {
    this.send(Channel.AI, { type: 'routine_action', projectId, sessionId, action })
  }

  sendRoutineUpdate(
    projectId: string,
    sessionId: string,
    patch: {
      name?: string
      description?: string
      instructions?: string
      schedule?: string | null
    },
  ) {
    this.send(Channel.AI, { type: 'routine_update', projectId, sessionId, patch })
  }

  sendRoutineRunLogs(
    projectId: string,
    sessionId: string,
    startedAt: number,
    completedAt: number,
    runSessionId?: string,
  ) {
    this.send(Channel.AI, {
      type: 'routine_run_logs',
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

  sendWorkflowActivate(projectId: string, workflowId: string) {
    this.send(Channel.AI, { type: 'workflow_activate', projectId, workflowId })
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
    enabled: boolean
    registryId?: string
    accountEmail?: string
    accountLabel?: string
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

  sendConnectorOAuthStart(provider: string, registryId?: string) {
    this.send(Channel.AI, {
      type: 'connector_oauth_start',
      provider,
      ...(registryId ? { registryId } : {}),
    })
  }

  sendConnectorOAuthDisconnect(provider: string) {
    this.send(Channel.AI, { type: 'connector_oauth_disconnect', provider })
  }

  sendSkillList() {
    this.send(Channel.AI, { type: 'skill_list' })
  }

  sendPublishedList() {
    this.send(Channel.AI, { type: 'published_list' })
  }

  sendUnpublish(slug: string) {
    this.send(Channel.AI, { type: 'unpublish', slug })
  }

  sendConnectorSetToolPermission(
    id: string,
    toolName: string,
    permission: 'auto' | 'ask' | 'never',
  ) {
    this.send(Channel.AI, { type: 'connector_set_tool_permission', id, toolName, permission })
  }

  // ── Filesystem ─────────────────────────────────────────────────

  sendFilesystemList(path: string, showHidden?: boolean) {
    this.send(Channel.FILESYNC, { type: 'fs_list', path, showHidden })
  }

  sendFilesystemRead(path: string, encoding?: 'base64') {
    this.send(Channel.FILESYNC, { type: 'fs_read', path, ...(encoding && { encoding }) })
  }

  /** Dedicated binary read for artifact previews (docx/xlsx/pdf/image bytes).
   *  Server returns base64-encoded content + sniffed MIME + size. Cap 500MB. */
  sendFilesystemReadBytes(path: string) {
    this.send(Channel.FILESYNC, { type: 'fs_read_bytes', path })
  }

  sendFilesystemMkdir(path: string) {
    this.send(Channel.FILESYNC, { type: 'fs_mkdir', path })
  }

  sendFilesystemDelete(path: string) {
    this.send(Channel.FILESYNC, { type: 'fs_delete', path })
  }

  sendFilesystemWrite(path: string, content: string, encoding: string) {
    this.send(Channel.FILESYNC, { type: 'fs_write', path, content, encoding })
  }

  onFilesystemResponse(
    handler: (
      entries: { name: string; type: 'file' | 'dir' | 'link'; size: string }[],
      error?: string,
      /** Path the list was requested for (echoed back by the server). */
      path?: string,
    ) => void,
  ) {
    // Filesystem channel messages aren't in the protocol union yet — use raw listener
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_list_response') {
        const path = payload.path as string | undefined
        if (payload.error) {
          handler([], payload.error as string, path)
        } else {
          handler(
            (payload.entries || []) as {
              name: string
              type: 'file' | 'dir' | 'link'
              size: string
            }[],
            undefined,
            path,
          )
        }
      }
    })
  }

  onFilesystemReadResponse(
    handler: (
      path: string,
      content: string,
      truncated: boolean,
      error?: string,
      encoding?: string,
      mimeType?: string,
    ) => void,
  ) {
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_read_response') {
        handler(
          payload.path as string,
          payload.content as string,
          !!payload.truncated,
          payload.error as string | undefined,
          payload.encoding as string | undefined,
          payload.mimeType as string | undefined,
        )
      }
    })
  }

  onFilesystemReadBytesResponse(
    handler: (payload: {
      path: string
      content: string // base64
      mimeType?: string
      size?: number
      error?: string
    }) => void,
  ) {
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_read_bytes_response') {
        handler({
          path: payload.path as string,
          content: (payload.content as string) ?? '',
          mimeType: payload.mimeType as string | undefined,
          size: payload.size as number | undefined,
          error: payload.error as string | undefined,
        })
      }
    })
  }

  onFilesystemMkdirResponse(handler: (path: string, success: boolean, error?: string) => void) {
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_mkdir_response') {
        handler(payload.path as string, !!payload.success, payload.error as string | undefined)
      }
    })
  }

  onFilesystemDeleteResponse(handler: (path: string, success: boolean, error?: string) => void) {
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_delete_response') {
        handler(payload.path as string, !!payload.success, payload.error as string | undefined)
      }
    })
  }

  onFilesystemWriteResponse(handler: (path: string, success: boolean, error?: string) => void) {
    return this.onRawMessage((channel, payload) => {
      if (channel === Channel.FILESYNC && payload.type === 'fs_write_response') {
        handler(payload.path as string, !!payload.success, payload.error as string | undefined)
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

        // Dispatch to typed handlers
        for (const handler of this.handlers) {
          handler(channel, payload)
        }
        // Dispatch to raw handlers (for channels not in the typed union)
        for (const handler of this.rawHandlers) {
          handler(channel, payload as unknown as RawPayload)
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
