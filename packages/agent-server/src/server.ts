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

import { execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join, resolve } from 'node:path'
import type { AgentConfig } from '@anton/agent-config'
import { DEFAULT_PROVIDERS } from '@anton/agent-config'
import {
  addProjectPreference,
  appendMessageToSession,
  appendSessionHistory,
  buildProjectContext,
  cleanExpiredSessions,
  createProject,
  deleteSession as deletePersistedSession,
  deleteProject,
  deleteProjectPreference,
  ensureDefaultProject,
  getAntonDir,
  getConversationMemoryDir,
  getDeltasSince,
  getGlobalMemoryDir,
  getProjectSessionsDir,
  getProvidersList,
  getPublished,
  getPublishedDir,
  getSyncVersion,
  incrementViews,
  listProjectIndex,
  listProjectSessions,
  listProjectWorkflows,
  listPublished,
  listSessionMetas,
  loadAgentMetadata,
  loadProject,
  loadProjectInstructions,
  loadProjectPreferences,
  loadProjects,
  loadUserRules,
  onSyncChange,
  removePublished,
  saveConfig,
  saveProjectInstructions,
  savePublishedMeta,
  setDefault,
  setProviderKey,
  setProviderModels,
  updateProject,
  updateProjectContext,
  updateProjectStats,
} from '@anton/agent-config'
import { GIT_HASH, VERSION } from '@anton/agent-config'
import { loadSkills } from '@anton/agent-config'
import {
  CONNECTOR_REGISTRY,
  type ConnectorConfig,
  type ConnectorToolPermission,
  addConnector,
  getConnectors,
  removeConnector as removeConnectorConfig,
  setConnectorToolPermission,
  toggleConnector as toggleConnectorConfig,
  updateConnector as updateConnectorConfig,
} from '@anton/agent-config'
import {
  ANTON_MCP_NAMESPACE,
  AntonToolRegistry,
  ClaudeAdapter,
  CodexAdapter,
  CodexHarnessSession,
  HarnessSession,
  type LiveConnectorSummary,
  McpManager,
  type McpServerConfig,
  type Session,
  SessionRegistry,
  type SubAgentEventHandler,
  type ShimProbeResult,
  appendHarnessTurn,
  assembleConversationContext,
  buildHarnessCapabilityBlock,
  buildHarnessContextPrompt,
  buildMcpSpawnConfig,
  buildReplaySeed,
  createMcpIpcServer,
  createSession,
  ensureHarnessSessionInit,
  executePublish,
  extractHarnessMemoriesFromMirror,
  hashPromptVersion,
  isHarnessSession,
  matchesSurface,
  probeMcpShim,
  readHarnessHistory,
  resolveModel,
  resumeSession,
  synthesizeHarnessTurn,
  writeHarnessSessionTitle,
} from '@anton/agent-core'
import { CONNECTOR_FACTORIES, ConnectorManager } from '@anton/connectors'
import { createLogger } from '@anton/logger'
import { Channel, decodeFrame, encodeFrame, parseJsonPayload } from '@anton/protocol'
import type {
  AiMessage,
  ChannelId,
  ControlMessage,
  TerminalMessage,
  ThinkingLevel,
} from '@anton/protocol'
import { WebSocket, WebSocketServer } from 'ws'
import {
  CredentialStore,
  OAuthFlow,
  fetchAccountIdentity,
  oauthCallbackHandler,
} from './oauth/index.js'
import type { Scheduler } from './scheduler.js'
import { Updater } from './updater.js'
import { extractBindingKey, getBinding } from './webhooks/bindings.js'
import {
  SlackWebhookProvider,
  TelegramWebhookProvider,
  WebhookAgentRunner,
  WebhookRouter,
} from './webhooks/index.js'
import {
  getBuiltinWorkflowPath,
  listBuiltinWorkflows,
  loadBuiltinManifest,
} from './workflows/builtin-registry.js'
import { WorkflowStateDb } from './workflows/shared-state-db.js'
import { buildWorkflowAgentContext } from './workflows/workflow-context.js'
import { WorkflowInstaller } from './workflows/workflow-installer.js'

const log = createLogger('server')

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

// ── PTY abstraction (node-pty with child_process fallback) ──────

interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: () => void): void
}

let nodePty: typeof import('node-pty') | null = null
let nodePtyLoaded = false

async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  if (nodePtyLoaded) return nodePty
  nodePtyLoaded = true
  try {
    nodePty = await import('node-pty')
    log.info('node-pty loaded — real PTY support enabled')
  } catch {
    log.warn('node-pty not available — falling back to child_process (no TTY)')
  }
  return nodePty
}

function spawnFallback(shell: string, cols: number, rows: number, cwd: string): PtyHandle {
  const p = spawn(shell, ['-i'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  })

  const dataCallbacks: ((data: string) => void)[] = []
  const exitCallbacks: (() => void)[] = []

  const onData = (chunk: Buffer) => {
    const str = chunk.toString('utf-8')
    for (const cb of dataCallbacks) cb(str)
  }

  p.stdout?.on('data', onData)
  p.stderr?.on('data', onData)
  p.on('exit', () => {
    for (const cb of exitCallbacks) cb()
  })

  return {
    write(data: string) {
      if (p.stdin?.writable) p.stdin.write(data)
    },
    resize() {
      // child_process doesn't support resize
    },
    kill() {
      p.kill('SIGTERM')
    },
    onData(cb) {
      dataCallbacks.push(cb)
    },
    onExit(cb) {
      exitCallbacks.push(cb)
    },
  }
}

export class AgentServer {
  private wss: WebSocketServer | null = null
  private config: AgentConfig
  /**
   * Bounded, LRU-ordered registry for every live session. Replaces a
   * plain Map. Guarantees (a) `shutdown()` runs on eviction and explicit
   * delete, and (b) partitioned pools so routine bursts can't evict live
   * conversations. Category is passed at `put()` time by the call site
   * that knows intent best.
   */
  private sessions: SessionRegistry<Session | HarnessSession | CodexHarnessSession> =
    new SessionRegistry<Session | HarnessSession | CodexHarnessSession>({
      // LRU eviction only calls session.shutdown() on the evicted entry.
      // We also own per-session bookkeeping outside the registry
      // (mcpIpcServer auth, harness context maps, activeTurns) that
      // would otherwise leak on eviction. Drop them here — deliberately
      // NOT deletePersistedSession, because eviction is a memory-pressure
      // signal, not a "user destroyed this session" signal, and the disk
      // state must remain resumable.
      onEvict: (id, session) => {
        this.cleanupEvictedSessionState(id, isHarnessSession(session))
      },
    })
  private activeTurns: Set<string> = new Set() // sessions currently processing a turn
  /**
   * Latest result from `probeMcpShim()`. `null` = not yet probed. Gates
   * the capability block on harness session creation so the model
   * doesn't hallucinate connectors when the shim is unreachable.
   */
  private mcpHealth: ShimProbeResult | null = null
  /** Epoch ms when `mcpHealth` was last written — used by the lazy freshness check. */
  private mcpHealthAt = 0
  /** Shared in-flight re-probe promise so concurrent callers collapse into one spawn. */
  private mcpProbeInflight: Promise<void> | null = null
  /**
   * Resolves once the first `probeMcpShim()` finishes (ok or err) so
   * `start()` can block on it before the WebSocket listener opens.
   * Without this await, clients that connect in the first few hundred ms
   * after boot see `mcpHealth === null` at session creation and lose the
   * capability block for the session's entire lifetime — Codex bakes
   * `developerInstructions` into `thread/start` and never rebuilds it.
   */
  private initialMcpProbe: Promise<void> | null = null
  private activeClient: WebSocket | null = null
  // Track pending interactive prompts so they can be re-sent on client reconnect
  private pendingPrompts: Map<string, { type: string; payload: Record<string, unknown> }> =
    new Map()
  // Resolvers for pending interactive prompts — keyed by prompt ID
  private promptResolvers: Map<string, (msg: AiMessage) => void> = new Map()
  private scheduler: Scheduler | null = null
  private workflowDbs: Map<string, WorkflowStateDb> = new Map()
  private agentManager: import('./agents/agent-manager.js').AgentManager | null = null
  private updater: Updater
  private mcpManager: McpManager = new McpManager()
  private oauthFlow: OAuthFlow
  private credentialStore: CredentialStore
  private connectorManager: ConnectorManager
  private webhookRouter: WebhookRouter | null = null
  private webhookRunner: WebhookAgentRunner | null = null
  private telegramProvider: TelegramWebhookProvider | null = null
  private slackBotProvider: SlackWebhookProvider | null = null
  private ptys: Map<string, PtyHandle> = new Map()
  private activeWorkspacePath: string | null = null
  private mcpIpcServer: import('@anton/agent-core').McpIpcServer | null = null
  private harnessSessionContexts = new Map<
    string,
    import('@anton/agent-core').HarnessSessionContext
  >()
  /**
   * Per-harness-session cursor into the mirror for memory extraction.
   * Advanced after each successful extraction; the same index is passed
   * as sinceIndex on the next call so we don't re-scan prior messages.
   * Cleared on session destroy.
   */
  private harnessExtractionCursor = new Map<string, number>()
  /**
   * Wall-clock cancel timers for detached turns. Keyed by sessionId.
   * Scheduled when a client disconnects while the session is in
   * detached mode; cleared if the client reconnects or the turn ends
   * naturally. See specs/features/DETACHED_TURNS.md.
   */
  private detachedTurnTimers = new Map<string, NodeJS.Timeout>()
  private toolRegistry!: AntonToolRegistry
  private pendingLoginProc: import('node:child_process').ChildProcess | null = null

  constructor(config: AgentConfig) {
    this.config = config

    // Initialize updater (proxies to sidecar)
    this.updater = new Updater(config.token)

    // Initialize OAuth infrastructure
    this.credentialStore = new CredentialStore(getAntonDir(), config.token)
    this.oauthFlow = new OAuthFlow(config, this.credentialStore)
    this.connectorManager = new ConnectorManager(CONNECTOR_FACTORIES, (id: string) =>
      this.resolveConnectorEnv(id),
    )

    // Tool registry for harness sessions: exposes static Anton tools +
    // dynamic per-session tools (connectors, activate_workflow,
    // update_project_context) via MCP. Must be constructed after
    // connectorManager is assigned.
    this.toolRegistry = new AntonToolRegistry({
      connectorManager: this.connectorManager,
      mcpManager: this.mcpManager,
      getSessionContext: (sessionId) => this.harnessSessionContexts.get(sessionId),
    })

    // Clean expired sessions on startup
    const ttl = config.sessions?.ttlDays ?? 7
    const cleaned = cleanExpiredSessions(ttl)
    if (cleaned > 0) {
      log.info({ cleaned }, 'Cleaned expired sessions')
    }

    // Push session index changes to connected clients in real-time
    onSyncChange((delta, syncVersion) => {
      if (this.activeClient) {
        log.info(
          { action: delta.action, sessionId: delta.sessionId, syncVersion },
          'Pushing session sync delta to client',
        )
        this.sendToClient(Channel.AI, {
          type: 'session_sync',
          syncVersion,
          delta,
        })
      }
    })

    // Start MCP IPC server for harness sessions
    const socketPath = join(getAntonDir(), 'harness.sock')
    this.mcpIpcServer = createMcpIpcServer(socketPath, this.toolRegistry)

    // Fire the boot probe. Subsequent re-probes happen lazily in
    // `ensureMcpHealthFresh()` when a harness session is about to be
    // created and the last probe is older than MCP_HEALTH_STALE_MS. We
    // don't poll on an interval — the shim binary only changes on
    // deploy, so idle re-probes just burn cycles and fill logs.
    this.initialMcpProbe = this.runMcpProbe()
  }

  /**
   * Run one probe and update `mcpHealth` / `mcpHealthAt`. Concurrent
   * callers share the in-flight promise via `mcpProbeInflight` so we
   * never spawn two probe subprocesses in parallel.
   */
  private runMcpProbe(): Promise<void> {
    if (this.mcpProbeInflight) return this.mcpProbeInflight
    this.mcpProbeInflight = (async () => {
      try {
        this.mcpHealth = await probeMcpShim()
      } catch (err) {
        log.error({ err }, 'probeMcpShim threw — treating as unhealthy')
        this.mcpHealth = {
          ok: false,
          error: (err as Error).message,
          stderrTail: [],
          durationMs: 0,
        }
      } finally {
        this.mcpHealthAt = Date.now()
        this.mcpProbeInflight = null
      }
    })()
    return this.mcpProbeInflight
  }

  /**
   * Ensure `mcpHealth` is no older than `staleMs`. If stale (or absent),
   * re-probe inline. Callers await this before consulting `mcpHealth` to
   * gate the capability block on harness session creation. Safe to call
   * concurrently — shares the in-flight promise.
   *
   * Default staleness: 5 minutes. The probe only protects against partial
   * deploys / broken builds, which are discrete events, so a short-ish
   * freshness window bounds exposure without polling idly.
   */
  private async ensureMcpHealthFresh(staleMs = 5 * 60_000): Promise<void> {
    if (this.mcpHealth && Date.now() - this.mcpHealthAt < staleMs) return
    await this.runMcpProbe()
  }

  setScheduler(scheduler: Scheduler) {
    this.scheduler = scheduler
  }

  /** Graceful shutdown: stop MCP servers, close connections, release resources. */
  async shutdown(): Promise<void> {
    try {
      await this.mcpManager.stopAll()
      log.info('MCP servers stopped')
    } catch (err) {
      log.error({ err }, 'Error stopping MCP servers')
    }
    // Kill any active PTY sessions
    for (const [id, proc] of this.ptys) {
      try {
        proc.kill()
      } catch {
        /* best-effort */
      }
      this.ptys.delete(id)
    }
    // Shutdown every registered session via the registry — harness
    // sessions get SIGTERM→SIGKILL on their CLI; Pi SDK sessions are
    // currently a no-op (no shutdown() method) but will pick it up for
    // free if one is added later.
    await this.sessions.shutdownAll()
    if (this.mcpIpcServer) {
      await this.mcpIpcServer.close()
      this.mcpIpcServer = null
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
        // Ephemeral: agent runs are one-shot; the finally-block below
        // deletes explicitly, but if an exception races that path the
        // registry's ephemeral pool caps the damage.
        this.sessions.put(runSessionId, session, 'ephemeral')

        log.info({ runSessionId, agentSessionId }, 'Created fresh agent run session')

        let eventCount = 0
        let summary = ''

        try {
          // Run the conversation
          eventCount = await this.handleChatMessage({ content, sessionId: runSessionId })

          log.info({ runSessionId, eventCount }, 'Agent run events produced')

          // Extract summary from the last assistant text
          try {
            const history = session.getHistory()
            log.debug(
              {
                runSessionId,
                historyLength: history.length,
                roles: history.map((h) => h.role).join(','),
              },
              'Agent run history entries',
            )
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].role === 'assistant' && history[i].content) {
                summary = String(history[i].content).slice(0, 2000)
                break
              }
            }
          } catch (extractErr) {
            log.warn({ err: extractErr }, 'Agent run summary extraction failed')
          }
        } catch (err) {
          log.error({ err, agentSessionId }, 'Agent run failed')
          throw err
        } finally {
          // Always clean up cached session (persisted to disk by the session itself)
          await this.sessions.delete(runSessionId)
        }

        return { eventCount, summary, runSessionId }
      },
    )
  }

  async start(): Promise<void> {
    // Block on the initial MCP shim probe so every harness session
    // created after `start()` returns sees a definitive mcpHealth
    // result. Probe timeout is 5s (see probeMcpShim), so startup is
    // bounded even if the shim is broken.
    if (this.initialMcpProbe) {
      log.info('awaiting initial MCP shim probe before opening WebSocket listener')
      await this.initialMcpProbe
    }

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

      // Unified webhook router: POST /_anton/webhooks/{provider}
      if (this.webhookRouter?.tryHandle(req, res)) return

      // Typed notifications from the oauth-proxy (e.g. Slack bot ownership
      // was transferred to another Anton). Signed with the connector's
      // forward_secret so only the legitimate proxy can reach it.
      if (req.method === 'POST' && req.url === '/_anton/proxy/notify') {
        this.handleProxyNotify(req, res).catch((err) => {
          log.error({ err }, '/_anton/proxy/notify failed')
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('internal error')
          }
        })
        return
      }

      // Backwards-compat alias for the legacy Telegram webhook URL.
      if (req.method === 'POST' && req.url === '/_anton/telegram/webhook') {
        // Rewrite and re-dispatch through the router so we don't duplicate logic.
        req.url = '/_anton/webhooks/telegram'
        if (this.webhookRouter?.tryHandle(req, res)) return
        res.writeHead(404)
        res.end('Telegram bot not configured')
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
      // View counter beacon
      if (req.method === 'POST' && req.url?.startsWith('/_anton/views/')) {
        const viewSlug = req.url.slice('/_anton/views/'.length)
        if (viewSlug && /^[a-zA-Z0-9_-]+$/.test(viewSlug)) {
          incrementViews(viewSlug)
        }
        res.writeHead(204)
        res.end()
        return
      }

      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('WebSocket connections only')
    })
    const plainWss = new WebSocketServer({ server: plainServer })
    plainWss.on('connection', (ws) => this.handleConnection(ws))

    plainServer.listen(port, () => {
      log.info({ port }, 'WebSocket server listening (plain)')
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
          log.info({ port: tlsPort }, 'WebSocket server listening (TLS, self-signed)')
        })
      } catch (err: unknown) {
        log.error({ err }, 'TLS server failed to start')
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

    // Activate all direct connectors (OAuth + API) with stored credentials
    await this.startConnectors()

    // Start webhook router and configured providers
    await this.startWebhooks()

    log.info({ agentId: this.config.agentId, token: this.config.token }, 'Server started')

    // Log all stored sessions for debugging sync issues
    this.logStoredSessions()
  }

  // ── Connection handling ─────────────────────────────────────────

  private handleConnection(ws: WebSocket) {
    log.info('Client connected, waiting for auth')

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

              // Client came back — cancel any pending detached-turn budget
              // timers; the turn is attached again and the user can steer it.
              if (this.detachedTurnTimers.size > 0) {
                for (const [sessionId, timer] of this.detachedTurnTimers) {
                  clearTimeout(timer)
                  log.debug({ sessionId }, 'Client reconnected, cleared detached budget')
                }
                this.detachedTurnTimers.clear()
              }

              // Build auth_ok with version compatibility + update info
              const authOk: Record<string, unknown> = {
                type: 'auth_ok',
                agentId: this.config.agentId,
                version: VERSION,
                gitHash: GIT_HASH,
                domain: process.env.ANTON_HOST || undefined,
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
              log.info('Client authenticated')

              // Send per-session status for active turns so the client
              // knows exactly which sessions are still working after reconnect
              for (const sessionId of this.activeTurns) {
                this.sendToClient(Channel.EVENTS, {
                  type: 'routine_status',
                  status: 'working',
                  sessionId,
                })
              }
              // If nothing is active, send a global idle to clear any stale client state
              if (this.activeTurns.size === 0) {
                this.sendToClient(Channel.EVENTS, {
                  type: 'routine_status',
                  status: 'idle',
                })
              }

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
        log.error({ err }, 'Message error')
      }
    })

    ws.on('close', () => {
      if (ws === this.activeClient) {
        this.activeClient = null
        // If there are pending interactive prompts (ask_user, confirm), don't cancel
        // those turns — the user just needs to reconnect and answer
        if (this.pendingPrompts.size > 0) {
          log.info(
            { pendingPrompts: this.pendingPrompts.size },
            'Client disconnected with pending prompts, keeping turns alive',
          )
        } else {
          const disconnectMode = this.config.sessions?.disconnectMode ?? 'attached'
          const detachedBudgetMs = this.config.sessions?.detachedTurnMaxMs ?? 10 * 60 * 1000
          // Cancel interactive turns but keep background work (sub-agents, agent jobs) alive
          for (const sessionId of this.activeTurns) {
            // Sub-agent sessions (sub_*) and agent sessions continue in background
            if (
              sessionId.startsWith('sub_') ||
              sessionId.startsWith('agent-job-') ||
              sessionId.startsWith('agent--')
            ) {
              log.debug({ sessionId }, 'Keeping background turn alive')
              continue
            }
            if (disconnectMode === 'detached') {
              // User opted in: let the turn run unattended. Schedule a
              // hard wall-clock cancel so a zombie turn can't burn
              // tokens forever if the user never comes back.
              log.info(
                { sessionId, budgetMs: detachedBudgetMs },
                'Detached mode: keeping turn alive, scheduling budget cancel',
              )
              this.scheduleDetachedTurnBudget(sessionId, detachedBudgetMs)
              continue
            }
            const session = this.sessions.get(sessionId)
            if (session) {
              log.info({ sessionId }, 'Cancelling active turn on disconnect')
              session.cancel()
            }
          }
          // Only clear non-background, non-detached turns. Detached turns
          // stay in activeTurns so the registry pin holds until the turn
          // actually ends.
          for (const sessionId of this.activeTurns) {
            const isBackground =
              sessionId.startsWith('sub_') ||
              sessionId.startsWith('agent-job-') ||
              sessionId.startsWith('agent--')
            if (!isBackground && disconnectMode !== 'detached') {
              this.activeTurns.delete(sessionId)
            }
          }
        }
        // Kill all PTY sessions
        for (const [id, p] of this.ptys) {
          try {
            p.kill()
          } catch {}
          this.ptys.delete(id)
        }
        log.info('Client disconnected')
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
        log.warn({ channel }, 'Unknown channel')
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
      case 'sessions':
        value = this.config.sessions ?? {}
        break
      case 'system_prompt': {
        // If a session is active, return the full composed prompt (what the model actually sees)
        if (sessionId) {
          const session = this.sessions.get(sessionId)
          if (session && !isHarnessSession(session)) {
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
          // Merge rather than overwrite so partial updates (e.g. just tourCompleted)
          // don't drop previously-saved fields like `role` or `completed`.
          this.config.onboarding = {
            ...this.config.onboarding,
            ...(value as NonNullable<typeof this.config.onboarding>),
          }
          saveConfig(this.config)
          break
        case 'sessions':
          this.config.sessions = {
            ...(this.config.sessions ?? { ttlDays: 7 }),
            ...(value as NonNullable<typeof this.config.sessions>),
          }
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
    // Stream sidecar output to desktop via WebSocket.
    // The sidecar runs `anton computer update --json` which emits NDJSON.
    // The agent stays alive during clone/install/build, so the desktop sees
    // real-time progress. When the CLI stops the agent for the swap,
    // the WebSocket dies and the desktop shows "restarting...".
    // On reconnect, auth_ok version comparison determines success/failure.
    const sidecarPort = Number(process.env.SIDECAR_PORT) || 9878
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/update/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.ANTON_TOKEN ?? this.config.token}` },
        signal: AbortSignal.timeout(600_000),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        this.sendToClient(Channel.CONTROL, {
          type: 'update_progress',
          stage: 'error',
          message: `Sidecar error: ${res.status} ${body}`,
        })
        return
      }

      if (!res.body) {
        this.sendToClient(Channel.CONTROL, {
          type: 'update_progress',
          stage: 'error',
          message: 'No response from sidecar',
        })
        return
      }

      // Stream NDJSON lines — each is {"stage":"...","message":"..."}
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const progress = JSON.parse(trimmed) as { stage: string; message: string }
            this.sendToClient(Channel.CONTROL, {
              type: 'update_progress',
              stage: progress.stage,
              message: progress.message,
            })
          } catch {
            // Non-JSON line from CLI — skip
          }
        }
      }
    } catch (err) {
      // If the agent is being killed for the swap, this is expected
      log.info({ err }, 'update stream ended (expected during restart)')
    }
  }

  // ── Terminal channel ────────────────────────────────────────────

  private async handleTerminal(payload: Uint8Array) {
    const msg = parseJsonPayload<TerminalMessage>(payload)

    switch (msg.type) {
      case 'pty_spawn': {
        // Kill existing PTY with same ID if any
        const existing = this.ptys.get(msg.id)
        if (existing) {
          try {
            existing.kill()
          } catch {}
          this.ptys.delete(msg.id)
        }

        const shell = msg.shell || process.env.SHELL || '/bin/bash'
        const cols = msg.cols || 80
        const rows = msg.rows || 24
        const cwd = msg.cwd || process.env.HOME || '/'

        let p: PtyHandle
        try {
          const ptyMod = await loadNodePty()
          if (ptyMod) {
            const ptyProc = ptyMod.spawn(shell, [], {
              name: 'xterm-256color',
              cols,
              rows,
              cwd,
              env: {
                ...process.env,
                TERM: 'xterm-256color',
              } as Record<string, string>,
            })
            p = {
              write: (data) => ptyProc.write(data),
              resize: (c, r) => ptyProc.resize(c, r),
              kill: () => ptyProc.kill(),
              onData: (cb) => ptyProc.onData(cb),
              onExit: (cb) => ptyProc.onExit(cb),
            }
          } else {
            p = spawnFallback(shell, cols, rows, cwd)
          }
        } catch (err) {
          log.error({ err, ptyId: msg.id, shell }, 'Failed to spawn PTY')
          this.sendToClient(Channel.TERMINAL, { type: 'pty_close', id: msg.id })
          break
        }

        this.ptys.set(msg.id, p)

        p.onData((data: string) => {
          const b64 = Buffer.from(data, 'utf-8').toString('base64')
          try {
            this.sendToClient(Channel.TERMINAL, { type: 'pty_data', id: msg.id, data: b64 })
          } catch {}
        })

        p.onExit(() => {
          this.ptys.delete(msg.id)
          try {
            this.sendToClient(Channel.TERMINAL, { type: 'pty_close', id: msg.id })
          } catch {}
        })

        log.info({ ptyId: msg.id, shell }, 'PTY spawned')
        break
      }

      case 'pty_data': {
        const p = this.ptys.get(msg.id)
        if (p) {
          const decoded = Buffer.from(msg.data, 'base64').toString('utf-8')
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
          try {
            p.kill()
          } catch {}
          this.ptys.delete(msg.id)
        }
        break
      }
    }
  }

  // ── Filesync channel ────────────────────────────────────────────

  private static readonly IMAGE_EXTS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'avif',
    'bmp',
    'ico',
    'heic',
    'heif',
  ])
  // SVG is text (XML) — read as UTF-8, not binary
  private static readonly MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20MB cap for binary reads

  private static readonly IMAGE_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    heic: 'image/heic',
    heif: 'image/heif',
  }

  // Binary document MIME lookup for fs_read_bytes. Images still go through IMAGE_MIME.
  private static readonly BINARY_DOC_MIME: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
  }

  // Hard cap for arbitrary binary reads (e.g. artifact previews). 500MB.
  private static readonly MAX_BINARY_READ_BYTES = 500 * 1024 * 1024

  /** Check if a resolved path is within the active workspace.
   *  When no workspace is set (non-project context), allows all paths.
   *  Follows symlinks on the workspace to prevent symlink-based escapes. */
  private isPathWithinWorkspace(targetPath: string): boolean {
    if (!this.activeWorkspacePath) return true // no sandbox when no project
    let workspace: string
    try {
      workspace = realpathSync(resolve(this.activeWorkspacePath))
    } catch {
      workspace = resolve(this.activeWorkspacePath)
    }
    const resolved = resolve(targetPath)
    return resolved === workspace || resolved.startsWith(`${workspace}/`)
  }

  private async handleFilesync(payload: Uint8Array) {
    const msg = parseJsonPayload<{
      type: string
      path?: string
      showHidden?: boolean
      content?: string
      encoding?: string
      name?: string
    }>(payload)

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
            .filter((e) => msg.showHidden || !e.name.startsWith('.'))
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
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_list_response',
            path: msg.path,
            entries: result,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_list_response',
            path: msg.path,
            entries: [],
            error: (err as Error).message,
          })
        }
        break
      }

      case 'fs_read': {
        const filePath = msg.path || ''
        const encoding = msg.encoding === 'base64' ? 'base64' : 'utf-8'
        try {
          const { readFileSync, statSync } = await import('node:fs')
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const wantBinary = encoding === 'base64' || AgentServer.IMAGE_EXTS.has(ext)
          if (wantBinary) {
            // Binary read — return base64
            const stat = statSync(filePath)
            if (stat.size > AgentServer.MAX_IMAGE_BYTES) {
              this.sendToClient(Channel.FILESYNC, {
                type: 'fs_read_response',
                path: filePath,
                content: '',
                error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is 20MB.`,
              })
              break
            }
            const buf = readFileSync(filePath)
            this.sendToClient(Channel.FILESYNC, {
              type: 'fs_read_response',
              path: filePath,
              content: buf.toString('base64'),
              encoding: 'base64',
              mimeType: AgentServer.IMAGE_EXTS.has(ext)
                ? AgentServer.IMAGE_MIME[ext] || 'application/octet-stream'
                : undefined,
              size: stat.size,
              truncated: false,
            })
          } else {
            const content = readFileSync(filePath, 'utf-8')
            const truncated = content.length > 100_000 ? content.slice(0, 100_000) : content
            this.sendToClient(Channel.FILESYNC, {
              type: 'fs_read_response',
              path: filePath,
              content: truncated,
              truncated: content.length > 100_000,
            })
          }
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

      case 'fs_read_bytes': {
        // Dedicated binary read for artifact previews / client-side rendering of
        // user-uploaded files (docx, xlsx, pdf, images). Returns base64 content
        // plus a best-effort MIME type. Separate from fs_read so the cap and
        // semantics can diverge (fs_read stays agent-facing and text-first).
        const filePath = msg.path || ''
        if (!this.isPathWithinWorkspace(filePath)) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_read_bytes_response',
            path: filePath,
            content: '',
            error: 'Read denied: path is outside the project workspace',
          })
          break
        }
        try {
          const { readFileSync, statSync } = await import('node:fs')
          const stat = statSync(filePath)
          if (!stat.isFile()) {
            this.sendToClient(Channel.FILESYNC, {
              type: 'fs_read_bytes_response',
              path: filePath,
              content: '',
              error: 'Path is not a file',
            })
            break
          }
          if (stat.size > AgentServer.MAX_BINARY_READ_BYTES) {
            this.sendToClient(Channel.FILESYNC, {
              type: 'fs_read_bytes_response',
              path: filePath,
              content: '',
              size: stat.size,
              error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is ${Math.round(AgentServer.MAX_BINARY_READ_BYTES / 1024 / 1024)}MB.`,
            })
            break
          }
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const mimeType =
            AgentServer.IMAGE_MIME[ext] ||
            AgentServer.BINARY_DOC_MIME[ext] ||
            'application/octet-stream'
          const buf = readFileSync(filePath)
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_read_bytes_response',
            path: filePath,
            content: buf.toString('base64'),
            encoding: 'base64',
            mimeType,
            size: stat.size,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_read_bytes_response',
            path: filePath,
            content: '',
            error: (err as Error).message,
          })
        }
        break
      }

      case 'fs_write': {
        const filePath = msg.path || ''
        // Path sandboxing: only allow writes within the active workspace
        if (!this.isPathWithinWorkspace(filePath)) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_write_response',
            path: filePath,
            success: false,
            error: 'Write denied: path is outside the project workspace',
          })
          break
        }
        try {
          const { writeFileSync, mkdirSync } = await import('node:fs')
          const { dirname } = await import('node:path')
          mkdirSync(dirname(filePath), { recursive: true })
          const buf =
            msg.encoding === 'base64'
              ? Buffer.from(msg.content || '', 'base64')
              : Buffer.from(msg.content || '', 'utf-8')
          writeFileSync(filePath, buf)
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_write_response',
            path: filePath,
            success: true,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_write_response',
            path: filePath,
            success: false,
            error: (err as Error).message,
          })
        }
        break
      }

      case 'fs_mkdir': {
        const dirPath = msg.path || ''
        // Path sandboxing: only allow mkdir within the active workspace
        if (!this.isPathWithinWorkspace(dirPath)) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_mkdir_response',
            path: dirPath,
            success: false,
            error: 'Mkdir denied: path is outside the project workspace',
          })
          break
        }
        try {
          const { mkdirSync } = await import('node:fs')
          mkdirSync(dirPath, { recursive: true })
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_mkdir_response',
            path: dirPath,
            success: true,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_mkdir_response',
            path: dirPath,
            success: false,
            error: (err as Error).message,
          })
        }
        break
      }

      case 'fs_delete': {
        const filePath = msg.path || ''
        // Path sandboxing: only allow deletes within the active workspace
        if (!this.isPathWithinWorkspace(filePath)) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_delete_response',
            path: filePath,
            success: false,
            error: 'Delete denied: path is outside the project workspace',
          })
          break
        }
        try {
          const { rmSync } = await import('node:fs')
          rmSync(filePath, { recursive: true })
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_delete_response',
            path: filePath,
            success: true,
          })
        } catch (err: unknown) {
          this.sendToClient(Channel.FILESYNC, {
            type: 'fs_delete_response',
            path: filePath,
            success: false,
            error: (err as Error).message,
          })
        }
        break
      }

      default:
        log.warn({ msgType: msg.type }, 'Unknown filesync message type')
    }
  }

  // ── AI channel ──────────────────────────────────────────────────

  private async handleAi(payload: Uint8Array) {
    const msg = parseJsonPayload<AiMessage>(payload)

    switch (msg.type) {
      // ── Session lifecycle ──
      case 'session_create':
        this.handleSessionCreate(msg).catch((err) => {
          log.error({ err, sessionId: msg.id }, 'handleSessionCreate rejected unexpectedly')
        })
        break

      case 'sessions_list':
        this.handleSessionsList()
        break

      case 'sessions_sync':
        this.handleSessionsSync(msg as { lastSyncVersion: number })
        break

      case 'usage_stats':
        this.handleUsageStats()
        break

      case 'session_destroy':
        void this.handleSessionDestroy(msg)
        break

      case 'session_provider_switch':
        void this.handleSessionProviderSwitch(msg)
        break

      case 'session_history':
        this.handleSessionHistory(msg)
        break

      case 'session_set_thinking_level':
        this.handleSessionSetThinkingLevel(msg)
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

      case 'detect_harnesses':
        this.handleDetectHarnesses()
        break

      case 'harness_setup':
        this.handleHarnessSetup(msg)
        break

      // ── Skills ──
      case 'skill_list':
        this.handleSkillList()
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

      // ── Routines ──
      case 'routine_create':
        this.handleRoutineCreate(msg)
        break
      case 'routines_list':
        this.handleRoutinesList(msg)
        break
      case 'routine_action':
        this.handleRoutineAction(msg)
        break

      case 'routine_update':
        this.handleRoutineUpdate(msg)
        break
      case 'routine_run_logs':
        this.handleRoutineRunLogs(msg)
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
      case 'workflow_activate':
        this.handleWorkflowActivate(msg)
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
        this.handleConnectorOAuthDisconnect(msg).catch((err) =>
          log.error({ err, provider: msg.provider }, 'OAuth disconnect failed'),
        )
        break
      case 'connector_set_tool_permission':
        this.handleConnectorSetToolPermission(msg)
        break

      // ── Publish artifacts ──
      case 'publish_artifact':
        this.handlePublishArtifact(msg)
        break
      case 'published_list':
        this.handlePublishedList()
        break
      case 'unpublish':
        this.handleUnpublish(msg)
        break

      // ── Chat messages ──
      case 'message':
        await this.handleChatMessage(msg)
        break

      // ── Steering: user sends a message while the agent is working ──
      case 'steer': {
        const steerSessionId = msg.sessionId || DEFAULT_SESSION_ID
        const steerSession = this.sessions.get(steerSessionId)
        if (
          steerSession &&
          !isHarnessSession(steerSession) &&
          this.activeTurns.has(steerSessionId)
        ) {
          steerSession.steer(msg.content, msg.attachments)
          this.sendToClient(Channel.AI, {
            type: 'steer_ack',
            content: msg.content,
            sessionId: steerSessionId,
            attachments: msg.attachments,
          })
          log.info(
            { sessionId: steerSessionId, content: msg.content.slice(0, 60) },
            'Steering session',
          )
        } else {
          // Session not active — treat as a regular message
          await this.handleChatMessage({
            content: msg.content,
            sessionId: msg.sessionId,
            attachments: msg.attachments,
          })
        }
        break
      }

      // ── Cancel turn: user clicks stop button ──
      case 'cancel_turn': {
        const cancelSessionId = msg.sessionId || DEFAULT_SESSION_ID
        const cancelSession = this.sessions.get(cancelSessionId)
        if (cancelSession && this.activeTurns.has(cancelSessionId)) {
          log.info({ sessionId: cancelSessionId }, 'Cancelling turn via client request')
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
    projectId?: string
  }) {
    try {
      // Reject if slug is already taken by a different artifact
      if (msg.slug) {
        const existing = getPublished(msg.slug)
        if (existing?.artifactId && existing.artifactId !== msg.artifactId) {
          this.sendToClient(Channel.AI, {
            type: 'publish_artifact_response',
            artifactId: msg.artifactId,
            publicUrl: '',
            slug: msg.slug,
            success: false,
            error: `Slug "${msg.slug}" is already used by "${existing.title}". Choose a different slug.`,
          })
          return
        }
      }

      const result = executePublish(
        {
          title: msg.title,
          content: msg.content,
          type: msg.contentType,
          language: msg.language,
          slug: msg.slug,
        },
        process.env.ANTON_HOST,
      )

      // Extract slug and URL from the result string
      const urlMatch = result.match(/→ (.+)$/)
      const publicUrl = urlMatch?.[1] || ''
      const slugMatch = publicUrl.match(/\/a\/([^/]+)$/)
      const slug = slugMatch?.[1] || msg.slug || ''

      // Save metadata to published index
      savePublishedMeta({
        slug,
        artifactId: msg.artifactId,
        title: msg.title,
        type: msg.contentType,
        language: msg.language,
        description:
          msg.content
            .slice(0, 200)
            .replace(/[#*_\n]/g, ' ')
            .trim() || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectId: msg.projectId,
        views: 0,
      })

      // Symlink published file into project workspace
      if (msg.projectId) {
        try {
          const project = loadProject(msg.projectId)
          if (project?.workspacePath) {
            const publishedDir = join(project.workspacePath, 'published')
            mkdirSync(publishedDir, { recursive: true })
            const linkPath = join(publishedDir, `${slug}.html`)
            const targetPath = join(getPublishedDir(), slug, 'index.html')
            // Remove existing symlink if re-publishing same slug
            if (existsSync(linkPath)) {
              try {
                unlinkSync(linkPath)
              } catch {
                /* ignore */
              }
            }
            symlinkSync(targetPath, linkPath)
          }
        } catch {
          // Non-critical — don't fail the publish if symlink fails
        }
      }

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

  private handlePublishedList() {
    this.sendToClient(Channel.AI, {
      type: 'published_list_response',
      host: process.env.ANTON_HOST || undefined,
      pages: listPublished(),
    })
  }

  private handleUnpublish(msg: { slug: string }) {
    try {
      removePublished(msg.slug)
      this.sendToClient(Channel.AI, {
        type: 'unpublish_response',
        slug: msg.slug,
        success: true,
      })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'unpublish_response',
        slug: msg.slug,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  // ── Session handlers ────────────────────────────────────────────

  private async handleSessionCreate(msg: {
    id: string
    provider?: string
    model?: string
    apiKey?: string
    projectId?: string
    thinkingLevel?: ThinkingLevel
  }) {
    try {
      // Determine provider type (harness vs API)
      const providerName = msg.provider || this.config.defaults.provider
      const providerConfig = this.config.providers[providerName] || DEFAULT_PROVIDERS[providerName]

      if (providerConfig?.type === 'harness') {
        // Re-probe if the last probe is stale. createHarnessSession bakes
        // the capability-block decision into the CLI's system prompt at
        // creation time — a stale "ok" result would ship connector tools
        // the shim can't actually serve.
        await this.ensureMcpHealthFresh()
        // Harness sessions are created via createHarnessSession() so the
        // same setup code runs for both fresh starts and provider-switch
        // rebuilds. See that method for the full wiring.
        const model = msg.model || this.config.defaults.model
        this.createHarnessSession({
          id: msg.id,
          providerName,
          model,
          projectId: msg.projectId,
          thinkingLevel: msg.thinkingLevel,
        })
      } else {
        // ── Standard API session (Pi SDK) ──
        const session = createSession(
          msg.id,
          this.config,
          this.buildSessionOptions(msg.id, msg.projectId, {
            provider: msg.provider,
            model: msg.model,
            apiKey: msg.apiKey,
            domain: process.env.ANTON_HOST,
            thinkingLevel: msg.thinkingLevel,
          }),
        )

        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.put(msg.id, session, 'conversation')

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

        log.info(
          {
            sessionId: msg.id,
            provider: session.provider,
            model: session.model,
            projectId: msg.projectId,
          },
          'Session created',
        )
      }

      // Update project stats so session count is accurate
      if (msg.projectId) {
        updateProjectStats(msg.projectId)
        const updatedProject = loadProject(msg.projectId)
        if (updatedProject) {
          this.sendToClient(Channel.AI, { type: 'project_updated', project: updatedProject })
          if (updatedProject.workspacePath) {
            this.activeWorkspacePath = updatedProject.workspacePath
          }
        }
      }
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to create session: ${(err as Error).message}`,
        sessionId: msg.id,
      })
    }
  }

  /**
   * Build + register a HarnessSession. Shared between fresh
   * session-start and provider-switch. Does all the wiring:
   *   • Adapter selection
   *   • IPC auth token + registration
   *   • Harness session context (for tool registry scoping)
   *   • Per-turn system-prompt builder (loads memory on first turn,
   *     emits context_info to the client, injects an optional
   *     `replaySeedForFirstTurn` for provider-switch continuity)
   *   • Mirror + project-history onTurnEnd callback
   *   • ensureHarnessSessionInit so meta.json exists
   *   • Announces session_created so the client renders the session
   */
  /**
   * Public so webhook surfaces (Slack, Telegram) can create harness
   * sessions with the same wiring desktop uses. The `surface` opt
   * controls which connector tools the tool-registry exposes for the
   * session — defaults to 'desktop' for back-compat with the original
   * caller.
   */
  createHarnessSession(opts: {
    id: string
    providerName: string
    model: string
    projectId?: string
    /** Surface label for tool-registry filtering. Defaults to 'desktop'. */
    surface?: string
    /**
     * One-shot context block prepended to the first turn's system
     * prompt after a provider switch. On turn 0 it's included; on
     * subsequent turns the CLI's own resume tape carries history.
     */
    replaySeedForFirstTurn?: string
    /** Initial reasoning effort (Codex harness only — Claude Code CLI has no flag). */
    thinkingLevel?: ThinkingLevel
  }): HarnessSession | CodexHarnessSession {
    const {
      id,
      providerName,
      model,
      projectId: harnessProjectId,
      surface: surfaceLabel = 'desktop',
      replaySeedForFirstTurn,
      thinkingLevel,
    } = opts

    // Legacy HarnessSession (Claude Code) still needs a spawn adapter.
    // Codex sessions construct CodexHarnessSession directly below and
    // don't touch this variable — so we only build it for non-codex.
    const adapter = providerName === 'codex' ? null : new ClaudeAdapter()
    const socketPath = join(getAntonDir(), 'harness.sock')
    // Shim path + node binary come from buildMcpSpawnConfig(), which
    // resolves the shim via import.meta.url (package-owned) and uses
    // process.execPath for the node binary. This replaces the previous
    // `homedir() + '../node_modules/...'` construction which broke on
    // VPS deployments where HOME != install root.
    const mcpSpawn = buildMcpSpawnConfig()

    // Resolve workspace path from the project (if any)
    let cwd: string | undefined
    if (harnessProjectId) {
      const project = loadProject(harnessProjectId)
      if (project?.workspacePath) cwd = project.workspacePath
    }

    // Per-session IPC auth token — registered BEFORE the shim can connect.
    const authToken = randomBytes(32).toString('base64url')
    if (this.mcpIpcServer) {
      this.mcpIpcServer.registerSession(id, authToken)
    } else {
      log.error(
        { sessionId: id },
        'MCP IPC server not initialized — harness session cannot authenticate',
      )
    }

    // Register the tool-registry session context so project-scoped
    // tools (activate_workflow, update_project_context) and surface-
    // filtered connector tools resolve correctly for this session.
    this.harnessSessionContexts.set(id, {
      projectId: harnessProjectId,
      workspacePath: cwd,
      surface: surfaceLabel,
      onActivateWorkflow: harnessProjectId ? this.buildActivateWorkflowHandler() : undefined,
      onAskUser: this.buildHarnessAskUserHandler(id),
      // Routine management (`routine` MCP tool). Same handler Pi SDK
      // uses inline via agent.ts; only meaningful when the session is
      // attached to a project.
      onJobAction: harnessProjectId ? this.buildAgentActionHandler(id) : undefined,
      // Browser-state callbacks for the `browser` MCP tool. Late-binds
      // through `this.sessions.get(id)` because the session itself is
      // created a few lines below — callbacks fire only after the
      // session exists.
      browserCallbacks: this.buildHarnessBrowserCallbacks(id),
      // `set_session_title` MCP tool handler. Late-binds through
      // `this.sessions.get(id)` because the session is constructed a
      // few lines below. Both HarnessSession and CodexHarnessSession
      // expose `setTitle(title: string)` which emits `title_update`.
      onSetTitle: (title: string) => {
        const s = this.sessions.get(id) as
          | { setTitle?: (t: string) => void; getTitle?: () => string }
          | undefined
        if (!s || typeof s.setTitle !== 'function') return
        s.setTitle(title)
        // Persist to meta.json so the title survives a client reload —
        // the `title_update` event only updates connected clients, and
        // on reconnect the server reads titles from disk (buildSessionList
        // + listProjectSessions). We read back via getTitle() so disk and
        // memory stay in lockstep even if setTitle ever changes its
        // normalization rules.
        const normalized = typeof s.getTitle === 'function' ? s.getTitle() : title
        try {
          writeHarnessSessionTitle({
            sessionId: id,
            projectId: harnessProjectId,
            title: normalized,
          })
        } catch (err) {
          log.warn({ err, sessionId: id }, 'failed to persist harness session title')
        }
      },
    })

    // Per-turn system-prompt builder — mirrors Pi SDK's layer assembly
    // so harness turns see the same Anton-owned state. Memory loads on
    // the first turn using the user's first message for keyword
    // matching; subsequent turns reuse the cache.
    let cachedMemoryData:
      | Awaited<ReturnType<typeof assembleConversationContext>>['memoryData']
      | undefined
    let cachedContextInfoSent = false
    let replaySeedConsumed = false
    const buildSystemPrompt = async (userMessage: string, turnIndex: number): Promise<string> => {
      const project = harnessProjectId ? loadProject(harnessProjectId) : undefined
      const projectInstructions = harnessProjectId ? loadProjectInstructions(harnessProjectId) : ''

      if (turnIndex === 0) {
        const assembled = assembleConversationContext(id, userMessage, harnessProjectId)
        cachedMemoryData = assembled.memoryData

        if (!cachedContextInfoSent) {
          cachedContextInfoSent = true
          this.sendToClient(Channel.AI, {
            type: 'context_info',
            sessionId: id,
            globalMemories: assembled.contextInfo.globalMemories,
            conversationMemories: assembled.contextInfo.conversationMemories,
            crossConversationMemories: assembled.contextInfo.crossConversationMemories,
            projectId: assembled.contextInfo.projectId,
          })
        }
      }

      // Build the per-turn project-context block
      let projectContextBlock: string | undefined
      if (project) {
        const lines: string[] = [
          'You are running inside Anton, a personal AI computer.',
          `Project: ${project.name}`,
        ]
        if (project.description) lines.push(`Description: ${project.description}`)
        if (projectInstructions) lines.push(`\nProject Instructions:\n${projectInstructions}`)
        if (project.context.summary) lines.push(`\nProject Summary:\n${project.context.summary}`)
        projectContextBlock = lines.join('\n')
      }

      const base = buildHarnessContextPrompt({
        projectContext: projectContextBlock,
        projectId: harnessProjectId,
        workspacePath: cwd,
        memoryData: cachedMemoryData,
        availableWorkflows: this.getAvailableWorkflowsForPrompt(),
      })

      // Inject the replay seed ONCE, on the first turn only. From turn
      // 1 onward the CLI's own --resume tape carries the history.
      if (turnIndex === 0 && replaySeedForFirstTurn && !replaySeedConsumed) {
        replaySeedConsumed = true
        return `${base}${replaySeedForFirstTurn}`
      }
      return base
    }

    // Ensure meta.json + empty messages.jsonl exist
    try {
      ensureHarnessSessionInit({
        sessionId: id,
        projectId: harnessProjectId,
        provider: providerName,
        model,
      })
    } catch (err) {
      log.warn(
        { err, sessionId: id },
        'failed to initialize harness session on disk — mirror will be incomplete',
      )
    }

    const mirrorProjectId = harnessProjectId
    const onTurnEnd = async (turn: {
      userMessage: string
      events: Parameters<
        NonNullable<ConstructorParameters<typeof HarnessSession>[0]['onTurnEnd']>
      >[0]['events']
    }) => {
      const messages = synthesizeHarnessTurn(turn.userMessage, turn.events)
      const firstText = turn.events.find((e) => e.type === 'text') as
        | { content: string }
        | undefined
      // Prefer the session's own title — it reflects `set_session_title`
      // when the model called it, or the turn-0 user-message seed
      // otherwise. Fall back to the assistant's first text snippet only
      // if the session somehow has no title yet (e.g., a `turnIndex > 0`
      // replay edge case). This avoids meta.json latching onto AI prose
      // like "I'm checking both of your Google Calendar accounts..." as
      // the conversation title.
      const sessionForTitle = this.sessions.get(id) as
        | { getTitle?: () => string }
        | undefined
      const sessionTitle =
        typeof sessionForTitle?.getTitle === 'function' ? sessionForTitle.getTitle() : ''
      const turnTitle = sessionTitle || firstText?.content
      appendHarnessTurn({
        sessionId: id,
        projectId: mirrorProjectId,
        messages,
        firstTitle: turnTitle,
      })

      // Capture update_project_context tool-result from this turn.
      const pendingToolNames = new Map<string, string>()
      let projectContextUpdate: { sessionSummary: string; projectSummary?: string } | undefined
      for (const ev of turn.events) {
        if (ev.type === 'tool_call') {
          pendingToolNames.set(ev.id, ev.name)
        } else if (ev.type === 'tool_result') {
          if (pendingToolNames.get(ev.id) === 'update_project_context') {
            try {
              const parsed = JSON.parse(ev.output) as {
                sessionSummary?: unknown
                projectSummary?: unknown
              }
              if (typeof parsed.sessionSummary === 'string') {
                projectContextUpdate = {
                  sessionSummary: parsed.sessionSummary,
                  projectSummary:
                    typeof parsed.projectSummary === 'string' ? parsed.projectSummary : undefined,
                }
              }
            } catch {
              /* malformed — ignore */
            }
          }
          pendingToolNames.delete(ev.id)
        }
      }

      if (mirrorProjectId && turnTitle) {
        try {
          const title = turnTitle.slice(0, 60).split('\n')[0]
          const sessionSummary = projectContextUpdate?.sessionSummary || title
          if (projectContextUpdate?.projectSummary) {
            updateProjectContext(mirrorProjectId, 'summary', projectContextUpdate.projectSummary)
          }
          appendSessionHistory(mirrorProjectId, {
            sessionId: id,
            title,
            summary: sessionSummary,
            ts: Date.now(),
          })
          updateProjectStats(mirrorProjectId)
          const updatedProject = loadProject(mirrorProjectId)
          if (updatedProject) {
            this.sendToClient(Channel.AI, { type: 'project_updated', project: updatedProject })
          }
        } catch (err) {
          log.warn(
            { err, sessionId: id, projectId: mirrorProjectId },
            'harness project-history update failed',
          )
        }
      }

      // Fire-and-forget background memory extraction. Mirrors what
      // Pi SDK does via session.maybeExtractMemories(). Silently
      // skips if no Pi SDK provider has an API key configured.
      this.runHarnessMemoryExtraction(id, mirrorProjectId)
    }

    const liveConnectorsAtStart = this.collectLiveConnectorsForPrompt(surfaceLabel)
    // Gate on MCP shim health. If the shim probe failed (or hasn't run
    // yet), we skip emitting the capability block entirely — the model
    // would otherwise believe it can call connector tools when the
    // transport is dead. We log once at creation so the operator can
    // correlate missing tools with a known probe failure.
    const mcpReady = this.mcpHealth?.ok === true
    if (!mcpReady) {
      log.warn(
        { sessionId: id, mcpHealth: this.mcpHealth },
        'MCP shim probe not ok — omitting capability block from harness session',
      )
    }
    const capabilityBlock = mcpReady
      ? buildHarnessCapabilityBlock(liveConnectorsAtStart, ANTON_MCP_NAMESPACE)
      : ''
    const liveConnectorIdsAtStart = mcpReady ? liveConnectorsAtStart.map((c) => c.id) : []

    const session: HarnessSession | CodexHarnessSession =
      providerName === 'codex'
        ? new CodexHarnessSession({
            id,
            provider: providerName,
            model,
            mcp: { socketPath, authToken, spawn: mcpSpawn },
            cwd,
            buildSystemPrompt,
            capabilityBlock,
            capabilityConnectorIds: liveConnectorIdsAtStart,
            onTurnEnd,
            thinkingLevel,
          })
        : new HarnessSession({
            id,
            provider: providerName,
            model,
            // Non-codex branch: adapter is guaranteed non-null by
            // construction above (only the codex branch sets it to null).
            // thinkingLevel is intentionally ignored here — the Claude Code
            // CLI has no thinking/budget flag, so the composer's Effort pill
            // is hidden for claude harness sessions.
            adapter: adapter ?? new ClaudeAdapter(),
            mcp: { socketPath, authToken, spawn: mcpSpawn },
            cwd,
            buildSystemPrompt,
            onTurnEnd,
          })
    // Harness sessions share the `conversation` pool with Pi SDK chats.
    // Agent-run variants come through createSession with 'ephemeral'.
    this.sessions.put(id, session, 'conversation')

    this.sendToClient(Channel.AI, {
      type: 'session_created',
      id,
      provider: providerName,
      model,
    })

    log.info(
      {
        sessionId: id,
        provider: providerName,
        model,
        type: 'harness',
        switched: Boolean(replaySeedForFirstTurn),
      },
      'Harness session created',
    )

    return session
  }

  /**
   * Swap the provider/model of an existing harness session without
   * losing its conversation history. Tears down the current
   * HarnessSession (cancels the CLI if running, clears auth +
   * context), then rebuilds via createHarnessSession with a replay
   * seed drawn from the mirrored messages.jsonl so the new CLI starts
   * its first turn with full context.
   */
  private async handleSessionProviderSwitch(msg: {
    id: string
    provider: string
    model: string
  }): Promise<void> {
    const existing = this.sessions.get(msg.id)
    if (!existing) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Session not found: ${msg.id}`,
        sessionId: msg.id,
      })
      return
    }
    if (!isHarnessSession(existing)) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: 'Provider switching is only supported for harness (BYOS) sessions.',
        sessionId: msg.id,
      })
      return
    }

    // Validate the requested provider is a harness type — refusing here
    // prevents the caller from silently dead-ending into an incompatible
    // Pi SDK flow.
    const newProviderConfig = this.config.providers[msg.provider] || DEFAULT_PROVIDERS[msg.provider]
    if (newProviderConfig?.type !== 'harness') {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Provider ${msg.provider} is not a harness provider.`,
        sessionId: msg.id,
      })
      return
    }

    const projectId = this.harnessSessionContexts.get(msg.id)?.projectId

    // Drop external bookkeeping BEFORE the registry tears down the
    // subprocess, mirroring the onEvict ordering — any in-flight MCP
    // call from the soon-to-be-dead session fails with a clean "unknown
    // session" instead of racing a dangling auth entry.
    if (this.mcpIpcServer) {
      this.mcpIpcServer.unregisterSession(msg.id)
    }
    this.harnessSessionContexts.delete(msg.id)
    this.activeTurns.delete(msg.id)
    // registry.delete() runs shutdown() — the SIGTERM → SIGKILL ladder
    // inside HarnessSession.shutdown already waits for the CLI to exit.
    // We deliberately don't call shutdown() ourselves first; it isn't
    // cheap (proc.killed doesn't flip fast enough to short-circuit the
    // second call, so a manual call + registry.delete would double the
    // ~7s delay ladder on every provider switch).
    await this.sessions.delete(msg.id)

    // Build the replay seed from the mirror. Empty string is fine —
    // means no prior history yet (switch before the first turn).
    let replaySeed: string | undefined
    try {
      const seed = buildReplaySeed({ sessionId: msg.id, projectId })
      if (seed) replaySeed = seed
    } catch (err) {
      log.warn(
        { err, sessionId: msg.id },
        'failed to build replay seed — continuing without history replay',
      )
    }

    // Re-probe if the last probe is stale — the rebuild below bakes the
    // capability block into the new CLI's system prompt.
    await this.ensureMcpHealthFresh()

    // Rebuild. createHarnessSession writes meta.json via
    // ensureHarnessSessionInit, which is a no-op if the file exists —
    // so the meta.json still reflects the ORIGINAL provider/model.
    // Overwrite it with the new values so the session index + export
    // reflect the switch.
    this.createHarnessSession({
      id: msg.id,
      providerName: msg.provider,
      model: msg.model,
      projectId,
      replaySeedForFirstTurn: replaySeed,
    })
    this.updateHarnessSessionMeta(msg.id, projectId, msg.provider, msg.model)

    this.sendToClient(Channel.AI, {
      type: 'session_provider_switched',
      id: msg.id,
      provider: msg.provider,
      model: msg.model,
    })
    log.info(
      {
        sessionId: msg.id,
        provider: msg.provider,
        model: msg.model,
        hadReplaySeed: Boolean(replaySeed),
      },
      'Harness session provider switched',
    )
  }

  /**
   * Fire-and-forget background memory extraction for a harness session.
   * Pi SDK sessions get the same via session.maybeExtractMemories().
   *
   * Picks a Pi SDK provider with an API key for the extractor LLM —
   * the harness provider itself (Codex/Claude-Code) can't be used
   * because extractMemories needs a raw Pi SDK model handle. If no
   * suitable Pi SDK provider is configured, silently skip. Tracks a
   * per-session cursor so consecutive turns don't re-scan messages.
   */
  private runHarnessMemoryExtraction(sessionId: string, projectId: string | undefined): void {
    // Find any configured Pi SDK provider that has an API key set.
    // Prefer the config's default provider; fall back to any match.
    const tryProviders = [this.config.defaults.provider, ...Object.keys(this.config.providers)]
    let chosenProvider: string | undefined
    let apiKey: string | undefined
    for (const name of tryProviders) {
      const cfg = this.config.providers[name] || DEFAULT_PROVIDERS[name]
      if (!cfg || cfg.type === 'harness') continue
      const key = this.config.providers[name]?.apiKey
      if (key) {
        chosenProvider = name
        apiKey = key
        break
      }
    }
    if (!chosenProvider || !apiKey) {
      // No Pi SDK provider with a key → skip silently. Users running
      // pure-harness will only get memories from explicit memory_save
      // tool calls, which still work.
      return
    }

    // Resolve a Pi SDK model for the extractor's fallback. Use the
    // provider's first configured model, else its default.
    const provCfg = this.config.providers[chosenProvider] || DEFAULT_PROVIDERS[chosenProvider]
    const modelId = provCfg?.models?.[0]
    if (!modelId) return
    const fallbackModel = resolveModel(chosenProvider, modelId)
    if (!fallbackModel) return

    const providerName = chosenProvider
    const apiKeyValue = apiKey
    const sinceIndex = this.harnessExtractionCursor.get(sessionId) ?? 0

    void extractHarnessMemoriesFromMirror({
      sessionId,
      projectId,
      sinceIndex,
      provider: providerName,
      fallbackModel,
      getApiKey: (p) => (p === providerName ? apiKeyValue : undefined),
    })
      .then((result) => {
        this.harnessExtractionCursor.set(sessionId, result.newCursor)
        if (result.memories.length > 0) {
          log.info(
            {
              sessionId,
              count: result.memories.length,
              keys: result.memories.map((m) => m.key),
            },
            'harness memories extracted',
          )
        }
      })
      .catch((err) => {
        log.warn({ err, sessionId }, 'harness memory extraction failed')
      })
  }

  /**
   * Rewrite meta.json on disk with a new provider/model after a
   * provider switch. Keeps messageCount / title / createdAt intact.
   */
  private updateHarnessSessionMeta(
    sessionId: string,
    projectId: string | undefined,
    provider: string,
    model: string,
  ): void {
    const dir = projectId
      ? join(getProjectSessionsDir(projectId), sessionId)
      : join(getAntonDir(), 'conversations', sessionId)
    const metaPath = join(dir, 'meta.json')
    if (!existsSync(metaPath)) return
    try {
      const current = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
      current.provider = provider
      current.model = model
      current.lastActiveAt = Date.now()
      writeFileSync(metaPath, JSON.stringify(current, null, 2), 'utf-8')
    } catch (err) {
      log.warn({ err, sessionId }, 'failed to rewrite meta.json after provider switch')
    }
  }

  /** Build enriched session list from disk + in-memory sessions */
  private buildSessionList() {
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
      archived: m.archived,
      tags: m.tags,
      status: (this.activeTurns.has(m.id)
        ? 'working'
        : m.messageCount > 0
          ? 'completed'
          : 'idle') as 'working' | 'completed' | 'idle',
    }))

    // Add in-memory sessions that aren't persisted yet (exclude project sessions)
    for (const [id, session] of this.sessions) {
      if (!metas.some((m) => m.id === id) && !id.match(/^proj_/) && !isHarnessSession(session)) {
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
          archived: false,
          tags: [],
          status: (this.activeTurns.has(id)
            ? 'working'
            : info.messageCount > 0
              ? 'completed'
              : 'idle') as 'working' | 'completed' | 'idle',
        })
      }
    }

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return sessions
  }

  private handleSessionsList() {
    this.sendToClient(Channel.AI, {
      type: 'sessions_list_response',
      sessions: this.buildSessionList(),
    })
  }

  private handleSessionsSync(msg: { lastSyncVersion: number }) {
    const currentVersion = getSyncVersion()
    const deltas = msg.lastSyncVersion > 0 ? getDeltasSince(msg.lastSyncVersion) : null

    if (deltas !== null) {
      log.info(
        {
          clientVersion: msg.lastSyncVersion,
          serverVersion: currentVersion,
          deltaCount: deltas.length,
        },
        'Session sync: incremental',
      )
      this.sendToClient(Channel.AI, {
        type: 'sessions_sync_response',
        syncVersion: currentVersion,
        full: false,
        deltas,
      })
    } else {
      const sessions = this.buildSessionList()
      log.info(
        {
          clientVersion: msg.lastSyncVersion,
          serverVersion: currentVersion,
          sessionCount: sessions.length,
        },
        'Session sync: full bootstrap',
      )
      this.sendToClient(Channel.AI, {
        type: 'sessions_sync_response',
        syncVersion: currentVersion,
        full: true,
        sessions,
      })
    }
  }

  private handleUsageStats() {
    const metas = listSessionMetas()

    // Build a map of in-memory sessions (these have live usage data)
    const inMemoryMap = new Map<string, ReturnType<Session['getInfo']>>()
    for (const [id, session] of this.sessions) {
      if (!id.match(/^proj_/) && !isHarnessSession(session)) {
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

  /**
   * In-memory bookkeeping that must be dropped when a session leaves the
   * registry via LRU eviction. Intentionally does NOT touch disk state —
   * eviction is a memory-pressure signal and the persisted file must
   * remain resumable.
   */
  private cleanupEvictedSessionState(id: string, wasHarness: boolean): void {
    this.activeTurns.delete(id)
    if (wasHarness && this.mcpIpcServer) {
      this.mcpIpcServer.unregisterSession(id)
    }
    if (wasHarness) {
      this.harnessSessionContexts.delete(id)
      this.harnessExtractionCursor.delete(id)
    }
  }

  /**
   * Live-update the reasoning effort on an active session. Works for both
   * Pi-SDK sessions (delegates to Session.setThinkingLevel → PiAgent) and
   * Codex harness sessions (delegates to CodexHarnessSession.setThinkingLevel,
   * which applies on the next `turn/start`). No-op for Claude Code harness
   * sessions since the CLI has no thinking flag — the composer's Effort pill
   * is already hidden there so this path shouldn't fire.
   */
  private handleSessionSetThinkingLevel(msg: {
    sessionId: string
    level: ThinkingLevel
  }) {
    const session = this.sessions.peek(msg.sessionId)
    if (!session) {
      log.warn({ sessionId: msg.sessionId }, 'session_set_thinking_level: unknown session')
      return
    }
    if (session instanceof CodexHarnessSession) {
      session.setThinkingLevel(msg.level)
    } else if ('setThinkingLevel' in session && typeof session.setThinkingLevel === 'function') {
      session.setThinkingLevel(msg.level)
    }
  }

  private async handleSessionDestroy(msg: { id: string }) {
    // Extract projectId before deleting so we can update stats
    const session = this.sessions.peek(msg.id)
    const projectId =
      (session && !isHarnessSession(session) ? session.contextInfo?.projectId : undefined) ??
      this.extractProjectId(msg.id)
    const wasHarness = session ? isHarnessSession(session) : false

    let idReused = false
    try {
      // Registry.delete() awaits session.shutdown() when present — this
      // is the leak fix. Previously the harness codex app-server (and
      // its shim child) leaked until the host process exited, because
      // only `this.sessions.delete(id)` was called.
      await this.sessions.delete(msg.id)

      // Race guard: while the delete() await was suspended on
      // session.shutdown() (which for codex harness can take several
      // seconds), another WebSocket message — typically session_create
      // reusing the same id — could have run to completion and re-populated
      // the registry + harnessSessionContexts + mcpIpcServer auth under
      // this id. Running the id-keyed cleanup below would then clobber
      // the live new session. If the id is back in the registry, the new
      // session already owns these maps, so we skip all tail ops
      // (including deletePersistedSession, which would delete the new
      // session's on-disk meta.json / messages.jsonl).
      idReused = this.sessions.has(msg.id)
      if (idReused) {
        log.info(
          { sessionId: msg.id },
          'session id reused during destroy — skipping tail cleanup; new session owns these maps',
        )
      } else {
        this.activeTurns.delete(msg.id)
        deletePersistedSession(msg.id, projectId)
        if (wasHarness && this.mcpIpcServer) {
          this.mcpIpcServer.unregisterSession(msg.id)
        }
        if (wasHarness) {
          this.harnessSessionContexts.delete(msg.id)
          this.harnessExtractionCursor.delete(msg.id)
        }
      }
    } catch (err: unknown) {
      log.error({ err, sessionId: msg.id }, 'Error destroying session')
    }

    this.sendToClient(Channel.AI, {
      type: 'session_destroyed',
      id: msg.id,
    })

    // Update project stats so session count reflects the deletion. Skip
    // on id-reuse: the new session's create path will refresh stats on
    // its own, and recalculating here would race with its disk writes.
    if (projectId && !idReused) {
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
        log.warn(
          { err: e, sessionId: msg.id },
          'Failed to update project stats after session destroy',
        )
      }
    }

    log.info({ sessionId: msg.id, idReused }, 'Session destroyed')
  }

  private handleSessionHistory(msg: {
    id: string
    before?: number
    limit?: number
    projectId?: string
  }) {
    try {
      const limit = msg.limit ?? 200
      const isFirstPage = msg.before === undefined
      const projectIdHint = msg.projectId || this.extractProjectId(msg.id)

      // HARNESS FAST PATH — detect harness sessions by their on-disk
      // meta.json provider BEFORE attempting Pi SDK's resumeSession.
      // Pi SDK validates the model against its own registry and will
      // reject harness-only models (e.g. "gpt-5.4" for Codex). Reading
      // our mirror directly also avoids re-hydrating a Session we
      // don't need — harness history is the jsonl file, nothing else.
      const harnessHit = this.tryReadHarnessHistory(
        msg.id,
        projectIdHint,
        msg.before,
        limit,
        isFirstPage,
      )
      if (harnessHit) return

      // Pi SDK PATH — check if already in memory, else revive from disk.
      let session = this.sessions.get(msg.id)
      // If the in-memory session is a harness session we somehow missed
      // above (shouldn't happen — meta.json is authoritative), fall
      // back to reading its mirror so we never silently return empty.
      if (session && isHarnessSession(session)) {
        const entries = readHarnessHistory(
          msg.id,
          this.harnessSessionContexts.get(msg.id)?.projectId,
        )
        this.sendHarnessHistoryPage(msg.id, entries, msg.before, limit, isFirstPage)
        return
      }

      if (!session) {
        // Try loading from disk (project dir first, then global fallback)
        session =
          resumeSession(msg.id, this.config, this.buildSessionOptions(msg.id, projectIdHint)) ??
          undefined

        // Fallback to global sessions dir if project-scoped lookup failed
        if (!session && projectIdHint) {
          session =
            resumeSession(msg.id, this.config, this.buildSessionOptions(msg.id)) ?? undefined
        }

        if (!session) {
          log.warn(
            {
              sessionId: msg.id,
              projectId: projectIdHint,
              extracted: this.extractProjectId(msg.id),
            },
            'Session not found on disk',
          )
          this.sendToClient(Channel.AI, {
            type: 'error',
            code: 'session_not_found',
            message: `Session not found: ${msg.id}`,
            sessionId: msg.id,
          })
          return
        }
        log.info(
          { sessionId: msg.id, projectId: projectIdHint },
          'Resumed session from disk for history',
        )
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.put(msg.id, session, 'conversation')
      }

      // Pi SDK session: continue with existing logic.
      const fullHistory = session.getHistory()
      const totalCount = fullHistory.length
      const lastSeq = totalCount > 0 ? fullHistory[totalCount - 1].seq : 0

      // Get paginated page
      const page = session.getHistory({ before: msg.before, limit })
      const hasMore = page.length > 0 && page[0].seq > 1

      log.debug(
        {
          sessionId: msg.id,
          sent: page.length,
          totalCount,
          lastSeq,
          hasMore,
          before: msg.before ?? 'latest',
        },
        'Sending session history',
      )

      // On first page, include artifacts extracted from full history
      const artifacts =
        isFirstPage && !isHarnessSession(session) ? session.getArtifacts() : undefined

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
      if (isHarnessSession(session)) return
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

  /**
   * If the session on disk belongs to a harness provider, read its
   * mirrored messages.jsonl, flatten into SessionHistoryEntry[], and
   * send a paginated session_history_response. Returns true when the
   * harness path handled the request; false otherwise (so the caller
   * falls through to the Pi SDK revive path).
   *
   * Checks both the project-scoped and global session dirs so that a
   * missing projectId hint doesn't miss a project-attached session.
   */
  private tryReadHarnessHistory(
    sessionId: string,
    projectIdHint: string | undefined,
    before: number | undefined,
    limit: number,
    isFirstPage: boolean,
  ): boolean {
    const candidates: Array<{ projectId?: string }> = []
    if (projectIdHint) candidates.push({ projectId: projectIdHint })
    candidates.push({}) // global fallback

    for (const c of candidates) {
      const metaDir = c.projectId
        ? join(getProjectSessionsDir(c.projectId), sessionId)
        : join(getAntonDir(), 'conversations', sessionId)
      const metaPath = join(metaDir, 'meta.json')
      if (!existsSync(metaPath)) continue
      let meta: { provider?: unknown }
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      } catch {
        continue
      }
      const provider = typeof meta.provider === 'string' ? meta.provider : undefined
      if (!provider || !this.isHarnessProvider(provider)) continue

      const entries = readHarnessHistory(sessionId, c.projectId)
      this.sendHarnessHistoryPage(sessionId, entries, before, limit, isFirstPage)
      return true
    }
    return false
  }

  /** True if the named provider is configured as a harness-type provider. */
  private isHarnessProvider(name: string): boolean {
    const cfg = this.config.providers[name] || DEFAULT_PROVIDERS[name]
    return cfg?.type === 'harness'
  }

  /** Paginate + emit session_history_response for a harness session. */
  private sendHarnessHistoryPage(
    sessionId: string,
    entries: import('@anton/protocol').SessionHistoryEntry[],
    before: number | undefined,
    limit: number,
    _isFirstPage: boolean,
  ): void {
    const totalCount = entries.length
    const lastSeq = totalCount > 0 ? entries[totalCount - 1].seq : 0

    // Pagination: entries with seq < `before`, taking the last `limit`.
    const upToBefore = before !== undefined ? entries.filter((e) => e.seq < before) : entries
    const page = upToBefore.slice(Math.max(0, upToBefore.length - limit))
    const hasMore = page.length > 0 && page[0].seq > 1

    log.debug(
      { sessionId, sent: page.length, totalCount, lastSeq, hasMore, before: before ?? 'latest' },
      'Sending harness session history from mirror',
    )

    this.sendToClient(Channel.AI, {
      type: 'session_history_response',
      id: sessionId,
      messages: page,
      lastSeq,
      totalCount,
      hasMore,
      // No artifacts for harness sessions yet — we don't emit artifact
      // events from the harness path. If/when we do, they'll be in the
      // mirror and can be extracted here.
    })
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

  private async handleDetectHarnesses() {
    const adapters = [new ClaudeAdapter(), new CodexAdapter()]
    const harnesses = await Promise.all(
      adapters.map(async (adapter) => {
        const result = await adapter.detect()
        return {
          id: adapter.id,
          name: adapter.name,
          installed: result.installed,
          version: result.version,
          auth: result.auth
            ? {
                loggedIn: result.auth.loggedIn,
                email: result.auth.email,
                subscriptionType: result.auth.subscriptionType,
              }
            : undefined,
        }
      }),
    )
    this.sendToClient(Channel.AI, {
      type: 'detect_harnesses_response',
      harnesses,
    })
  }

  private async handleHarnessSetup(msg: { harnessId: string; action: string }) {
    const { harnessId, action } = msg

    const adapter =
      harnessId === 'codex'
        ? new CodexAdapter()
        : harnessId === 'claude-code'
          ? new ClaudeAdapter()
          : null

    if (!adapter) {
      this.sendToClient(Channel.AI, {
        type: 'harness_setup_response',
        harnessId,
        action: action as 'install' | 'login' | 'status',
        success: false,
        message: `Unknown harness: ${harnessId}`,
      })
      return
    }

    switch (action) {
      case 'status': {
        const result = await adapter.detect()
        this.sendToClient(Channel.AI, {
          type: 'harness_setup_response',
          harnessId,
          action: 'status',
          success: true,
          status: {
            id: adapter.id,
            name: adapter.name,
            installed: result.installed,
            version: result.version,
            auth: result.auth
              ? {
                  loggedIn: result.auth.loggedIn,
                  email: result.auth.email,
                  subscriptionType: result.auth.subscriptionType,
                }
              : undefined,
          },
        })
        break
      }

      case 'install': {
        this.sendToClient(Channel.AI, {
          type: 'harness_setup_response',
          harnessId,
          action: 'install',
          success: true,
          step: 'installing',
          message: `Installing ${adapter.name} CLI...`,
        })

        try {
          const { execFile: execFileCb } = await import('node:child_process')
          const npmPackage = harnessId === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'

          await new Promise<void>((resolve, reject) => {
            execFileCb(
              'sudo',
              ['npm', 'install', '-g', npmPackage],
              { timeout: 120_000 },
              (err, _stdout, stderr) => {
                if (err) {
                  reject(new Error(stderr?.trim() || err.message))
                } else {
                  resolve()
                }
              },
            )
          })

          // Re-detect after install
          const result = await adapter.detect()
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'install',
            success: true,
            step: 'done',
            message: `${adapter.name} CLI installed (${result.version || 'success'})`,
            status: {
              id: adapter.id,
              name: adapter.name,
              installed: result.installed,
              version: result.version,
              auth: result.auth
                ? {
                    loggedIn: result.auth.loggedIn,
                    email: result.auth.email,
                    subscriptionType: result.auth.subscriptionType,
                  }
                : undefined,
            },
          })
        } catch (err) {
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'install',
            success: false,
            step: 'error',
            message: `Install failed: ${(err as Error).message}`,
          })
        }
        break
      }

      case 'login': {
        // Kill any existing login process to prevent races from multiple clicks
        if (this.pendingLoginProc) {
          this.pendingLoginProc.kill()
          this.pendingLoginProc = null
        }

        this.sendToClient(Channel.AI, {
          type: 'harness_setup_response',
          harnessId,
          action: 'login',
          success: true,
          step: 'starting',
          message: `Starting ${adapter.name} login...`,
        })

        try {
          const { spawn: spawnLogin } = await import('node:child_process')
          const { createInterface: createRl } = await import('node:readline')

          // On headless servers, the OAuth localhost redirect can't reach the CLI,
          // so the user must paste the auth code manually. The CLI reads this via
          // an interactive prompt (readline), which requires a TTY.
          // We use Python's pty.spawn() to give the CLI a real PTY — it handles
          // stdin/stdout forwarding automatically and is available on all Linux systems.
          // BROWSER=true silently succeeds without printing/spamming.
          await new Promise<void>((resolve, reject) => {
            const needsPty = process.platform === 'linux'

            let cmd: string
            let args: string[]
            if (harnessId === 'codex') {
              // Codex uses device-auth flow (no localhost callback needed)
              cmd = needsPty ? 'python3' : 'codex'
              args = needsPty
                ? ['-c', 'import pty,sys;sys.exit(pty.spawn(["codex","login","--device-auth"]))']
                : ['login', '--device-auth']
            } else {
              cmd = needsPty ? 'python3' : 'claude'
              args = needsPty
                ? ['-c', 'import pty,sys;sys.exit(pty.spawn(["claude","auth","login"]))']
                : ['auth', 'login']
            }
            const proc = spawnLogin(cmd, args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { ...process.env, BROWSER: 'true' },
            })
            this.pendingLoginProc = proc

            let output = ''
            let detectedUrl = ''

            const handleLine = (line: string) => {
              // Strip ANSI escape codes (Codex outputs colored text)
              // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is intentional — stripping ANSI
              const clean = line.trim().replace(/\x1b\[[0-9;]*m/g, '')
              if (!clean) return

              output += `${clean}\n`
              log.info({ line: clean, harnessId }, 'harness auth login output')

              const urlMatch = clean.match(/(https?:\/\/[^\s]+)/)
              if (urlMatch) {
                detectedUrl = urlMatch[1]
              }

              // For Codex device-auth: detect the one-time device code (e.g. "JY9T-N884D")
              // It appears after the URL line as an alphanumeric code with dashes
              if (harnessId === 'codex' && detectedUrl) {
                const codeMatch = clean.match(/^([A-Z0-9]{4,}-[A-Z0-9]{4,})$/)
                if (codeMatch) {
                  // Send both URL and device code — UI shows "open URL and enter code"
                  this.sendToClient(Channel.AI, {
                    type: 'harness_setup_response',
                    harnessId,
                    action: 'login',
                    success: true,
                    step: 'waiting',
                    message: JSON.stringify({ url: detectedUrl, deviceCode: codeMatch[1] }),
                  })
                  return
                }
              }

              // For Claude: send URL for auth code paste flow
              if (urlMatch && harnessId !== 'codex') {
                this.sendToClient(Channel.AI, {
                  type: 'harness_setup_response',
                  harnessId,
                  action: 'login',
                  success: true,
                  step: 'waiting',
                  message: urlMatch[1],
                })
              }
            }

            if (proc.stdout) {
              const rl = createRl({ input: proc.stdout })
              rl.on('line', handleLine)
            }
            if (proc.stderr) {
              const rlErr = createRl({ input: proc.stderr })
              rlErr.on('line', handleLine)
            }

            const timeout = setTimeout(() => {
              proc.kill()
              reject(new Error('Login timed out after 5 minutes'))
            }, 300_000)

            proc.on('close', (code) => {
              clearTimeout(timeout)
              this.pendingLoginProc = null
              if (code === 0) resolve()
              else reject(new Error(output.trim() || `Login process exited with code ${code}`))
            })

            proc.on('error', (err) => {
              clearTimeout(timeout)
              this.pendingLoginProc = null
              reject(err)
            })
          })

          // Re-detect to confirm auth status
          const result = await adapter.detect()
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'login',
            success: result.auth?.loggedIn ?? false,
            step: 'done',
            message: result.auth?.loggedIn
              ? `Logged in as ${result.auth.email || 'unknown'} (${result.auth.subscriptionType || 'active'})`
              : 'Login did not complete — please try again',
            status: {
              id: adapter.id,
              name: adapter.name,
              installed: result.installed,
              version: result.version,
              auth: result.auth
                ? {
                    loggedIn: result.auth.loggedIn,
                    email: result.auth.email,
                    subscriptionType: result.auth.subscriptionType,
                  }
                : undefined,
            },
          })
        } catch (err) {
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'login',
            success: false,
            step: 'error',
            message: `Login failed: ${(err as Error).message}`,
          })
        }
        break
      }

      case 'login_code': {
        const code = (msg as { code?: string }).code
        if (!code) {
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'login_code',
            success: false,
            message: 'No auth code provided',
          })
          break
        }

        if (!this.pendingLoginProc || !this.pendingLoginProc.stdin) {
          this.sendToClient(Channel.AI, {
            type: 'harness_setup_response',
            harnessId,
            action: 'login_code',
            success: false,
            message: 'No login process waiting for a code — try signing in again',
          })
          break
        }

        log.info('Writing auth code to claude login process via PTY')
        // Send \r (carriage return) not \n — Ink uses raw mode where Enter = \r
        this.pendingLoginProc.stdin.write(`${code.trim()}\r`)
        this.sendToClient(Channel.AI, {
          type: 'harness_setup_response',
          harnessId,
          action: 'login_code',
          success: true,
          step: 'waiting',
          message: 'Auth code submitted, completing login...',
        })
        break
      }

      default:
        this.sendToClient(Channel.AI, {
          type: 'harness_setup_response',
          harnessId,
          action: action as 'install' | 'login' | 'login_code' | 'status',
          success: false,
          message: `Unknown action: ${action}`,
        })
    }
  }

  private handleProviderSetKey(msg: { provider: string; apiKey: string }) {
    try {
      setProviderKey(this.config, msg.provider, msg.apiKey)
      this.sendToClient(Channel.AI, {
        type: 'provider_set_key_response',
        success: true,
        provider: msg.provider,
      })
      log.info({ provider: msg.provider }, 'API key updated')
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

      let apiSwitched = 0
      let harnessSwitched = 0
      let harnessSkipped = 0
      for (const [id, session] of this.sessions) {
        if (isHarnessSession(session)) {
          // Harness sessions are bound to their provider (CLI binary + auth)
          // at spawn time, but the model is applied per-turn (turn/start for
          // codex, --model for claude). Same-provider switches mutate
          // this.model and take effect on the next turn; cross-provider
          // switches can't be hot-swapped and the old session keeps running
          // its original model until it's destroyed.
          if (session.provider !== msg.provider) {
            log.info(
              {
                sessionId: id,
                sessionProvider: session.provider,
                sessionModel: session.model,
                requestedProvider: msg.provider,
                requestedModel: msg.model,
              },
              'Harness session kept on original provider — cross-provider switch requires a new session',
            )
            harnessSkipped++
            continue
          }
          try {
            const previousModel = session.model
            session.switchModel(msg.provider, msg.model)
            log.info(
              {
                sessionId: id,
                provider: msg.provider,
                previousModel,
                model: msg.model,
              },
              'Switched harness session model (applies to next turn)',
            )
            harnessSwitched++
          } catch (err) {
            log.warn({ err, sessionId: id }, 'Failed to switch harness session model')
          }
          continue
        }
        try {
          session.switchModel(msg.provider, msg.model)
          log.info(
            { sessionId: id, provider: msg.provider, model: msg.model },
            'Switched API session to new default model',
          )
          apiSwitched++
        } catch (err) {
          log.warn({ err, sessionId: id }, 'Failed to switch session model')
        }
      }

      // Also switch all live webhook sessions (Telegram, Slack, etc.)
      this.webhookRunner?.switchAllSessionModels(msg.provider, msg.model)

      this.sendToClient(Channel.AI, {
        type: 'provider_set_default_response',
        success: true,
        provider: msg.provider,
        model: msg.model,
      })
      log.info(
        {
          provider: msg.provider,
          model: msg.model,
          apiSwitched,
          harnessSkipped,
        },
        'Default provider/model set',
      )
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
      log.info({ provider: msg.provider, count: msg.models.length }, 'Models updated for provider')
    } catch {
      this.sendToClient(Channel.AI, {
        type: 'provider_set_models_response',
        success: false,
        provider: msg.provider,
      })
    }
  }

  // ── Scheduler handlers ────────────────────────────────────────

  private handleSkillList() {
    try {
      const skills = loadSkills()
      this.sendToClient(Channel.AI, {
        type: 'skill_list_response',
        skills,
      })
    } catch (_err) {
      this.sendToClient(Channel.AI, {
        type: 'skill_list_response',
        skills: [],
      })
    }
  }

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

  // ── Routine handlers ─────────────────────────────────────────────

  private handleRoutineCreate(msg: { projectId: string; routine: Record<string, unknown> }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, { type: 'error', message: 'Routine manager not initialized' })
      return
    }
    try {
      const spec = msg.routine as {
        name: string
        description?: string
        instructions: string
        schedule?: string
        originConversationId?: string
      }
      const routine = this.agentManager.createAgent(msg.projectId, spec)
      this.sendToClient(Channel.AI, { type: 'routine_created', routine })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, { type: 'error', message: (err as Error).message })
    }
  }

  private handleRoutinesList(msg: { projectId: string }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, {
        type: 'routines_list_response',
        projectId: msg.projectId,
        routines: [],
      })
      return
    }
    const routines = this.agentManager.listAgents(msg.projectId)
    this.sendToClient(Channel.AI, {
      type: 'routines_list_response',
      projectId: msg.projectId,
      routines,
    })
  }

  private handleRoutineAction(msg: { projectId: string; sessionId: string; action: string }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, { type: 'error', message: 'Routine manager not initialized' })
      return
    }

    switch (msg.action) {
      case 'start':
        this.agentManager.runAgent(msg.sessionId, 'manual')
        break
      case 'stop': {
        const routine = this.agentManager.stopAgent(msg.sessionId)
        if (routine) this.sendToClient(Channel.AI, { type: 'routine_updated', routine })
        break
      }
      case 'pause': {
        const routine = this.agentManager.pauseAgent(msg.sessionId)
        if (routine) this.sendToClient(Channel.AI, { type: 'routine_updated', routine })
        break
      }
      case 'resume': {
        const routine = this.agentManager.resumeAgent(msg.sessionId)
        if (routine) this.sendToClient(Channel.AI, { type: 'routine_updated', routine })
        break
      }
      case 'delete':
        if (this.agentManager.deleteAgent(msg.sessionId)) {
          this.sendToClient(Channel.AI, {
            type: 'routine_deleted',
            projectId: msg.projectId,
            sessionId: msg.sessionId,
          })
        } else {
          this.sendToClient(Channel.AI, {
            type: 'error',
            message: `Routine not found: ${msg.sessionId}`,
          })
        }
        break
      default:
        this.sendToClient(Channel.AI, { type: 'error', message: `Unknown action: ${msg.action}` })
    }
  }

  private handleRoutineUpdate(msg: {
    projectId: string
    sessionId: string
    patch: {
      name?: string
      description?: string
      instructions?: string
      schedule?: string | null
    }
  }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, { type: 'error', message: 'Routine manager not initialized' })
      return
    }
    try {
      const routine = this.agentManager.updateAgent(msg.sessionId, msg.patch)
      if (!routine) {
        this.sendToClient(Channel.AI, {
          type: 'error',
          message: `Routine not found: ${msg.sessionId}`,
        })
        return
      }
      this.sendToClient(Channel.AI, { type: 'routine_updated', routine })
    } catch (err: unknown) {
      this.sendToClient(Channel.AI, { type: 'error', message: (err as Error).message })
    }
  }

  private handleRoutineRunLogs(msg: {
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
            type: 'routine_run_logs_response',
            sessionId: msg.sessionId,
            logs: [],
          })
          return
        }
      }

      // Get full history — for run-specific sessions, return everything (no time filtering needed)
      if (isHarnessSession(session)) return
      const fullHistory = session.getHistory()
      const logs = fullHistory.map(
        (entry: {
          ts: number
          role: string
          content: unknown
          toolName?: string
          toolInput?: unknown
          isError?: boolean
        }) => ({
          ts: entry.ts,
          role: entry.role as 'user' | 'assistant' | 'tool_call' | 'tool_result',
          content: typeof entry.content === 'string' ? entry.content.slice(0, 2000) : '',
          toolName: entry.toolName,
          toolInput: entry.toolInput ? JSON.stringify(entry.toolInput).slice(0, 500) : undefined,
          isError: entry.isError,
        }),
      )

      this.sendToClient(Channel.AI, {
        type: 'routine_run_logs_response',
        sessionId: msg.sessionId,
        logs,
      })
    } catch (err) {
      log.error({ err }, 'Failed to get routine run logs')
      this.sendToClient(Channel.AI, {
        type: 'routine_run_logs_response',
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

  /**
   * Collect the set of connectors actually live for this session, so the
   * harness identity prompt can answer "what services do I have?" from
   * ground truth instead of the model's training priors. Includes both
   * direct connectors (Slack, GitHub, Gmail, …) and enabled MCP servers.
   */
  private collectLiveConnectorsForPrompt(surface?: string): LiveConnectorSummary[] {
    const result: LiveConnectorSummary[] = []
    const seen = new Set<string>()

    for (const id of this.connectorManager.getActiveIds()) {
      const connector = this.connectorManager.getConnector(id)
      if (!connector) continue
      if (
        surface &&
        connector.surfaces &&
        connector.surfaces.length > 0 &&
        !connector.surfaces.includes(surface)
      ) {
        continue
      }
      const toolNames = connector.getTools().map((t) => t.name)
      if (toolNames.length === 0) continue
      // Prefer the connector's declared example (authoritative) and fall
      // back to the first tool name only when none is set.
      const example = connector.capabilityExample ?? toolNames[0]
      result.push({
        id,
        name: connector.name,
        capabilitySummary: connector.capabilitySummary ?? '',
        capabilityExample: example ?? '',
      })
      seen.add(id)
    }

    for (const status of this.mcpManager.getStatus()) {
      if (!status.connected || status.toolCount === 0) continue
      // Skip if a direct connector with the same id already claimed it —
      // prevents a duplicate "Gmail / Gmail (MCP)" entry when the user
      // has both wired up.
      if (seen.has(status.id)) continue
      // Honor any surface allowlist the user configured on the MCP
      // server so its tools don't get advertised in surfaces where they
      // wouldn't execute anyway.
      if (!matchesSurface(status.surfaces, surface)) continue
      const example = status.tools[0] ?? ''
      result.push({
        id: status.id,
        name: status.name,
        capabilitySummary: status.description ?? '',
        capabilityExample: example,
      })
    }

    return result
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
        message: 'Routine manager not available',
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

  private handleWorkflowActivate(msg: { projectId: string; workflowId: string }) {
    if (!this.agentManager) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: 'Routine manager not available',
      })
      return
    }

    try {
      const installer = new WorkflowInstaller(this.agentManager)
      const installed = installer.activateWorkflow(msg.projectId, msg.workflowId)
      const routines = this.agentManager
        .listAgents(msg.projectId)
        .filter((a) => a.agent.workflowId === msg.workflowId)
      this.sendToClient(Channel.AI, {
        type: 'workflow_activated',
        workflow: installed,
        routines,
      })
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Activation failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  private wireAgentAutoHandlers(session: Session) {
    session.setConfirmHandler(async (_command, _reason) => {
      log.debug({ sessionId: session.id, command: _command }, 'Agent auto-approved confirm')
      return true
    })
    session.setPlanConfirmHandler(async (_title, _content) => {
      return { approved: true, feedback: '' }
    })
    session.setAskUserHandler(async (_questions) => {
      log.debug({ sessionId: session.id }, 'Agent auto-skipped ask_user (autonomous mode)')
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
      thinkingLevel?: ThinkingLevel
    },
  ) {
    const project = projectId ? loadProject(projectId) : undefined
    const isAgent = sessionId.startsWith('agent--')

    // Load agent instructions and workflow metadata
    let agentInstructions = extra?.agentInstructions
    let agentMemory = extra?.agentMemory
    let agentWorkflowId: string | undefined
    let agentWorkflowKey: string | undefined

    if (!agentInstructions && isAgent && projectId) {
      const meta = loadAgentMetadata(projectId, sessionId)
      if (meta) {
        agentWorkflowId = meta.workflowId
        agentWorkflowKey = meta.workflowAgentKey
        // If this is a workflow agent, build rich context from workflow files
        if (meta.workflowId) {
          const wfContext = buildWorkflowAgentContext(
            projectId,
            meta.workflowId,
            meta.workflowAgentKey,
          )
          if (wfContext) {
            agentInstructions = wfContext.instructions
            agentMemory = agentMemory || wfContext.memory || undefined
          } else {
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
      onActivateWorkflow: projectId && !isAgent ? this.buildActivateWorkflowHandler() : undefined,
      onSharedState:
        agentWorkflowId && projectId
          ? this.buildSharedStateHandler(agentWorkflowId, agentWorkflowKey)
          : undefined,
      workflowId: agentWorkflowId,
      workflowAgentKey: agentWorkflowKey,
      onDeliverResult:
        isAgent && projectId ? this.buildDeliverResultHandler(sessionId, projectId) : undefined,
      thinkingLevel: extra?.thinkingLevel,
      agentInstructions,
      agentMemory,
      availableWorkflows: this.getAvailableWorkflowsForPrompt(),
      workflowMetadata:
        agentWorkflowId && agentWorkflowKey && agentInstructions
          ? {
              workflowId: agentWorkflowId,
              agentKey: agentWorkflowKey,
              promptVersion: hashPromptVersion(agentInstructions),
            }
          : undefined,
    }
  }

  /** Build the routine action callback for the routine tool (used by the LLM) */
  private buildAgentActionHandler(
    originSessionId?: string,
  ): import('@anton/agent-core').JobActionHandler | undefined {
    if (!this.agentManager) return undefined
    const am = this.agentManager

    return async (projectId, input) => {
      switch (input.operation) {
        case 'create': {
          if (!input.name) return 'Error: name is required for create'
          if (!input.prompt) return 'Error: prompt/instructions is required for routine'
          // Flat ownership: always point to the root human conversation, not the calling agent
          const rootConversationId = this.resolveRootConversation(originSessionId)
          const routine = am.createAgent(projectId, {
            name: input.name,
            description: input.description,
            instructions: input.prompt,
            schedule: input.schedule,
            originConversationId: rootConversationId,
          })
          this.sendToClient(Channel.AI, { type: 'routine_created', routine })
          return `Routine created: ${routine.agent.name} (session: ${routine.sessionId}, schedule: ${routine.agent.schedule?.cron ?? 'manual'})`
        }
        case 'list': {
          const agents = am.listAgents(projectId)
          if (agents.length === 0) return 'No routines in this project.'
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
          if (!agent) return `Error: Routine not found: ${input.jobId}`
          return `Routine "${agent.agent.name}" started`
        }
        case 'stop': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for stop'
          const agent = am.stopAgent(input.jobId)
          if (!agent) return `Error: Routine not found: ${input.jobId}`
          return `Routine "${agent.agent.name}" stopped.`
        }
        case 'delete': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for delete'
          const success = am.deleteAgent(input.jobId)
          if (!success) return `Error: Routine not found: ${input.jobId}`
          this.sendToClient(Channel.AI, {
            type: 'routine_deleted',
            projectId,
            sessionId: input.jobId,
          })
          return 'Routine deleted.'
        }
        case 'status': {
          if (!input.jobId) return 'Error: job_id (session ID) is required for status'
          const agent = am.getAgent(input.jobId)
          if (!agent) return `Error: Routine not found: ${input.jobId}`
          return [
            `Routine: ${agent.agent.name}`,
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

  /** Build the activate_workflow callback for the bootstrap agent */
  private buildActivateWorkflowHandler():
    | import('@anton/agent-core').ActivateWorkflowHandler
    | undefined {
    if (!this.agentManager) return undefined

    return async (projectId, workflowId) => {
      try {
        const installer = new WorkflowInstaller(this.agentManager!)
        const installed = installer.activateWorkflow(projectId, workflowId)
        const routines = this.agentManager!.listAgents(projectId).filter(
          (a) => a.agent.workflowId === workflowId,
        )

        // Notify the client about the new routines
        this.sendToClient(Channel.AI, {
          type: 'workflow_activated',
          workflow: installed,
          routines,
        })

        const routineNames = routines.map((a) => a.agent.name).join(', ')
        return `Workflow "${workflowId}" activated successfully. Created ${routines.length} routines: ${routineNames}. They will start running on their configured schedules.`
      } catch (err) {
        return `Failed to activate workflow: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /** Build the shared_state callback for workflow agents */
  private buildSharedStateHandler(
    _defaultWorkflowId: string,
    agentKey?: string,
  ): import('@anton/agent-core').SharedStateHandler | undefined {
    return async (projectId, wfId, operation, sql, params) => {
      const cacheKey = `${projectId}:${wfId}`
      let db = this.workflowDbs.get(cacheKey)

      if (!db) {
        // Lazy-open the DB
        const { getWorkflowStateDbPath } = await import('@anton/agent-config')
        const { loadWorkflowManifest } = await import('@anton/agent-config')
        const dbPath = getWorkflowStateDbPath(projectId, wfId)
        const manifest = loadWorkflowManifest(projectId, wfId)
        const transitions = manifest?.sharedState?.transitions || {}

        try {
          db = new WorkflowStateDb(dbPath, transitions)
          this.workflowDbs.set(cacheKey, db)
        } catch (err) {
          return JSON.stringify({
            error: `Failed to open shared state DB: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }

      if (operation === 'query') {
        return db.query(sql, params || [])
      }
      return db.execute(sql, params || [], agentKey)
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
          content: `**Routine: ${agent.agent.name}**\n\n${result.content}`,
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
        type: 'routine_result_delivered',
        projectId,
        routineSessionId: agentSessionId,
        routineName: agent.agent.name,
        originConversationId: originId,
        summary: result.summary ?? 'Routine delivered results',
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
    const allPersisted = listProjectSessions(msg.projectId)
    // Filter out agent sessions — they appear in the agents list, not here
    const persisted = allPersisted.filter(
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
      status: (this.activeTurns.has(s.id)
        ? 'working'
        : s.messageCount > 0
          ? 'completed'
          : 'idle') as 'working' | 'completed' | 'idle',
    }))

    // Add in-memory project sessions that aren't persisted yet
    const prefix = `proj_${msg.projectId}_sess_`
    let inMemoryCount = 0
    for (const [id, session] of this.sessions) {
      if (
        id.startsWith(prefix) &&
        !persisted.some((s) => s.id === id) &&
        !isHarnessSession(session)
      ) {
        const info = session.getInfo()
        sessions.push({
          id: info.id,
          title: info.title,
          provider: info.provider,
          model: info.model,
          messageCount: info.messageCount,
          createdAt: info.createdAt,
          lastActiveAt: info.lastActiveAt,
          status: (this.activeTurns.has(id)
            ? 'working'
            : info.messageCount > 0
              ? 'completed'
              : 'idle') as 'working' | 'completed' | 'idle',
        })
        inMemoryCount++
      }
    }

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    log.info(
      {
        projectId: msg.projectId,
        persistedTotal: allPersisted.length,
        persistedFiltered: persisted.length,
        inMemory: inMemoryCount,
        sent: sessions.length,
      },
      'Project sessions list',
    )

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
            domain: process.env.ANTON_HOST,
          }),
        )
        this.wireSessionConfirmHandler(session)
        this.wirePlanConfirmHandler(session)
        this.wireAskUserHandler(session)
        this.sessions.put(DEFAULT_SESSION_ID, session, 'conversation')
      } else {
        // Try to resume from disk automatically
        const projectId = this.extractProjectId(sessionId)
        const isAgentSession = sessionId.startsWith('agent--')
        const opts = this.buildSessionOptions(sessionId, projectId)

        // Track workspace for filesync sandboxing
        if (projectId && !this.activeWorkspacePath) {
          const proj = loadProject(projectId)
          if (proj?.workspacePath) this.activeWorkspacePath = proj.workspacePath
        }

        session = resumeSession(sessionId, this.config, opts) ?? undefined

        // Also try global sessions as fallback
        if (!session && projectId) {
          session =
            resumeSession(sessionId, this.config, this.buildSessionOptions(sessionId)) ?? undefined
        }

        // For agent sessions that have never run: create a fresh session
        if (!session && isAgentSession && projectId) {
          log.info({ sessionId }, 'Creating new session for agent')
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
          // Agent sessions land in `routine` pool — they run on a schedule
          // and naturally come and go; conversations go to the `conversation`
          // pool where they compete for chat capacity.
          this.sessions.put(sessionId, session, isAgentSession ? 'routine' : 'conversation')
          log.info({ sessionId }, 'Auto-resumed session from disk')
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
    if (msg.content.startsWith('/compact') && !isHarnessSession(session)) {
      await this.handleCompactCommand(session, sessionId, msg.content)
      return 0
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'routine_status',
      status: 'working',
      detail: 'Processing your request...',
      sessionId,
    })

    log.info({ sessionId, content: msg.content.slice(0, 50) }, 'Processing message')

    // Load conversation context on first message (cross-conversation matching uses message text)
    // Skip for harness sessions — they manage their own context
    if (!isHarnessSession(session) && !session.contextInfo) {
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

    // Guard: if this session is already processing, steer instead of starting a second turn
    if (this.activeTurns.has(sessionId)) {
      log.warn({ sessionId }, 'Session already processing — converting message to steer')
      if (!isHarnessSession(session)) {
        session.steer(msg.content, msg.attachments)
      } else if (session instanceof CodexHarnessSession) {
        // Codex app-server: real interrupt + sendUserMessage. Fire-and-forget;
        // failures are logged inside steer() and don't block the ack.
        session.steer(msg.content).catch((err) => {
          log.warn({ err: (err as Error).message, sessionId }, 'codex steer failed')
        })
      }
      // Claude Code harness (legacy HarnessSession) still has no steer path.
      this.sendToClient(Channel.AI, {
        type: 'steer_ack',
        content: msg.content,
        sessionId,
        attachments: msg.attachments,
      })
      return 0
    }

    this.activeTurns.add(sessionId)
    let eventCount = 0

    // Buffer text chunks and flush every ~80ms (or before any non-text event)
    // Hoisted above try so catch/finally can access it
    const textBuffer = new TextStreamBuffer((text) => {
      this.sendToClient(Channel.AI, { type: 'text', content: text, sessionId })
    })

    try {
      // Pin inside the try so the finally's unpin always pairs with a pin,
      // even if a throw fires between the two statements.
      this.sessions.pin(sessionId)
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
              type: 'routine_status',
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
            type: 'routine_status',
            status: 'working',
            detail: toolDetail,
            sessionId,
          })
        } else if (event.type === 'thinking') {
          this.sendToClient(Channel.EVENTS, {
            type: 'routine_status',
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
              type: 'routine_status',
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
      log.info(
        {
          sessionId,
          eventCount,
          toolCallCount,
          chars: accumulatedText.length,
          durationMs: turnDurationMs,
        },
        'Turn complete',
      )

      // Fire-and-forget: OS notification when turn finishes.
      // Desktop clients handle their own notifications via Tauri plugin,
      // so this only fires for headless / CLI-only runs (no connected GUI client).
      if (!this.activeClient && toolCallCount > 0 && !isHarnessSession(session)) {
        const title = session.getInfo().title || 'Task completed'
        try {
          if (process.platform === 'darwin') {
            // Use spawn (non-blocking) + pass args as array (no shell escaping needed)
            spawn(
              'osascript',
              [
                '-e',
                `display notification ${JSON.stringify(title.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))} with title "Anton" sound name "Glass"`,
              ],
              { stdio: 'ignore', detached: true },
            ).unref()
          } else {
            spawn('notify-send', ['Anton', title], {
              stdio: 'ignore',
              detached: true,
            }).unref()
          }
        } catch {
          // Non-critical — silently ignore notification failures
        }
      }

      // Fire-and-forget: background memory extraction
      if (!isHarnessSession(session)) {
        session.maybeExtractMemories().catch((err: unknown) => {
          log.warn({ err, sessionId }, 'background memory extraction failed')
        })
      }

      // Track session in project history if this is a project session
      if (!isHarnessSession(session)) {
        const sessionInfo = session.getInfo()
        if (session.projectId && sessionInfo.title) {
          try {
            // Use LLM-provided summary from update_project_context tool, fallback to title
            const sessionSummary = projectContextUpdate?.sessionSummary || sessionInfo.title

            // Update project summary if the LLM provided one
            if (projectContextUpdate?.projectSummary) {
              updateProjectContext(
                session.projectId,
                'summary',
                projectContextUpdate.projectSummary,
              )
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
            log.warn({ err: e, sessionId }, 'Failed to update project history')
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message
      log.error({ sessionId, err: errMsg }, 'Session error')
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
      this.sessions.unpin(sessionId)
      this.clearDetachedTurnBudget(sessionId)
      this.sendToClient(Channel.EVENTS, {
        type: 'routine_status',
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

    log.info({ sessionId }, 'Manual compaction requested')

    try {
      const state = await session.compactNow(customInstructions)

      this.sendToClient(Channel.AI, {
        type: 'compaction_complete',
        sessionId,
        compactedMessages: state.compactedMessageCount,
        totalCompactions: state.compactionCount,
      })

      log.info(
        {
          sessionId,
          compactedMessages: state.compactedMessageCount,
          totalCompactions: state.compactionCount,
        },
        'Compaction complete',
      )
    } catch (err: unknown) {
      log.error({ err, sessionId }, 'Compaction failed')
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Compaction failed: ${(err as Error).message}`,
        sessionId,
      })
    }

    this.sendToClient(Channel.EVENTS, {
      type: 'routine_status',
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

        // 24 hours — user may leave and come back; pending prompts survive reconnects
        const timeout = setTimeout(() => {
          this.pendingPrompts.delete(confirmId)
          this.promptResolvers.delete(confirmId)
          resolve({ approved: false, feedback: 'Timed out waiting for plan review' })
        }, 86_400_000)

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
    session.setAskUserHandler(this.buildAskUserHandlerForSession(session.id))
  }

  /**
   * Harness-side counterpart to `wireAskUserHandler`. The codex / claude
   * harness can't call `setAskUserHandler` (no Pi SDK Session), so the
   * tool-registry instead pulls this off `HarnessSessionContext.onAskUser`
   * when constructing the `ask_user` MCP tool. Same Channel.AI round-trip,
   * same pendingPrompts/promptResolvers wiring as Pi SDK sessions.
   */
  private buildHarnessAskUserHandler(
    sessionId: string,
  ): import('@anton/agent-core').AskUserHandler {
    return this.buildAskUserHandlerForSession(sessionId)
  }

  /**
   * Browser-state callbacks for the harness `browser` MCP tool. Same
   * shape Pi SDK uses (`onBrowserState` / `onBrowserClose`). Late-binds
   * via `this.sessions.get(sessionId)` so the callback handles the
   * race where the context is set before the session itself is
   * constructed. No-op if the session has gone away by the time the
   * tool fires.
   */
  private buildHarnessBrowserCallbacks(
    sessionId: string,
  ): import('@anton/agent-core').HarnessSessionContext['browserCallbacks'] {
    return {
      onBrowserState: (state) => {
        const session = this.sessions.get(sessionId)
        if (session && isHarnessSession(session)) session.emitBrowserState(state)
      },
      onBrowserClose: () => {
        const session = this.sessions.get(sessionId)
        if (session && isHarnessSession(session)) session.emitBrowserClose()
      },
    }
  }

  /** Shared core: produce an AskUserHandler bound to `sessionId`. */
  private buildAskUserHandlerForSession(
    sessionId: string,
  ): import('@anton/agent-core').AskUserHandler {
    return async (questions) => {
      if (!this.activeClient) return {}

      return new Promise((resolve) => {
        const askId = `ask_${Date.now()}`

        const payload = {
          type: 'ask_user' as const,
          id: askId,
          questions,
          sessionId,
        }
        this.sendToClient(Channel.AI, payload)
        // Track so we can re-send on reconnect
        this.pendingPrompts.set(askId, { type: 'ask_user', payload })

        // 24 hours — user may leave and come back; pending prompts survive reconnects
        const timeout = setTimeout(() => {
          this.pendingPrompts.delete(askId)
          this.promptResolvers.delete(askId)
          resolve({})
        }, 86_400_000)

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
    }
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
      log.info({ count: mcpConfigs.length }, 'Starting MCP connectors')
      await this.mcpManager.startAll(mcpConfigs)
    }

    // Restore per-tool permission overrides from persisted config for both
    // managers. Direct connectors (slack, github, …) need this just as much
    // as MCP — without it, a 'never' tool would be re-allowed every restart.
    for (const c of connectors) {
      if (!c.toolPermissions) continue
      if (c.type === 'mcp') {
        this.mcpManager.setToolPermissions(c.id, c.toolPermissions)
      } else {
        this.connectorManager.setToolPermissions(c.id, c.toolPermissions)
      }
    }
  }

  /**
   * Resolve env + refreshToken for a connector. Used by ConnectorManager.activate().
   * Priority: 1) encrypted secrets, 2) legacy OAuth accessToken, 3) process.env fallback.
   */
  private async resolveConnectorEnv(
    providerId: string,
  ): Promise<import('@anton/connectors').ConnectorEnv> {
    const env: Record<string, string> = {}
    const cfg = getConnectors(this.config).find((c) => c.id === providerId)

    // 1. Encrypted secrets (highest priority — user explicitly set these)
    let creds: import('./credential-store.js').StoredCredentials | null = null
    try {
      creds = this.credentialStore.load(providerId)
    } catch {
      // Can't decrypt — will rely on process.env fallback
    }
    if (creds?.secrets) Object.assign(env, creds.secrets)
    // Legacy: map accessToken into env for OAuth connectors
    if (creds?.accessToken && !env.ACCESS_TOKEN) env.ACCESS_TOKEN = creds.accessToken

    // 2. process.env fallback — check ONLY declared registry keys
    const registryId = cfg?.registryId ?? providerId
    const prefix = registryId.toUpperCase().replace(/-/g, '_')
    const entry = CONNECTOR_REGISTRY.find((e) => e.id === registryId)
    const declaredKeys = [
      ...(entry?.requiredEnv ?? []),
      ...(entry?.optionalFields?.map((f) => f.key) ?? []),
    ]
    for (const key of declaredKeys) {
      if (!env[key]) {
        // Check prefixed form first (e.g. TELEGRAM_BOT_TOKEN), then bare key
        const prefixed = process.env[`${prefix}_${key}`]
        const bare = process.env[key]
        if (prefixed) env[key] = prefixed
        else if (bare) env[key] = bare
      }
    }

    // 3. OAuth refresh callback (only if this connector has a refresh token)
    const refreshToken = creds?.refreshToken ? () => this.oauthFlow.getToken(providerId) : undefined

    return { env, refreshToken }
  }

  private async startConnectors(): Promise<void> {
    const connectors = getConnectors(this.config).filter((c) => c.enabled)
    const toActivate = connectors.filter((c) => {
      if (c.type === 'mcp') return false // MCP handled separately
      const factoryId = c.registryId ?? c.id
      if (!this.connectorManager.hasFactory(factoryId)) return false
      // For OAuth connectors, only activate if we have stored credentials
      if (c.type === 'oauth' && !this.credentialStore.has(c.id)) return false
      // For API connectors, check credential store or process.env
      if (c.type === 'api') {
        const hasStored = this.credentialStore.has(c.id)
        if (!hasStored) {
          // Check process.env fallback
          const registryId = c.registryId ?? c.id
          const prefix = registryId.toUpperCase().replace(/-/g, '_')
          const entry = CONNECTOR_REGISTRY.find((e) => e.id === registryId)
          const declaredKeys = [...(entry?.requiredEnv ?? [])]
          const hasEnv = declaredKeys.some(
            (key) => process.env[`${prefix}_${key}`] || process.env[key],
          )
          if (!hasEnv) return false
        }
      }
      return true
    })

    if (toActivate.length === 0) return
    log.info({ count: toActivate.length }, 'Activating connectors')

    for (const c of toActivate) {
      // Backfill accountEmail for OAuth connectors that were connected before
      // identity-fetching was introduced (or where the initial fetch failed).
      if (c.type === 'oauth' && !c.accountEmail && !c.accountLabel) {
        try {
          const token = await this.oauthFlow.getToken(c.id)
          if (token) {
            const registryId = c.registryId ?? c.id
            const email = await fetchAccountIdentity(registryId, token)
            if (email) {
              c.accountEmail = email
              updateConnectorConfig(this.config, c.id, { accountEmail: email })
              log.info({ providerId: c.id, accountEmail: email }, 'Backfilled account identity')
            }
          }
        } catch (err) {
          log.warn({ providerId: c.id, err }, 'Failed to backfill account identity')
        }
      }

      await this.connectorManager.activate(c.id, {
        registryId: c.registryId,
        accountDisplayName: c.accountLabel ?? c.accountEmail,
      })
    }
  }

  /**
   * Boot the unified webhook router and register all providers whose
   * credentials are present. Idempotent — safe to call repeatedly when a
   * connector is added at runtime.
   */
  private async startWebhooks(): Promise<void> {
    // Lazily construct the runner + router on first call.
    if (!this.webhookRunner) {
      this.webhookRunner = new WebhookAgentRunner(
        this.config,
        this.mcpManager,
        this.connectorManager,
        (sessionId) => {
          // Resolve project binding for this webhook session so that
          // project-scoped tools (agent, workflow, etc.) are available.
          const bindingKey = extractBindingKey(sessionId)
          const binding = getBinding(bindingKey)
          let projectId = binding?.projectId

          // Fall back to the default project when no explicit binding exists.
          if (!projectId) {
            const defaultProject = listProjectIndex().find((p) => p.isDefault)
            if (defaultProject) projectId = defaultProject.id
          }

          if (!projectId) return undefined
          const project = loadProject(projectId)
          if (!project) return undefined
          return {
            projectId,
            projectContext: buildProjectContext(project, projectId),
            projectWorkspacePath: project.workspacePath,
            projectType: project.type,
            onJobAction: this.buildAgentActionHandler(sessionId),
            availableWorkflows: this.getAvailableWorkflowsForPrompt(),
          }
        },
        // Harness session factory — lets the runner build Codex /
        // Claude Code sessions for Slack/Telegram with the same wiring
        // desktop sessions use (IPC auth, tool registry, mirror, etc.).
        // Async so we can freshen mcpHealth before baking the capability
        // block into the CLI's system prompt, matching the desktop path.
        async ({ sessionId, providerName, model, projectId, surface }) => {
          await this.ensureMcpHealthFresh()
          return this.createHarnessSession({
            id: sessionId,
            providerName,
            model,
            projectId,
            surface,
          })
        },
        // Session disposer — mirrors handleSessionProviderSwitch's
        // teardown order: drop IPC auth + harness context map BEFORE
        // awaiting registry.delete (which runs session.shutdown()).
        // Without this, any webhook eviction path (/model switch,
        // switchAllSessionModels, /reset) orphans the codex/claude-code
        // subprocess because the webhook runner's own Map entry was the
        // only thing keeping tightly-scoped state, but the real session
        // owner is the server's SessionRegistry.
        async (sessionId) => {
          if (this.mcpIpcServer) {
            this.mcpIpcServer.unregisterSession(sessionId)
          }
          this.harnessSessionContexts.delete(sessionId)
          this.activeTurns.delete(sessionId)
          await this.sessions.delete(sessionId)
        },
      )
      // Wire scheduler access so /agents command works on Telegram/Slack
      if (this.scheduler) {
        this.webhookRunner.setSchedulerJobsProvider(() => this.scheduler!.listJobs())
      }
    }
    if (!this.webhookRouter) {
      this.webhookRouter = new WebhookRouter(this.webhookRunner)
    }

    const publicUrl = this.getPublicUrl()

    // ── Telegram ─────────────────────────────────────────────────
    const telegramToken = this.getTelegramToken()
    if (telegramToken && !this.telegramProvider) {
      this.telegramProvider = new TelegramWebhookProvider(telegramToken)
      this.webhookRouter.register(this.telegramProvider)
      if (publicUrl) {
        await this.telegramProvider.registerWebhook(publicUrl)
      } else {
        log.warn('Telegram token present but ANTON_HOST not set; webhook not registered')
      }
      // Register slash commands with Telegram's Bot Commands menu (fire-and-forget)
      this.telegramProvider.registerCommands().catch(() => {})
    }

    // ── Slack bot ────────────────────────────────────────────────
    // Inbound Slack events arrive from the developer-owned oauth-proxy, not
    // from Slack directly. Verification uses the per-install forward_secret
    // the proxy wrote into slack-bot metadata at OAuth time — we never see
    // Slack's app signing secret.
    //
    // We always register the provider (even before the user has installed
    // the bot) so the route exists; `getForwardSecret` returning null is the
    // natural "not-installed" signal and rejects traffic cleanly.
    if (!this.slackBotProvider) {
      this.slackBotProvider = new SlackWebhookProvider({
        getForwardSecret: async () => this.getSlackBotForwardSecret(),
        getBotToken: async () => {
          try {
            return (await this.oauthFlow.getToken('slack-bot')) ?? null
          } catch {
            return null
          }
        },
        getBotUserId: async () => this.getSlackBotConnector()?.metadata?.bot_user_id ?? null,
        getBotIdentity: async () => {
          const meta = this.getSlackBotConnector()?.metadata
          if (!meta) return null
          return {
            displayName: meta.displayName || undefined,
            iconUrl: meta.iconUrl || undefined,
          }
        },
      })
      this.webhookRouter.register(this.slackBotProvider)

      try {
        const ids = listSessionMetas().map((m) => m.id)
        this.slackBotProvider.rehydrateActiveThreadsFromSessionIds(ids)
      } catch (err) {
        log.warn({ err }, 'failed to rehydrate slack activeThreads from session list')
      }
    }
  }

  /** Resolve the publicly reachable origin used for webhook registration. */
  private getPublicUrl(): string | null {
    if (process.env.ANTON_HOST) return `https://${process.env.ANTON_HOST}`
    if (process.env.OAUTH_CALLBACK_BASE_URL) {
      try {
        return new URL(process.env.OAUTH_CALLBACK_BASE_URL).origin
      } catch {
        /* ignore */
      }
    }
    if (this.config.oauth?.callbackBaseUrl) {
      try {
        return new URL(this.config.oauth.callbackBaseUrl).origin
      } catch {
        /* ignore */
      }
    }
    return null
  }

  private getTelegramToken(): string | null {
    // Check env var first, then credential store
    if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN
    try {
      const creds = this.credentialStore.load('telegram')
      return creds?.secrets?.BOT_TOKEN ?? creds?.secrets?.TELEGRAM_BOT_TOKEN ?? null
    } catch {
      return null
    }
  }

  /**
   * Resolve the slack-bot connector from config. Centralised so the inbound
   * webhook hot path, the proxy notify endpoint, and the disconnect helper all
   * agree on what "the slack-bot install" means.
   */
  private getSlackBotConnector(): ConnectorConfig | undefined {
    return getConnectors(this.config).find((c) => c.id === 'slack-bot')
  }

  /**
   * Resolve the forward_secret for the slack-bot install. Called on every
   * inbound Slack event, so this stays cheap (single Map lookup + property
   * access) — no caching, which sidesteps any race between cache invalidation
   * and concurrent webhook verification during ownership transfers.
   */
  private getSlackBotForwardSecret(): string | null {
    const c = this.getSlackBotConnector()
    return c?.enabled ? (c.metadata?.forward_secret ?? null) : null
  }

  /** No-op kept for call-site compatibility now that the secret is read live. */
  private invalidateSlackBotSecretCache(): void {
    /* secret is now read directly from config; nothing to invalidate */
  }

  // startApiConnectors removed — unified into startConnectors()

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
    const mcpStatus = this.mcpManager.getStatus().find((s: { id: string }) => s.id === c.id)
    const directStatus = this.connectorManager
      .getStatus()
      .find((s: { id: string }) => s.id === c.id)
    // OAuth connectors are "connected" when they have a stored token
    const isOAuthConnected = c.type === 'oauth' && this.oauthFlow.hasToken(c.id) && c.enabled
    const connected = mcpStatus?.connected ?? directStatus?.connected ?? isOAuthConnected
    // Reported toolCount and tools should reflect what the agent will actually see —
    // i.e. excluding tools the user has marked 'never'.
    const rawTools = mcpStatus?.tools ?? directStatus?.tools ?? []
    const perms = c.toolPermissions ?? {}
    const visibleTools = rawTools.filter((t: string) => perms[t] !== 'never')
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      type: c.type,
      connected,
      enabled: c.enabled,
      // Always expose the FULL tool list to the UI so the user can re-enable a 'never' tool.
      // The toolCount reflects the agent-visible subset.
      toolCount: visibleTools.length,
      tools: rawTools,
      toolPermissions: c.toolPermissions,
      // Provider-specific runtime metadata (Slack bot identity, team info, etc.)
      // Sensitive values are stripped before sending to the client.
      metadata: stripSensitiveMetadata(c.metadata),
      hasCredentials: this.credentialStore.has(c.id),
      // Multi-account fields
      registryId: c.registryId,
      accountEmail: c.accountEmail,
      accountLabel: c.accountLabel,
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
      // Store all env values in the credential store (encrypted)
      if (msg.connector.env && Object.keys(msg.connector.env).length > 0) {
        this.credentialStore.save(msg.connector.id, {
          provider: msg.connector.id,
          secrets: msg.connector.env,
        })
      }

      // Strip secrets from config before persisting to config.yaml
      const configToSave = { ...msg.connector }
      configToSave.env = undefined
      addConnector(this.config, configToSave)
      if (msg.connector.id === 'slack-bot') this.invalidateSlackBotSecretCache()

      if (msg.connector.type === 'mcp' && msg.connector.command) {
        await this.mcpManager.addConnector(this.connectorToMcpConfig(msg.connector))
        this.mcpManager.setToolPermissions(msg.connector.id, msg.connector.toolPermissions)
      } else if (msg.connector.toolPermissions) {
        this.connectorManager.setToolPermissions(msg.connector.id, msg.connector.toolPermissions)
      }

      // Activate direct connectors immediately
      const factoryId = msg.connector.registryId ?? msg.connector.id
      if (
        msg.connector.type === 'api' &&
        this.connectorManager.hasFactory(factoryId) &&
        this.credentialStore.has(msg.connector.id)
      ) {
        await this.connectorManager.activate(msg.connector.id, {
          registryId: msg.connector.registryId,
          accountDisplayName: msg.connector.accountLabel ?? msg.connector.accountEmail,
        })
        this.refreshAllSessionTools()
      }

      // Start Telegram webhook provider if just connected
      if (
        msg.connector.id === 'telegram' &&
        this.credentialStore.has('telegram') &&
        !this.telegramProvider
      ) {
        this.startWebhooks().catch((err) => log.error({ err }, 'Webhook startup failed'))
      }

      const saved =
        getConnectors(this.config).find((c) => c.id === msg.connector.id) ?? msg.connector
      this.sendToClient(Channel.AI, {
        type: 'connector_added',
        connector: this.buildConnectorStatus(saved),
      })
      log.info({ connectorId: msg.connector.id, name: msg.connector.name }, 'Connector added')
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
      // If env values provided, merge into credential store
      if (msg.changes.env && Object.keys(msg.changes.env).length > 0) {
        let existing: import('./credential-store.js').StoredCredentials | null = null
        try {
          existing = this.credentialStore.load(msg.id)
        } catch {
          /* fresh */
        }
        const mergedSecrets = { ...(existing?.secrets ?? {}), ...msg.changes.env }
        this.credentialStore.save(msg.id, {
          ...(existing ?? { provider: msg.id }),
          secrets: mergedSecrets,
        })
      }
      // Don't persist env to config.yaml
      const { env: _env, ...configChanges } = msg.changes
      const updated = updateConnectorConfig(this.config, msg.id, configChanges)
      if (!updated) {
        this.sendToClient(Channel.AI, { type: 'error', message: `Connector not found: ${msg.id}` })
        return
      }
      if (msg.id === 'slack-bot') this.invalidateSlackBotSecretCache()

      if (updated.type === 'mcp' && updated.command) {
        await this.mcpManager.removeConnector(msg.id)
        await this.mcpManager.addConnector(this.connectorToMcpConfig(updated))
        this.mcpManager.setToolPermissions(updated.id, updated.toolPermissions)
      } else {
        this.connectorManager.setToolPermissions(updated.id, updated.toolPermissions)
        // Reconfigure live connector if env changed
        if (msg.changes.env) {
          await this.connectorManager.reconfigure(msg.id)
        }
        this.refreshAllSessionTools()
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
      // For slack-bot, tell the oauth-proxy to drop the workspace BEFORE we
      // wipe local config — once metadata.forward_secret is gone we can't
      // produce a valid disconnect signature any more.
      if (msg.id === 'slack-bot') {
        await this.notifyProxySlackBotDisconnect().catch((err) =>
          log.warn({ err }, 'slack-bot proxy disconnect failed (continuing)'),
        )
      }

      // Try MCP removal (ignores if not an MCP connector)
      try {
        await this.mcpManager.removeConnector(msg.id)
      } catch {
        /* not an MCP connector — that's fine */
      }
      this.connectorManager.deactivate(msg.id)
      this.connectorManager.setToolPermissions(msg.id, undefined)
      this.credentialStore.delete(msg.id)
      removeConnectorConfig(this.config, msg.id)
      if (msg.id === 'slack-bot') this.invalidateSlackBotSecretCache()
      this.refreshAllSessionTools()
      this.sendToClient(Channel.AI, { type: 'connector_removed', id: msg.id })
      log.info({ connectorId: msg.id }, 'Connector removed')
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
      if (msg.id === 'slack-bot') this.invalidateSlackBotSecretCache()

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
          await this.connectorManager.activate(msg.id, {
            registryId: connectorConfig?.registryId,
            accountDisplayName: connectorConfig?.accountLabel ?? connectorConfig?.accountEmail,
          })
        } else {
          this.connectorManager.deactivate(msg.id)
        }
        this.refreshAllSessionTools()
        const status = this.connectorManager
          .getStatus()
          .find((s: { id: string }) => s.id === msg.id)
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
        const tools =
          this.connectorManager.getStatus().find((s: { id: string }) => s.id === msg.id)?.tools ??
          []
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
          const connectorConfig = getConnectors(this.config).find((c) => c.id === msg.id)
          await this.connectorManager.activate(msg.id, {
            registryId: connectorConfig?.registryId,
            accountDisplayName: connectorConfig?.accountLabel ?? connectorConfig?.accountEmail,
          })
          const result = await this.connectorManager.testConnection(msg.id)
          const tools =
            this.connectorManager.getStatus().find((s: { id: string }) => s.id === msg.id)?.tools ??
            []
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

  private handleConnectorSetToolPermission(msg: {
    id: string
    toolName: string
    permission: ConnectorToolPermission
  }): void {
    try {
      const updated = setConnectorToolPermission(this.config, msg.id, msg.toolName, msg.permission)
      if (!updated) {
        this.sendToClient(Channel.AI, { type: 'error', message: `Connector not found: ${msg.id}` })
        return
      }
      // Push the new permission set into both managers — MCP for stdio
      // connectors, ConnectorManager for direct OAuth/API connectors. Without
      // the second call, the agent could still call e.g. slack_send_message
      // even though the user marked it 'never' in the UI, because the only
      // enforcement was the MCP-prefix check in session.beforeToolCall.
      this.mcpManager.setToolPermissions(updated.id, updated.toolPermissions)
      this.connectorManager.setToolPermissions(updated.id, updated.toolPermissions)
      // Tools the agent sees may have changed — refresh active sessions.
      this.refreshAllSessionTools()
      this.sendToClient(Channel.AI, {
        type: 'connector_updated',
        connector: this.buildConnectorStatus(updated),
      })
      log.info(
        { connectorId: msg.id, toolName: msg.toolName, permission: msg.permission },
        'Connector tool permission updated',
      )
    } catch (err) {
      this.sendToClient(Channel.AI, {
        type: 'error',
        message: `Failed to set tool permission: ${(err as Error).message}`,
      })
    }
  }

  // ── OAuth connector handlers ──────────────────────────────────────

  private handleConnectorOAuthStart(msg: { provider: string; registryId?: string }): void {
    // For multi-account, the provider is a UUID instance ID — resolve the
    // registry entry from registryId or fall back to the provider itself.
    const lookupId = msg.registryId ?? msg.provider
    const entry = CONNECTOR_REGISTRY.find((e) => e.id === lookupId)
    const scopes = entry?.oauthScopes

    // Build provider-specific extra params
    let extraParams: Record<string, string> | undefined
    if (entry?.oauthProvider === 'websearch') {
      let domain = process.env.ANTON_HOST
      if (!domain && process.env.OAUTH_CALLBACK_BASE_URL) {
        try {
          domain = new URL(process.env.OAUTH_CALLBACK_BASE_URL).hostname
        } catch {
          // ignore invalid URL
        }
      }
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

  private async handleConnectorOAuthDisconnect(msg: { provider: string }): Promise<void> {
    // Drop the stored OAuth token first so the connector can't make any more
    // outbound calls while teardown runs.
    this.oauthFlow.disconnect(msg.provider)

    // Then run the full connector-removal pipeline. This is what makes the
    // slack-bot proxy /_disconnect notify, MCP teardown, ConnectorManager
    // deactivation, session tool refresh, and forward_secret cache
    // invalidation all run for OAuth-initiated disconnects too — previously
    // this path only deleted the token + config and emitted connector_removed,
    // which left direct-connector tools dangling on live sessions and left the
    // workspace owned in the oauth-proxy.
    if (getConnectors(this.config).some((c) => c.id === msg.provider)) {
      await this.handleConnectorRemove({ id: msg.provider })
    } else {
      // No config row to remove — still let the UI know the token is gone.
      this.sendToClient(Channel.AI, { type: 'connector_removed', id: msg.provider })
    }
    log.info({ provider: msg.provider }, 'OAuth connector disconnected')
  }

  private async handleOAuthComplete(result: {
    provider: string
    success: boolean
    error?: string
    metadata?: Record<string, string>
  }): Promise<void> {
    if (result.success) {
      // Auto-create a connector config for the OAuth provider
      const existingConnector = getConnectors(this.config).find((c) => c.id === result.provider)
      // Resolve registryId: the connector config may have one (multi-account UUID),
      // or the provider IS the registryId (single-account backward compat).
      const registryId = existingConnector?.registryId ?? result.provider
      const registryEntry = CONNECTOR_REGISTRY.find((r) => r.id === registryId)

      // Fetch account identity (email/username) from the provider
      let accountEmail: string | undefined
      try {
        const token = await this.oauthFlow.getToken(result.provider)
        if (token) {
          accountEmail = (await fetchAccountIdentity(registryId, token)) ?? undefined
        }
      } catch (err) {
        log.warn({ provider: result.provider, err }, 'Failed to fetch account identity')
      }

      if (!existingConnector) {
        addConnector(this.config, {
          id: result.provider,
          name: registryEntry?.name || result.provider,
          description: registryEntry?.description,
          icon: registryEntry?.icon,
          type: 'oauth',
          enabled: true,
          metadata: result.metadata,
          // Multi-account: only set registryId if it differs from the id
          registryId: registryId !== result.provider ? registryId : undefined,
          accountEmail,
        })
      } else {
        const updates: Partial<ConnectorConfig> = {}
        if (result.metadata) {
          // Merge fresh OAuth metadata onto the existing connector. Critical
          // for slack-bot, where the proxy hands us a per-install forward_secret
          // that the SlackWebhookProvider must read on every inbound event.
          updates.metadata = { ...(existingConnector.metadata ?? {}), ...result.metadata }
        }
        if (accountEmail) {
          updates.accountEmail = accountEmail
        }
        if (Object.keys(updates).length > 0) {
          updateConnectorConfig(this.config, result.provider, updates)
        }
      }
      if (result.provider === 'slack-bot') this.invalidateSlackBotSecretCache()

      // Activate the direct connector so tools are immediately available.
      const factoryId = registryId
      if (this.connectorManager.hasFactory(factoryId)) {
        const activated = await this.connectorManager.activate(result.provider, {
          registryId: registryId !== result.provider ? registryId : undefined,
          accountDisplayName: accountEmail,
        })
        if (!activated) {
          log.error(
            { provider: result.provider },
            'OAuth completed but direct connector failed to activate',
          )
        }
        this.refreshAllSessionTools()
      }

      // Push updated connector status so the desktop store updates immediately.
      // Re-read the config to get the fully-saved version with accountEmail etc.
      const freshConfig = getConnectors(this.config).find((c) => c.id === result.provider)
      if (freshConfig) {
        this.sendToClient(Channel.AI, {
          type: 'connector_added',
          connector: this.buildConnectorStatus(freshConfig),
        })
      }

      log.info({ provider: result.provider, accountEmail }, 'OAuth connector connected')
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
      if (!isHarnessSession(session)) {
        session.refreshConnectorTools()
      }
    }
    this.webhookRunner?.refreshAllSessionTools()
  }

  /**
   * Inbound typed notifications from the oauth-proxy. Currently used to tell
   * the agent its slack-bot install was transferred to a different Anton.
   *
   * Authenticated by HMAC-SHA256 over `v1:<ts>:<rawBody>` using the slack-bot
   * connector's `forward_secret`. Only the proxy that minted that secret can
   * produce a valid signature.
   */
  private async handleProxyNotify(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    log.info({ remoteAddr: req.socket.remoteAddress }, 'proxy-notify: inbound')
    let body = ''
    for await (const chunk of req) body += (chunk as Buffer).toString('utf8')

    const ts = (req.headers['x-anton-proxy-ts'] as string | undefined) ?? ''
    const sig = (req.headers['x-anton-proxy-sig'] as string | undefined) ?? ''
    if (!ts || !sig) {
      log.warn('proxy-notify: missing signature headers')
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('missing signature')
      return
    }
    const tsNum = Number.parseInt(ts, 10)
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
      log.warn({ ts, skewSec: Date.now() / 1000 - tsNum }, 'proxy-notify: stale timestamp')
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('stale timestamp')
      return
    }

    let payload: { type?: string; team_id?: string; team_name?: string; new_owner_label?: string }
    try {
      payload = JSON.parse(body)
    } catch (err) {
      log.warn({ err }, 'proxy-notify: invalid JSON body')
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('invalid json')
      return
    }

    // The notify channel is per-install — verify against the slack-bot
    // connector's forward_secret. (When we add more notify-capable connectors
    // we'll dispatch on payload.type to find the right secret.)
    if (!payload.type?.startsWith('slack-bot.')) {
      log.warn({ type: payload.type }, 'proxy-notify: unknown notify type')
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('unknown notify type')
      return
    }
    const secret = this.getSlackBotConnector()?.metadata?.forward_secret
    if (!secret) {
      log.warn('proxy-notify: no slack-bot install, nothing to verify against')
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('no slack-bot install')
      return
    }

    // The Worker signs notifications using the same base64url helper as the
    // Slack event forward path. We must compute base64url here too or every
    // ownership-lost notify will 401 for the same encoding-mismatch reason
    // the slack-bot webhook verify used to. Keep these in lockstep.
    const { createHmac, timingSafeEqual } = await import('node:crypto')
    const expected = `v1=${createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`v1:${ts}:${body}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}`
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    let valid = false
    try {
      valid = a.length === b.length && timingSafeEqual(a, b)
    } catch {
      valid = false
    }
    if (!valid) {
      log.warn(
        {
          type: payload.type,
          sigPrefix: sig.slice(0, 16),
          expectedPrefix: expected.slice(0, 16),
        },
        'proxy-notify: HMAC mismatch, rejecting',
      )
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('bad signature')
      return
    }
    log.info({ type: payload.type, teamId: payload.team_id }, 'proxy-notify: verified, processing')

    // Ack first — we don't want the proxy retrying because our cleanup is slow.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')

    if (payload.type === 'slack-bot.ownership-lost') {
      log.warn(
        { teamId: payload.team_id, newOwner: payload.new_owner_label },
        'slack-bot ownership transferred to another Anton — disconnecting locally',
      )
      try {
        // Drop the active connector + its tools, then push a UI update.
        try {
          this.connectorManager.deactivate('slack-bot')
        } catch {
          /* not active — fine */
        }
        removeConnectorConfig(this.config, 'slack-bot')
        this.invalidateSlackBotSecretCache()
        this.refreshAllSessionTools()
        this.sendToClient(Channel.AI, { type: 'connector_removed', id: 'slack-bot' })
      } catch (err) {
        log.error({ err }, 'failed to drop slack-bot connector after ownership transfer')
      }
    }
  }

  /**
   * Tell the oauth-proxy to stop routing Slack events for the workspace
   * currently owned by this Anton. Signed with the per-install forward_secret
   * so only the current owner can trigger a disconnect.
   */
  private async notifyProxySlackBotDisconnect(): Promise<void> {
    const c = this.getSlackBotConnector()
    const secret = c?.metadata?.forward_secret
    const teamId = c?.metadata?.team_id
    if (!secret || !teamId) return

    const proxyUrl = this.oauthFlow.getProxyUrl() ?? process.env.OAUTH_PROXY_URL
    if (!proxyUrl) {
      log.warn('slack-bot disconnect: no proxy URL configured')
      return
    }

    const ts = Math.floor(Date.now() / 1000).toString()
    const { createHmac } = await import('node:crypto')
    const sig = createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`${teamId}:${ts}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/_disconnect/slack-bot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-anton-agent-sig': sig,
      },
      body: JSON.stringify({ team_id: teamId, ts }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      log.warn({ status: res.status }, 'slack-bot /_disconnect responded non-2xx')
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
        log.debug('No sessions on disk')
        return
      }
      log.info({ count: metas.length }, 'Sessions on disk')
      for (const m of metas.slice(0, 20)) {
        const ago = Math.round((Date.now() - m.lastActiveAt) / 60_000)
        const agoStr =
          ago < 60
            ? `${ago}m ago`
            : ago < 1440
              ? `${Math.round(ago / 60)}h ago`
              : `${Math.round(ago / 1440)}d ago`
        log.debug(
          { sessionId: m.id, title: m.title, messageCount: m.messageCount, lastActive: agoStr },
          'Stored session',
        )
      }
      if (metas.length > 20)
        log.debug({ remaining: metas.length - 20 }, 'Additional sessions on disk')
    } catch (err: unknown) {
      log.error({ err }, 'Failed to list sessions on disk')
    }
  }

  private sendToClient(channel: ChannelId, message: object) {
    if (this.activeClient && this.activeClient.readyState === WebSocket.OPEN) {
      this.activeClient.send(encodeFrame(channel, message))
    }
  }

  /**
   * Schedule a hard wall-clock cancel for a detached turn. Replaces any
   * existing timer for the same session so repeated disconnects don't
   * stack. Cleared automatically when the client reconnects or the
   * turn ends naturally (see `clearDetachedTurnBudget`).
   */
  private scheduleDetachedTurnBudget(sessionId: string, budgetMs: number): void {
    const existing = this.detachedTurnTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.detachedTurnTimers.delete(sessionId)
      const session = this.sessions.get(sessionId)
      if (session) {
        log.warn(
          { sessionId, budgetMs },
          'Detached turn budget exceeded, cancelling',
        )
        session.cancel()
      }
    }, budgetMs)
    // Don't let this timer keep the process alive on shutdown.
    if (typeof timer.unref === 'function') timer.unref()
    this.detachedTurnTimers.set(sessionId, timer)
  }

  /** Called when a turn ends naturally — clear any pending budget timer. */
  private clearDetachedTurnBudget(sessionId: string): void {
    const t = this.detachedTurnTimers.get(sessionId)
    if (t) {
      clearTimeout(t)
      this.detachedTurnTimers.delete(sessionId)
    }
  }
}

/**
 * Drop secrets before sending connector metadata to the desktop client.
 * Anything that looks like a token, secret, or key is redacted.
 */
const SENSITIVE_METADATA_KEYS = new Set([
  'access_token',
  'bot_token',
  'refresh_token',
  'client_secret',
  'api_key',
  'signing_secret',
  // Per-install HMAC key the proxy uses to sign forwarded Slack events to
  // the agent-server. Lives in slack-bot metadata; never expose to UI.
  'forward_secret',
])
function stripSensitiveMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!metadata) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(k)) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
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

  log.info('Generating self-signed TLS certificate')

  try {
    execSync(`mkdir -p "${certDir}"`)
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=anton.computer"`,
      { stdio: 'pipe' },
    )
  } catch (err: unknown) {
    log.error({ err }, 'Failed to generate certs')
  }
}
