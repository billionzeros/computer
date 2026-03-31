import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// ── Provider types ──────────────────────────────────────────────────

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  models: string[]
}

export type ProvidersMap = Record<string, ProviderConfig>

// ── Session persistence ─────────────────────────────────────────────

/** Session metadata — stored in meta.json, no messages */
export interface SessionMeta {
  id: string
  title: string
  provider: string
  model: string
  createdAt: number
  lastActiveAt: number
  messageCount: number
  archived: boolean
  tags: string[]
  parentSessionId?: string
  compactionCount?: number
  lastCompactedAt?: number
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
}

export interface PersistedImageBlock {
  type: 'image'
  mimeType: string
  storagePath: string
  name?: string
  sizeBytes?: number
}

/** A single message line in messages.jsonl */
export interface SessionMessage {
  role: string
  timestamp?: number
  content?: string | (Record<string, unknown> | PersistedImageBlock)[]
  [key: string]: unknown
}

/** Session index — lightweight listing of all sessions */
interface SessionIndex {
  version: number
  sessions: SessionMeta[]
}

/** Full session data for backward compat and session.ts */
export interface PersistedTaskItem {
  content: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface PersistedSession {
  id: string
  provider: string
  model: string
  messages: unknown[] // pi SDK message format
  createdAt: number
  lastActiveAt: number
  title: string
  compactionState?: {
    summary: string | null
    compactedMessageCount: number
    lastCompactedAt: number | null
    compactionCount: number
  }
  lastTasks?: PersistedTaskItem[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
}

// ── Main config ─────────────────────────────────────────────────────

export interface AgentConfig {
  agentId: string
  token: string
  port: number

  providers: ProvidersMap

  defaults: {
    provider: string
    model: string
  }

  security: {
    confirmPatterns: string[]
    forbiddenPaths: string[]
    networkAllowlist: string[]
  }

  skills: SkillConfig[]

  connectors: ConnectorConfig[]

  oauth?: {
    proxyUrl: string // URL of the OAuth proxy (CF Worker)
    callbackBaseUrl?: string // Agent's public URL for receiving callbacks
  }

  workspace?: {
    root: string // default: ~/Anton — user-visible directory for all projects
  }

  sessions?: {
    ttlDays: number // auto-cleanup after N days, default 7
  }

  compaction?: {
    enabled: boolean // default: true
    threshold: number // fraction of context window (default: 0.80)
    preserveRecentCount: number // messages to keep verbatim (default: 20)
    toolOutputMaxTokens: number // max tokens per tool output (default: 4000)
  }

  braintrust?: {
    apiKey?: string // or use BRAINTRUST_API_KEY env var
    projectName?: string // defaults to "anton-agent"
    sampleRate?: number // fraction of sessions to score online (default: 0.1)
    onlineScoring?: boolean // enable online heuristic + sampled scoring (default: false)
  }
}

export interface SkillConfig {
  name: string
  description: string
  prompt: string
  schedule?: string
  tools?: string[]
}

// ── Connector types ──────────────────────────────────────────────────

export interface ConnectorConfig {
  id: string
  name: string
  description?: string
  icon?: string // emoji or URL
  type: 'mcp' | 'api' | 'oauth' // mcp = stdio server, api = simple API key, oauth = OAuth flow

  // For MCP connectors (type: 'mcp')
  command?: string
  args?: string[]
  env?: Record<string, string>

  // For API key connectors (type: 'api')
  apiKey?: string
  baseUrl?: string

  // For OAuth connectors (type: 'oauth') — tokens stored separately in TokenStore
  oauthProvider?: string

  // Extra per-connector key-value data (e.g. ownerChatId for Telegram)
  metadata?: Record<string, string>

  enabled: boolean
}

// ── Paths ───────────────────────────────────────────────────────────

const ANTON_DIR = join(homedir(), '.anton')
const CONFIG_PATH = join(ANTON_DIR, 'config.yaml')
const CONVERSATIONS_DIR = join(ANTON_DIR, 'conversations')
const PROMPTS_DIR = join(ANTON_DIR, 'prompts')
const PROJECT_TYPES_DIR = join(PROMPTS_DIR, 'project-types')
const DEFAULT_WORKSPACE_ROOT = join(homedir(), 'Anton')
const SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, 'system.md')
const GLOBAL_MEMORY_DIR = join(ANTON_DIR, 'memory')
const PUBLISHED_DIR = join(ANTON_DIR, 'published')

// Embedded prompts — baked in at build time by scripts/embed-prompts.js.
// This works in both source mode and binary mode (no filesystem read needed).
import { EMBEDDED_PROJECT_TYPE_PROMPTS, EMBEDDED_SYSTEM_PROMPT } from './embedded-prompts.js'

// ── Default providers ───────────────────────────────────────────────

/**
 * Default providers with model IDs that match pi SDK's registry.
 * IMPORTANT: Model IDs must exactly match what pi SDK's getModel() expects.
 * Run `getModel(provider, modelId)` to verify — it throws on unknown IDs.
 */
const DEFAULT_PROVIDERS: ProvidersMap = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY || '',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    models: ['llama-3.3-70b-versatile', 'llama3-70b-8192'],
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.6',
      'openai/gpt-4o',
      'google/gemini-2.5-pro-preview',
      'minimax/minimax-m2.5',
      'minimax/minimax-m2.7',
      'meta-llama/llama-4-maverick',
    ],
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
    models: ['mistral-large-latest', 'mistral-medium-latest'],
  },
}

// ── Load / Save / Migrate ───────────────────────────────────────────

/**
 * Parse CLI flags from process.argv.
 * Supports: --port <n>, --token <string>
 */
function parseCLIFlags(): { port?: number; token?: string } {
  const args = process.argv.slice(2)
  const flags: { port?: number; token?: string } = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      flags.port = Number(args[++i])
    } else if (args[i] === '--token' && args[i + 1]) {
      flags.token = args[++i]
    }
  }
  return flags
}

export function loadConfig(): AgentConfig {
  mkdirSync(ANTON_DIR, { recursive: true })
  mkdirSync(CONVERSATIONS_DIR, { recursive: true })
  mkdirSync(join(ANTON_DIR, 'skills'), { recursive: true })

  const flags = parseCLIFlags()

  // Token override: --token flag > ANTON_TOKEN env var
  const tokenOverride = flags.token || process.env.ANTON_TOKEN

  if (!existsSync(CONFIG_PATH)) {
    const defaultConfig = createDefaultConfig()
    if (tokenOverride) defaultConfig.token = tokenOverride
    if (flags.port) defaultConfig.port = flags.port
    writeFileSync(CONFIG_PATH, stringifyYaml(defaultConfig), 'utf-8')
    console.log(`\n  Config created: ${CONFIG_PATH}`)
    console.log(`  Token: ${defaultConfig.token}`)
    console.log('  Save this token — you need it to connect from the desktop app.\n')
    return defaultConfig
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  // biome-ignore lint/suspicious/noExplicitAny: yaml parser returns untyped data
  const parsed = parseYaml(raw) as Record<string, any>

  // Merge parsed config with defaults — any missing fields get filled in.
  // This makes the binary truly zero-config: even a config file with just
  // "port: 9876" will work because providers, security, etc. get defaults.
  const defaults = createDefaultConfig()
  const config: AgentConfig = {
    ...defaults,
    ...parsed,
    providers: parsed.providers ?? defaults.providers,
    defaults: parsed.defaults ?? defaults.defaults,
    security: parsed.security ?? defaults.security,
    skills: parsed.skills ?? defaults.skills ?? [],
    connectors: parsed.connectors ?? defaults.connectors ?? [],
    workspace: parsed.workspace ?? defaults.workspace,
    sessions: parsed.sessions ?? defaults.sessions,
  }

  // Apply CLI/env overrides (these take precedence over config file)
  if (tokenOverride) config.token = tokenOverride
  if (flags.port) config.port = flags.port

  // OAuth env var overrides
  if (process.env.OAUTH_PROXY_URL || process.env.OAUTH_CALLBACK_BASE_URL) {
    config.oauth = {
      proxyUrl: process.env.OAUTH_PROXY_URL || config.oauth?.proxyUrl || '',
      callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL || config.oauth?.callbackBaseUrl,
    }
  }

  // Braintrust env var override
  if (process.env.BRAINTRUST_API_KEY) {
    config.braintrust = {
      ...config.braintrust,
      apiKey: process.env.BRAINTRUST_API_KEY,
    }
  }

  return config
}

export function saveConfig(config: AgentConfig): void {
  writeFileSync(CONFIG_PATH, stringifyYaml(config), 'utf-8')
}

function pickDefaultProvider(): { provider: string; model: string } {
  // Pick first provider that actually has a key
  for (const [name, p] of Object.entries(DEFAULT_PROVIDERS)) {
    const envVar = ENV_KEY_MAP[name]
    const hasKey = (p.apiKey && p.apiKey.length > 0) || (envVar && process.env[envVar])
    if (hasKey && p.models.length > 0) {
      return { provider: name, model: p.models[0] }
    }
  }
  // Fallback — no keys configured at all
  return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
}

function createDefaultConfig(): AgentConfig {
  return {
    agentId: `anton-${hostname()}-${randomBytes(4).toString('hex')}`,
    token: `ak_${randomBytes(24).toString('hex')}`,
    port: 9876,
    providers: DEFAULT_PROVIDERS,
    defaults: pickDefaultProvider(),
    security: {
      confirmPatterns: ['rm -rf', 'sudo', 'shutdown', 'reboot', 'mkfs', 'dd if=', ':(){ :|:& };:'],
      forbiddenPaths: ['/etc/shadow', '~/.ssh/id_*', '~/.anton/config.yaml'],
      networkAllowlist: [
        'github.com',
        'npmjs.org',
        'pypi.org',
        'registry.npmjs.org',
        'api.anthropic.com',
        'api.openai.com',
        'api.exa.ai',
      ],
    },
    skills: [],
    connectors: [],
    workspace: { root: DEFAULT_WORKSPACE_ROOT },
    sessions: { ttlDays: 7 },
  }
}

// ── Provider management ─────────────────────────────────────────────

export function setProviderKey(config: AgentConfig, provider: string, apiKey: string): void {
  const defaults = DEFAULT_PROVIDERS[provider]
  if (!config.providers[provider]) {
    // New provider — seed with default models and baseUrl if known
    config.providers[provider] = {
      apiKey,
      models: defaults?.models || [],
      ...(defaults?.baseUrl ? { baseUrl: defaults.baseUrl } : {}),
    }
  } else {
    config.providers[provider].apiKey = apiKey
    // Restore default models if empty (e.g. broken config)
    if (!config.providers[provider].models || config.providers[provider].models.length === 0) {
      config.providers[provider].models = defaults?.models || []
    }
    // Restore baseUrl if missing
    if (!config.providers[provider].baseUrl && defaults?.baseUrl) {
      config.providers[provider].baseUrl = defaults.baseUrl
    }
  }
  saveConfig(config)
}

export function setProviderModels(config: AgentConfig, provider: string, models: string[]): void {
  const defaults = DEFAULT_PROVIDERS[provider]
  if (!config.providers[provider]) {
    config.providers[provider] = {
      apiKey: '',
      models,
      ...(defaults?.baseUrl ? { baseUrl: defaults.baseUrl } : {}),
    }
  } else {
    config.providers[provider].models = models
  }
  saveConfig(config)
}

export function setDefault(config: AgentConfig, provider: string, model: string): void {
  config.defaults = { provider, model }
  saveConfig(config)
}

const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}

/** Check if a provider has a usable API key (config file OR environment variable). */
export function providerHasKey(provider: string, config: AgentConfig): boolean {
  const p = config.providers[provider]
  if (p?.apiKey && p.apiKey.length > 0) return true
  const envVar = ENV_KEY_MAP[provider]
  if (envVar && process.env[envVar]) return true
  return false
}

export function getProvidersList(config: AgentConfig) {
  // Merge config providers with all defaults so nothing is missing
  const allProviderNames = new Set([
    ...Object.keys(DEFAULT_PROVIDERS),
    ...Object.keys(config.providers),
  ])

  return Array.from(allProviderNames).map((name) => {
    const configEntry = config.providers[name]
    const defaults = DEFAULT_PROVIDERS[name]

    // Models: prefer config if non-empty, else defaults
    const models =
      configEntry?.models && configEntry.models.length > 0
        ? configEntry.models
        : defaults?.models || []

    return {
      name,
      models,
      defaultModels: defaults?.models || [],
      hasApiKey: providerHasKey(name, config),
      baseUrl: configEntry?.baseUrl || defaults?.baseUrl,
    }
  })
}

// ── Session persistence (v2: meta.json + messages.jsonl) ────────────
// Sessions live under ~/.anton/conversations/

const INDEX_PATH = join(CONVERSATIONS_DIR, 'index.json')

function sessionDir(id: string): string {
  return join(CONVERSATIONS_DIR, id)
}

function metaPath(id: string): string {
  return join(sessionDir(id), 'meta.json')
}

function messagesPath(id: string): string {
  return join(sessionDir(id), 'messages.jsonl')
}

function sessionImagesDir(id: string): string {
  return join(sessionDir(id), 'images')
}

function clearSessionImages(id: string): void {
  const dir = sessionImagesDir(id)
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir)) {
    unlinkSync(join(dir, file))
  }
}

function sanitizeAttachmentName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'image'
  )
}

function extensionFromMimeType(mimeType: string): string {
  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/heic': '.heic',
    'image/heif': '.heif',
  }
  return extMap[mimeType] || ''
}

function splitAttachmentName(name?: string): { base: string; ext: string } {
  if (!name) return { base: 'image', ext: '' }
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { base: sanitizeAttachmentName(trimmed), ext: '' }
  }
  return {
    base: sanitizeAttachmentName(trimmed.slice(0, dot)),
    ext: trimmed.slice(dot),
  }
}

function toRelativeImagePath(
  messageIndex: number,
  blockIndex: number,
  name?: string,
  mimeType?: string,
): string {
  const { base, ext } = splitAttachmentName(name)
  const safeExt = ext || extensionFromMimeType(mimeType || '')
  const filename = `${String(messageIndex + 1).padStart(4, '0')}-${String(blockIndex + 1).padStart(2, '0')}-${base}${safeExt}`
  return join('images', filename).replaceAll('\\', '/')
}

function serializeSessionContent(
  sessionId: string,
  messageIndex: number,
  content: unknown,
): SessionMessage['content'] {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : undefined
  }

  const imagesDir = sessionImagesDir(sessionId)
  mkdirSync(imagesDir, { recursive: true })

  return content.map((block, blockIndex) => {
    const value = block as Record<string, unknown>
    if (
      value.type !== 'image' ||
      typeof value.data !== 'string' ||
      typeof value.mimeType !== 'string'
    ) {
      return value
    }

    const relativePath = toRelativeImagePath(
      messageIndex,
      blockIndex,
      typeof value.name === 'string' ? value.name : undefined,
      value.mimeType,
    )
    const absolutePath = join(sessionDir(sessionId), relativePath)
    const imageBuffer = Buffer.from(value.data, 'base64')
    writeFileSync(absolutePath, imageBuffer)

    return {
      type: 'image',
      mimeType: value.mimeType,
      storagePath: relativePath,
      name: typeof value.name === 'string' ? value.name : relativePath.split('/').pop(),
      sizeBytes:
        typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes)
          ? value.sizeBytes
          : imageBuffer.byteLength,
    } satisfies PersistedImageBlock
  })
}

function hydrateSessionContent(sessionId: string, content: unknown): SessionMessage['content'] {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : undefined
  }

  return content.map((block) => {
    const value = block as Record<string, unknown>
    if (value.type !== 'image' || typeof value.storagePath !== 'string') {
      return value
    }

    const absolutePath = join(sessionDir(sessionId), value.storagePath)
    if (!existsSync(absolutePath)) {
      return value
    }

    return {
      type: 'image',
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'image/png',
      data: readFileSync(absolutePath).toString('base64'),
      name: typeof value.name === 'string' ? value.name : value.storagePath.split('/').pop(),
      storagePath: value.storagePath,
      sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    }
  })
}

function serializeSessionMessage(
  sessionId: string,
  rawMsg: unknown,
  messageIndex: number,
): SessionMessage {
  const msg = rawMsg as Record<string, unknown>
  const serialized: SessionMessage = {
    ...msg,
    role: typeof msg.role === 'string' ? msg.role : 'system',
  }

  if ('content' in msg) {
    serialized.content = serializeSessionContent(sessionId, messageIndex, msg.content)
  }

  return serialized
}

function hydrateSessionMessage(sessionId: string, rawMsg: SessionMessage): SessionMessage {
  const hydrated: SessionMessage = { ...rawMsg }
  if ('content' in rawMsg) {
    hydrated.content = hydrateSessionContent(sessionId, rawMsg.content)
  }
  return hydrated
}

/** Save session — writes meta.json and full messages.jsonl, updates index */
export function saveSession(session: PersistedSession, basePath?: string): void {
  const dir = basePath ? join(basePath, session.id) : sessionDir(session.id)
  mkdirSync(dir, { recursive: true })
  if (!basePath) clearSessionImages(session.id)

  // Write meta
  const meta: SessionMeta = {
    id: session.id,
    title: session.title,
    provider: session.provider,
    model: session.model,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messages.length,
    archived: false,
    tags: [],
    compactionCount: session.compactionState?.compactionCount,
    lastCompactedAt: session.compactionState?.lastCompactedAt ?? undefined,
    usage: session.usage,
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // Write compaction state if present
  if (session.compactionState) {
    writeFileSync(
      join(dir, 'compaction.json'),
      JSON.stringify(session.compactionState, null, 2),
      'utf-8',
    )
  }

  // Write last tasks if present
  if (session.lastTasks && session.lastTasks.length > 0) {
    writeFileSync(join(dir, 'tasks.json'), JSON.stringify(session.lastTasks, null, 2), 'utf-8')
  }

  // Write messages as JSONL with image blocks externalized into session-local files.
  const lines = session.messages.map((rawMsg: unknown, i: number) =>
    JSON.stringify(serializeSessionMessage(session.id, rawMsg, i)),
  )
  writeFileSync(join(dir, 'messages.jsonl'), `${lines.join('\n')}\n`, 'utf-8')

  // Update index (only for global sessions)
  if (!basePath) {
    updateIndex(meta)
  }
}

/** Append a single message to an existing session's JSONL */
export function appendSessionMessage(id: string, msg: SessionMessage): void {
  const path = messagesPath(id)
  if (!existsSync(path)) return
  appendFileSync(path, `${JSON.stringify(msg)}\n`)

  // Update meta counts
  const meta = loadSessionMeta(id)
  if (meta) {
    meta.messageCount++
    meta.lastActiveAt = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()
    writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8')
    updateIndex(meta)
  }
}

/** Persist task state immediately (called during streaming to avoid data loss on disconnect). */
export function saveSessionTasks(id: string, tasks: PersistedTaskItem[], basePath?: string): void {
  const dir = basePath ? join(basePath, id) : sessionDir(id)
  if (!existsSync(dir)) return
  writeFileSync(join(dir, 'tasks.json'), JSON.stringify(tasks, null, 2), 'utf-8')
}

/**
 * Append a single message to an existing conversation's messages.jsonl
 * and update meta.json (messageCount, lastActiveAt).
 * Used for delivering agent results to the parent conversation.
 */
export function appendMessageToSession(
  id: string,
  message: { role: string; content: string; agentName?: string; agentSessionId?: string },
  basePath?: string,
): boolean {
  const dir = basePath ? join(basePath, id) : sessionDir(id)
  const msgPath = join(dir, 'messages.jsonl')
  const mPath = join(dir, 'meta.json')
  if (!existsSync(dir) || !existsSync(msgPath)) return false

  // Append message
  const line: SessionMessage = {
    role: message.role,
    content: message.content,
    timestamp: Date.now(),
    ...(message.agentName ? { agentName: message.agentName } : {}),
    ...(message.agentSessionId ? { agentSessionId: message.agentSessionId } : {}),
  }
  appendFileSync(msgPath, `${JSON.stringify(line)}\n`)

  // Update meta
  if (existsSync(mPath)) {
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(mPath, 'utf-8'))
      meta.messageCount = (meta.messageCount ?? 0) + 1
      meta.lastActiveAt = Date.now()
      writeFileSync(mPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {
      /* skip meta update on error */
    }
  }

  return true
}

/** Load session with full messages (for pi SDK resume) */
export function loadSession(id: string, basePath?: string): PersistedSession | null {
  // If basePath given, load from custom location (project sessions)
  if (basePath) {
    const dir = join(basePath, id)
    const mPath = join(dir, 'meta.json')
    if (!existsSync(mPath)) return null
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(mPath, 'utf-8'))
      const msgPath = join(dir, 'messages.jsonl')
      const messages = existsSync(msgPath)
        ? readFileSync(msgPath, 'utf-8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              const parsed = JSON.parse(l)
              return hydrateSessionContent(id, parsed) || parsed
            })
        : []
      let compactionState: PersistedSession['compactionState'] | undefined
      const compPath = join(dir, 'compaction.json')
      if (existsSync(compPath)) {
        try {
          compactionState = JSON.parse(readFileSync(compPath, 'utf-8'))
        } catch {}
      }
      let lastTasks: PersistedTaskItem[] | undefined
      const tasksPath = join(dir, 'tasks.json')
      if (existsSync(tasksPath)) {
        try {
          lastTasks = JSON.parse(readFileSync(tasksPath, 'utf-8'))
        } catch {}
      }
      return {
        id: meta.id,
        provider: meta.provider,
        model: meta.model,
        messages,
        createdAt: meta.createdAt,
        lastActiveAt: meta.lastActiveAt,
        title: meta.title,
        compactionState,
        lastTasks,
      }
    } catch {
      return null
    }
  }

  // Try v2 format first
  const meta = loadSessionMeta(id)
  if (meta) {
    const messages = loadSessionMessages(id)

    // Load compaction state if present
    let compactionState: PersistedSession['compactionState'] | undefined
    const compactionPath = join(sessionDir(id), 'compaction.json')
    if (existsSync(compactionPath)) {
      try {
        compactionState = JSON.parse(readFileSync(compactionPath, 'utf-8'))
      } catch {}
    }

    // Load last tasks if present
    let lastTasks: PersistedTaskItem[] | undefined
    const tasksFilePath = join(sessionDir(id), 'tasks.json')
    if (existsSync(tasksFilePath)) {
      try {
        lastTasks = JSON.parse(readFileSync(tasksFilePath, 'utf-8'))
      } catch {}
    }

    return {
      id: meta.id,
      provider: meta.provider,
      model: meta.model,
      messages,
      createdAt: meta.createdAt,
      lastActiveAt: meta.lastActiveAt,
      title: meta.title,
      compactionState,
      lastTasks,
    }
  }

  return null
}

/** Load just the metadata (no messages) */
export function loadSessionMeta(id: string): SessionMeta | null {
  const path = metaPath(id)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as SessionMeta
}

/** Load messages from JSONL */
function loadSessionMessages(id: string): unknown[] {
  const path = messagesPath(id)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) return []
  return raw
    .split('\n')
    .map((line) => hydrateSessionMessage(id, JSON.parse(line) as SessionMessage))
}

/** List all sessions (from index, fast) */
export function listSessions(): PersistedSession[] {
  const index = loadIndex()
  return index.sessions
    .filter((s) => !s.archived)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((meta) => ({
      id: meta.id,
      provider: meta.provider,
      model: meta.model,
      messages: [], // don't load messages for listing
      createdAt: meta.createdAt,
      lastActiveAt: meta.lastActiveAt,
      title: meta.title,
    }))
}

/** List session metadata only (no messages) */
export function listSessionMetas(): SessionMeta[] {
  const index = loadIndex()
  return index.sessions.filter((s) => !s.archived).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

/** Delete session (hard delete) */
export function deleteSession(id: string): boolean {
  const dir = sessionDir(id)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }

  // Delete from project conversations dir if this is a project session
  // Session IDs follow the format: proj_{projectId}_sess_{suffix}
  const projMatch = id.match(/^proj_(.+?)_sess_/)
  if (projMatch) {
    const projectId = projMatch[1]
    const projectSessionDir = join(ANTON_DIR, 'projects', projectId, 'conversations', id)
    if (existsSync(projectSessionDir)) {
      rmSync(projectSessionDir, { recursive: true, force: true })
    }
  }

  // Also handle agent-job sessions: agent-job-{projectId}-{jobId}
  const agentJobMatch = id.match(/^agent-job-(.+?)-job_/)
  if (agentJobMatch) {
    const projectId = agentJobMatch[1]
    const projectSessionDir = join(ANTON_DIR, 'projects', projectId, 'conversations', id)
    if (existsSync(projectSessionDir)) {
      rmSync(projectSessionDir, { recursive: true, force: true })
    }
  }

  removeFromIndex(id)
  return true
}

/** Archive session (soft delete) */
export function archiveSession(id: string): boolean {
  const meta = loadSessionMeta(id)
  if (!meta) return false
  meta.archived = true
  writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8')
  updateIndex(meta)
  return true
}

/** Clean expired sessions */
export function cleanExpiredSessions(ttlDays = 30): number {
  const archiveCutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
  const deleteCutoff = Date.now() - (ttlDays + 7) * 24 * 60 * 60 * 1000

  const index = loadIndex()
  let cleaned = 0

  for (const meta of index.sessions) {
    if (meta.archived && meta.lastActiveAt < deleteCutoff) {
      // Hard delete sessions archived for > 7 days past TTL
      deleteSession(meta.id)
      cleaned++
    } else if (!meta.archived && meta.lastActiveAt < archiveCutoff) {
      // Archive sessions older than TTL
      archiveSession(meta.id)
    }
  }

  return cleaned
}

// ── Index management ────────────────────────────────────────────────

function loadIndex(): SessionIndex {
  mkdirSync(CONVERSATIONS_DIR, { recursive: true })
  if (existsSync(INDEX_PATH)) {
    try {
      return JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as SessionIndex
    } catch {
      // Corrupt index — rebuild
    }
  }
  return rebuildIndex()
}

function saveIndex(index: SessionIndex): void {
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8')
}

function updateIndex(meta: SessionMeta): void {
  const index = loadIndex()
  const existing = index.sessions.findIndex((s) => s.id === meta.id)
  if (existing >= 0) {
    index.sessions[existing] = meta
  } else {
    index.sessions.push(meta)
  }
  saveIndex(index)
}

function removeFromIndex(id: string): void {
  const index = loadIndex()
  index.sessions = index.sessions.filter((s) => s.id !== id)
  saveIndex(index)
}

/** Rebuild index by scanning conversation directories */
function rebuildIndex(): SessionIndex {
  mkdirSync(CONVERSATIONS_DIR, { recursive: true })
  const sessions: SessionMeta[] = []

  // Scan conversations/ dir (primary location)
  if (existsSync(CONVERSATIONS_DIR)) {
    for (const dir of readdirSync(CONVERSATIONS_DIR)) {
      if (dir === 'index.json') continue
      const meta = metaPath(dir)
      if (existsSync(meta)) {
        try {
          sessions.push(JSON.parse(readFileSync(meta, 'utf-8')))
        } catch {}
      }
    }
  }

  const index: SessionIndex = { version: 1, sessions }
  saveIndex(index)
  return index
}

// ── Conversation workspace helpers ──────────────────────────────────

export function getConversationsDir(): string {
  return CONVERSATIONS_DIR
}

export function getConversationDir(convId: string): string {
  return join(CONVERSATIONS_DIR, convId)
}

export function getConversationWorkspace(convId: string): string {
  return join(CONVERSATIONS_DIR, convId, 'workspace')
}

export function getConversationMemoryDir(convId: string): string {
  return join(CONVERSATIONS_DIR, convId, 'memory')
}

export function getGlobalMemoryDir(): string {
  return GLOBAL_MEMORY_DIR
}

/** Ensure conversation workspace directories exist */
export function ensureConversationDirs(convId: string): void {
  const dir = getConversationDir(convId)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'memory'), { recursive: true })
  mkdirSync(join(dir, 'images'), { recursive: true })
}

// ── Workspace root helpers ──────────────────────────────────────────

/** Get the workspace root directory (default: ~/Anton/) */
export function getWorkspaceRoot(config?: AgentConfig): string {
  const root = config?.workspace?.root || DEFAULT_WORKSPACE_ROOT
  // Resolve ~ to homedir
  return root.startsWith('~') ? join(homedir(), root.slice(1)) : root
}

/** Ensure workspace root exists */
export function ensureWorkspaceRoot(config?: AgentConfig): string {
  const root = getWorkspaceRoot(config)
  mkdirSync(root, { recursive: true })
  return root
}

/** Get the misc directory for one-off files */
export function getWorkspaceMisc(config?: AgentConfig): string {
  return join(getWorkspaceRoot(config), 'misc')
}

// ── Project-type prompt module loader ──────────────────────────────

export type ProjectType = 'code' | 'document' | 'data' | 'clone' | 'mixed'

/**
 * Load a project-type prompt module.
 * Checks ~/.anton/prompts/project-types/{type}.md first (user-customizable),
 * then falls back to embedded defaults.
 */
export function loadProjectTypePrompt(projectType: ProjectType): string | undefined {
  // Check user-customized prompt first
  const modulePath = join(PROJECT_TYPES_DIR, `${projectType}.md`)
  if (existsSync(modulePath)) {
    try {
      return readFileSync(modulePath, 'utf-8')
    } catch {
      // fall through to embedded
    }
  }
  // Fall back to embedded default
  return EMBEDDED_PROJECT_TYPE_PROMPTS[projectType]
}

/**
 * Ensure project-type prompt modules exist (seed from defaults on first run).
 */
export function ensureProjectTypePrompts(): void {
  mkdirSync(PROJECT_TYPES_DIR, { recursive: true })
}

// ── Exports ─────────────────────────────────────────────────────────

export function getAntonDir(): string {
  return ANTON_DIR
}

export function getPromptsDir(): string {
  return PROMPTS_DIR
}

export function getPublishedDir(): string {
  mkdirSync(PUBLISHED_DIR, { recursive: true })
  return PUBLISHED_DIR
}

export function getProjectPublicDir(projectName: string): string {
  const dir = join(DEFAULT_WORKSPACE_ROOT, projectName, 'public')
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── System prompt loading ───────────────────────────────────────────

/**
 * Load the core system prompt — embedded behavioral instructions only.
 * This is the self-contained base prompt that ships identically everywhere.
 * Also syncs to ~/.anton/prompts/system.md for user reference.
 */
export function loadCoreSystemPrompt(): string {
  mkdirSync(PROMPTS_DIR, { recursive: true })
  writeFileSync(SYSTEM_PROMPT_PATH, EMBEDDED_SYSTEM_PROMPT, 'utf-8')
  return EMBEDDED_SYSTEM_PROMPT
}

/**
 * Load user rules from ~/.anton/prompts/append.md and ~/.anton/prompts/rules/*.md.
 * Returns combined content or empty string if nothing exists.
 */
export function loadUserRules(): string {
  let rules = ''

  const appendPath = join(PROMPTS_DIR, 'append.md')
  if (existsSync(appendPath)) {
    rules += readFileSync(appendPath, 'utf-8')
  }

  const rulesDir = join(PROMPTS_DIR, 'rules')
  if (existsSync(rulesDir)) {
    const ruleFiles = readdirSync(rulesDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
    for (const file of ruleFiles) {
      const content = readFileSync(join(rulesDir, file), 'utf-8')
      if (rules) rules += '\n\n'
      rules += `## ${file.replace('.md', '')}\n\n${content}`
    }
  }

  return rules
}

/**
 * Load workspace-level rules from .anton.md in the given directory.
 * Analogous to CLAUDE.md in Claude Code or .cursorrules in Cursor.
 */
export function loadWorkspaceRules(workspacePath: string): string {
  const antonMdPath = join(workspacePath, '.anton.md')
  if (existsSync(antonMdPath)) {
    try {
      return readFileSync(antonMdPath, 'utf-8')
    } catch {
      return ''
    }
  }
  return ''
}

// ── Connector management ────────────────────────────────────────────

export function addConnector(config: AgentConfig, connector: ConnectorConfig): void {
  // Remove existing with same id
  config.connectors = config.connectors.filter((c) => c.id !== connector.id)
  config.connectors.push(connector)
  saveConfig(config)
}

export function updateConnector(
  config: AgentConfig,
  id: string,
  changes: Partial<ConnectorConfig>,
): ConnectorConfig | null {
  const idx = config.connectors.findIndex((c) => c.id === id)
  if (idx === -1) return null
  config.connectors[idx] = { ...config.connectors[idx], ...changes }
  saveConfig(config)
  return config.connectors[idx]
}

export function removeConnector(config: AgentConfig, id: string): boolean {
  const len = config.connectors.length
  config.connectors = config.connectors.filter((c) => c.id !== id)
  if (config.connectors.length < len) {
    saveConfig(config)
    return true
  }
  return false
}

export function toggleConnector(config: AgentConfig, id: string, enabled: boolean): boolean {
  const connector = config.connectors.find((c) => c.id === id)
  if (!connector) return false
  connector.enabled = enabled
  saveConfig(config)
  return true
}

export function getConnectors(config: AgentConfig): ConnectorConfig[] {
  return config.connectors
}

// ── Connector registry (built-in catalog) ───────────────────────────

export interface ConnectorRegistryEntry {
  id: string
  name: string
  description: string
  icon: string
  category: 'messaging' | 'productivity' | 'development' | 'social' | 'other'
  type: 'mcp' | 'api' | 'oauth'
  command?: string
  args?: string[]
  requiredEnv: string[]
  optionalFields?: { key: string; label: string; hint?: string }[]
  featured?: boolean
  oauthProvider?: string // provider key for the OAuth proxy
  oauthScopes?: string[] // display-only scopes for the UI
  setupGuide?: {
    steps: string[]
    url: string
    urlLabel?: string
  }
}

export const CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [
  {
    id: 'exa-search',
    name: 'Web Search',
    description:
      'Semantic web search powered by Exa. Returns full page content, summaries, and highlights.',
    icon: '🔍',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'websearch',
    requiredEnv: [],
    featured: true,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Send and receive Telegram messages via your bot',
    icon: '📱',
    category: 'messaging',
    type: 'api',
    requiredEnv: ['TELEGRAM_BOT_TOKEN'],
    optionalFields: [
      {
        key: 'OWNER_CHAT_ID',
        label: 'Your Chat ID',
        hint: 'Message @userinfobot on Telegram to get your personal chat ID. Anton will use this to send you messages.',
      },
    ],
    featured: true,
    setupGuide: {
      steps: [
        'Open Telegram and search for @BotFather',
        'Send /newbot and follow the prompts to create a bot',
        'Copy the bot token provided by BotFather',
        'Paste the token below',
        '(Optional) Message @userinfobot to get your Chat ID so Anton can message you directly',
      ],
      url: 'https://core.telegram.org/bots#botfather',
      urlLabel: 'BotFather Docs',
    },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, and send emails from your Gmail account',
    icon: '📧',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'gmail',
    oauthScopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Google account'],
      url: 'https://console.cloud.google.com/apis/credentials',
      urlLabel: 'Google Cloud Console',
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write Notion pages and databases',
    icon: '📝',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'notion',
    oauthScopes: [],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Notion account'],
      url: 'https://www.notion.so/profile/integrations',
      urlLabel: 'Notion Integrations',
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories, issues, and pull requests',
    icon: '🐙',
    category: 'development',
    type: 'oauth',
    oauthProvider: 'github',
    oauthScopes: ['repo', 'read:org', 'read:user'],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your GitHub account'],
      url: 'https://github.com/settings/connections/applications',
      urlLabel: 'GitHub Apps',
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages and manage Slack channels',
    icon: '💬',
    category: 'messaging',
    type: 'oauth',
    oauthProvider: 'slack',
    oauthScopes: ['channels:read', 'chat:write', 'users:read'],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Slack workspace'],
      url: 'https://api.slack.com/apps',
      urlLabel: 'Slack Apps',
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues, projects, and workflows',
    icon: '📋',
    category: 'development',
    type: 'oauth',
    oauthProvider: 'linear',
    oauthScopes: ['read', 'write', 'issues:create'],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Linear account'],
      url: 'https://linear.app',
      urlLabel: 'Linear',
    },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive',
    icon: '📁',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'google',
    oauthScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Google account'],
      url: 'https://console.cloud.google.com/apis/credentials',
      urlLabel: 'Google Cloud Console',
    },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'View and manage events in Google Calendar',
    icon: '📅',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'google',
    oauthScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Google account'],
      url: 'https://console.cloud.google.com/apis/credentials',
      urlLabel: 'Google Cloud Console',
    },
  },
  {
    id: 'granola',
    name: 'Granola',
    description: 'Access your AI meeting notes and transcripts',
    icon: '🎙️',
    category: 'productivity',
    type: 'api',
    requiredEnv: ['GRANOLA_API_KEY'],
    featured: true,
    setupGuide: {
      steps: [
        'Open the Granola desktop app',
        'Go to Settings → API',
        'Click "Create new key"',
        'Copy the key (starts with grn_) and paste it below',
        'Note: requires a Business or Enterprise plan',
      ],
      url: 'https://granola.so',
      urlLabel: 'Granola',
    },
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Read, create, and edit Google Docs documents',
    icon: '📄',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'google',
    oauthScopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: [
        'Click "Connect Google Docs" to authorize with your Google account',
        'Anton will request access to your Google Docs documents',
      ],
      url: 'https://docs.google.com',
      urlLabel: 'Google Docs',
    },
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read, create, and edit Google Sheets spreadsheets',
    icon: '📊',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'google',
    oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: [
        'Click "Connect Google Sheets" to authorize with your Google account',
        'Anton will request access to your Google Sheets spreadsheets',
      ],
      url: 'https://sheets.google.com',
      urlLabel: 'Google Sheets',
    },
  },
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    description: 'Search analytics, top queries, page performance, URL inspection, and sitemaps',
    icon: '📈',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'google',
    oauthScopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: [
        'Click "Connect Google Search Console" to authorize with your Google account',
        'Anton will request read-only access to your Search Console data',
        'Make sure your site is already verified in Search Console',
      ],
      url: 'https://search.google.com/search-console',
      urlLabel: 'Search Console',
    },
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Manage bases, tables, and records in Airtable',
    icon: '📊',
    category: 'productivity',
    type: 'oauth',
    oauthProvider: 'airtable',
    oauthScopes: [
      'data.records:read',
      'data.records:write',
      'schema.bases:read',
    ],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: ['Click Connect to authorize with your Airtable account'],
      url: 'https://airtable.com',
      urlLabel: 'Airtable',
    },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description:
      'Search people, send messages, manage connections, and create posts on LinkedIn. Supports multiple accounts.',
    icon: '💼',
    category: 'social',
    type: 'oauth',
    oauthProvider: 'linkedin',
    oauthScopes: [],
    requiredEnv: [],
    featured: true,
    setupGuide: {
      steps: [
        'Click Connect to authenticate with your LinkedIn account',
        'You can connect up to 3 LinkedIn accounts',
      ],
      url: 'https://www.linkedin.com',
      urlLabel: 'LinkedIn',
    },
  },
]
