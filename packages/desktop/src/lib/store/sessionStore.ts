/**
 * Session domain store — sessions, providers, per-session state.
 *
 * ALL transient session state lives inside `sessionStates: Map<sessionId, SessionState>`.
 * There are ZERO global fields for session-specific data — switching conversations
 * just changes which sessionId is "active", no save/restore needed.
 */

import type {
  AiMessage,
  AskUserQuestion,
  ChatImageAttachmentInput,
  TaskItem,
  ThinkingLevel,
  TokenUsage,
} from '@anton/protocol'

/**
 * User-facing reasoning effort tiers. Cycled by the composer's Effort pill
 * in order: low → medium → high → xhigh → low. `off` is not a UI position;
 * it's implicit (model has `reasoning: false`, or pill is hidden).
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh'

export const EFFORT_CYCLE: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh'] as const

export function nextEffortLevel(current: EffortLevel): EffortLevel {
  const i = EFFORT_CYCLE.indexOf(current)
  return EFFORT_CYCLE[(i + 1) % EFFORT_CYCLE.length]
}

export function effortLabel(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'xhigh':
      return 'Extra high'
  }
}

function loadEffortLevel(): EffortLevel {
  const raw = localStorage.getItem('anton.effortLevel')
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh') return raw
  return 'medium'
}
import { create } from 'zustand'
import { connection } from '../connection.js'
import type { ProviderInfo, RoutineStatus, RoutineStep, SessionMeta } from './types.js'

// ── Consolidated per-session state ────────────────────────────────

export interface PendingConfirm {
  id: string
  command: string
  reason: string
  sessionId?: string
}

export interface PendingPlan {
  id: string
  title: string
  content: string
  sessionId?: string
}

export interface PendingAskUser {
  id: string
  questions: AskUserQuestion[]
  sessionId?: string
}

export interface SessionState {
  // Core status
  status: RoutineStatus
  statusDetail: string | null
  isStreaming: boolean

  // Tasks
  tasks: TaskItem[]

  // Agent steps (tool call sequence)
  agentSteps: RoutineStep[]

  // Turn timing
  workingStartedAt: number | null
  lastTurnDurationMs: number | null

  // Token usage
  turnUsage: TokenUsage | null
  sessionUsage: TokenUsage | null
  lastResponseProvider: string | null
  lastResponseModel: string | null

  // Pending interactions
  pendingConfirm: PendingConfirm | null
  pendingPlan: PendingPlan | null
  pendingAskUser: PendingAskUser | null

  // Tool call tracking
  hiddenToolCallIds: Set<string>
  toolCallNames: Map<string, { name: string; input?: Record<string, unknown> }>

  // Sync state
  needsHistoryRefresh: boolean
  isSyncing: boolean
  pendingSyncMessages: AiMessage[]

  // Pagination
  hasMore: boolean
  isLoadingOlder: boolean

  // Citation tracking
  pendingCitationSources: import('./types.js').CitationSource[]
  pendingWebSearchToolCallIds: Set<string>

  // Message tracking
  assistantMsgId: string | null

  // Reasoning effort for this session's next turn. Mirrors what the
  // composer sent last (Pi SDK + Codex both honor per-turn updates).
  thinkingLevel: ThinkingLevel | null

  // Composer mode toggles. Sticky across turns — user clears explicitly.
  // researchMode: when true, the next send carries `mode: 'research'` to
  // the server, which prepends a turn-level system hint biasing the model
  // toward `web_research` over `web_search`.
  researchMode: boolean

  // Session readiness
  resolver?: () => void
}

export function createSessionState(
  sessionId?: string,
  partial?: Partial<SessionState>,
): SessionState {
  return {
    status: 'idle',
    statusDetail: null,
    isStreaming: false,
    tasks: [],
    agentSteps: [],
    workingStartedAt: null,
    lastTurnDurationMs: null,
    turnUsage: null,
    sessionUsage: null,
    lastResponseProvider: null,
    lastResponseModel: null,
    pendingConfirm: null,
    pendingPlan: null,
    pendingAskUser: null,
    hiddenToolCallIds: new Set(),
    toolCallNames: new Map(),
    pendingCitationSources: [],
    pendingWebSearchToolCallIds: new Set(),
    needsHistoryRefresh: false,
    isSyncing: false,
    pendingSyncMessages: [],
    hasMore: true,
    isLoadingOlder: false,
    assistantMsgId: null,
    thinkingLevel: null,
    // Rehydrate from the localStorage-backed map so a session that had
    // research mode on before reload comes back with it on. Without this
    // the persisted flag is silently dropped the moment any update path
    // creates a fresh SessionState entry.
    researchMode: sessionId ? _researchModeMap[sessionId] === true : false,
    ...partial,
  }
}

// ── Research-mode persistence ─────────────────────────────────────
//
// Persist each conversation's `researchMode` flag in localStorage so the
// pill state survives reloads, matching Claude's behaviour. Stored as a
// single JSON blob `{ [sessionId]: true }` keyed only on `true` values to
// keep the blob small (false = absent).
//
// In-memory cache: `_researchModeMap` is loaded once at module init and
// kept in sync with localStorage on every `toggleResearchMode` call.
// Reads (`getPersistedResearchMode`) hit the cache — O(1), no JSON parse,
// no storage I/O — so they're safe to call from a Zustand selector that
// runs on every store update without causing render-time pressure.

const RESEARCH_MODE_KEY = 'anton.researchMode'

function readPersistedMap(): Record<string, true> {
  try {
    const raw = localStorage.getItem(RESEARCH_MODE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, true>) : {}
  } catch {
    return {}
  }
}

const _researchModeMap: Record<string, true> = readPersistedMap()

function flushResearchModeMap(): void {
  try {
    localStorage.setItem(RESEARCH_MODE_KEY, JSON.stringify(_researchModeMap))
  } catch {
    /* quota / unavailable — ignore */
  }
}

export function getPersistedResearchMode(sessionId: string): boolean {
  return _researchModeMap[sessionId] === true
}

/**
 * If a Research toggle was made before this session existed (staged on
 * `pendingResearchMode`), migrate it onto the session's flag and clear
 * the pending state. No-op when there's nothing pending or the session
 * already has the flag set.
 */
function consumePendingResearchModeFor(
  sessionId: string,
  get: () => SessionStoreState,
  set: (partial: Partial<SessionStoreState>) => void,
): void {
  const state = get()
  if (!state.pendingResearchMode) return
  const sessionState = state.sessionStates.get(sessionId)
  if (sessionState?.researchMode) {
    set({ pendingResearchMode: false })
    return
  }
  state.updateSessionState(sessionId, { researchMode: true })
  _researchModeMap[sessionId] = true
  flushResearchModeMap()
  set({ pendingResearchMode: false })
}

// ── Store interface ───────────────────────────────────────────────

const MODEL_KEY = 'anton.selectedModel'

function loadSelectedModel(): { provider: string; model: string } | null {
  try {
    const raw = localStorage.getItem(MODEL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSelectedModel(provider: string, model: string) {
  localStorage.setItem(MODEL_KEY, JSON.stringify({ provider, model }))
}

// Per-session stuck-state timeouts
const STUCK_STATE_TIMEOUT_MS = 90_000
const _stuckTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

interface SessionStoreState {
  // Connection
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error'

  // Current session (identifies which session is "active" — not per-session state)
  currentSessionId: string | null
  currentProvider: string
  currentModel: string

  // All sessions from server
  sessions: SessionMeta[]
  sessionsLoaded: boolean

  // Providers (app-wide)
  providers: ProviderInfo[]
  defaults: { provider: string; model: string }

  // Reasoning effort level (app-wide default, persisted per user).
  // Per-session overrides live on `SessionState.thinkingLevel` below.
  effortLevel: EffortLevel

  // Consolidated per-session state (ALL transient state lives here)
  sessionStates: Map<string, SessionState>

  // Research mode toggled before a session exists (e.g. on the hero
  // composer). Migrated onto the session's per-session flag at first
  // send. Not persisted across reloads — only the per-session map is.
  pendingResearchMode: boolean

  // ── Actions ──────────────────────────────────────────────────

  // Connection
  setConnectionStatus: (
    status: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error',
  ) => void

  // Session management
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void
  setEffortLevel: (level: EffortLevel) => void
  cycleEffortLevel: () => EffortLevel
  setSessionThinkingLevel: (sessionId: string, level: ThinkingLevel) => void
  /**
   * Toggle Research mode. Pass the active session id when one exists so
   * the flag is stored per-session (and persisted to localStorage).
   * Pass `null` from the hero composer where no session exists yet —
   * the flag is staged on `pendingResearchMode` and migrated onto the
   * session at first send.
   */
  toggleResearchMode: (sessionId: string | null) => boolean

  // Per-session state (the ONLY way to read/write session-specific data)
  getSessionState: (sessionId: string) => SessionState
  updateSessionState: (sessionId: string, updates: Partial<SessionState>) => void
  removeSessionState: (sessionId: string) => void

  // Convenience helpers for common per-session operations
  setSessionStatus: (sessionId: string, status: RoutineStatus, statusDetail?: string | null) => void
  addRoutineStep: (sessionId: string, step: RoutineStep) => void
  updateRoutineStep: (sessionId: string, stepId: string, updates: Partial<RoutineStep>) => void

  // Session readiness
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void

  // Connection actions
  createSession: (
    sessionId: string,
    opts: {
      provider: string
      model: string
      projectId?: string
      thinkingLevel?: ThinkingLevel
    },
  ) => void
  destroySession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  switchSessionProvider: (sessionId: string, provider: string, model: string) => void
  requestSessionHistory: (sessionId: string, opts?: { before?: number; limit?: number }) => void
  sendConfirmResponse: (id: string, approved: boolean) => void
  sendPlanResponse: (id: string, approved: boolean, feedback?: string) => void
  sendAskUserResponse: (id: string, answers: Record<string, string>) => void
  sendCancelTurn: (sessionId: string) => void
  sendProvidersList: () => void
  sendProviderSetKey: (provider: string, apiKey: string) => void
  sendProviderSetModels: (provider: string, models: string[]) => void
  sendProviderSetDefault: (provider: string, model: string) => void
  sendDetectHarnesses: () => void
  sendHarnessSetup: (
    harnessId: string,
    action: 'install' | 'login' | 'login_code' | 'status',
    code?: string,
  ) => void
  harnessStatuses: Record<
    string,
    {
      installed: boolean
      version?: string
      auth?: { loggedIn: boolean; email?: string; subscriptionType?: string }
    }
  >
  harnessSetupProgress: Record<
    string,
    { action: string; step?: string; message?: string; success?: boolean }
  >
  setHarnessStatus: (
    id: string,
    status: {
      installed: boolean
      version?: string
      auth?: { loggedIn: boolean; email?: string; subscriptionType?: string }
    },
  ) => void
  setHarnessSetupProgress: (
    id: string,
    progress: { action: string; step?: string; message?: string; success?: boolean },
  ) => void
  sendAiMessage: (text: string, attachments?: ChatImageAttachmentInput[]) => void
  sendAiMessageToSession: (
    text: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
  ) => void
  sendSteerMessage: (
    text: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
  ) => void
  sendConfigQuery: (
    key: 'providers' | 'defaults' | 'security' | 'system_prompt' | 'memories',
    sessionId?: string,
    projectId?: string,
  ) => void

  // Reset
  reset: () => void
  resetKeepConversations: () => void
}

export const sessionStore = create<SessionStoreState>((set, get) => {
  const savedModel = loadSelectedModel()

  return {
    connectionStatus: 'disconnected',
    currentSessionId: null,
    pendingResearchMode: false,
    currentProvider: savedModel?.provider ?? 'anthropic',
    currentModel: savedModel?.model ?? 'claude-sonnet-4-6',
    sessions: [],
    sessionsLoaded: false,
    providers: [],
    defaults: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    effortLevel: loadEffortLevel(),
    sessionStates: new Map(),

    // ── Connection ────────────────────────────────────────────

    setConnectionStatus: (status) => set({ connectionStatus: status }),

    // ── Session management ────────────────────────────────────

    setCurrentSession: (id, provider, model) => {
      saveSelectedModel(provider, model)
      set({
        currentSessionId: id,
        currentProvider: provider,
        currentModel: model,
      })
    },

    setSessions: (sessions) => set({ sessions, sessionsLoaded: true }),

    setProviders: (providers, defaults) => {
      const saved = loadSelectedModel()
      const provider = saved?.provider ?? defaults.provider
      const model = saved?.model ?? defaults.model
      set({ providers, defaults, currentProvider: provider, currentModel: model })
    },

    setEffortLevel: (level) => {
      localStorage.setItem('anton.effortLevel', level)
      set({ effortLevel: level })
    },

    cycleEffortLevel: () => {
      const next = nextEffortLevel(get().effortLevel)
      localStorage.setItem('anton.effortLevel', next)
      set({ effortLevel: next })
      const sid = get().currentSessionId
      if (sid) {
        get().setSessionThinkingLevel(sid, next)
      }
      return next
    },

    setSessionThinkingLevel: (sessionId, level) => {
      get().updateSessionState(sessionId, { thinkingLevel: level })
      connection.sendSessionSetThinkingLevel(sessionId, level)
    },

    toggleResearchMode: (sessionId) => {
      // No active session yet (hero composer): stage on the root pending
      // flag. The next send migrates it onto the new session's state.
      if (!sessionId) {
        const next = !get().pendingResearchMode
        set({ pendingResearchMode: next })
        return next
      }
      const prev = get().getSessionState(sessionId).researchMode
      const next = !prev
      get().updateSessionState(sessionId, { researchMode: next })
      if (next) {
        _researchModeMap[sessionId] = true
      } else {
        delete _researchModeMap[sessionId]
      }
      flushResearchModeMap()
      return next
    },

    // ── Per-session state ─────────────────────────────────────

    getSessionState: (sessionId) => {
      return get().sessionStates.get(sessionId) ?? createSessionState(sessionId)
    },

    updateSessionState: (sessionId, updates) => {
      set((s) => {
        const states = new Map(s.sessionStates)
        const current = states.get(sessionId) ?? createSessionState(sessionId)
        states.set(sessionId, { ...current, ...updates })
        return { sessionStates: states }
      })
    },

    removeSessionState: (sessionId) => {
      const existingTimeout = _stuckTimeouts.get(sessionId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        _stuckTimeouts.delete(sessionId)
      }

      // Drop the persisted research-mode flag too — otherwise deleted
      // sessions accumulate in localStorage forever.
      if (_researchModeMap[sessionId]) {
        delete _researchModeMap[sessionId]
        flushResearchModeMap()
      }

      set((s) => {
        if (!s.sessionStates.has(sessionId) && s.currentSessionId !== sessionId) {
          return s
        }

        const states = new Map(s.sessionStates)
        states.delete(sessionId)

        return {
          sessionStates: states,
          currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
        }
      })
    },

    // ── Convenience helpers ───────────────────────────────────

    setSessionStatus: (sessionId, status, statusDetail) => {
      const prev = get().getSessionState(sessionId)

      // Clear any existing stuck-state timeout for this session
      const existingTimeout = _stuckTimeouts.get(sessionId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        _stuckTimeouts.delete(sessionId)
      }

      if (status === 'working') {
        const isNewTurn = prev.status !== 'working'
        get().updateSessionState(sessionId, {
          status,
          statusDetail: statusDetail ?? null,
          // Only reset turn state on the initial idle → working transition
          ...(isNewTurn && {
            workingStartedAt: Date.now(),
            lastTurnDurationMs: null,
            turnUsage: null,
            tasks: [],
          }),
        })

        // (Re-)start stuck-state timeout on every working event so long-running
        // turns stay alive as long as the server keeps sending status updates
        const timeout = setTimeout(() => {
          const current = get().getSessionState(sessionId)
          if (current.status === 'working') {
            console.error(`[sessionStore] Stuck-state timeout for ${sessionId}: auto-recovering.`)
            get().updateSessionState(sessionId, {
              status: 'idle',
              statusDetail: null,
              agentSteps: [],
            })
          }
          _stuckTimeouts.delete(sessionId)
        }, STUCK_STATE_TIMEOUT_MS)
        _stuckTimeouts.set(sessionId, timeout)
      } else if (status === 'idle' && prev.status === 'working') {
        const duration = prev.workingStartedAt ? Date.now() - prev.workingStartedAt : null
        get().updateSessionState(sessionId, {
          status,
          statusDetail: statusDetail ?? null,
          lastTurnDurationMs: duration,
        })
      } else {
        get().updateSessionState(sessionId, {
          status,
          statusDetail: statusDetail !== undefined ? statusDetail : prev.statusDetail,
        })
      }
    },

    addRoutineStep: (sessionId, step) => {
      const ss = get().getSessionState(sessionId)
      get().updateSessionState(sessionId, {
        agentSteps: [...ss.agentSteps, step],
      })
    },

    updateRoutineStep: (sessionId, stepId, updates) => {
      const ss = get().getSessionState(sessionId)
      get().updateSessionState(sessionId, {
        agentSteps: ss.agentSteps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
      })
    },

    // ── Session readiness ─────────────────────────────────────

    registerPendingSession: (id) => {
      return new Promise<void>((resolve) => {
        const states = new Map(get().sessionStates)
        const current = states.get(id) ?? createSessionState(id)
        states.set(id, { ...current, resolver: resolve })
        set({ sessionStates: states })
      })
    },

    resolvePendingSession: (id) => {
      const state = get().sessionStates.get(id)
      if (state?.resolver) {
        state.resolver()
        get().updateSessionState(id, { resolver: undefined })
      }
    },

    // ── Connection actions ────────────────────────────────────

    createSession: (sessionId, opts) => {
      const thinkingLevel: ThinkingLevel = opts.thinkingLevel ?? get().effortLevel
      connection.sendSessionCreate(sessionId, { ...opts, thinkingLevel })
      get().updateSessionState(sessionId, { thinkingLevel })
    },
    destroySession: (sessionId) => connection.sendSessionDestroy(sessionId),
    renameSession: (sessionId, title) => connection.sendSessionRename(sessionId, title),
    switchSessionProvider: (sessionId, provider, model) =>
      connection.sendSessionProviderSwitch(sessionId, provider, model),
    requestSessionHistory: (sessionId, opts) => {
      if (opts) {
        connection.sendSessionHistory(sessionId, opts)
      } else {
        get().updateSessionState(sessionId, { isSyncing: true })
        connection.sendSessionHistory(sessionId)

        // Safety timeout
        setTimeout(() => {
          const ss = get().getSessionState(sessionId)
          if (ss.isSyncing) {
            console.warn(`[Sync] Timeout for ${sessionId}, clearing sync flag`)
            const queued = ss.pendingSyncMessages
            get().updateSessionState(sessionId, {
              isSyncing: false,
              pendingSyncMessages: [],
            })
            for (const msg of queued) {
              console.log(`[Sync] Would replay ${msg.type} for ${sessionId}`)
            }
          }
        }, 5000)
      }
    },
    sendConfirmResponse: (id, approved) => connection.sendConfirmResponse(id, approved),
    sendPlanResponse: (id, approved, feedback) =>
      connection.sendPlanResponse(id, approved, feedback),
    sendAskUserResponse: (id, answers) => connection.sendAskUserResponse(id, answers),
    sendCancelTurn: (sessionId) => connection.sendCancelTurn(sessionId),
    sendProvidersList: () => connection.sendProvidersList(),
    sendProviderSetKey: (provider, apiKey) => connection.sendProviderSetKey(provider, apiKey),
    sendProviderSetModels: (provider, models) => connection.sendProviderSetModels(provider, models),
    sendProviderSetDefault: (provider, model) => connection.sendProviderSetDefault(provider, model),
    sendDetectHarnesses: () => connection.sendDetectHarnesses(),
    sendHarnessSetup: (harnessId, action, code) =>
      connection.sendHarnessSetup(harnessId, action, code),
    harnessStatuses: {},
    harnessSetupProgress: {},
    setHarnessStatus: (id, status) =>
      set((s) => ({ harnessStatuses: { ...s.harnessStatuses, [id]: status } })),
    setHarnessSetupProgress: (id, progress) =>
      set((s) => ({ harnessSetupProgress: { ...s.harnessSetupProgress, [id]: progress } })),
    sendAiMessage: (text, attachments) => {
      const sid = get().currentSessionId
      // Migrate any pre-session pending flag onto this session before
      // reading it, so the very first send after toggling Research on
      // the hero composer actually carries `mode: 'research'`.
      if (sid) consumePendingResearchModeFor(sid, get, set)
      const mode = sid && get().getSessionState(sid).researchMode ? 'research' : undefined
      connection.sendAiMessage(text, attachments, mode ? { mode } : undefined)
      // Optimistic: show working state immediately instead of waiting for server event.
      // Centralized here so every call site gets it automatically.
      if (sid && get().connectionStatus === 'connected') {
        get().setSessionStatus(sid, 'working')
      }
    },
    sendAiMessageToSession: (text, sessionId, attachments) => {
      consumePendingResearchModeFor(sessionId, get, set)
      const mode = get().getSessionState(sessionId).researchMode ? 'research' : undefined
      connection.sendAiMessageToSession(text, sessionId, attachments, mode ? { mode } : undefined)
      if (get().connectionStatus === 'connected') {
        get().setSessionStatus(sessionId, 'working')
      }
    },
    sendSteerMessage: (text, sessionId, attachments) =>
      connection.sendSteerMessage(text, sessionId, attachments),
    sendConfigQuery: (key, sessionId, projectId) =>
      connection.sendConfigQuery(key, sessionId, projectId),

    // ── Reset ─────────────────────────────────────────────────

    reset: () => {
      // Clear all stuck-state timeouts
      for (const timeout of _stuckTimeouts.values()) clearTimeout(timeout)
      _stuckTimeouts.clear()

      set({
        connectionStatus: 'disconnected',
        currentSessionId: null,
        sessions: [],
        sessionsLoaded: false,
        providers: [],
        sessionStates: new Map(),
      })
    },

    resetKeepConversations: () => {
      for (const timeout of _stuckTimeouts.values()) clearTimeout(timeout)
      _stuckTimeouts.clear()

      set({
        currentSessionId: null,
        sessions: [],
        sessionsLoaded: false,
        providers: [],
        sessionStates: new Map(),
      })
    },
  }
})

// ── Per-session selector hooks ───────────────────────────────────

const _defaultState = createSessionState()

/**
 * Read from the ACTIVE session's state. Reacts to both sessionId changes
 * and changes to that session's state within the Map.
 */
export function useActiveSessionState<T>(selector: (s: SessionState) => T): T {
  return sessionStore((store) => {
    const sid = store.currentSessionId
    if (!sid) return selector(_defaultState)
    return selector(store.sessionStates.get(sid) ?? _defaultState)
  })
}

/**
 * Read from a SPECIFIC session's state by sessionId.
 * Use for Sidebar badges, non-active session indicators, etc.
 */
export function useSessionState<T>(
  sessionId: string | undefined,
  selector: (s: SessionState) => T,
): T {
  return sessionStore((store) => {
    if (!sessionId) return selector(_defaultState)
    return selector(store.sessionStates.get(sessionId) ?? _defaultState)
  })
}
