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
  TokenUsage,
} from '@anton/protocol'
import { create } from 'zustand'
import { connection } from '../connection.js'
import type { RoutineStatus, RoutineStep, ProviderInfo, SessionMeta } from './types.js'

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

  // Session readiness
  resolver?: () => void
}

export function createSessionState(partial?: Partial<SessionState>): SessionState {
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
    ...partial,
  }
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

  // Thinking toggle (app-wide, persisted)
  thinkingEnabled: boolean

  // Consolidated per-session state (ALL transient state lives here)
  sessionStates: Map<string, SessionState>

  // ── Actions ──────────────────────────────────────────────────

  // Connection
  setConnectionStatus: (
    status: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error',
  ) => void

  // Session management
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void
  setThinkingEnabled: (enabled: boolean) => void

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
      thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
    },
  ) => void
  destroySession: (sessionId: string) => void
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
  sendHarnessSetup: (harnessId: string, action: 'install' | 'login' | 'login_code' | 'status', code?: string) => void
  harnessStatuses: Record<string, { installed: boolean; version?: string; auth?: { loggedIn: boolean; email?: string; subscriptionType?: string } }>
  harnessSetupProgress: Record<string, { action: string; step?: string; message?: string; success?: boolean }>
  setHarnessStatus: (id: string, status: { installed: boolean; version?: string; auth?: { loggedIn: boolean; email?: string; subscriptionType?: string } }) => void
  setHarnessSetupProgress: (id: string, progress: { action: string; step?: string; message?: string; success?: boolean }) => void
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
    currentProvider: savedModel?.provider ?? 'anthropic',
    currentModel: savedModel?.model ?? 'claude-sonnet-4-6',
    sessions: [],
    sessionsLoaded: false,
    providers: [],
    defaults: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    thinkingEnabled: localStorage.getItem('anton.thinkingEnabled') !== 'false',
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

    setThinkingEnabled: (enabled) => {
      localStorage.setItem('anton.thinkingEnabled', String(enabled))
      set({ thinkingEnabled: enabled })
    },

    // ── Per-session state ─────────────────────────────────────

    getSessionState: (sessionId) => {
      return get().sessionStates.get(sessionId) ?? createSessionState()
    },

    updateSessionState: (sessionId, updates) => {
      set((s) => {
        const states = new Map(s.sessionStates)
        const current = states.get(sessionId) ?? createSessionState()
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
        const current = states.get(id) ?? createSessionState()
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
      const thinkingLevel = opts.thinkingLevel ?? (get().thinkingEnabled ? 'medium' : 'off')
      connection.sendSessionCreate(sessionId, { ...opts, thinkingLevel })
    },
    destroySession: (sessionId) => connection.sendSessionDestroy(sessionId),
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
    sendHarnessSetup: (harnessId, action, code) => connection.sendHarnessSetup(harnessId, action, code),
    harnessStatuses: {},
    harnessSetupProgress: {},
    setHarnessStatus: (id, status) =>
      set((s) => ({ harnessStatuses: { ...s.harnessStatuses, [id]: status } })),
    setHarnessSetupProgress: (id, progress) =>
      set((s) => ({ harnessSetupProgress: { ...s.harnessSetupProgress, [id]: progress } })),
    sendAiMessage: (text, attachments) => {
      connection.sendAiMessage(text, attachments)
      // Optimistic: show working state immediately instead of waiting for server event.
      // Centralized here so every call site gets it automatically.
      const sid = get().currentSessionId
      if (sid && get().connectionStatus === 'connected') {
        get().setSessionStatus(sid, 'working')
      }
    },
    sendAiMessageToSession: (text, sessionId, attachments) => {
      connection.sendAiMessageToSession(text, sessionId, attachments)
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
