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

import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join } from 'node:path'
import type { AgentConfig } from '@anton/agent-config'
import {
  addProjectPreference,
  appendMessageToSession,
  appendSessionHistory,
  buildProjectContext,
  cleanExpiredSessions,
  createProject,
  deleteSession as deletePersistedSession,
  deleteProject,
  deleteProjectFile,
  deleteProjectPreference,
  ensureDefaultProject,
  getAntonDir,
  getConversationMemoryDir,
  getGlobalMemoryDir,
  getProjectSessionsDir,
  getProvidersList,
  listProjectFiles,
  listProjectSessions,
  listProjectWorkflows,
  listSessionMetas,
  loadAgentMetadata,
  loadProject,
  loadProjectInstructions,
  loadProjectPreferences,
  loadProjects,
  loadUserRules,
  saveConfig,
  saveProjectFile,
  saveProjectInstructions,
  setDefault,
  setProviderKey,
  setProviderModels,
  updateProject,
  updateProjectContext,
  updateProjectStats,
} from '@anton/agent-config'
import { GIT_HASH, VERSION } from '@anton/agent-config'
import {
  CONNECTOR_REGISTRY,
  type ConnectorConfig,
  addConnector,
  getConnectors,
  removeConnector as removeConnectorConfig,
  toggleConnector as toggleConnectorConfig,
  updateConnector as updateConnectorConfig,
} from '@anton/agent-config'
import {
  McpManager,
  type McpServerConfig,
  type Session,
  type SubAgentEventHandler,
  createSession,
  executePublish,
  resumeSession,
} from '@anton/agent-core'
import { CONNECTOR_FACTORIES, ConnectorManager } from '@anton/connectors'
import { Channel, decodeFrame, encodeFrame, parseJsonPayload } from '@anton/protocol'
import type { AiMessage, ChannelId, ControlMessage, TerminalMessage } from '@anton/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import { OAuthFlow, TokenStore, oauthCallbackHandler } from './oauth/index.js'
import type { Scheduler } from './scheduler.js'
import { TelegramBotHandler } from './telegram-bot.js'
import { Updater } from './updater.js'
import {
  getBuiltinWorkflowPath,
  listBuiltinWorkflows,
  loadBuiltinManifest,
} from './workflows/builtin-registry.js'
import { buildWorkflowAgentContext } from './workflows/workflow-context.js'
import { WorkflowInstaller } from './workflows/workflow-installer.js'

const DEFAULT_SESSION_ID = 'default'

/**
 * Buffers text chunks from the AI stream and flushes them on a timer (~80ms)
 * or immediately before any non-text event. This coalesces many small token-level
 * WS frames into fewer, larger updates (~12/sec instead of 30-50+).
 */
class TextStreamBuffer {
  private pending = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly INTERVAL_MS = 80
  private destroyed = false

  constructor(private send: (text: string) => void) {}

  /** Accumulate a text chunk. Starts the flush timer if not already running. */
  push(text: string): void {
    if (this.destroyed) return
    this.pending += text
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.INTERVAL_MS)
    }
  }

  /** Send whatever is buffered now. Safe to call anytime (no-ops if empty). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending) {
      this.send(this.pending)
      this.pending = ''
    }
  }

  /** Flush remaining text, clear timer, prevent further use. */
  destroy(): void {
    if (this.destroyed) return
    this.flush()
    this.destroyed = true
    this.send = () => {}
  }
}

export class AgentServer {
  private wss: WebSocketServer | null = null
  private config: AgentConfig
  private sessions: Map<string, Session> = new Map()
  private activeTurns: Set<string> = new Set() // sessions currently processing a turn
  private activeClient: WebSocket | null = null
  // Track pending interactive prompts so they can be re-sent on client reconnect
  private pendingPrompts: Map<string, { type: string; payload: Record<string, unknown> }> =
    new Map()
  // Resolvers for pending interactive prompts — keyed by prompt ID
  private promptResolvers: Map<string, (msg: AiMessage) => void> = new Map()
  private scheduler: Scheduler | null = null
  private agentManager: import('./agents/agent-manager.js').AgentManager | null = null
  private updater: Updater = new Updater()
  private mcpManager: McpManager = new McpManager()
  private oauthFlow: OAuthFlow
  private tokenStore: TokenStore
  private connectorManager: ConnectorManager
  private telegramBot: TelegramBotHandler | null = null
  private ptys: Map<string, ChildProcess> = new Map()

  constructor(config: AgentConfig) {
    this.config = config

    // Initialize OAuth infrastructure
    this.tokenStore = new TokenStore(getAntonDir(), config.token)
    this.oauthFlow = new OAuthFlow(config, this.tokenStore)
    this.connectorManager = new ConnectorManager(CONNECTOR_FACTORIES, (provider) =>
      this.oauthFlow.getToken(provider),
    )

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

  /** Graceful shutdown: stop MCP servers, close connections, release resources. */
  async shutdown(): Promise<void> {
    try {
      await this.mcpManager.stopAll()
      console.log('[server] MCP servers stopped')
    } catch (err) {
      console.error('[server] Error stopping MCP servers:', err)
    }
    // Kill any active PTY sessions
    for (const [id, pty] of this.ptys) {
      try {
        pty.kill()
      } catch {
        /* best-effort */
      }
      this.ptys.delete(id)
    }
  }

  setAgentManager(agentManager: import('./agents/agent-manager.js').AgentManager) {
    this.agentManager = agentManager

    // Wire sendMessage — each agent run creates a fresh ephemeral session
    agentManager.setSendMessageHandler(
      async (agentSessionId, content, agentInstructions, agentMemory) => {
        // Generate a unique session ID for this run
        const runSessionId = `agent-run--${agentSessionId}--${Date.now().toString(36)}`

        // Extract projectId from agent session ID
        const projectId = this.extractProjectId(agentSessionId)

        // Create a fresh session — agent runs are autonomous, no onJobAction needed
        const session = createSession(runSessionId, this.config, {
          ...this.buildSessionOptions(runSessionId, projectId, {
            agentInstructions,
            agentMemory: agentMemory ?? undefined,
          }),
          onJobAction: undefined, // agent runs don't manage other agents
        })

        // Agent sessions are autonomous — auto-approve everything
        this.wireAgentAutoHandlers(session)
        this.sessions.set(runSessionId, session)

        console.log(`[AgentRun] Created fresh session ${runSessionId} for agent ${agentSessionId}`)

        let eventCount = 0
        let summary = ''

        try {
          // Run the conversation
          eventCount = await this.handleChatMessage({ content, sessionId: runSessionId })

          console.log(`[AgentRun] ${runSessionId}: ${eventCount} events produced`)

          // Extract summary from the last assistant text
          try {
            const history = session.getHistory()
            console.log(
              `[AgentRun] ${runSessionId}: ${history.length} history entries, roles: ${history.map((h) => h.role).join(',')}`,
            )
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].role === 'assistant' && history[i].content) {
                summary = String(history[i].content).slice(0, 2000)
                break
              }
            }
          } catch (extractErr) {
            console.warn('[AgentRun] Summary extraction failed:', extractErr)
          }
        } catch (err) {
          console.error(`[AgentRun] Failed for ${agentSessionId}:`, err)
          throw err
        } finally {
          // Always clean up cached session (persisted to disk by the session itself)
          this.sessions.delete(runSessionId)
        }

        return { eventCount, summary, runSessionId }
      },
    )
  }

  async start(): Promise<void> {
    const { port } = this.config
    const tlsPort = port + 1

    // ── Primary: plain WS on config.port (default 9876) ──
    const plainServer = createHttpServer((req, res) => {
      // OAuth callback from the proxy
      if (req.method === 'POST' && req.url === '/_anton/oauth/callback') {
        oauthCallbackHandler(req, res, this.oauthFlow, (result) => {
          this.handleOAuthComplete(result)
        })
        return
      }

      if (req.method === 'POST' && req.url === '/_anton/telegram/webhook') {
        if (this.telegramBot) {
          this.telegramBot.handle(req, res)
        } else {
          res.writeHead(404)
          res.end('Telegram bot not configured')
        }
        return
      }

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

    // Start update checker — broadcast to connected client when periodic check finds new version
    this.updater.onUpdateFound = (manifest) => {
      this.sendToClient(Channel.EVENTS, {
        type: 'update_available',
        currentVersion: VERSION,
        latestVersion: manifest.version,
        changelog: manifest.changelog,
        releaseUrl: manifest.releaseUrl,
      })
    }
    this.updater.start()

    // Start MCP connectors
    await this.startMcpConnectors()

    // Activate OAuth connectors that have stored tokens
    await this.startOAuthConnectors()

    // Activate API connectors with stored tokens from config or env
    this.startApiConnectors()

    // Start Telegram bot if token is configured
    await this.startTelegramBot()

    console.log(`\n  Agent ID: ${this.config.agentId}`)
    console.log(`  Token:    ${this.config.token}\n`)

    // Log all stored sessions for debugging sync issues
    this.logStoredSessions()
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
                status: this.pendingPrompts.size > 0 ? 'working' : 'idle',
              })

              // Re-send any pending interactive prompts (ask_user, confirm, etc.)
              for (const [, prompt] of this.pendingPrompts) {
                this.sendToClient(Channel.AI, prompt.payload)
              }
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
        // If there are pending interactive prompts (ask_user, confirm), don't cancel
        // those turns — the user just needs to reconnect and answer
        if (this.pendingPrompts.size > 0) {
          console.log(
            `Client disconnected — ${this.pendingPrompts.size} pending prompt(s), keeping turns alive`,
          )
        } else {
          // Cancel interactive turns but keep background work (sub-agents, agent jobs) alive
          for (const sessionId of this.activeTurns) {
            // Sub-agent sessions (sub_*) and agent sessions continue in background
            if (
              sessionId.startsWith('sub_') ||
              sessionId.startsWith('agent-job-') ||
              sessionId.startsWith('agent--')
            ) {
              console.log(`Keeping background turn alive: ${sessionId}`)
              continue
            }
            const session = this.sessions.get(sessionId)
            if (session) {
              console.log(`Cancelling active turn for session ${sessionId}`)
              session.cancel()
            }
          }
          // Only clear non-background turns
          for (const sessionId of this.activeTurns) {
            if (
              !sessionId.startsWith('sub_') &&
              !sessionId.startsWith('agent-job-') &&
              !sessionId.startsWith('agent--')
            ) {
              this.activeTurns.delete(sessionId)
            }
          }
        }
        // Kill all PTY sessions
        for (const [id, p] of this.ptys) {
          try {
            p.kill('SIGTERM')
          } catch {}
          this.ptys.delete(id)
        }
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
        this.handleConfigQuery(msg.key, msg.sessionId, msg.projectId)
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

  private handleConfigQuery(key: string, sessionId?: string, projectId?: string) {
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
      case 'system_prompt': {
        // If a session is active, return the full composed prompt (what the model actually sees)
        if (sessionId) {
          const session = this.sessions.get(sessionId)
          if (session) {
            value = session.getComposedSystemPrompt()
            break
          }
        }
        // Fallback: base prompt + user rules (no session context)
        // loadCoreSystemPrompt() writes to disk on every call — read the file directly instead
        const promptPath = join(getAntonDir(), 'prompts', 'system.md')
        const base = existsSync(promptPath)
          ? readFileSync(promptPath, 'utf-8')
          : '(system prompt not found)'
        const userRules = loadUserRules()
        value = userRules ? `${base}\n\n${userRules}` : base
        break
      }
      case 'memories': {
        // Global memories
        const globalDir = getGlobalMemoryDir()
        const memories: {
          name: string
          content: string
          scope: 'global' | 'conversation' | 'project'
        }[] = []
        try {
          const files = readdirSync(globalDir).filter((f) => f.endsWith('.md'))
          for (const f of files) {
            memories.push({
              name: f,
              content: readFileSync(join(globalDir, f), 'utf-8'),
              scope: 'global',
            })
          }
        } catch {
          /* no global memories */
        }

        // Conversation-scoped memories (if sessionId provided)
        if (sessionId) {
          const convMemDir = getConversationMemoryDir(sessionId)
          try {
            const files = readdirSync(convMemDir).filter((f) => f.endsWith('.md'))
            for (const f of files) {
              memories.push({
                name: f,
                content: readFileSync(join(convMemDir, f), 'utf-8'),
                scope: 'conversation',
              })
            }
          } catch {
            /* no conversation memories */
          }
        }

        // Project-scoped context (if projectId provided)
        if (projectId) {
          const project = loadProject(projectId)
          if (project) {
            // Project notes as a memory entry
            if (project.context.notes) {
              memories.push({
                name: 'project-notes.md',
                content: `# Project Notes\n\n${project.context.notes}`,
                scope: 'project',
              })
            }
            // Project summary as a memory entry
            if (project.context.summary) {
              memories.push({
                name: 'project-summary.md',
                content: `# Project Summary\n\n${project.context.summary}`,
                scope: 'project',
              })
            }
          }
        }
        value = memories
        break
      }
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
        case 'onboarding':
          this.config.onboarding = value as typeof this.config.onboarding
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
      console.log(`[update] ${progress.stage}: ${progress.message}`)
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
          try {
            existing.kill('SIGTERM')
          } catch {}
          this.ptys.delete(msg.id)
        }

        const shell = msg.shell || process.env.SHELL || '/bin/bash'
        const cols = msg.cols || 80
        const rows = msg.rows || 24

        const p = spawn(shell, ['-i'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: msg.cwd || process.env.HOME || '/',
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLUMNS: String(cols),
            LINES: String(rows),
          },
        })

        this.ptys.set(msg.id, p)

        const onData = (data: Buffer) => {
          const b64 = data.toString('base64')
          this.sendToClient(Channel.TERMINAL, { type: 'pty_data', id: msg.id, data: b64 })
        }

        p.stdout?.on('data', onData)
        p.stderr?.on('data', onData)

        p.on('exit', () => {
          this.ptys.delete(msg.id)
          this.sendToClient(Channel.TERMINAL, { type: 'pty_close', id: msg.id })
        })

        console.log(`PTY spawned: ${msg.id} (${shell})`)
        break
      }

      case 'pty_data': {
        const p = this.ptys.get(msg.id)
        if (p?.stdin?.writable) {
          const decoded = Buffer.from(msg.data, 'base64').toString('binary')
          p.stdin.write(decoded)
        }
        break
      }

      case 'pty_resize': {
        // child_process doesn't support resize — ignored for now
        break
      }

      case 'pty_close': {
        const p = this.ptys.get(msg.id)
        if (p) {
          try {
            p.kill('SIGTERM')
          } catch {}
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

      case 'sessions_list':
        this.handleSessionsList()
        break

      case 'usage_stats':
        this.handleUsageStats()
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
      case 'project_instructions_get':
        this.handleProjectInstructionsGet(msg)
        break
      case 'project_instructions_save':
        this.handleProjectInstructionsSave(msg)
        break
      case 'project_preferences_get':
        this.handleProjectPreferencesGet(msg)
        break
      case 'project_preference_add':
        this.handleProjectPreferenceAdd(msg)
        break
      case 'project_preference_delete':
        this.handleProjectPreferenceDelete(msg)
        break

      // ── Agents ──
      case 'agent_create':
        this.handleAgentCreate(msg)
        break
      case 'agents_list':
        this.handleAgentsList(msg)
        break
      case 'agent_action':
        this.handleAgentAction(msg)
        break
      case 'agent_run_logs':
        this.handleAgentRunLogs(msg)
        break

      // ── Workflows ──
      case 'workflow_registry_list':
        this.handleWorkflowRegistryList()
        break
      case 'workflow_check_connectors':
        this.handleWorkflowCheckConnectors(msg)
        break
      case 'workflow_install':
        this.handleWorkflowInstall(msg)
        break
      case 'workflows_list':
        this.handleWorkflowsList(msg)
        break
      case 'workflow_uninstall':
        this.handleWorkflowUninstall(msg)
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
      case 'connector_oauth_start':
        this.handleConnectorOAuthStart(msg)
        break
      case 'connector_oauth_disconnect':
        this.handleConnectorOAuthDisconnect(msg)
        break

      // ── Publish artifacts ──
      case 'publish_artifact':
        this.handlePublishArtifact(msg)
        break

      // ── Chat messages ──
      case 'message':
        await this.handleChatMessage(msg)
        break

      // ── Steering: user sends a message while the agent is working ──
      case 'steer': {
        const steerSessionId = msg.sessionId || DEFAULT_SESSION_ID
        const steerSession = this.sessions.get(steerSessionId)
        if (steerSession && this.activeTurns.has(steerSessionId)) {
          steerSession.steer(msg.content)
          this.sendToClient(Channel.AI, {
            type: 'steer_ack',
            content: msg.content,
            sessionId: steerSessionId,
          })
          console.log(`[${steerSessionId}] Steering: "${msg.content.slice(0, 60)}"`)
        } else {
          // Session not active — treat as a regular message
          await this.handleChatMessage({ content: msg.content, sessionId: msg.sessionId })
        }
        break
      }

      // ── Cancel turn: user clicks stop button ──
      case 'cancel_turn': {
        const cancelSessionId = msg.sessionId || DEFAULT_SESSION_ID
        const cancelSession = this.sessions.get(cancelSessionId)
        if (cancelSession && this.activeTurns.has(cancelSessionId)) {
          console.log(`[${cancelSessionId}] Cancelling turn via client request`)
          cancelSession.cancel()
        }
        break
      }

      // ── Confirm response (forwarded to active session) ──
      case 'confirm_response':
        if (msg.id && this.promptResolvers.has(msg.id)) {
          this.promptResolvers.get(msg.id)!(msg)
        }
        break

      // ── Ask-user response (forwarded to active session) ──
      case 'ask_user_response':
        if (msg.id && this.promptResolvers.has(msg.id)) {
          this.promptResolvers.get(msg.id)!(msg)
        }
        break

      // ── Plan confirm response ──
      case 'plan_confirm_response':
        if (msg.id && this.promptResolvers.has(msg.id)) {
          this.promptResolvers.get(msg.id)!(msg)
        }
        break
    }
  }

  // ── Publish handler ─────────────────────────────────────────────

  private handlePublishArtifact(msg: {
    artifactId: string
    title: string
    content: string
    contentType: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
    language?: string
    slug?: string
  }) {
    try {
      const result = executePublish(
        {
          title: msg.title,
          content: msg.content,
          type: msg.contentType,
          language: msg.language,
          slug: msg.slug,
        },
        process.env.DOMAIN,
      )

      // Extract slug and URL from the result string
      const urlMatch = result.match(/→ (.+)$/)
      const publicUrl = urlMatch?.[1] || ''
      const slugMatch = publicUrl.match(/\/a\/([^/]+)$/)
      const slug = slugMatch?.[1] || msg.slug || ''

      this.sendToClient(Channel.AI, {
        type: 'publish_artifact_response',
        artifactId: msg.artifactId,
        publicUrl,
        slug,
        success: true,
      })

      // Also emit as event for real-time UI updates
      this.sendToClient(Channel.EVENTS, {
        type: 'artifact_published',
        artifactId: msg.artifactId,
        slug,
        publicUrl,
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'publish_artifact_response',
        artifactId: msg.artifactId,
        publicUrl: '',
        slug: '',
        success: false,
        error: (err as Error).message,
      })
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
      const session = createSession(
        msg.id,
        this.config,
        this.buildSessionOptions(msg.id, msg.projectId, {
          provider: msg.provider,
          model: msg.model,
          apiKey: msg.apiKey,
          domain: process.env.DOMAIN,
        }),
      )

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

      // Update project stats so session count is accurate
      if (msg.projectId) {
        updateProjectStats(msg.projectId)
        const updatedProject = loadProject(msg.projectId)
        if (updatedProject) {
          this.sendToClient(Channel.AI, { type: 'project_updated', project: updatedProject })
        }
      }

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

      console.log(
        `Session created: ${msg.id} (${session.provider}/${session.model})${msg.projectId ? ` [project: ${msg.projectId}]` : ''}`,
      )
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create session: ${(err as Error).message}`,
        sessionId: msg.id,
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
      usage: m.usage,
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
          usage: info.usage,
        })
      }
    }

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    this.sendToClient(Channel.AI, {
      type: 'sessions_list_response',
      sessions,
    })
  }

  private handleUsageStats() {
    const metas = listSessionMetas()

    // Build a map of in-memory sessions (these have live usage data)
    const inMemoryMap = new Map<string, ReturnType<Session['getInfo']>>()
    for (const [id, session] of this.sessions) {
      if (!id.match(/^proj_/)) {
        inMemoryMap.set(id, session.getInfo())
      }
    }

    type UsageEntry = {
      id: string
      title: string
      provider: string
      model: string
      createdAt: number
      lastActiveAt: number
      usage?: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
      }
    }

    // Start from persisted metas, but prefer in-memory usage when available
    const allSessions: UsageEntry[] = metas.map((m) => {
      const live = inMemoryMap.get(m.id)
      return {
        id: m.id,
        title: live?.title ?? m.title,
        provider: live?.provider ?? m.provider,
        model: live?.model ?? m.model,
        createdAt: m.createdAt,
        lastActiveAt: live?.lastActiveAt ?? m.lastActiveAt,
        usage: live?.usage ?? m.usage, // prefer live in-memory usage over persisted
      }
    })

    // Add in-memory sessions not yet persisted
    for (const [id, info] of inMemoryMap) {
      if (!metas.some((m) => m.id === id)) {
        allSessions.push({
          id: info.id,
          title: info.title,
          provider: info.provider,
          model: info.model,
          createdAt: info.createdAt,
          lastActiveAt: info.lastActiveAt,
          usage: info.usage,
        })
      }
    }

    // Compute totals
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const modelMap = new Map<
      string,
      {
        provider: string
        inputTokens: number
        outputTokens: number
        totalTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
        sessionCount: number
      }
    >()
    const dayMap = new Map<
      string,
      { inputTokens: number; outputTokens: number; totalTokens: number; sessionCount: number }
    >()

    for (const s of allSessions) {
      if (!s.usage) continue
      totals.inputTokens += s.usage.inputTokens
      totals.outputTokens += s.usage.outputTokens
      totals.totalTokens += s.usage.totalTokens
      totals.cacheReadTokens += s.usage.cacheReadTokens
      totals.cacheWriteTokens += s.usage.cacheWriteTokens

      // By model
      const existing = modelMap.get(s.model)
      if (existing) {
        existing.inputTokens += s.usage.inputTokens
        existing.outputTokens += s.usage.outputTokens
        existing.totalTokens += s.usage.totalTokens
        existing.cacheReadTokens += s.usage.cacheReadTokens
        existing.cacheWriteTokens += s.usage.cacheWriteTokens
        existing.sessionCount++
      } else {
        modelMap.set(s.model, {
          provider: s.provider,
          inputTokens: s.usage.inputTokens,
          outputTokens: s.usage.outputTokens,
          totalTokens: s.usage.totalTokens,
          cacheReadTokens: s.usage.cacheReadTokens,
          cacheWriteTokens: s.usage.cacheWriteTokens,
          sessionCount: 1,
        })
      }

      // By day
      const date = new Date(s.createdAt).toISOString().slice(0, 10)
      const dayEntry = dayMap.get(date)
      if (dayEntry) {
        dayEntry.inputTokens += s.usage.inputTokens
        dayEntry.outputTokens += s.usage.outputTokens
        dayEntry.totalTokens += s.usage.totalTokens
        dayEntry.sessionCount++
      } else {
        dayMap.set(date, {
          inputTokens: s.usage.inputTokens,
          outputTokens: s.usage.outputTokens,
          totalTokens: s.usage.totalTokens,
          sessionCount: 1,
        })
      }
    }

    // Sort sessions by most recent, include only those with usage
    const sessions = allSessions
      .filter((s) => s.usage && s.usage.totalTokens > 0)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        provider: s.provider,
        model: s.model,
        createdAt: s.createdAt,
        totalTokens: s.usage!.totalTokens,
        inputTokens: s.usage!.inputTokens,
        outputTokens: s.usage!.outputTokens,
      }))

    const byModel = Array.from(modelMap.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.totalTokens - a.totalTokens)

    const byDay = Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date))

    this.sendToClient(Channel.AI, {
      type: 'usage_stats_response',
      totals,
      byModel,
      byDay,
      sessions,
    })
  }

  private handleSessionDestroy(msg: { id: string }) {
    // Extract projectId before deleting so we can update stats
    const session = this.sessions.get(msg.id)
    const projectId = session?.contextInfo?.projectId ?? this.extractProjectId(msg.id)

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
        console.warn(
          `Failed to update project stats after session destroy: ${(e as Error).message}`,
        )
      }
    }

    console.log(`Session destroyed: ${msg.id}`)
  }

  private handleSessionHistory(msg: { id: string; before?: number; limit?: number }) {
    try {
      // Check if already in memory
      let session = this.sessions.get(msg.id)

      if (!session) {
        const projectId = this.extractProjectId(msg.id)

        // Try loading from disk (project dir first, then global fallback)
        session =
          resumeSession(msg.id, this.config, this.buildSessionOptions(msg.id, projectId)) ??
          undefined

        // Fallback to global sessions dir if project-scoped lookup failed
        if (!session && projectId) {
          session =
            resumeSession(msg.id, this.config, this.buildSessionOptions(msg.id)) ?? undefined
        }

        if (!session) {
          this.sendToClient(Channel.AI, {
            type: 'error',
            code: 'session_not_found',
            message: `Session not found: ${msg.id}`,
            sessionId: msg.id,
          })
          return
        }
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(msg.id, session)
      }

      const limit = msg.limit ?? 200
      const isFirstPage = msg.before === undefined

      // Get full history to compute totalCount and lastSeq
      const fullHistory = session.getHistory()
      const totalCount = fullHistory.length
      const lastSeq = totalCount > 0 ? fullHistory[totalCount - 1].seq : 0

      // Get paginated page
      const page = session.getHistory({ before: msg.before, limit })
      const hasMore = page.length > 0 && page[0].seq > 1

      console.log(
        `[Session history] ${msg.id}: sending ${page.length}/${totalCount} entries` +
          ` (lastSeq=${lastSeq}, hasMore=${hasMore}, before=${msg.before ?? 'latest'})`,
      )

      // On first page, include artifacts extracted from full history
      const artifacts = isFirstPage ? session.getArtifacts() : undefined

      this.sendToClient(Channel.AI, {
        type: 'session_history_response',
        id: msg.id,
        messages: page,
        lastSeq,
        totalCount,
        hasMore,
        artifacts,
      })

      // Restore task state after history
      const sessionInfo = session.getInfo()
      if (sessionInfo.lastTasks && sessionInfo.lastTasks.length > 0) {
        this.sendToClient(Channel.AI, {
          type: 'tasks_update',
          tasks: sessionInfo.lastTasks,
          sessionId: msg.id,
        })
      }
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to get session history: ${(err as Error).message}`,
        sessionId: msg.id,
      })
    }
  }

  // ── Provider handlers ───────────────────────────────────────────

  private handleProvidersList() {
    this.sendToClient(Channel.AI, {
      type: 'providers_list_response',
      providers: getProvidersList(this.config),
      defaults: this.config.defaults,
      onboarding: this.config.onboarding,
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

  // ── Agent handlers ─────────────────────────────────────────────

  private handleAgentCreate(msg: { projectId: string; agent: Record<string, unknown> }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, { type: 'error', message: 'Agent manager not initialized' })
      return
    }
    try {
      const spec = msg.agent as {
        name: string
        description?: string
        instructions: string
        schedule?: string
        originConversationId?: string
      }
      const agent = this.agentManager.createAgent(msg.projectId, spec)
      this.sendToClient(Channel.AI, { type: 'agent_created', agent })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, { type: 'error', message: (err as Error).message })
    }
  }

  private handleAgentsList(msg: { projectId: string }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, {
        type: 'agents_list_response',
        projectId: msg.projectId,
        agents: [],
      })
      return
    }
    const agents = this.agentManager.listAgents(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'agents_list_response',
      projectId: msg.projectId,
      agents,
    })
  }

  private handleAgentAction(msg: { projectId: string; sessionId: string; action: string }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, { type: 'error', message: 'Agent manager not initialized' })
      return
    }

    switch (msg.action) {
      case 'start':
        this.agentManager.runAgent(msg.sessionId, 'manual')
        break
      case 'stop': {
        const agent = this.agentManager.stopAgent(msg.sessionId)
        if (agent) this.sendToClient(Channel.AI, { type: 'agent_updated', agent })
        break
      }
      case 'pause': {
        const agent = this.agentManager.pauseAgent(msg.sessionId)
        if (agent) this.sendToClient(Channel.AI, { type: 'agent_updated', agent })
        break
      }
      case 'resume': {
        const agent = this.agentManager.resumeAgent(msg.sessionId)
        if (agent) this.sendToClient(Channel.AI, { type: 'agent_updated', agent })
        break
      }
      case 'delete':
        if (this.agentManager.deleteAgent(msg.sessionId)) {
          this.sendToClient(Channel.AI, {
            type: 'agent_deleted',
            projectId: msg.projectId,
            sessionId: msg.sessionId,
          })
        } else {
          this.sendToClient(Channel.AI, {
            type: 'error',
            message: `Agent not found: ${msg.sessionId}`,
          })
        }
        break
      default:
        this.sendToClient(Channel.AI, { type: 'error', message: `Unknown action: ${msg.action}` })
    }
  }

  private handleAgentRunLogs(msg: {
    projectId: string
    sessionId: string
    runSessionId?: string
    startedAt: number
    completedAt: number
  }) {
    try {
      // Use the run's own session ID if available (new architecture: each run = fresh session)
      const targetSessionId = msg.runSessionId || msg.sessionId
      let session = this.sessions.get(targetSessionId)

      if (!session) {
        const projectId = this.extractProjectId(targetSessionId) || msg.projectId

        session =
          resumeSession(
            targetSessionId,
            this.config,
            this.buildSessionOptions(targetSessionId, projectId),
          ) ?? undefined

        if (!session) {
          this.sendToClient(Channel.AI, {
            type: 'agent_run_logs_response',
            sessionId: msg.sessionId,
            logs: [],
          })
          return
        }
      }

      // Get full history — for run-specific sessions, return everything (no time filtering needed)
      const fullHistory = session.getHistory()
      const logs = fullHistory.map((entry) => ({
        ts: entry.ts,
        role: entry.role as 'user' | 'assistant' | 'tool_call' | 'tool_result',
        content: typeof entry.content === 'string' ? entry.content.slice(0, 2000) : '',
        toolName: entry.toolName,
        toolInput: entry.toolInput ? JSON.stringify(entry.toolInput).slice(0, 500) : undefined,
        isError: entry.isError,
      }))

      this.sendToClient(Channel.AI, {
        type: 'agent_run_logs_response',
        sessionId: msg.sessionId,
        logs,
      })
    } catch (err) {
      console.error('Failed to get agent run logs:', err)
      this.sendToClient(Channel.AI, {
        type: 'agent_run_logs_response',
        sessionId: msg.sessionId,
        logs: [],
      })
    }
  }

  /** Wire autonomous handlers for agent sessions — auto-approve everything, no user interaction needed */
  /**
   * Build the available workflows catalog for system prompt injection.
   * Loaded once from builtin registry, cached for the server lifetime.
   */
  private _workflowCatalog: { name: string; description: string; whenToUse: string }[] | null = null
  private getAvailableWorkflowsForPrompt(): {
    name: string
    description: string
    whenToUse: string
  }[] {
    if (!this._workflowCatalog) {
      const entries = listBuiltinWorkflows()
      this._workflowCatalog = entries
        .map((e) => {
          const manifest = loadBuiltinManifest(e.id)
          return {
            name: e.name,
            description: e.description,
            whenToUse: manifest?.whenToUse || e.description,
          }
        })
        .filter((w) => w.whenToUse.length > 0)
    }
    return this._workflowCatalog
  }

  // ── Workflow handlers ──────────────────────────────────────────────

  private handleWorkflowRegistryList() {
    const entries = listBuiltinWorkflows()
    this.sendToClient(Channel.AI, { type: 'workflow_registry_list_response', entries })
  }

  private handleWorkflowCheckConnectors(msg: { workflowId: string }) {
    const manifest = loadBuiltinManifest(msg.workflowId)
    if (!manifest) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Workflow "${msg.workflowId}" not found in registry`,
      })
      return
    }

    // Get list of currently active connector IDs
    const activeConnectors = this.connectorManager ? this.connectorManager.getActiveIds() : []

    const satisfied = manifest.connectors.required.filter((c) => activeConnectors.includes(c))
    const missing = manifest.connectors.required.filter((c) => !activeConnectors.includes(c))
    const optional = manifest.connectors.optional.map((c) => ({
      id: c,
      connected: activeConnectors.includes(c),
    }))

    this.sendToClient(Channel.AI, {
      type: 'workflow_check_connectors_response',
      workflowId: msg.workflowId,
      manifest,
      satisfied,
      missing,
      optional,
    })
  }

  private handleWorkflowInstall(msg: {
    projectId: string
    workflowId: string
    userInputs: Record<string, unknown>
  }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: 'Agent manager not available',
      })
      return
    }

    const sourcePath = getBuiltinWorkflowPath(msg.workflowId)
    if (!sourcePath) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Workflow "${msg.workflowId}" not found`,
      })
      return
    }

    const manifest = loadBuiltinManifest(msg.workflowId)
    if (!manifest) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Cannot load manifest for "${msg.workflowId}"`,
      })
      return
    }

    try {
      const installer = new WorkflowInstaller(this.agentManager)
      const installed = installer.install(
        msg.projectId,
        msg.workflowId,
        sourcePath,
        manifest,
        msg.userInputs,
      )
      this.sendToClient(Channel.AI, { type: 'workflow_installed', workflow: installed })
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  private handleWorkflowsList(msg: { projectId: string }) {
    const workflows = listProjectWorkflows(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'workflows_list_response',
      projectId: msg.projectId,
      workflows,
    })
  }

  private handleWorkflowUninstall(msg: { projectId: string; workflowId: string }) {
    if (!this.agentManager) return

    const installer = new WorkflowInstaller(this.agentManager)
    const success = installer.uninstall(msg.projectId, msg.workflowId)
    if (success) {
      this.sendToClient(Channel.AI, {
        type: 'workflow_uninstalled',
        projectId: msg.projectId,
        workflowId: msg.workflowId,
      })
    }
  }

  private wireAgentAutoHandlers(session: Session) {
    session.setConfirmHandler(async (_command, _reason) => {
      console.log(`[${session.id}] Agent auto-approved confirm: ${_command}`)
      return true
    })
    session.setPlanConfirmHandler(async (_title, _content) => {
      return { approved: true, feedback: '' }
    })
    session.setAskUserHandler(async (_questions) => {
      console.log(`[${session.id}] Agent auto-skipped ask_user (autonomous mode)`)
      return {}
    })
  }

  /** Resolve the root human conversation ID — walk up the agent chain to find the original user conversation */
  private resolveRootConversation(sessionId?: string): string | undefined {
    if (!sessionId || !this.agentManager) return sessionId
    // If this session is an agent, find its origin and recurse
    const agent = this.agentManager.getAgent(sessionId)
    if (agent?.agent.originConversationId) {
      return this.resolveRootConversation(agent.agent.originConversationId)
    }
    // Not an agent — this is the root human conversation
    return sessionId
  }

  // ── Session options helpers ─────────────────────────────────────

  /** Extract projectId from any session ID format */
  private extractProjectId(sessionId: string): string | undefined {
    const projMatch = sessionId.match(/^proj_(.+?)_sess_/)
    if (projMatch) return projMatch[1]
    const agentJobMatch = sessionId.match(/^agent-job-(.+?)-job_/)
    if (agentJobMatch) return agentJobMatch[1]
    const agentMatch = sessionId.match(/^(?:agent-run--)?agent--(.+?)--/)
    if (agentMatch) return agentMatch[1]
    return undefined
  }

  /** Build the full options object for createSession / resumeSession.
   *  Centralises callback wiring so new options only need to be added here. */
  private buildSessionOptions(
    sessionId: string,
    projectId?: string,
    extra?: {
      provider?: string
      model?: string
      apiKey?: string
      domain?: string
      agentInstructions?: string
      agentMemory?: string
    },
  ) {
    const project = projectId ? loadProject(projectId) : undefined
    const isAgent = sessionId.startsWith('agent--')

    // Load agent instructions from metadata unless explicitly provided
    let agentInstructions = extra?.agentInstructions
    let agentMemory = extra?.agentMemory
    if (!agentInstructions && isAgent && projectId) {
      const meta = loadAgentMetadata(projectId, sessionId)
      if (meta) {
        // If this is a workflow agent, build rich context from workflow files
        if (meta.workflowId) {
          const wfContext = buildWorkflowAgentContext(projectId, meta.workflowId)
          if (wfContext) {
            agentInstructions = wfContext.instructions
            agentMemory = agentMemory || wfContext.memory || undefined
          } else {
            // Fallback to flat instructions if workflow context build fails
            agentInstructions = meta.instructions
          }
        } else {
          agentInstructions = meta.instructions
        }
      }
    }

    return {
      provider: extra?.provider,
      model: extra?.model,
      apiKey: extra?.apiKey,
      domain: extra?.domain,
      onSubAgentEvent: this.makeSubAgentEventHandler(sessionId),
      mcpManager: this.mcpManager,
      connectorManager: this.connectorManager,
      projectId,
      projectContext: project ? buildProjectContext(project, projectId!) : undefined,
      projectWorkspacePath: project?.workspacePath,
      projectType: project?.type,
      onJobAction: projectId ? this.buildAgentActionHandler(sessionId) : undefined,
      onDeliverResult:
        isAgent && projectId ? this.buildDeliverResultHandler(sessionId, projectId) : undefined,
      agentInstructions,
      agentMemory,
      availableWorkflows: this.getAvailableWorkflowsForPrompt(),
    }
  }

  /** Build the agent action callback for the agent tool (used by the LLM) */
  private buildAgentActionHandler(
    originSessionId?: string,
  ): import('@anton/agent-core').JobActionHandler | undefined {
    if (!this.agentManager) return undefined
    const am = this.agentManager

    return async (projectId, input) => {
      switch (input.operation) {
        case 'create': {
          if (!input.name) return 'Error: name is required for create'
          if (!input.prompt) return 'Error: prompt/instructions is required for agent'
          // Flat ownership: always point to the root human conversation, not the calling agent
          const rootConversationId = this.resolveRootConversation(originSessionId)
          const agent = am.createAgent(projectId, {
            name: input.name,
            description: input.description,
            instructions: input.prompt,
            schedule: input.schedule,
            originConversationId: rootConversationId,
          })
          this.sendToClient(Channel.AI, { type: 'agent_created', agent })
          return `Agent created: ${agent.agent.name} (session: ${agent.sessionId}, schedule: ${agent.agent.schedule?.cron ?? 'manual'})`
        }
        case 'list': {
          const agents = am.listAgents(projectId)
          if (agents.length === 0) return 'No agents in this project.'
          return agents
            .map(
              (a) =>
                `- ${a.agent.name} (session: ${a.sessionId}, status: ${a.agent.status}${a.agent.schedule?.cron ? `, schedule: ${a.agent.schedule.cron}` : ''})`,
            )
            .join('\n')
        }
        case 'start': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for start'
          const agent = await am.runAgent(input.jobId, 'manual')
          if (!agent) return `Error: Agent not found: ${input.jobId}`
          return `Agent "${agent.agent.name}" started`
        }
        case 'stop': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for stop'
          const agent = am.stopAgent(input.jobId)
          if (!agent) return `Error: Agent not found: ${input.jobId}`
          return `Agent "${agent.agent.name}" stopped.`
        }
        case 'delete': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for delete'
          const success = am.deleteAgent(input.jobId)
          if (!success) return `Error: Agent not found: ${input.jobId}`
          this.sendToClient(Channel.AI, {
            type: 'agent_deleted',
            projectId,
            sessionId: input.jobId,
          })
          return 'Agent deleted.'
        }
        case 'status': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for status'
          const agent = am.getAgent(input.jobId)
          if (!agent) return `Error: Agent not found: ${input.jobId}`
          return [
            `Agent: ${agent.agent.name}`,
            `Status: ${agent.agent.status}`,
            `Runs: ${agent.agent.runCount}`,
            agent.agent.schedule ? `Schedule: ${agent.agent.schedule.cron}` : 'Schedule: manual',
            agent.agent.lastRunAt
              ? `Last run: ${new Date(agent.agent.lastRunAt).toISOString()}`
              : 'Last run: never',
          ].join('\n')
        }
        default:
          return `Unknown operation: ${input.operation}`
      }
    }
  }

  /** Build the deliver_result callback for an agent session */
  private buildDeliverResultHandler(
    agentSessionId: string,
    projectId: string,
  ): import('@anton/agent-core').DeliverResultHandler {
    return async (result) => {
      // Find the agent to get its originConversationId and name
      const agent = this.agentManager?.getAgent(agentSessionId)
      if (!agent?.agent.originConversationId) {
        return 'No origin conversation — results stay in this conversation.'
      }

      const originId = agent.agent.originConversationId
      const basePath = getProjectSessionsDir(projectId)

      // Append the result as an assistant message to the origin conversation
      const delivered = appendMessageToSession(
        originId,
        {
          role: 'assistant',
          content: `**Agent: ${agent.agent.name}**\n\n${result.content}`,
          agentName: agent.agent.name,
          agentSessionId,
        },
        basePath,
      )

      if (!delivered) {
        return `Could not deliver to conversation ${originId} — it may not exist.`
      }

      // Notify the client so the UI updates if that conversation is open
      this.sendToClient(Channel.AI, {
        type: 'agent_result_delivered',
        projectId,
        agentSessionId,
        agentName: agent.agent.name,
        originConversationId: originId,
        summary: result.summary ?? 'Agent delivered results',
      })

      return 'Results delivered to your origin conversation.'
    }
  }

  // ── Project handlers ──────────────────────────────────────────

  private handleProjectCreate(msg: {
    project: {
      name: string
      description?: string
      icon?: string
      color?: string
      workspacePath?: string
    }
  }) {
    try {
      const project = createProject({ ...msg.project, config: this.config })
      this.sendToClient(Channel.AI, { type: 'project_created', project })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create project: ${(err as Error).message}`,
      })
    }
  }

  private handleProjectsList() {
    ensureDefaultProject(this.config)
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
    // Filter out agent sessions — they appear in the agents list, not here
    const persisted = listProjectSessions(msg.projectId).filter(
      (s) => !s.id.startsWith('agent-job-') && !s.id.startsWith('agent--'),
    )
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

  private handleProjectContextUpdate(msg: {
    id: string
    field: 'notes' | 'summary'
    value: string
  }) {
    const updated = updateProjectContext(msg.id, msg.field, msg.value)
    if (updated) {
      this.sendToClient(Channel.AI, { type: 'project_updated', project: updated })
    } else {
      this.sendToClient(Channel.AI, { type: 'error', message: `Project not found: ${msg.id}` })
    }
  }

  private handleProjectInstructionsGet(msg: { projectId: string }) {
    const content = loadProjectInstructions(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'project_instructions_response',
      projectId: msg.projectId,
      content,
    })
  }

  private handleProjectInstructionsSave(msg: { projectId: string; content: string }) {
    saveProjectInstructions(msg.projectId, msg.content)
    this.sendToClient(Channel.AI, {
      type: 'project_instructions_response',
      projectId: msg.projectId,
      content: msg.content,
    })
  }

  private handleProjectPreferencesGet(msg: { projectId: string }) {
    const preferences = loadProjectPreferences(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'project_preferences_response',
      projectId: msg.projectId,
      preferences,
    })
  }

  private handleProjectPreferenceAdd(msg: { projectId: string; title: string; content: string }) {
    addProjectPreference(msg.projectId, msg.title, msg.content)
    // Send back the full list
    const preferences = loadProjectPreferences(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'project_preferences_response',
      projectId: msg.projectId,
      preferences,
    })
  }

  private handleProjectPreferenceDelete(msg: { projectId: string; preferenceId: string }) {
    deleteProjectPreference(msg.projectId, msg.preferenceId)
    const preferences = loadProjectPreferences(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'project_preferences_response',
      projectId: msg.projectId,
      preferences,
    })
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
  }): Promise<number> {
    const sessionId = msg.sessionId || DEFAULT_SESSION_ID

    // Auto-create default session if it doesn't exist
    let session = this.sessions.get(sessionId)
    if (!session) {
      if (sessionId === DEFAULT_SESSION_ID) {
        session = createSession(
          DEFAULT_SESSION_ID,
          this.config,
          this.buildSessionOptions(DEFAULT_SESSION_ID, undefined, {
            domain: process.env.DOMAIN,
          }),
        )
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.set(DEFAULT_SESSION_ID, session)
      } else {
        // Try to resume from disk automatically
        const projectId = this.extractProjectId(sessionId)
        const isAgentSession = sessionId.startsWith('agent--')
        const opts = this.buildSessionOptions(sessionId, projectId)

        session = resumeSession(sessionId, this.config, opts) ?? undefined

        // Also try global sessions as fallback
        if (!session && projectId) {
          session =
            resumeSession(sessionId, this.config, this.buildSessionOptions(sessionId)) ?? undefined
        }

        // For agent sessions that have never run: create a fresh session
        if (!session && isAgentSession && projectId) {
          console.log(`Creating new session for agent: ${sessionId}`)
          session = createSession(sessionId, this.config, opts)
        }

        if (session) {
          if (isAgentSession) {
            // Agent sessions are autonomous — auto-approve confirms, skip ask_user
            this.wireAgentAutoHandlers(session)
          } else {
            this.wireSessionConfirmHandler(session)
            this.wirePlanConfirmHandler(session)
            this.wireAskUserHandler(session)
          }
          this.sessions.set(sessionId, session)
          console.log(`Auto-resumed session from disk: ${sessionId}`)
        } else {
          this.sendToClient(Channel.AI, {
            type: 'error',
            code: 'session_not_found',
            message: `Session not found: ${sessionId}. Create it first with session_create.`,
            sessionId,
          })
          return 0
        }
      }
    }

    // Handle /compact command
    if (msg.content.startsWith('/compact')) {
      await this.handleCompactCommand(session, sessionId, msg.content)
      return 0
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
    let eventCount = 0

    // Buffer text chunks and flush every ~80ms (or before any non-text event)
    // Hoisted above try so catch/finally can access it
    const textBuffer = new TextStreamBuffer((text) => {
      this.sendToClient(Channel.AI, { type: 'text', content: text, sessionId })
    })

    try {
      const turnStartMs = Date.now()
      let accumulatedText = ''
      let toolCallCount = 0
      // Track update_project_context tool call data
      const pendingToolNames = new Map<string, string>()
      let projectContextUpdate: { sessionSummary?: string; projectSummary?: string } | null = null
      let lastProjectSummary: string | undefined
      let writingStatusSent = false

      for await (const event of session.processMessage(msg.content, msg.attachments || [])) {
        eventCount++

        // ── Text events: buffer instead of sending immediately ──
        if (event.type === 'text') {
          accumulatedText += event.content
          textBuffer.push(event.content)

          // Send "Writing response..." status only once per text block, not per token
          if (!writingStatusSent) {
            this.sendToClient(Channel.EVENTS, {
              type: 'agent_status',
              status: 'working',
              detail: 'Writing response...',
              sessionId,
            })
            writingStatusSent = true
          }
          continue
        }

        // ── Non-text event: force flush buffer to preserve ordering ──
        textBuffer.flush()
        writingStatusSent = false

        // Track tool call names for result matching
        if (event.type === 'tool_call') {
          const tc = event as { id: string; name: string }
          pendingToolNames.set(tc.id, tc.name)
        }

        // Capture update_project_context tool result
        if (event.type === 'tool_result') {
          const tr = event as { id: string; output: string }
          if (pendingToolNames.get(tr.id) === 'update_project_context') {
            try {
              const parsed = JSON.parse(tr.output)
              // Validate shape — sessionSummary must be a string, projectSummary optional string
              if (parsed && typeof parsed.sessionSummary === 'string') {
                const newProjectSummary =
                  typeof parsed.projectSummary === 'string' ? parsed.projectSummary : undefined
                // Keep previous projectSummary if new call omits it
                projectContextUpdate = {
                  sessionSummary: parsed.sessionSummary,
                  projectSummary: newProjectSummary || lastProjectSummary,
                }
                lastProjectSummary = projectContextUpdate.projectSummary
              }
            } catch {
              /* ignore malformed output */
            }
          }
          pendingToolNames.delete(tr.id)
        }

        // Emit granular status updates so the client can show step-by-step progress
        if (event.type === 'tool_call') {
          toolCallCount++
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
              const host = String(inp.url || inp.host)
                .replace(/^https?:\/\//, '')
                .split('/')[0]
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
        } else if (event.type === 'tasks_update') {
          // Use the activeForm of the current in_progress task as status detail
          const active = (
            event as { tasks: Array<{ activeForm: string; status: string }> }
          ).tasks.find((t) => t.status === 'in_progress')
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

      // Flush any remaining buffered text after the loop
      textBuffer.destroy()
      const turnDurationMs = Date.now() - turnStartMs
      console.log(
        `[${sessionId}] Turn complete: ${eventCount} events, ${toolCallCount} tool calls, ` +
          `${accumulatedText.length} chars, ${turnDurationMs}ms`,
      )

      // Track session in project history if this is a project session
      const sessionInfo = session.getInfo()
      if (session.projectId && sessionInfo.title) {
        try {
          // Use LLM-provided summary from update_project_context tool, fallback to title
          const sessionSummary = projectContextUpdate?.sessionSummary || sessionInfo.title

          // Update project summary if the LLM provided one
          if (projectContextUpdate?.projectSummary) {
            updateProjectContext(session.projectId, 'summary', projectContextUpdate.projectSummary)
          }

          appendSessionHistory(session.projectId, {
            sessionId: session.id,
            title: sessionInfo.title,
            summary: sessionSummary,
            ts: Date.now(),
          })
          updateProjectStats(session.projectId)

          const updatedProject = loadProject(session.projectId)
          if (updatedProject) {
            this.sendToClient(Channel.AI, { type: 'project_updated', project: updatedProject })
          }
        } catch (e) {
          console.warn(`Failed to update project history: ${(e as Error).message}`)
        }
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message
      console.error(`[${sessionId}] Error:`, errMsg)
      // Flush any buffered text before sending error so partial response isn't lost
      textBuffer.destroy()
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: errMsg,
        sessionId,
      })
      // Send done on error path so the client always clears loading state
      this.sendToClient(Channel.AI, {
        type: 'done',
        sessionId,
      })
    } finally {
      // Safety net: destroy is idempotent, ensures timer is cleared even if
      // the try block exited without reaching textBuffer.destroy()
      textBuffer.destroy()
      this.activeTurns.delete(sessionId)
      this.sendToClient(Channel.EVENTS, {
        type: 'agent_status',
        status: 'idle',
        sessionId,
      })
    }
    return eventCount
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

        const payload = {
          type: 'confirm' as const,
          id: confirmId,
          command,
          reason,
          sessionId: session.id,
        }
        this.sendToClient(Channel.AI, payload)
        this.pendingPrompts.set(confirmId, { type: 'confirm', payload })

        const timeout = setTimeout(() => {
          this.pendingPrompts.delete(confirmId)
          this.promptResolvers.delete(confirmId)
          resolve(false)
        }, 60_000)

        this.promptResolvers.set(confirmId, (msg: AiMessage) => {
          if (msg.type === 'confirm_response' && msg.id === confirmId) {
            clearTimeout(timeout)
            this.pendingPrompts.delete(confirmId)
            this.promptResolvers.delete(confirmId)
            resolve(msg.approved)
          }
        })
      })
    })
  }

  private wirePlanConfirmHandler(session: Session) {
    session.setPlanConfirmHandler(async (title, content) => {
      if (!this.activeClient) return { approved: false, feedback: 'No client connected' }

      return new Promise((resolve) => {
        const confirmId = `plan_${Date.now()}`

        const payload = {
          type: 'plan_confirm' as const,
          id: confirmId,
          title,
          content,
          sessionId: session.id,
        }
        this.sendToClient(Channel.AI, payload)
        this.pendingPrompts.set(confirmId, { type: 'plan_confirm', payload })

        // 5 minutes — plans need reading time
        const timeout = setTimeout(() => {
          this.pendingPrompts.delete(confirmId)
          this.promptResolvers.delete(confirmId)
          resolve({ approved: false, feedback: 'Timed out waiting for plan review' })
        }, 300_000)

        this.promptResolvers.set(confirmId, (msg: AiMessage) => {
          if (msg.type === 'plan_confirm_response' && msg.id === confirmId) {
            clearTimeout(timeout)
            this.pendingPrompts.delete(confirmId)
            this.promptResolvers.delete(confirmId)
            resolve({ approved: msg.approved, feedback: msg.feedback })
          }
        })
      })
    })
  }

  private wireAskUserHandler(session: Session) {
    session.setAskUserHandler(async (questions) => {
      if (!this.activeClient) return {}

      return new Promise((resolve) => {
        const askId = `ask_${Date.now()}`

        const payload = {
          type: 'ask_user' as const,
          id: askId,
          questions,
          sessionId: session.id,
        }
        this.sendToClient(Channel.AI, payload)
        // Track so we can re-send on reconnect
        this.pendingPrompts.set(askId, { type: 'ask_user', payload })

        // 5 minutes — user needs time to answer
        const timeout = setTimeout(() => {
          this.pendingPrompts.delete(askId)
          this.promptResolvers.delete(askId)
          resolve({})
        }, 300_000)

        // Register resolver — routed via handleMessage, survives reconnects
        this.promptResolvers.set(askId, (msg: AiMessage) => {
          if (msg.type === 'ask_user_response' && msg.id === askId) {
            clearTimeout(timeout)
            this.pendingPrompts.delete(askId)
            this.promptResolvers.delete(askId)
            resolve(msg.answers)
          }
        })
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

  private async startOAuthConnectors(): Promise<void> {
    const connected = this.oauthFlow.listConnected()
    if (connected.length === 0) return

    // Only activate connectors that are enabled in config
    const enabledConnectors = getConnectors(this.config)
    const enabledIds = new Set(enabledConnectors.filter((c) => c.enabled).map((c) => c.id))

    const toActivate = connected.filter(
      (id) => this.connectorManager.hasFactory(id) && enabledIds.has(id),
    )
    if (toActivate.length === 0) return

    console.log(`  Activating ${toActivate.length} OAuth connector(s)...`)
    for (const providerId of toActivate) {
      await this.connectorManager.activate(providerId)
    }
  }

  private async startTelegramBot(): Promise<void> {
    const token = this.getTelegramToken()
    if (!token) return

    // Accept DOMAIN, or derive from OAUTH_CALLBACK_BASE_URL (same host)
    let publicUrl: string | null = null
    if (process.env.DOMAIN) {
      publicUrl = `https://${process.env.DOMAIN}`
    } else if (process.env.OAUTH_CALLBACK_BASE_URL) {
      try {
        publicUrl = new URL(process.env.OAUTH_CALLBACK_BASE_URL).origin
      } catch {
        /* ignore */
      }
    } else if (this.config.oauth?.callbackBaseUrl) {
      try {
        publicUrl = new URL(this.config.oauth.callbackBaseUrl).origin
      } catch {
        /* ignore */
      }
    }

    if (!publicUrl) {
      console.log('  Telegram bot token found but DOMAIN not set — skipping webhook registration')
      return
    }

    this.telegramBot = new TelegramBotHandler({
      token,
      config: this.config,
      mcpManager: this.mcpManager,
      connectorManager: this.connectorManager,
    })

    await this.telegramBot.registerWebhook(publicUrl)
  }

  private getTelegramToken(): string | null {
    // Check env var first, then saved connector config
    if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN
    const saved = getConnectors(this.config).find((c) => c.id === 'telegram' && c.enabled)
    return saved?.apiKey ?? null
  }

  /** Activate direct connectors that have a stored apiKey in config or a matching env var. */
  private startApiConnectors(): void {
    const apiConnectors = getConnectors(this.config).filter(
      (c) => c.type === 'api' && c.enabled && this.connectorManager.hasFactory(c.id),
    )

    for (const c of apiConnectors) {
      // Prefer stored apiKey from config, fall back to env var
      const token =
        c.apiKey ??
        process.env[`${c.id.toUpperCase()}_BOT_TOKEN`] ??
        process.env[`${c.id.toUpperCase()}_API_KEY`]
      if (token) {
        this.connectorManager.activateWithToken(c.id, token)
        this.applyConnectorMetadata(c.id, c.metadata)
        console.log(`  Activated API connector: ${c.id}`)
      }
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
    const directStatus = this.connectorManager.getStatus().find((s) => s.id === c.id)
    // OAuth connectors are "connected" when they have a stored token
    const isOAuthConnected = c.type === 'oauth' && this.oauthFlow.hasToken(c.id) && c.enabled
    const connected = mcpStatus?.connected ?? directStatus?.connected ?? isOAuthConnected
    const toolCount = mcpStatus?.toolCount ?? directStatus?.toolCount ?? 0
    const tools = mcpStatus?.tools ?? directStatus?.tools ?? []
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      type: c.type,
      connected,
      enabled: c.enabled,
      toolCount,
      tools,
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

      // Activate direct API connectors immediately using the provided token
      if (
        msg.connector.type === 'api' &&
        msg.connector.apiKey &&
        this.connectorManager.hasFactory(msg.connector.id)
      ) {
        this.connectorManager.activateWithToken(msg.connector.id, msg.connector.apiKey)
        this.applyConnectorMetadata(msg.connector.id, msg.connector.metadata)
        this.refreshAllSessionTools()
      }

      // Start Telegram bot if just connected
      if (msg.connector.id === 'telegram' && msg.connector.apiKey && !this.telegramBot) {
        this.startTelegramBot().catch((err) => console.error('[TelegramBot] Failed to start:', err))
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

  private async handleConnectorUpdate(msg: {
    id: string
    changes: Partial<ConnectorConfig>
  }): Promise<void> {
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
      // Try MCP removal (ignores if not an MCP connector)
      try {
        await this.mcpManager.removeConnector(msg.id)
      } catch {
        /* not an MCP connector — that's fine */
      }
      this.connectorManager.deactivate(msg.id)
      removeConnectorConfig(this.config, msg.id)
      this.refreshAllSessionTools()
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

      const isMcpConnector = this.mcpManager.getStatus().some((s) => s.id === msg.id)
      const isDirectConnector =
        this.connectorManager.isActive(msg.id) || this.connectorManager.hasFactory(msg.id)

      if (isMcpConnector) {
        await this.mcpManager.toggleConnector(msg.id, msg.enabled)
        this.sendToClient(Channel.AI, {
          type: 'connector_status',
          id: msg.id,
          connected: this.mcpManager.isConnected(msg.id),
          toolCount: this.mcpManager.getStatus().find((s) => s.id === msg.id)?.toolCount ?? 0,
        })
      } else if (isDirectConnector) {
        if (msg.enabled) {
          const connectorConfig = getConnectors(this.config).find((c) => c.id === msg.id)
          if (connectorConfig?.type === 'api') {
            const token =
              connectorConfig.apiKey ??
              process.env[`${msg.id.toUpperCase()}_BOT_TOKEN`] ??
              process.env[`${msg.id.toUpperCase()}_API_KEY`]
            if (token) {
              this.connectorManager.activateWithToken(msg.id, token)
              this.applyConnectorMetadata(msg.id, connectorConfig.metadata)
            }
          } else {
            await this.connectorManager.activate(msg.id)
          }
        } else {
          this.connectorManager.deactivate(msg.id)
        }
        // Refresh tools on active sessions
        for (const session of this.sessions.values()) {
          session.refreshConnectorTools()
        }
        const status = this.connectorManager.getStatus().find((s) => s.id === msg.id)
        this.sendToClient(Channel.AI, {
          type: 'connector_status',
          id: msg.id,
          connected: msg.enabled && (status?.connected ?? false),
          toolCount: status?.toolCount ?? 0,
        })
      } else {
        // Not found in either manager — just update config
        this.sendToClient(Channel.AI, {
          type: 'connector_status',
          id: msg.id,
          connected: false,
          toolCount: 0,
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
      // Direct connectors (OAuth/API) — test via ConnectorManager
      if (this.connectorManager.isActive(msg.id)) {
        const result = await this.connectorManager.testConnection(msg.id)
        const tools = this.connectorManager.getStatus().find((s) => s.id === msg.id)?.tools ?? []
        this.sendToClient(Channel.AI, {
          type: 'connector_test_response',
          id: msg.id,
          success: result.success,
          tools,
          error: result.error,
        })
        return
      }

      // Inactive direct connector (has factory but not activated) — try to activate first
      if (this.connectorManager.hasFactory(msg.id)) {
        try {
          // Check if this is an API-key connector — use activateWithToken instead of OAuth
          const connectorConfig = getConnectors(this.config).find((c) => c.id === msg.id)
          if (connectorConfig?.type === 'api') {
            const token =
              connectorConfig.apiKey ??
              process.env[`${msg.id.toUpperCase()}_BOT_TOKEN`] ??
              process.env[`${msg.id.toUpperCase()}_API_KEY`]
            if (!token) {
              this.sendToClient(Channel.AI, {
                type: 'connector_test_response',
                id: msg.id,
                success: false,
                tools: [],
                error: `No API key configured for ${msg.id}`,
              })
              return
            }
            this.connectorManager.activateWithToken(msg.id, token)
            this.applyConnectorMetadata(msg.id, connectorConfig.metadata)
          } else {
            await this.connectorManager.activate(msg.id)
          }
          const result = await this.connectorManager.testConnection(msg.id)
          const tools = this.connectorManager.getStatus().find((s) => s.id === msg.id)?.tools ?? []
          this.sendToClient(Channel.AI, {
            type: 'connector_test_response',
            id: msg.id,
            success: result.success,
            tools,
            error: result.error,
          })
        } catch (activateErr) {
          this.sendToClient(Channel.AI, {
            type: 'connector_test_response',
            id: msg.id,
            success: false,
            tools: [],
            error: `Failed to activate connector: ${(activateErr as Error).message}`,
          })
        }
        return
      }

      // MCP connectors
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

  // ── OAuth connector handlers ──────────────────────────────────────

  private handleConnectorOAuthStart(msg: { provider: string }): void {
    const entry = CONNECTOR_REGISTRY.find((e) => e.id === msg.provider)
    const scopes = entry?.oauthScopes

    // Build provider-specific extra params
    let extraParams: Record<string, string> | undefined
    if (entry?.oauthProvider === 'websearch') {
      const domain = process.env.DOMAIN
      if (domain) extraParams = { domain }
    }

    // Pass oauthProvider so shared OAuth apps (e.g. 'google') use the correct redirect_uri
    const url = this.oauthFlow.startFlow(msg.provider, scopes, entry?.oauthProvider, extraParams)
    if (!url) {
      this.sendToClient(Channel.AI, {
        type: 'connector_oauth_complete',
        provider: msg.provider,
        success: false,
        error:
          'OAuth proxy URL or callback base URL not configured. Set OAUTH_PROXY_URL and OAUTH_CALLBACK_BASE_URL environment variables.',
      })
      return
    }
    this.sendToClient(Channel.AI, {
      type: 'connector_oauth_url',
      provider: msg.provider,
      url,
    })
  }

  private handleConnectorOAuthDisconnect(msg: { provider: string }): void {
    this.oauthFlow.disconnect(msg.provider)
    // Also remove the connector config if it exists
    const connector = getConnectors(this.config).find((c) => c.id === msg.provider)
    if (connector) {
      removeConnectorConfig(this.config, msg.provider)
    }
    this.sendToClient(Channel.AI, {
      type: 'connector_removed',
      id: msg.provider,
    })
    console.log(`OAuth connector disconnected: ${msg.provider}`)
  }

  private async handleOAuthComplete(result: {
    provider: string
    success: boolean
    error?: string
  }): Promise<void> {
    if (result.success) {
      // Auto-create a connector config for the OAuth provider
      const existingConnector = getConnectors(this.config).find((c) => c.id === result.provider)
      if (!existingConnector) {
        const registryEntry = CONNECTOR_REGISTRY.find((r) => r.id === result.provider)
        addConnector(this.config, {
          id: result.provider,
          name: registryEntry?.name || result.provider,
          description: registryEntry?.description,
          icon: registryEntry?.icon,
          type: 'oauth',
          enabled: true,
        })
      }

      // Activate the direct connector so tools are immediately available
      if (this.connectorManager.hasFactory(result.provider)) {
        await this.connectorManager.activate(result.provider)
        this.refreshAllSessionTools()
      }

      // Push updated connector status so the desktop store updates immediately
      const registryEntry2 = CONNECTOR_REGISTRY.find((r) => r.id === result.provider)
      const connStatus = this.connectorManager.getStatus().find((s) => s.id === result.provider)
      const toolCount = connStatus?.toolCount ?? 0
      this.sendToClient(Channel.AI, {
        type: 'connector_added',
        connector: {
          id: result.provider,
          name: registryEntry2?.name || result.provider,
          description: registryEntry2?.description,
          icon: registryEntry2?.icon,
          type: 'oauth' as const,
          connected: true,
          enabled: true,
          toolCount,
        },
      })

      console.log(`OAuth connector connected: ${result.provider}`)
    }

    this.sendToClient(Channel.AI, {
      type: 'connector_oauth_complete',
      provider: result.provider,
      success: result.success,
      error: result.error,
    })
  }

  /** Refresh connector tools on all active sessions so new connectors are available immediately. */
  private refreshAllSessionTools(): void {
    for (const session of this.sessions.values()) {
      session.refreshConnectorTools()
    }
    this.telegramBot?.refreshAllSessionTools()
  }

  /** Apply connector-specific metadata after activation (e.g. ownerChatId for Telegram). */
  private applyConnectorMetadata(id: string, metadata: Record<string, string> | undefined): void {
    if (!metadata) return
    const connector = this.connectorManager.getConnector(id)
    if (!connector) return
    if (id === 'telegram' && metadata.OWNER_CHAT_ID) {
      const chatId = Number(metadata.OWNER_CHAT_ID)
      if (!Number.isNaN(chatId) && 'setOwnerChatId' in connector) {
        ;(connector as { setOwnerChatId: (id: number) => void }).setOwnerChatId(chatId)
        console.log(`  Telegram owner chat ID set: ${chatId}`)
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Public: forward agent manager events to client */
  broadcastAgentEvent(event: import('./agents/agent-manager.js').AgentEvent) {
    this.sendToClient(Channel.AI, event)
  }

  private logStoredSessions() {
    try {
      const metas = listSessionMetas()
      if (metas.length === 0) {
        console.log('[Sessions on disk] (none)')
        return
      }
      console.log(`[Sessions on disk] ${metas.length} session(s):`)
      for (const m of metas.slice(0, 20)) {
        const ago = Math.round((Date.now() - m.lastActiveAt) / 60_000)
        const agoStr =
          ago < 60
            ? `${ago}m ago`
            : ago < 1440
              ? `${Math.round(ago / 60)}h ago`
              : `${Math.round(ago / 1440)}d ago`
        console.log(`  - ${m.id}: "${m.title}" (${m.messageCount} msgs, last active ${agoStr})`)
      }
      if (metas.length > 20) console.log(`  ... and ${metas.length - 20} more`)
    } catch (err: unknown) {
      console.error('[Sessions on disk] Failed to list:', (err as Error).message)
    }
  }

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
