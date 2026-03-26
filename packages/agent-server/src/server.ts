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
import * as pty from 'node-pty'
import { existsSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join } from 'node:path'
import type { AgentConfig } from '@anton/agent-config'
import {
  appendSessionHistory,
  buildProjectContext,
  cleanExpiredSessions,
  createProject,
  deleteSession as deletePersistedSession,
  deleteProject,
  getAntonDir,
  getProvidersList,
  listProjectSessions,
  listSessionMetas,
  loadProject,
  loadProjects,
  saveConfig,
  setDefault,
  setProviderKey,
  setProviderModels,
  updateProject,
  updateProjectContext,
  updateProjectStats,
  saveProjectFile,
  deleteProjectFile,
  listProjectFiles,
} from '@anton/agent-config'
import { GIT_HASH, VERSION } from '@anton/agent-config'
import {
  type Session,
  type SubAgentEventHandler,
  McpManager,
  type McpServerConfig,
  createSession,
  resumeSession,
} from '@anton/agent-core'
import {
  CONNECTOR_REGISTRY,
  type ConnectorConfig,
  addConnector,
  getConnectors,
  removeConnector as removeConnectorConfig,
  toggleConnector as toggleConnectorConfig,
  updateConnector as updateConnectorConfig,
} from '@anton/agent-config'
import { Channel, decodeFrame, encodeFrame, parseJsonPayload } from '@anton/protocol'
import type { AiMessage, ChannelId, ControlMessage, TerminalMessage } from '@anton/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import type { Scheduler } from './scheduler.js'
import { Updater } from './updater.js'

const DEFAULT_SESSION_ID = 'default'

export class AgentServer {
  private wss: WebSocketServer | null = null
  private config: AgentConfig
  private sessions: Map<string, Session> = new Map()
  private activeTurns: Set<string> = new Set() // sessions currently processing a turn
  private activeClient: WebSocket | null = null
  private scheduler: Scheduler | null = null
  private updater: Updater = new Updater()
  private mcpManager: McpManager = new McpManager()
  private ptys: Map<string, pty.IPty> = new Map()

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
        const updateInfo = this.updater.getUpdateAvailable()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'ok',
            agentId: this.config.agentId,
            version: VERSION,
            gitHash: GIT_HASH,
            ...(updateInfo
              ? {
                  updateAvailable: {
                    version: updateInfo.version,
                  },
                }
              : {}),
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

    // Start update checker
    this.updater.start()

    // Start MCP connectors
    await this.startMcpConnectors()

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

              // Build auth_ok with version compatibility + update info
              const authOk: Record<string, unknown> = {
                type: 'auth_ok',
                agentId: this.config.agentId,
                version: VERSION,
                gitHash: GIT_HASH,
              }

              // Include update info if available
              const updateManifest = this.updater.getUpdateAvailable()
              if (updateManifest) {
                authOk.updateAvailable = {
                  version: updateManifest.version,
                  changelog: updateManifest.changelog,
                  releaseUrl: updateManifest.releaseUrl,
                }
              }

              this.sendToClient(Channel.CONTROL, authOk)
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
        // Cancel active turns and persist their current state
        for (const sessionId of this.activeTurns) {
          const session = this.sessions.get(sessionId)
          if (session) {
            console.log(`Cancelling active turn for session ${sessionId}`)
            session.cancel()
          }
        }
        this.activeTurns.clear()
        // Kill all PTY sessions
        for (const [id, p] of this.ptys) {
          try { p.kill() } catch {}
          this.ptys.delete(id)
        }
        console.log('Client disconnected — active sessions cancelled & persisted')
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

      case Channel.TERMINAL:
        this.handleTerminal(payload)
        break

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

      case 'update_check':
        this.handleUpdateCheck()
        break

      case 'update_start':
        this.handleUpdateStart()
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

  // ── Update handlers ─────────────────────────────────────────────

  private async handleUpdateCheck() {
    const result = await this.updater.checkForUpdates()
    const status = this.updater.getStatus()

    this.sendToClient(Channel.CONTROL, {
      type: 'update_check_response',
      ...status,
    })

    // Also emit event if update is available
    if (result.updateAvailable && result.manifest) {
      this.sendToClient(Channel.EVENTS, {
        type: 'update_available',
        currentVersion: VERSION,
        latestVersion: result.manifest.version,
        changelog: result.manifest.changelog,
        releaseUrl: result.manifest.releaseUrl,
      })
    }
  }

  private async handleUpdateStart() {
    for await (const progress of this.updater.selfUpdate()) {
      this.sendToClient(Channel.CONTROL, {
        type: 'update_progress',
        stage: progress.stage,
        message: progress.message,
      })
    }
  }

  // ── Terminal channel ────────────────────────────────────────────

  private handleTerminal(payload: Uint8Array) {
    const msg = parseJsonPayload<TerminalMessage>(payload)

    switch (msg.type) {
      case 'pty_spawn': {
        // Kill existing PTY with same ID if any
        const existing = this.ptys.get(msg.id)
        if (existing) {
          try { existing.kill() } catch {}
          this.ptys.delete(msg.id)
        }

        const shell = msg.shell || process.env.SHELL || '/bin/bash'
        const p = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: msg.cols || 80,
          rows: msg.rows || 24,
          cwd: process.env.HOME || '/',
          env: process.env as Record<string, string>,
        })

        this.ptys.set(msg.id, p)

        p.onData((data: string) => {
          const b64 = Buffer.from(data, 'binary').toString('base64')
          this.sendToClient(Channel.TERMINAL, { type: 'pty_data', id: msg.id, data: b64 })
        })

        p.onExit(() => {
          this.ptys.delete(msg.id)
          this.sendToClient(Channel.TERMINAL, { type: 'pty_close', id: msg.id })
        })

        console.log(`PTY spawned: ${msg.id} (${shell})`)
        break
      }

      case 'pty_data': {
        const p = this.ptys.get(msg.id)
        if (p) {
          const decoded = Buffer.from(msg.data, 'base64').toString('binary')
          p.write(decoded)
        }
        break
      }

      case 'pty_resize': {
        const p = this.ptys.get(msg.id)
        if (p) {
          p.resize(msg.cols, msg.rows)
        }
        break
      }

      case 'pty_close': {
        const p = this.ptys.get(msg.id)
        if (p) {
          try { p.kill() } catch {}
          this.ptys.delete(msg.id)
        }
        break
      }
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

      // ── Projects ──
      case 'project_create':
        this.handleProjectCreate(msg)
        break
      case 'projects_list':
        this.handleProjectsList()
        break
      case 'project_update':
        this.handleProjectUpdate(msg)
        break
      case 'project_delete':
        this.handleProjectDelete(msg)
        break
      case 'project_context_update':
        this.handleProjectContextUpdate(msg)
        break
      case 'project_file_upload':
        this.handleProjectFileUpload(msg)
        break
      case 'project_file_text_create':
        this.handleProjectFileTextCreate(msg)
        break
      case 'project_file_delete':
        this.handleProjectFileDelete(msg)
        break
      case 'project_files_list':
        this.handleProjectFilesList(msg)
        break
      case 'project_sessions_list':
        this.handleProjectSessionsList(msg)
        break

      // ── Connectors ──
      case 'connectors_list':
        this.handleConnectorsList()
        break
      case 'connector_add':
        await this.handleConnectorAdd(msg)
        break
      case 'connector_update':
        await this.handleConnectorUpdate(msg)
        break
      case 'connector_remove':
        await this.handleConnectorRemove(msg)
        break
      case 'connector_toggle':
        await this.handleConnectorToggle(msg)
        break
      case 'connector_test':
        await this.handleConnectorTest(msg)
        break
      case 'connector_registry_list':
        this.handleConnectorRegistryList()
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
    projectId?: string
  }) {
    try {
      // Build project context if this is a project-scoped session
      let projectContext: string | undefined
      if (msg.projectId) {
        const project = loadProject(msg.projectId)
        if (project) {
          projectContext = buildProjectContext(project, msg.projectId)
        }
      }

      const session = createSession(msg.id, this.config, {
        provider: msg.provider,
        model: msg.model,
        apiKey: msg.apiKey,
        onSubAgentEvent: this.makeSubAgentEventHandler(msg.id),
        projectId: msg.projectId,
        projectContext,
        mcpManager: this.mcpManager,
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

      // Send context info if available
      if (session.contextInfo) {
        this.sendToClient(Channel.AI, {
          type: 'context_info',
          sessionId: msg.id,
          globalMemories: session.contextInfo.globalMemories,
          conversationMemories: session.contextInfo.conversationMemories,
          crossConversationMemories: session.contextInfo.crossConversationMemories,
          projectId: session.contextInfo.projectId,
        })
      }

      console.log(`Session created: ${msg.id} (${session.provider}/${session.model})${msg.projectId ? ` [project: ${msg.projectId}]` : ''}`)
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
        // Extract projectId from session ID format (proj_{projectId}_sess_...)
        let projectId: string | undefined
        const projMatch = msg.id.match(/^proj_(.+?)_sess_/)
        if (projMatch) {
          projectId = projMatch[1]
        }

        // Try loading from disk (project dir first if applicable, then global)
        session =
          resumeSession(msg.id, this.config, {
            onSubAgentEvent: this.makeSubAgentEventHandler(msg.id),
            mcpManager: this.mcpManager,
            projectId,
            projectContext: projectId ? (() => {
              const project = loadProject(projectId!)
              return project ? buildProjectContext(project, projectId!) : undefined
            })() : undefined,
          }) ?? undefined

        // Fallback to global sessions
        if (!session && projectId) {
          session = resumeSession(msg.id, this.config, {
            onSubAgentEvent: this.makeSubAgentEventHandler(msg.id),
            mcpManager: this.mcpManager,
          }) ?? undefined
        }

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

      // Send context info if available
      if (session.contextInfo) {
        this.sendToClient(Channel.AI, {
          type: 'context_info',
          sessionId: msg.id,
          globalMemories: session.contextInfo.globalMemories,
          conversationMemories: session.contextInfo.conversationMemories,
          crossConversationMemories: session.contextInfo.crossConversationMemories,
          projectId: session.contextInfo.projectId,
        })
      }

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

    // Add in-memory sessions that aren't persisted yet (exclude project sessions)
    for (const [id, session] of this.sessions) {
      if (!metas.some((m) => m.id === id) && !id.match(/^proj_/)) {
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
    // Extract projectId before deleting so we can update stats
    let projectId: string | undefined
    const session = this.sessions.get(msg.id)
    if (session?.contextInfo?.projectId) {
      projectId = session.contextInfo.projectId
    } else {
      const projMatch = msg.id.match(/^proj_(.+?)_sess_/)
      if (projMatch) projectId = projMatch[1]
    }

    try {
      this.sessions.delete(msg.id)
      this.activeTurns.delete(msg.id)
      deletePersistedSession(msg.id)
    } catch (err: unknown) {
      console.error(`Error destroying session ${msg.id}:`, (err as Error).message)
    }

    this.sendToClient(Channel.AI, {
      type: 'session_destroyed',
      id: msg.id,
    })

    // Update project stats so session count reflects the deletion
    if (projectId) {
      try {
        updateProjectStats(projectId)
        const project = loadProject(projectId)
        if (project) {
          this.sendToClient(Channel.AI, {
            type: 'project_updated',
            project,
          })
        }
      } catch (e) {
        console.warn(`Failed to update project stats after session destroy: ${(e as Error).message}`)
      }
    }

    console.log(`Session destroyed: ${msg.id}`)
  }

  private handleSessionHistory(msg: { id: string }) {
    try {
      // Check if already in memory
      let session = this.sessions.get(msg.id)

      if (!session) {
        // Try loading from disk
        session =
          resumeSession(msg.id, this.config, {
            onSubAgentEvent: this.makeSubAgentEventHandler(msg.id),
            mcpManager: this.mcpManager,
          }) ?? undefined
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

  // ── Project handlers ──────────────────────────────────────────

  private handleProjectCreate(msg: {
    project: { name: string; description?: string; icon?: string; color?: string }
  }) {
    try {
      const project = createProject(msg.project)
      this.sendToClient(Channel.AI, { type: 'project_created', project })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create project: ${(err as Error).message}`,
      })
    }
  }

  private handleProjectsList() {
    const projects = loadProjects()
    this.sendToClient(Channel.AI, { type: 'projects_list_response', projects })
  }

  private handleProjectUpdate(msg: { id: string; changes: Record<string, unknown> }) {
    const updated = updateProject(msg.id, msg.changes as Parameters<typeof updateProject>[1])
    if (updated) {
      this.sendToClient(Channel.AI, { type: 'project_updated', project: updated })
    } else {
      this.sendToClient(Channel.AI, { type: 'error', message: `Project not found: ${msg.id}` })
    }
  }

  private handleProjectDelete(msg: { id: string }) {
    const success = deleteProject(msg.id)
    if (success) {
      this.sendToClient(Channel.AI, { type: 'project_deleted', id: msg.id })
    } else {
      this.sendToClient(Channel.AI, { type: 'error', message: `Project not found: ${msg.id}` })
    }
  }

  private handleProjectSessionsList(msg: { projectId: string }) {
    const persisted = listProjectSessions(msg.projectId)
    const sessions = persisted.map((s) => ({
      id: s.id,
      title: s.title,
      provider: s.provider,
      model: s.model,
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }))

    // Add in-memory project sessions that aren't persisted yet
    const prefix = `proj_${msg.projectId}_sess_`
    for (const [id, session] of this.sessions) {
      if (id.startsWith(prefix) && !persisted.some((s) => s.id === id)) {
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
      type: 'project_sessions_list_response',
      projectId: msg.projectId,
      sessions,
    })
  }

  private handleProjectContextUpdate(msg: { id: string; field: 'notes' | 'summary'; value: string }) {
    const updated = updateProjectContext(msg.id, msg.field, msg.value)
    if (updated) {
      this.sendToClient(Channel.AI, { type: 'project_updated', project: updated })
    } else {
      this.sendToClient(Channel.AI, { type: 'error', message: `Project not found: ${msg.id}` })
    }
  }

  private handleProjectFileUpload(msg: {
    projectId: string
    filename: string
    content: string
    mimeType: string
    sizeBytes: number
  }) {
    try {
      const buffer = Buffer.from(msg.content, 'base64')
      saveProjectFile(msg.projectId, msg.filename, buffer)
      const project = loadProject(msg.projectId)
      if (project) {
        this.sendToClient(Channel.AI, { type: 'project_updated', project })
      }
      this.sendToClient(Channel.AI, {
        type: 'project_files_list_response',
        projectId: msg.projectId,
        files: listProjectFiles(msg.projectId),
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to upload file: ${(err as Error).message}`,
      })
    }
  }

  private handleProjectFileTextCreate(msg: {
    projectId: string
    filename: string
    content: string
  }) {
    try {
      const buffer = Buffer.from(msg.content, 'utf-8')
      saveProjectFile(msg.projectId, msg.filename, buffer)
      const project = loadProject(msg.projectId)
      if (project) {
        this.sendToClient(Channel.AI, { type: 'project_updated', project })
      }
      this.sendToClient(Channel.AI, {
        type: 'project_files_list_response',
        projectId: msg.projectId,
        files: listProjectFiles(msg.projectId),
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create file: ${(err as Error).message}`,
      })
    }
  }

  private handleProjectFileDelete(msg: { projectId: string; filename: string }) {
    const success = deleteProjectFile(msg.projectId, msg.filename)
    if (success) {
      const project = loadProject(msg.projectId)
      if (project) {
        this.sendToClient(Channel.AI, { type: 'project_updated', project })
      }
      this.sendToClient(Channel.AI, {
        type: 'project_files_list_response',
        projectId: msg.projectId,
        files: listProjectFiles(msg.projectId),
      })
    } else {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `File not found: ${msg.filename}`,
      })
    }
  }

  private handleProjectFilesList(msg: { projectId: string }) {
    this.sendToClient(Channel.AI, {
      type: 'project_files_list_response',
      projectId: msg.projectId,
      files: listProjectFiles(msg.projectId),
    })
  }

  // ── Chat message handler ────────────────────────────────────────

  private async handleChatMessage(msg: {
    content: string
    sessionId?: string
    attachments?: { id: string; name: string; mimeType: string; data: string; sizeBytes: number }[]
  }) {
    const sessionId = msg.sessionId || DEFAULT_SESSION_ID

    // Auto-create default session if it doesn't exist
    let session = this.sessions.get(sessionId)
    if (!session) {
      if (sessionId === DEFAULT_SESSION_ID) {
        session = createSession(DEFAULT_SESSION_ID, this.config, {
          onSubAgentEvent: this.makeSubAgentEventHandler(DEFAULT_SESSION_ID),
          mcpManager: this.mcpManager,
        })
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(DEFAULT_SESSION_ID, session)
      } else {
        // Try to resume from disk automatically
        // For project sessions (proj_{projectId}_sess_...), try the project directory first
        let projectId: string | undefined
        const projMatch = sessionId.match(/^proj_(.+?)_sess_/)
        if (projMatch) {
          projectId = projMatch[1]
        }

        session =
          resumeSession(sessionId, this.config, {
            onSubAgentEvent: this.makeSubAgentEventHandler(sessionId),
            mcpManager: this.mcpManager,
            projectId,
            projectContext: projectId ? (() => {
              const project = loadProject(projectId!)
              return project ? buildProjectContext(project, projectId!) : undefined
            })() : undefined,
          }) ?? undefined

        // Also try global sessions as fallback
        if (!session && projectId) {
          session = resumeSession(sessionId, this.config, {
            onSubAgentEvent: this.makeSubAgentEventHandler(sessionId),
            mcpManager: this.mcpManager,
          }) ?? undefined
        }

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
      sessionId,
    })

    console.log(`[${sessionId}] Processing: "${msg.content.slice(0, 50)}"`)

    // Load conversation context on first message (cross-conversation matching uses message text)
    if (!session.contextInfo) {
      const contextInfo = session.loadConversationContext(msg.content)
      if (contextInfo) {
        this.sendToClient(Channel.AI, {
          type: 'context_info',
          sessionId,
          globalMemories: contextInfo.globalMemories,
          conversationMemories: contextInfo.conversationMemories,
          crossConversationMemories: contextInfo.crossConversationMemories,
          projectId: contextInfo.projectId,
        })
      }
    }

    this.activeTurns.add(sessionId)

    try {
      let eventCount = 0
      let accumulatedText = ''
      for await (const event of session.processMessage(msg.content, msg.attachments || [])) {
        // Accumulate text for project context extraction
        if (event.type === 'text') {
          accumulatedText += event.content
        }
        eventCount++

        // Emit granular status updates so the client can show step-by-step progress
        if (event.type === 'tool_call') {
          // Build richer detail: "Running shell: npm test" instead of just "Running shell..."
          const toolEvent = event as { name: string; input?: Record<string, unknown> }
          let toolDetail = `Running ${toolEvent.name}...`
          if (toolEvent.input) {
            const inp = toolEvent.input
            if (toolEvent.name === 'shell' && inp.command) {
              const cmd = String(inp.command).slice(0, 60)
              toolDetail = `Running: ${cmd}`
            } else if (toolEvent.name === 'filesystem' && inp.path) {
              const op = inp.operation || 'reading'
              const file = String(inp.path).split('/').pop()
              toolDetail = `${String(op).charAt(0).toUpperCase()}${String(op).slice(1)} ${file}`
            } else if (toolEvent.name === 'network' && (inp.url || inp.host)) {
              const host = String(inp.url || inp.host).replace(/^https?:\/\//, '').split('/')[0]
              toolDetail = `Fetching ${host}`
            } else if (toolEvent.name === 'browser' && inp.operation) {
              toolDetail = `Browser: ${inp.operation}`
            } else if (toolEvent.name === 'code_search' && inp.query) {
              toolDetail = `Searching: ${String(inp.query).slice(0, 50)}`
            }
          }
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: toolDetail,
            sessionId,
          })
        } else if (event.type === 'thinking') {
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: 'Thinking...',
            sessionId,
          })
        } else if (event.type === 'text') {
          this.sendToClient(Channel.EVENTS, {
            type: 'agent_status',
            status: 'working',
            detail: 'Writing response...',
            sessionId,
          })
        } else if (event.type === 'tasks_update') {
          // Use the activeForm of the current in_progress task as status detail
          const active = (event as { tasks: Array<{ activeForm: string; status: string }> }).tasks
            .find((t) => t.status === 'in_progress')
          if (active) {
            this.sendToClient(Channel.EVENTS, {
              type: 'agent_status',
              status: 'working',
              detail: active.activeForm,
              sessionId,
            })
          }
        }

        this.sendToClient(Channel.AI, { ...event, sessionId } as Record<string, unknown>)
      }
      console.log(`[${sessionId}] Done (${eventCount} events)`)

      // Track session in project history if this is a project session
      const sessionInfo = session.getInfo()
      if (session.projectId && sessionInfo.title) {
        try {
          // Try to extract auto-summarization from [PROJECT_CONTEXT_UPDATE] block
          let sessionSummary = sessionInfo.title
          const ctxMatch = accumulatedText.match(
            /\[PROJECT_CONTEXT_UPDATE\]\s*([\s\S]*?)\s*\[\/PROJECT_CONTEXT_UPDATE\]/,
          )
          if (ctxMatch) {
            try {
              const parsed = JSON.parse(ctxMatch[1])
              if (parsed.sessionSummary) {
                sessionSummary = parsed.sessionSummary
              }
              if (parsed.summary) {
                updateProjectContext(session.projectId, 'summary', parsed.summary)
                const updatedProject = loadProject(session.projectId)
                if (updatedProject) {
                  this.sendToClient(Channel.AI, { type: 'project_updated', project: updatedProject })
                }
              }
            } catch {
              // Malformed JSON — fall back to title
            }
          }

          appendSessionHistory(session.projectId, {
            sessionId: session.id,
            title: sessionInfo.title,
            summary: sessionSummary,
            ts: Date.now(),
          })
          updateProjectStats(session.projectId)
        } catch (e) {
          console.warn(`Failed to update project history: ${(e as Error).message}`)
        }
      }
    } catch (err: unknown) {
      console.error(`[${sessionId}] Error:`, (err as Error).message)
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: (err as Error).message,
        sessionId,
      })
    } finally {
      this.activeTurns.delete(sessionId)
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'agent_status',
      status: 'idle',
      sessionId,
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
      sessionId,
    })
  }

  // ── Sub-agent event forwarding ──────────────────────────────────

  /** Create a callback that forwards sub-agent events to the connected client. */
  private makeSubAgentEventHandler(sessionId: string): SubAgentEventHandler {
    return (event) => {
      this.sendToClient(Channel.AI, { ...event, sessionId })
    }
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

  // ── MCP Connectors ────────────────────────────────────────────────

  private async startMcpConnectors(): Promise<void> {
    const connectors = getConnectors(this.config)
    if (connectors.length === 0) return

    const mcpConfigs: McpServerConfig[] = connectors
      .filter((c) => c.type === 'mcp' && c.command)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        command: c.command!,
        args: c.args || [],
        env: c.env,
        enabled: c.enabled,
      }))

    if (mcpConfigs.length > 0) {
      console.log(`  Starting ${mcpConfigs.length} MCP connector(s)...`)
      await this.mcpManager.startAll(mcpConfigs)
    }
  }

  private connectorToMcpConfig(c: ConnectorConfig): McpServerConfig {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      command: c.command || '',
      args: c.args || [],
      env: c.env,
      enabled: c.enabled,
    }
  }

  private buildConnectorStatus(c: ConnectorConfig) {
    const mcpStatus = this.mcpManager.getStatus().find((s) => s.id === c.id)
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      type: c.type,
      connected: mcpStatus?.connected ?? false,
      enabled: c.enabled,
      toolCount: mcpStatus?.toolCount ?? 0,
      tools: mcpStatus?.tools ?? [],
    }
  }

  private handleConnectorsList(): void {
    const connectors = getConnectors(this.config)
    this.sendToClient(Channel.AI, {
      type: 'connectors_list_response',
      connectors: connectors.map((c) => this.buildConnectorStatus(c)),
    })
  }

  private async handleConnectorAdd(msg: { connector: ConnectorConfig }): Promise<void> {
    try {
      addConnector(this.config, msg.connector)

      if (msg.connector.type === 'mcp' && msg.connector.command) {
        await this.mcpManager.addConnector(this.connectorToMcpConfig(msg.connector))
      }

      this.sendToClient(Channel.AI, {
        type: 'connector_added',
        connector: this.buildConnectorStatus(msg.connector),
      })
      console.log(`Connector added: ${msg.connector.id} (${msg.connector.name})`)
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to add connector: ${(err as Error).message}`,
      })
    }
  }

  private async handleConnectorUpdate(msg: { id: string; changes: Partial<ConnectorConfig> }): Promise<void> {
    try {
      const updated = updateConnectorConfig(this.config, msg.id, msg.changes)
      if (!updated) {
        this.sendToClient(Channel.AI, { type: 'error', message: `Connector not found: ${msg.id}` })
        return
      }

      if (updated.type === 'mcp' && updated.command) {
        await this.mcpManager.removeConnector(msg.id)
        await this.mcpManager.addConnector(this.connectorToMcpConfig(updated))
      }

      this.sendToClient(Channel.AI, {
        type: 'connector_updated',
        connector: this.buildConnectorStatus(updated),
      })
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to update connector: ${(err as Error).message}`,
      })
    }
  }

  private async handleConnectorRemove(msg: { id: string }): Promise<void> {
    try {
      await this.mcpManager.removeConnector(msg.id)
      removeConnectorConfig(this.config, msg.id)
      this.sendToClient(Channel.AI, { type: 'connector_removed', id: msg.id })
      console.log(`Connector removed: ${msg.id}`)
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to remove connector: ${(err as Error).message}`,
      })
    }
  }

  private async handleConnectorToggle(msg: { id: string; enabled: boolean }): Promise<void> {
    try {
      toggleConnectorConfig(this.config, msg.id, msg.enabled)
      await this.mcpManager.toggleConnector(msg.id, msg.enabled)

      const connector = getConnectors(this.config).find((c) => c.id === msg.id)
      if (connector) {
        this.sendToClient(Channel.AI, {
          type: 'connector_status',
          id: msg.id,
          connected: this.mcpManager.isConnected(msg.id),
          toolCount: this.mcpManager.getStatus().find((s) => s.id === msg.id)?.toolCount ?? 0,
        })
      }
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'connector_status',
        id: msg.id,
        connected: false,
        toolCount: 0,
        error: (err as Error).message,
      })
    }
  }

  private async handleConnectorTest(msg: { id: string }): Promise<void> {
    try {
      const result = await this.mcpManager.testConnector(msg.id)
      this.sendToClient(Channel.AI, {
        type: 'connector_test_response',
        id: msg.id,
        ...result,
      })
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'connector_test_response',
        id: msg.id,
        success: false,
        tools: [],
        error: (err as Error).message,
      })
    }
  }

  private handleConnectorRegistryList(): void {
    this.sendToClient(Channel.AI, {
      type: 'connector_registry_list_response',
      entries: CONNECTOR_REGISTRY,
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
