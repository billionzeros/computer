/**
 * WebSocket server — the pipe between clients and agent sessions.
 *
 * Handles auth, multiplexed channels, session lifecycle, and provider management.
 * Each session is an independent pi SDK agent instance.
 *
 * Connection spec: see /SPEC.md
 *   Port 9876 (config.port)     → plain ws:// (primary, default)
 *   Port 9877 (config.port + 1) → wss:// with self-signed TLS
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join } from 'node:path'
import type { AgentConfig } from '@anton/agent-config'
import {
  cleanExpiredSessions,
  deleteSession as deletePersistedSession,
  getAntonDir,
  getProvidersList,
  listSessionMetas,
  saveConfig,
  setDefault,
  setProviderKey,
  setProviderModels,
} from '@anton/agent-config'
import { GIT_HASH, SPEC_VERSION, VERSION } from '@anton/agent-config'
import { type Session, createSession, resumeSession } from '@anton/agent-core'
import { Channel, decodeFrame, encodeFrame, parseJsonPayload } from '@anton/protocol'
import type { AiMessage, ChannelId, ControlMessage, TerminalMessage } from '@anton/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import type { Scheduler } from './scheduler.js'

const DEFAULT_SESSION_ID = 'default'

export class AgentServer {
  private wss: WebSocketServer | null = null
  private config: AgentConfig
  private sessions: Map<string, Session> = new Map()
  private activeClient: WebSocket | null = null
  private scheduler: Scheduler | null = null

  constructor(config: AgentConfig) {
    this.config = config

    // Clean expired sessions on startup
    const ttl = config.sessions?.ttlDays ?? 7
    const cleaned = cleanExpiredSessions(ttl)
    if (cleaned > 0) {
      console.log(`  Cleaned ${cleaned} expired session(s).`)
    }
  }

  setScheduler(scheduler: Scheduler) {
    this.scheduler = scheduler
  }

  async start(): Promise<void> {
    const { port } = this.config
    const tlsPort = port + 1

    // ── Primary: plain WS on config.port (default 9876) ──
    const plainServer = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'ok',
            agentId: this.config.agentId,
            version: VERSION,
            gitHash: GIT_HASH,
            specVersion: SPEC_VERSION,
          }),
        )
        return
      }
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('WebSocket connections only')
    })
    const plainWss = new WebSocketServer({ server: plainServer })
    plainWss.on('connection', (ws) => this.handleConnection(ws))

    plainServer.listen(port, () => {
      console.log(`  ws://0.0.0.0:${port}  (primary, plain)`)
    })

    this.wss = plainWss

    // ── Secondary: TLS on config.port + 1 (default 9877) ──
    const certDir = join(getAntonDir(), 'certs')
    ensureCerts(certDir)

    const certPath = join(certDir, 'cert.pem')
    const keyPath = join(certDir, 'key.pem')

    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        const tlsServer = createHttpsServer({
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
        })
        const tlsWss = new WebSocketServer({ server: tlsServer })
        tlsWss.on('connection', (ws) => this.handleConnection(ws))

        tlsServer.listen(tlsPort, () => {
          console.log(`  wss://0.0.0.0:${tlsPort} (TLS, self-signed)`)
        })
      } catch (err: unknown) {
        console.error(`  TLS server failed to start: ${(err as Error).message}`)
      }
    }

    console.log(`\n  Agent ID: ${this.config.agentId}`)
    console.log(`  Token:    ${this.config.token}\n`)
  }

  // ── Connection handling ─────────────────────────────────────────

  private handleConnection(ws: WebSocket) {
    console.log('Client connected, waiting for auth...')

    let authenticated = false
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Auth timeout')
      }
    }, 10_000)

    ws.on('message', async (data: Buffer) => {
      try {
        const frame = decodeFrame(new Uint8Array(data))

        if (!authenticated) {
          if (frame.channel === Channel.CONTROL) {
            const msg = parseJsonPayload<ControlMessage>(frame.payload)
            if (msg.type === 'auth' && msg.token === this.config.token) {
              authenticated = true
              clearTimeout(authTimeout)
              this.activeClient = ws
              this.sendToClient(Channel.CONTROL, {
                type: 'auth_ok',
                agentId: this.config.agentId,
                version: VERSION,
                gitHash: GIT_HASH,
                specVersion: SPEC_VERSION,
              })
              console.log('Client authenticated')

              this.sendToClient(Channel.EVENTS, {
                type: 'agent_status',
                status: 'idle',
              })
            } else {
              ws.send(
                encodeFrame(Channel.CONTROL, {
                  type: 'auth_error',
                  reason: 'Invalid token',
                }),
              )
              ws.close(4003, 'Auth failed')
            }
          }
          return
        }

        await this.handleMessage(frame.channel, frame.payload)
      } catch (err: unknown) {
        console.error('Message error:', (err as Error).message)
      }
    })

    ws.on('close', () => {
      if (ws === this.activeClient) {
        this.activeClient = null
        console.log('Client disconnected')
      }
    })
  }

  // ── Message routing ─────────────────────────────────────────────

  private async handleMessage(channel: number, payload: Uint8Array) {
    switch (channel) {
      case Channel.CONTROL:
        await this.handleControl(payload)
        break

      case Channel.AI:
        await this.handleAi(payload)
        break

      case Channel.TERMINAL: {
        const msg = parseJsonPayload<TerminalMessage>(payload)
        console.log('Terminal message:', msg.type)
        break
      }

      case Channel.FILESYNC:
        await this.handleFilesync(payload)
        break

      default:
        console.log(`Unknown channel: ${channel}`)
    }
  }

  // ── Control channel ─────────────────────────────────────────────

  private async handleControl(payload: Uint8Array) {
    const msg = parseJsonPayload<ControlMessage>(payload)

    switch (msg.type) {
      case 'ping':
        this.sendToClient(Channel.CONTROL, { type: 'pong' })
        break

      case 'config_query':
        this.handleConfigQuery(msg.key)
        break

      case 'config_update':
        this.handleConfigUpdate(msg.key, msg.value)
        break
    }
  }

  private handleConfigQuery(key: string) {
    let value: unknown
    switch (key) {
      case 'providers':
        value = getProvidersList(this.config)
        break
      case 'defaults':
        value = this.config.defaults
        break
      case 'security':
        value = this.config.security
        break
      default:
        value = null
    }
    this.sendToClient(Channel.CONTROL, {
      type: 'config_query_response',
      key,
      value,
    })
  }

  private handleConfigUpdate(key: string, value: unknown) {
    try {
      switch (key) {
        case 'defaults': {
          const { provider, model } = value as { provider: string; model: string }
          setDefault(this.config, provider, model)
          break
        }
        case 'security':
          this.config.security = value as typeof this.config.security
          saveConfig(this.config)
          break
        default:
          throw new Error(`Unknown config key: ${key}`)
      }
      this.sendToClient(Channel.CONTROL, {
        type: 'config_update_response',
        success: true,
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.CONTROL, {
        type: 'config_update_response',
        success: false,
        error: (err as Error).message,
      })
    }
  }

  // ── Filesync channel ────────────────────────────────────────────

  private async handleFilesync(payload: Uint8Array) {
    const msg = parseJsonPayload<{ type: string; path?: string }>(payload)

    switch (msg.type) {
      case 'fs_list': {
        const { homedir } = await import('node:os')
        let dirPath = msg.path || homedir()
        // Resolve ~ to actual home
        if (dirPath === '~' || dirPath.startsWith('~/')) {
          dirPath = dirPath.replace('~', homedir())
        }
        try {
          const { readdirSync, statSync } = await import('node:fs')
          const { join } = await import('node:path')
          const entries = readdirSync(dirPath, { withFileTypes: true })
          const result = entries
            .filter((e) => !e.name.startsWith('.')) // hide dotfiles by default
            .map((e) => {
              try {
                const fullPath = join(dirPath, e.name)
                const stat = statSync(fullPath)
                return {
                  name: e.name,
                  type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file',
                  size: e.isDirectory() ? '' : formatFileSize(stat.size),
                }
              } catch {
                return { name: e.name, type: 'file' as const, size: '' }
              }
            })
          this.sendToClient(Channel.FILESYNC, { type: 'fs_list_response', entries: result })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_list_response',
            entries: [],
            error: (err as Error).message,
          })
        }
        break
      }

      case 'fs_read': {
        const filePath = msg.path || ''
        try {
          const { readFileSync } = await import('node:fs')
          const content = readFileSync(filePath, 'utf-8')
          const truncated = content.length > 100_000 ? content.slice(0, 100_000) : content
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_read_response',
            path: filePath,
            content: truncated,
            truncated: content.length > 100_000,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_read_response',
            path: filePath,
            content: '',
            error: (err as Error).message,
          })
        }
        break
      }

      default:
        console.log(`Unknown filesync message type: ${msg.type}`)
    }
  }

  // ── AI channel ──────────────────────────────────────────────────

  private async handleAi(payload: Uint8Array) {
    const msg = parseJsonPayload<AiMessage>(payload)

    switch (msg.type) {
      // ── Session lifecycle ──
      case 'session_create':
        this.handleSessionCreate(msg)
        break

      case 'session_resume':
        this.handleSessionResume(msg)
        break

      case 'sessions_list':
        this.handleSessionsList()
        break

      case 'session_destroy':
        this.handleSessionDestroy(msg)
        break

      case 'session_history':
        this.handleSessionHistory(msg)
        break

      // ── Provider management ──
      case 'providers_list':
        this.handleProvidersList()
        break

      case 'provider_set_key':
        this.handleProviderSetKey(msg)
        break

      case 'provider_set_default':
        this.handleProviderSetDefault(msg)
        break

      case 'provider_set_models':
        this.handleProviderSetModels(msg)
        break

      // ── Scheduler ──
      case 'scheduler_list':
        this.handleSchedulerList()
        break

      case 'scheduler_run':
        await this.handleSchedulerRun(msg)
        break

      // ── Chat messages ──
      case 'message':
        await this.handleChatMessage(msg)
        break

      // ── Confirm response (forwarded to active session) ──
      case 'confirm_response':
        // Handled inline by the confirm handler Promise in session
        break

      // ── Ask-user response (forwarded to active session) ──
      case 'ask_user_response':
        // Handled inline by the ask_user handler Promise in session
        break
    }
  }

  // ── Session handlers ────────────────────────────────────────────

  private handleSessionCreate(msg: {
    id: string
    provider?: string
    model?: string
    apiKey?: string
  }) {
    try {
      const session = createSession(msg.id, this.config, {
        provider: msg.provider,
        model: msg.model,
        apiKey: msg.apiKey,
      })

      this.wireSessionConfirmHandler(session)
      this.wirePlanConfirmHandler(session)
      this.wireAskUserHandler(session)
      this.sessions.set(msg.id, session)

      this.sendToClient(Channel.AI, {
        type: 'session_created',
        id: msg.id,
        provider: session.provider,
        model: session.model,
      })

      console.log(`Session created: ${msg.id} (${session.provider}/${session.model})`)
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create session: ${(err as Error).message}`,
        sessionId: msg.id,
      })
    }
  }

  private handleSessionResume(msg: { id: string }) {
    try {
      // Check if already in memory
      let session = this.sessions.get(msg.id)

      if (!session) {
        // Try loading from disk
        session = resumeSession(msg.id, this.config) ?? undefined
        if (!session) {
          this.sendToClient(Channel.AI, {
            type: 'error',
            message: `Session not found: ${msg.id}`,
          })
          return
        }
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(msg.id, session)
      }

      const info = session.getInfo()
      this.sendToClient(Channel.AI, {
        type: 'session_resumed',
        id: info.id,
        provider: info.provider,
        model: info.model,
        messageCount: info.messageCount,
        title: info.title,
      })

      console.log(`Session resumed: ${msg.id} (${info.messageCount} messages)`)
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to resume session: ${(err as Error).message}`,
      })
    }
  }

  private handleSessionsList() {
    // Fast listing from index.json (no message loading)
    const metas = listSessionMetas()

    const sessions = metas.map((m) => ({
      id: m.id,
      title: m.title,
      provider: m.provider,
      model: m.model,
      messageCount: m.messageCount,
      createdAt: m.createdAt,
      lastActiveAt: m.lastActiveAt,
    }))

    // Add in-memory sessions that aren't persisted yet
    for (const [id, session] of this.sessions) {
      if (!metas.some((m) => m.id === id)) {
        const info = session.getInfo()
        sessions.push({
          id: info.id,
          title: info.title,
          provider: info.provider,
          model: info.model,
          messageCount: info.messageCount,
          createdAt: info.createdAt,
          lastActiveAt: info.lastActiveAt,
        })
      }
    }

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    this.sendToClient(Channel.AI, {
      type: 'sessions_list_response',
      sessions,
    })
  }

  private handleSessionDestroy(msg: { id: string }) {
    this.sessions.delete(msg.id)
    deletePersistedSession(msg.id)

    this.sendToClient(Channel.AI, {
      type: 'session_destroyed',
      id: msg.id,
    })

    console.log(`Session destroyed: ${msg.id}`)
  }

  private handleSessionHistory(msg: { id: string }) {
    try {
      // Check if already in memory
      let session = this.sessions.get(msg.id)

      if (!session) {
        // Try loading from disk
        session = resumeSession(msg.id, this.config) ?? undefined
        if (!session) {
          this.sendToClient(Channel.AI, {
            type: 'error',
            message: `Session not found: ${msg.id}`,
          })
          return
        }
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(msg.id, session)
      }

      this.sendToClient(Channel.AI, {
        type: 'session_history_response',
        id: msg.id,
        messages: session.getHistory(),
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to get session history: ${(err as Error).message}`,
      })
    }
  }

  // ── Provider handlers ───────────────────────────────────────────

  private handleProvidersList() {
    this.sendToClient(Channel.AI, {
      type: 'providers_list_response',
      providers: getProvidersList(this.config),
      defaults: this.config.defaults,
    })
  }

  private handleProviderSetKey(msg: { provider: string; apiKey: string }) {
    try {
      setProviderKey(this.config, msg.provider, msg.apiKey)
      this.sendToClient(Channel.AI, {
        type: 'provider_set_key_response',
        success: true,
        provider: msg.provider,
      })
      console.log(`API key updated for provider: ${msg.provider}`)
    } catch {
      this.sendToClient(Channel.AI, {
        type: 'provider_set_key_response',
        success: false,
        provider: msg.provider,
      })
    }
  }

  private handleProviderSetDefault(msg: { provider: string; model: string }) {
    try {
      setDefault(this.config, msg.provider, msg.model)

      // Switch all active sessions to the new default model
      for (const [id, session] of this.sessions) {
        try {
          session.switchModel(msg.provider, msg.model)
          console.log(`Switched session ${id} to ${msg.provider}/${msg.model}`)
        } catch (err) {
          console.warn(`Failed to switch session ${id}:`, (err as Error).message)
        }
      }

      this.sendToClient(Channel.AI, {
        type: 'provider_set_default_response',
        success: true,
        provider: msg.provider,
        model: msg.model,
      })
      console.log(`Default set to: ${msg.provider}/${msg.model}`)
    } catch {
      this.sendToClient(Channel.AI, {
        type: 'provider_set_default_response',
        success: false,
        provider: msg.provider,
        model: msg.model,
      })
    }
  }

  private handleProviderSetModels(msg: { provider: string; models: string[] }) {
    try {
      setProviderModels(this.config, msg.provider, msg.models)
      this.sendToClient(Channel.AI, {
        type: 'provider_set_models_response',
        success: true,
        provider: msg.provider,
      })
      console.log(`Models updated for provider: ${msg.provider} (${msg.models.length} models)`)
    } catch {
      this.sendToClient(Channel.AI, {
        type: 'provider_set_models_response',
        success: false,
        provider: msg.provider,
      })
    }
  }

  // ── Scheduler handlers ────────────────────────────────────────

  private handleSchedulerList() {
    if (!this.scheduler) {
      this.sendToClient(Channel.AI, {
        type: 'scheduler_list_response',
        jobs: [],
      })
      return
    }

    this.sendToClient(Channel.AI, {
      type: 'scheduler_list_response',
      jobs: this.scheduler.listJobs(),
    })
  }

  private async handleSchedulerRun(msg: { name: string }) {
    if (!this.scheduler) {
      this.sendToClient(Channel.AI, {
        type: 'scheduler_run_response',
        name: msg.name,
        success: false,
        error: 'Scheduler not initialized',
      })
      return
    }

    const job = this.scheduler.findJob(msg.name)
    if (!job) {
      this.sendToClient(Channel.AI, {
        type: 'scheduler_run_response',
        name: msg.name,
        success: false,
        error: `Job not found: ${msg.name}`,
      })
      return
    }

    try {
      await this.scheduler.runJob(job)
      this.sendToClient(Channel.AI, {
        type: 'scheduler_run_response',
        name: msg.name,
        success: true,
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'scheduler_run_response',
        name: msg.name,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  // ── Chat message handler ────────────────────────────────────────

  private async handleChatMessage(msg: { content: string; sessionId?: string }) {
    const sessionId = msg.sessionId || DEFAULT_SESSION_ID

    // Auto-create default session if it doesn't exist
    let session = this.sessions.get(sessionId)
    if (!session) {
      if (sessionId === DEFAULT_SESSION_ID) {
        session = createSession(DEFAULT_SESSION_ID, this.config)
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(DEFAULT_SESSION_ID, session)
      } else {
        // Try to resume from disk automatically
        session = resumeSession(sessionId, this.config) ?? undefined
        if (session) {
          this.wireSessionConfirmHandler(session)
          this.wirePlanConfirmHandler(session)
          this.wireAskUserHandler(session)
          this.sessions.set(sessionId, session)
          console.log(`Auto-resumed session from disk: ${sessionId}`)
        } else {
          this.sendToClient(Channel.AI, {
            type: 'error',
            message: `Session not found: ${sessionId}. Create it first with session_create.`,
            sessionId,
          })
          return
        }
      }
    }

    // Handle /compact command
    if (msg.content.startsWith('/compact')) {
      await this.handleCompactCommand(session, sessionId, msg.content)
      return
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'agent_status',
      status: 'working',
      detail: 'Processing your request...',
    })

    console.log(`[${sessionId}] Processing: "${msg.content.slice(0, 50)}"`)

    try {
      let eventCount = 0
      for await (const event of session.processMessage(msg.content)) {
        eventCount++

        // Emit granular status updates so the client can show step-by-step progress
        if (event.type === 'tool_call') {
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: `Running ${event.name}...`,
          })
        } else if (event.type === 'thinking') {
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: 'Thinking...',
          })
        } else if (event.type === 'text') {
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: 'Writing response...',
          })
        }

        this.sendToClient(Channel.AI, { ...event, sessionId } as Record<string, unknown>)
      }
      console.log(`[${sessionId}] Done (${eventCount} events)`)
    } catch (err: unknown) {
      console.error(`[${sessionId}] Error:`, (err as Error).message)
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: (err as Error).message,
        sessionId,
      })
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'agent_status',
      status: 'idle',
    })
  }

  private async handleCompactCommand(session: Session, sessionId: string, content: string) {
    const customInstructions = content.slice('/compact'.length).trim() || undefined

    this.sendToClient(Channel.AI, {
      type: 'compaction_start',
      sessionId,
    })

    console.log(`[${sessionId}] Manual compaction requested`)

    try {
      const state = await session.compactNow(customInstructions)

      this.sendToClient(Channel.AI, {
        type: 'compaction_complete',
        sessionId,
        compactedMessages: state.compactedMessageCount,
        totalCompactions: state.compactionCount,
      })

      console.log(
        `[${sessionId}] Compaction complete: ${state.compactedMessageCount} messages compacted ` +
          `(${state.compactionCount} total compactions)`,
      )
    } catch (err: unknown) {
      console.error(`[${sessionId}] Compaction failed:`, (err as Error).message)
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Compaction failed: ${(err as Error).message}`,
        sessionId,
      })
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'agent_status',
      status: 'idle',
    })
  }

  // ── Confirmation wiring ─────────────────────────────────────────

  private wireSessionConfirmHandler(session: Session) {
    session.setConfirmHandler(async (command, reason) => {
      if (!this.activeClient) return false

      return new Promise((resolve) => {
        const confirmId = `c_${Date.now()}`

        this.sendToClient(Channel.AI, {
          type: 'confirm',
          id: confirmId,
          command,
          reason,
          sessionId: session.id,
        })

        const timeout = setTimeout(() => resolve(false), 60_000)

        const handler = (data: Buffer) => {
          try {
            const frame = decodeFrame(new Uint8Array(data))
            if (frame.channel === Channel.AI) {
              const msg = parseJsonPayload<AiMessage>(frame.payload)
              if (msg.type === 'confirm_response' && msg.id === confirmId) {
                clearTimeout(timeout)
                this.activeClient?.off('message', handler)
                resolve(msg.approved)
              }
            }
          } catch {}
        }

        this.activeClient?.on('message', handler)
      })
    })
  }

  private wirePlanConfirmHandler(session: Session) {
    session.setPlanConfirmHandler(async (title, content) => {
      if (!this.activeClient) return { approved: false, feedback: 'No client connected' }

      return new Promise((resolve) => {
        const confirmId = `plan_${Date.now()}`

        this.sendToClient(Channel.AI, {
          type: 'plan_confirm',
          id: confirmId,
          title,
          content,
          sessionId: session.id,
        })

        // 5 minutes — plans need reading time
        const timeout = setTimeout(
          () => resolve({ approved: false, feedback: 'Timed out waiting for plan review' }),
          300_000,
        )

        const handler = (data: Buffer) => {
          try {
            const frame = decodeFrame(new Uint8Array(data))
            if (frame.channel === Channel.AI) {
              const msg = parseJsonPayload<AiMessage>(frame.payload)
              if (msg.type === 'plan_confirm_response' && msg.id === confirmId) {
                clearTimeout(timeout)
                this.activeClient?.off('message', handler)
                resolve({ approved: msg.approved, feedback: msg.feedback })
              }
            }
          } catch {}
        }

        this.activeClient?.on('message', handler)
      })
    })
  }

  private wireAskUserHandler(session: Session) {
    session.setAskUserHandler(async (questions) => {
      if (!this.activeClient) return {}

      return new Promise((resolve) => {
        const askId = `ask_${Date.now()}`

        this.sendToClient(Channel.AI, {
          type: 'ask_user',
          id: askId,
          questions,
          sessionId: session.id,
        })

        // 5 minutes — user needs time to answer
        const timeout = setTimeout(() => {
          this.activeClient?.off('message', handler)
          resolve({})
        }, 300_000)

        const handler = (data: Buffer) => {
          try {
            const frame = decodeFrame(new Uint8Array(data))
            if (frame.channel === Channel.AI) {
              const msg = parseJsonPayload<AiMessage>(frame.payload)
              if (msg.type === 'ask_user_response' && msg.id === askId) {
                clearTimeout(timeout)
                this.activeClient?.off('message', handler)
                resolve(msg.answers)
              }
            }
          } catch {}
        }

        this.activeClient?.on('message', handler)
      })
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private sendToClient(channel: ChannelId, message: object) {
    if (this.activeClient && this.activeClient.readyState === WebSocket.OPEN) {
      this.activeClient.send(encodeFrame(channel, message))
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`
}

function ensureCerts(certDir: string) {
  const certPath = join(certDir, 'cert.pem')
  const keyPath = join(certDir, 'key.pem')

  if (existsSync(certPath) && existsSync(keyPath)) return

  console.log('Generating self-signed TLS certificate...')

  try {
    execSync(`mkdir -p "${certDir}"`)
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=anton.computer"`,
      { stdio: 'pipe' },
    )
  } catch (err: unknown) {
    console.error('Failed to generate certs:', (err as Error).message)
  }
}
