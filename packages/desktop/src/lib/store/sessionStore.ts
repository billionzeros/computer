/**
 * Session domain store — sessions, providers, agent status, per-session state.
 *
 * Consolidates 10+ separate Maps/Sets into a single `sessionStates` Map<sessionId, SessionState>.
 * Each session's status, tasks, sync state, streaming state, and message tracking
 * lives in one place instead of being scattered across separate collections.
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
import type { AgentStatus, AgentStep, ProviderInfo, SessionMeta } from './types.js'

// ── Consolidated per-session state ────────────────────────────────

export interface SessionState {
  status: AgentStatus
  statusDetail?: string
  tasks: TaskItem[]
  isStreaming: boolean
  needsHistoryRefresh: boolean
  isSyncing: boolean
  pendingSyncMessages: AiMessage[]
  hasMore: boolean
  isLoadingOlder: boolean
  assistantMsgId: string | null
  resolver?: () => void
}

function createSessionState(partial?: Partial<SessionState>): SessionState {
  return {
    status: 'idle',
    tasks: [],
    isStreaming: false,
    needsHistoryRefresh: false,
    isSyncing: false,
    pendingSyncMessages: [],
    hasMore: true,
    isLoadingOlder: false,
    assistantMsgId: null,
    ...partial,
  }
}

// ── Pending interaction types ─────────────────────────────────────

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

interface SessionStoreState {
  // Connection
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error'

  // Current session
  currentSessionId: string | null
  currentProvider: string
  currentModel: string

  // All sessions from server
  sessions: SessionMeta[]
  sessionsLoaded: boolean

  // Providers
  providers: ProviderInfo[]
  defaults: { provider: string; model: string }

  // Global agent status (for the active session)
  agentStatus: AgentStatus
  agentStatusDetail: string | null
  agentSteps: AgentStep[]

  // Turn timing
  workingStartedAt: number | null
  lastTurnDurationMs: number | null
  turnStatsConversationId: string | null
  workingSessionId: string | null

  // Token usage (per-turn)
  turnUsage: TokenUsage | null
  sessionUsage: TokenUsage | null
  lastResponseProvider: string | null
  lastResponseModel: string | null

  // Currently visible tasks (for active session)
  currentTasks: TaskItem[]

  // Consolidated per-session state
  sessionStates: Map<string, SessionState>

  // Tool call tracking (not per-session — cleared on turn end)
  _hiddenToolCallIds: Set<string>
  _toolCallNames: Map<string, { name: string; input?: Record<string, unknown> }>

  // Pending interactions
  pendingConfirm: PendingConfirm | null
  pendingPlan: PendingPlan | null
  pendingAskUser: PendingAskUser | null

  // ── Actions ──────────────────────────────────────────────────

  // Connection
  setConnectionStatus: (
    status: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error',
  ) => void

  // Session management
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void

  // Agent status
  setAgentStatus: (status: AgentStatus, sessionId?: string) => void
  setAgentStatusDetail: (detail: string | null) => void
  addAgentStep: (step: AgentStep) => void
  updateAgentStep: (id: string, updates: Partial<AgentStep>) => void
  clearAgentSteps: () => void

  // Turn usage
  setUsage: (turn: TokenUsage | null, session: TokenUsage | null) => void
  setLastResponseModel: (provider: string, model: string) => void

  // Tasks
  setCurrentTasks: (tasks: TaskItem[]) => void

  // Pending interactions
  setPendingConfirm: (confirm: PendingConfirm | null) => void
  setPendingPlan: (plan: PendingPlan | null) => void
  setPendingAskUser: (ask: PendingAskUser | null) => void

  // Per-session state helpers
  getSessionState: (sessionId: string) => SessionState
  updateSessionState: (sessionId: string, updates: Partial<SessionState>) => void

  // Session readiness
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void

  // Pending interaction selectors (filters by active session)
  getPendingConfirmForSession: (activeSessionId?: string) => PendingConfirm | null
  getPendingPlanForSession: (activeSessionId?: string) => PendingPlan | null
  getPendingAskUserForSession: (activeSessionId?: string) => PendingAskUser | null

  // Connection actions
  createSession: (
    sessionId: string,
    opts: { provider: string; model: string; projectId?: string },
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
  sendAiMessage: (text: string, attachments?: ChatImageAttachmentInput[]) => void
  sendAiMessageToSession: (
    text: string,
    sessionId: string,
    attachments?: ChatImageAttachmentInput[],
  ) => void
  sendSteerMessage: (text: string, sessionId: string) => void
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
    agentStatus: 'idle',
    agentStatusDetail: null,
    agentSteps: [],
    workingStartedAt: null,
    lastTurnDurationMs: null,
    turnStatsConversationId: null,
    workingSessionId: null,
    turnUsage: null,
    sessionUsage: null,
    lastResponseProvider: null,
    lastResponseModel: null,
    currentTasks: [],
    sessionStates: new Map(),
    _hiddenToolCallIds: new Set(),
    _toolCallNames: new Map(),
    pendingConfirm: null,
    pendingPlan: null,
    pendingAskUser: null,

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

    // ── Agent status ──────────────────────────────────────────

    setAgentStatus: (status, sessionId?) => {
      const prev = get().agentStatus

      // Clear any existing stuck-state timeout
      if ((window as unknown as Record<string, unknown>).__stuckTimeout) {
        clearTimeout((window as unknown as Record<string, unknown>).__stuckTimeout as number)
        ;(window as unknown as Record<string, unknown>).__stuckTimeout = null
      }

      if (status === 'working' && prev !== 'working') {
        set({
          agentStatus: status,
          workingStartedAt: Date.now(),
          lastTurnDurationMs: null,
          turnUsage: null,
          currentTasks: [],
          workingSessionId: sessionId || null,
        })

        // Safety net: if stuck in "working" for 5 min with no events, auto-recover
        ;(window as unknown as Record<string, unknown>).__stuckTimeout = window.setTimeout(
          () => {
            const current = get()
            if (current.agentStatus === 'working') {
              console.error('[sessionStore] Stuck-state timeout: auto-recovering to idle.')
              set({ agentStatus: 'idle', workingSessionId: null })
              current.clearAgentSteps()
              current.setAgentStatusDetail(null)
            }
          },
          5 * 60 * 1000,
        )
      } else if (status === 'idle' && prev === 'working') {
        const started = get().workingStartedAt
        const duration = started ? Date.now() - started : null
        set({
          agentStatus: status,
          lastTurnDurationMs: duration,
          turnStatsConversationId: null, // will be set by caller if needed
          workingSessionId: null,
        })
      } else {
        set({
          agentStatus: status,
          workingSessionId: status === 'working' ? sessionId || null : null,
        })
      }
    },

    setAgentStatusDetail: (detail) => set({ agentStatusDetail: detail }),
    addAgentStep: (step) => set((s) => ({ agentSteps: [...s.agentSteps, step] })),
    updateAgentStep: (id, updates) =>
      set((s) => ({
        agentSteps: s.agentSteps.map((step) => (step.id === id ? { ...step, ...updates } : step)),
      })),
    clearAgentSteps: () => set({ agentSteps: [] }),

    // ── Turn usage ────────────────────────────────────────────

    setUsage: (turn, session) => set({ turnUsage: turn, sessionUsage: session }),
    setLastResponseModel: (provider, model) =>
      set({ lastResponseProvider: provider, lastResponseModel: model }),

    // ── Tasks ─────────────────────────────────────────────────

    setCurrentTasks: (tasks) => set({ currentTasks: tasks }),

    // ── Pending interactions ──────────────────────────────────

    setPendingConfirm: (confirm) => set({ pendingConfirm: confirm }),
    setPendingPlan: (plan) => set({ pendingPlan: plan }),
    setPendingAskUser: (ask) => set({ pendingAskUser: ask }),

    // Selectors that filter by active session
    getPendingConfirmForSession: (activeSessionId) => {
      const c = get().pendingConfirm
      if (!c) return null
      return !c.sessionId || c.sessionId === activeSessionId ? c : null
    },
    getPendingPlanForSession: (activeSessionId) => {
      const p = get().pendingPlan
      if (!p) return null
      return !p.sessionId || p.sessionId === activeSessionId ? p : null
    },
    getPendingAskUserForSession: (activeSessionId) => {
      const a = get().pendingAskUser
      if (!a) return null
      return !a.sessionId || a.sessionId === activeSessionId ? a : null
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

    createSession: (sessionId, opts) => connection.sendSessionCreate(sessionId, opts),
    destroySession: (sessionId) => connection.sendSessionDestroy(sessionId),
    requestSessionHistory: (sessionId, opts) => {
      if (opts) {
        connection.sendSessionHistory(sessionId, opts)
      } else {
        // Mark session as syncing
        get().updateSessionState(sessionId, { isSyncing: true })
        connection.sendSessionHistory(sessionId)

        // Safety timeout: clear syncing flag if server never responds
        setTimeout(() => {
          const ss = get().getSessionState(sessionId)
          if (ss.isSyncing) {
            console.warn(`[Sync] Timeout for ${sessionId}, clearing sync flag`)
            const queued = ss.pendingSyncMessages
            get().updateSessionState(sessionId, {
              isSyncing: false,
              pendingSyncMessages: [],
            })
            // Replay any queued messages
            for (const msg of queued) {
              // The message handler will be wired externally
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
    sendAiMessage: (text, attachments) => connection.sendAiMessage(text, attachments),
    sendAiMessageToSession: (text, sessionId, attachments) =>
      connection.sendAiMessageToSession(text, sessionId, attachments),
    sendSteerMessage: (text, sessionId) => connection.sendSteerMessage(text, sessionId),
    sendConfigQuery: (key, sessionId, projectId) =>
      connection.sendConfigQuery(key, sessionId, projectId),
    // ── Reset ─────────────────────────────────────────────────

    reset: () =>
      set({
        connectionStatus: 'disconnected',
        currentSessionId: null,
        sessions: [],
        sessionsLoaded: false,
        providers: [],
        agentStatus: 'idle',
        agentStatusDetail: null,
        agentSteps: [],
        workingStartedAt: null,
        lastTurnDurationMs: null,
        turnStatsConversationId: null,
        workingSessionId: null,
        turnUsage: null,
        sessionUsage: null,
        lastResponseProvider: null,
        lastResponseModel: null,
        currentTasks: [],
        sessionStates: new Map(),
        _hiddenToolCallIds: new Set(),
        _toolCallNames: new Map(),
        pendingConfirm: null,
        pendingPlan: null,
        pendingAskUser: null,
      }),

    resetKeepConversations: () =>
      set({
        currentSessionId: null,
        sessions: [],
        sessionsLoaded: false,
        agentStatus: 'idle',
        agentStatusDetail: null,
        agentSteps: [],
        workingStartedAt: null,
        lastTurnDurationMs: null,
        turnStatsConversationId: null,
        workingSessionId: null,
        turnUsage: null,
        sessionUsage: null,
        lastResponseProvider: null,
        lastResponseModel: null,
        currentTasks: [],
        sessionStates: new Map(),
        _hiddenToolCallIds: new Set(),
        _toolCallNames: new Map(),
        pendingConfirm: null,
        pendingPlan: null,
        pendingAskUser: null,
        providers: [],
      }),
  }
})
