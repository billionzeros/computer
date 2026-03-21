import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
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
}

/** A single message line in messages.jsonl */
export interface SessionMessage {
  seq: number
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content?: string
  name?: string // tool name
  input?: unknown // tool input
  id?: string // tool call ID
  output?: string // tool result output
  isError?: boolean
  ts: number
}

/** Session index — lightweight listing of all sessions */
interface SessionIndex {
  version: number
  sessions: SessionMeta[]
}

/** Full session data for backward compat and session.ts */
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

  sessions?: {
    ttlDays: number // auto-cleanup after N days, default 7
  }

  compaction?: {
    enabled: boolean // default: true
    threshold: number // fraction of context window (default: 0.80)
    preserveRecentCount: number // messages to keep verbatim (default: 20)
    toolOutputMaxTokens: number // max tokens per tool output (default: 4000)
  }
}

export interface SkillConfig {
  name: string
  description: string
  prompt: string
  schedule?: string
  tools?: string[]
}

// ── Legacy config (for migration) ───────────────────────────────────

interface LegacyConfig {
  agentId: string
  token: string
  port: number
  ai: {
    provider: string
    apiKey: string
    model: string
    baseUrl?: string
  }
  security: {
    confirmPatterns: string[]
    forbiddenPaths: string[]
    networkAllowlist: string[]
  }
  skills: SkillConfig[]
}

// ── Paths ───────────────────────────────────────────────────────────

const ANTON_DIR = join(homedir(), '.anton')
const CONFIG_PATH = join(ANTON_DIR, 'config.yaml')
const SESSIONS_DIR = join(ANTON_DIR, 'sessions')
const PROMPTS_DIR = join(ANTON_DIR, 'prompts')
const SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, 'system.md')

// Embedded system prompt — baked in at build time by scripts/embed-prompts.js.
// This works in both source mode and binary mode (no filesystem read needed).
import { EMBEDDED_SYSTEM_PROMPT } from './embedded-prompts.js'

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
      'meta-llama/llama-4-maverick',
    ],
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
    models: ['mistral-large-latest', 'mistral-medium-latest'],
  },
}

// ── Load / Save / Migrate ───────────────────────────────────────────

export function loadConfig(): AgentConfig {
  mkdirSync(ANTON_DIR, { recursive: true })
  mkdirSync(SESSIONS_DIR, { recursive: true })
  mkdirSync(join(ANTON_DIR, 'skills'), { recursive: true })

  if (!existsSync(CONFIG_PATH)) {
    const defaultConfig = createDefaultConfig()
    writeFileSync(CONFIG_PATH, stringifyYaml(defaultConfig), 'utf-8')
    console.log(`\n  Config created: ${CONFIG_PATH}`)
    console.log(`  Token: ${defaultConfig.token}`)
    console.log('  Save this token — you need it to connect from the desktop app.\n')
    return defaultConfig
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  // biome-ignore lint/suspicious/noExplicitAny: yaml parser returns untyped data
  const parsed = parseYaml(raw) as Record<string, any>

  // Migrate legacy single-provider config
  if (parsed.ai && !parsed.providers) {
    const migrated = migrateLegacyConfig(parsed as unknown as LegacyConfig)
    saveConfig(migrated)
    console.log('  Config migrated to multi-provider format.')
    return migrated
  }

  return parsed as AgentConfig
}

export function saveConfig(config: AgentConfig): void {
  writeFileSync(CONFIG_PATH, stringifyYaml(config), 'utf-8')
}

function migrateLegacyConfig(legacy: LegacyConfig): AgentConfig {
  const providers: ProvidersMap = { ...DEFAULT_PROVIDERS }

  // Preserve the user's existing key in the right provider
  const providerName = legacy.ai.provider || 'anthropic'
  if (providers[providerName]) {
    providers[providerName].apiKey = legacy.ai.apiKey || providers[providerName].apiKey
    if (legacy.ai.baseUrl) {
      providers[providerName].baseUrl = legacy.ai.baseUrl
    }
  } else {
    providers[providerName] = {
      apiKey: legacy.ai.apiKey,
      baseUrl: legacy.ai.baseUrl,
      models: [legacy.ai.model],
    }
  }

  return {
    agentId: legacy.agentId,
    token: legacy.token,
    port: legacy.port,
    providers,
    defaults: {
      provider: legacy.ai.provider || 'anthropic',
      model: legacy.ai.model || 'claude-sonnet-4-6',
    },
    security: legacy.security,
    skills: legacy.skills,
    sessions: { ttlDays: 7 },
  }
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
      ],
    },
    skills: [],
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

const SESSIONS_DATA_DIR = join(SESSIONS_DIR, 'data')
const INDEX_PATH = join(SESSIONS_DIR, 'index.json')

function sessionDir(id: string): string {
  return join(SESSIONS_DATA_DIR, id)
}

function metaPath(id: string): string {
  return join(sessionDir(id), 'meta.json')
}

function messagesPath(id: string): string {
  return join(sessionDir(id), 'messages.jsonl')
}

/** Save session — writes meta.json and full messages.jsonl, updates index */
export function saveSession(session: PersistedSession): void {
  const dir = sessionDir(session.id)
  mkdirSync(dir, { recursive: true })

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
  }
  writeFileSync(metaPath(session.id), JSON.stringify(meta, null, 2), 'utf-8')

  // Write compaction state if present
  if (session.compactionState) {
    const compactionPath = join(sessionDir(session.id), 'compaction.json')
    writeFileSync(compactionPath, JSON.stringify(session.compactionState, null, 2), 'utf-8')
  }

  // Write messages as JSONL (full rewrite from pi SDK format)
  const lines = session.messages.map((rawMsg: unknown, i: number) => {
    const msg = rawMsg as { role?: string; content?: string | { type: string; text?: string }[] }
    const line: SessionMessage = {
      seq: i + 1,
      role: (msg.role as SessionMessage['role']) || 'system',
      ts: session.lastActiveAt,
    }
    // Extract content from pi SDK message format
    if (msg.content) {
      if (typeof msg.content === 'string') {
        line.content = msg.content
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((c) => c.type === 'text')
        if (textParts.length > 0) {
          line.content = textParts.map((c) => c.text ?? '').join('')
        }
      }
    }
    return JSON.stringify(line)
  })
  writeFileSync(messagesPath(session.id), `${lines.join('\n')}\n`, 'utf-8')

  // Update index
  updateIndex(meta)
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
    meta.lastActiveAt = msg.ts
    writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8')
    updateIndex(meta)
  }
}

/** Load session with full messages (for pi SDK resume) */
export function loadSession(id: string): PersistedSession | null {
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

    return {
      id: meta.id,
      provider: meta.provider,
      model: meta.model,
      messages, // raw JSONL messages — session.ts converts back to pi format
      createdAt: meta.createdAt,
      lastActiveAt: meta.lastActiveAt,
      title: meta.title,
      compactionState,
    }
  }

  // Fall back to v1 format (flat .json file)
  const v1Path = join(SESSIONS_DIR, `${id}.json`)
  if (existsSync(v1Path)) {
    const raw = readFileSync(v1Path, 'utf-8')
    const v1 = JSON.parse(raw) as PersistedSession
    // Migrate to v2 on read
    saveSession(v1)
    unlinkSync(v1Path)
    return v1
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
  return raw.split('\n').map((line) => JSON.parse(line))
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
    // Remove all files in the session directory
    for (const file of readdirSync(dir)) {
      unlinkSync(join(dir, file))
    }
    rmdirSync(dir)
  }

  // Also remove v1 format if exists
  const v1Path = join(SESSIONS_DIR, `${id}.json`)
  if (existsSync(v1Path)) {
    unlinkSync(v1Path)
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
  mkdirSync(SESSIONS_DIR, { recursive: true })
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

/** Rebuild index by scanning all session data directories */
function rebuildIndex(): SessionIndex {
  mkdirSync(SESSIONS_DATA_DIR, { recursive: true })
  const sessions: SessionMeta[] = []

  if (existsSync(SESSIONS_DATA_DIR)) {
    for (const dir of readdirSync(SESSIONS_DATA_DIR)) {
      const meta = metaPath(dir)
      if (existsSync(meta)) {
        try {
          sessions.push(JSON.parse(readFileSync(meta, 'utf-8')))
        } catch {}
      }
    }
  }

  // Also migrate any v1 flat .json files
  if (existsSync(SESSIONS_DIR)) {
    for (const file of readdirSync(SESSIONS_DIR)) {
      if (file.endsWith('.json') && file !== 'index.json') {
        const id = file.replace('.json', '')
        if (!sessions.some((s) => s.id === id)) {
          // Will be migrated on next loadSession call
          try {
            const raw = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf-8'))
            sessions.push({
              id: raw.id,
              title: raw.title || raw.id,
              provider: raw.provider || 'anthropic',
              model: raw.model || 'claude-sonnet-4-6',
              createdAt: raw.createdAt || Date.now(),
              lastActiveAt: raw.lastActiveAt || Date.now(),
              messageCount: raw.messages?.length || 0,
              archived: false,
              tags: [],
            })
          } catch {}
        }
      }
    }
  }

  const index: SessionIndex = { version: 1, sessions }
  saveIndex(index)
  return index
}

// ── Exports ─────────────────────────────────────────────────────────

export function getAntonDir(): string {
  return ANTON_DIR
}

export function getSessionsDir(): string {
  return SESSIONS_DIR
}

// ── System prompt loading ───────────────────────────────────────────

/**
 * Load the system prompt from ~/.anton/prompts/system.md.
 * If it doesn't exist, copies the bundled default there first.
 *
 * Prompt layering (highest priority wins):
 *   1. ~/.anton/prompts/system.md      (user-editable, persists across updates)
 *   2. Bundled prompts/system.md       (shipped with package, used as seed)
 *   3. Hardcoded fallback              (last resort)
 *
 * Users can also place additional context in:
 *   ~/.anton/prompts/append.md         (appended after system prompt)
 *   ~/.anton/prompts/rules/*.md        (project rules, appended as sections)
 */
export function loadSystemPrompt(): string {
  mkdirSync(PROMPTS_DIR, { recursive: true })

  // Seed from embedded default if user hasn't customized yet
  if (!existsSync(SYSTEM_PROMPT_PATH)) {
    writeFileSync(SYSTEM_PROMPT_PATH, EMBEDDED_SYSTEM_PROMPT, 'utf-8')
    console.log(`  System prompt created: ${SYSTEM_PROMPT_PATH}`)
  }

  let prompt = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')

  // Append extra context if present
  const appendPath = join(PROMPTS_DIR, 'append.md')
  if (existsSync(appendPath)) {
    prompt += `\n\n${readFileSync(appendPath, 'utf-8')}`
  }

  // Append rules
  const rulesDir = join(PROMPTS_DIR, 'rules')
  if (existsSync(rulesDir)) {
    const ruleFiles = readdirSync(rulesDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
    for (const file of ruleFiles) {
      const content = readFileSync(join(rulesDir, file), 'utf-8')
      prompt += `\n\n## ${file.replace('.md', '')}\n\n${content}`
    }
  }

  return prompt
}

