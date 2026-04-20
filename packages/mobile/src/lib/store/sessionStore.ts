/**
 * Session domain store — sessions, providers, per-session state.
 * Adapted from desktop sessionStore for React Native.
 */

import type { ChatImageAttachmentInput } from '@anton/protocol'
import { create } from 'zustand'
import { connection } from '../connection'
import { saveSelectedModel } from '../storage'
import {
  type AgentStatus,
  type ProviderInfo,
  type RoutineStep,
  type SessionMeta,
  type SessionState,
  createSessionState,
} from './types'

const STUCK_STATE_TIMEOUT_MS = 90_000
const _stuckTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

interface SessionStoreState {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'authenticating' | 'error'
  currentSessionId: string | null
  currentProvider: string
  currentModel: string
  sessions: SessionMeta[]
  sessionsLoaded: boolean
  providers: ProviderInfo[]
  defaults: { provider: string; model: string }
  thinkingEnabled: boolean
  sessionStates: Map<string, SessionState>

  setConnectionStatus: (status: SessionStoreState['connectionStatus']) => void
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void
  setThinkingEnabled: (enabled: boolean) => void
  getSessionState: (sessionId: string) => SessionState
  updateSessionState: (sessionId: string, updates: Partial<SessionState>) => void
  removeSessionState: (sessionId: string) => void
  setSessionStatus: (sessionId: string, status: AgentStatus, statusDetail?: string | null) => void
  addRoutineStep: (sessionId: string, step: RoutineStep) => void
  updateRoutineStep: (sessionId: string, stepId: string, updates: Partial<RoutineStep>) => void
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void
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
  sendConfirmResponse: (id: string, approved: boolean) => void
  sendPlanResponse: (id: string, approved: boolean, feedback?: string) => void
  sendAskUserResponse: (id: string, answers: Record<string, string>) => void
  sendCancelTurn: (sessionId: string) => void
  sendProvidersList: () => void
  sendProviderSetDefault: (provider: string, model: string) => void
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
  reset: () => void
}

export const sessionStore = create<SessionStoreState>((set, get) => ({
  connectionStatus: 'disconnected',
  currentSessionId: null,
  currentProvider: 'anthropic',
  currentModel: 'claude-sonnet-4-6',
  sessions: [],
  sessionsLoaded: false,
  providers: [],
  defaults: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  thinkingEnabled: true,
  sessionStates: new Map(),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setCurrentSession: (id, provider, model) => {
    saveSelectedModel(provider, model)
    set({ currentSessionId: id, currentProvider: provider, currentModel: model })
  },

  setSessions: (sessions) => set({ sessions, sessionsLoaded: true }),

  setProviders: (providers, defaults) => {
    set({
      providers,
      defaults,
      currentProvider: defaults.provider,
      currentModel: defaults.model,
    })
  },

  setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),

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
      const states = new Map(s.sessionStates)
      states.delete(sessionId)
      return {
        sessionStates: states,
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      }
    })
  },

  setSessionStatus: (sessionId, status, statusDetail) => {
    const prev = get().getSessionState(sessionId)
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
        ...(isNewTurn && {
          workingStartedAt: Date.now(),
          lastTurnDurationMs: null,
          turnUsage: null,
          tasks: [],
        }),
      })

      const timeout = setTimeout(() => {
        const current = get().getSessionState(sessionId)
        if (current.status === 'working') {
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
    get().updateSessionState(sessionId, { agentSteps: [...ss.agentSteps, step] })
  },

  updateRoutineStep: (sessionId, stepId, updates) => {
    const ss = get().getSessionState(sessionId)
    get().updateSessionState(sessionId, {
      agentSteps: ss.agentSteps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    })
  },

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
      console.log('[Session] Resolved pending session:', id)
      state.resolver()
      get().updateSessionState(id, { resolver: undefined })
    }
  },

  createSession: (sessionId, opts) => {
    const thinkingLevel = opts.thinkingLevel ?? (get().thinkingEnabled ? 'medium' : 'off')
    console.log('[Session] Creating:', sessionId, opts.provider, opts.model)
    connection.sendSessionCreate(sessionId, { ...opts, thinkingLevel })
  },

  destroySession: (sessionId) => connection.sendSessionDestroy(sessionId),

  sendConfirmResponse: (id, approved) => connection.sendConfirmResponse(id, approved),
  sendPlanResponse: (id, approved, feedback) => connection.sendPlanResponse(id, approved, feedback),
  sendAskUserResponse: (id, answers) => connection.sendAskUserResponse(id, answers),
  sendCancelTurn: (sessionId) => connection.sendCancelTurn(sessionId),
  sendProvidersList: () => connection.sendProvidersList(),
  sendProviderSetDefault: (provider, model) => connection.sendProviderSetDefault(provider, model),

  sendAiMessage: (text, attachments) => {
    connection.sendAiMessage(text, attachments)
    const sid = get().currentSessionId
    if (sid && get().connectionStatus === 'connected') {
      get().setSessionStatus(sid, 'working')
    }
  },

  sendAiMessageToSession: (text, sessionId, attachments) => {
    console.log('[Session] Sending message to session:', sessionId)
    connection.sendAiMessageToSession(text, sessionId, attachments)
    if (get().connectionStatus === 'connected') {
      get().setSessionStatus(sessionId, 'working')
    }
  },

  sendSteerMessage: (text, sessionId, attachments) =>
    connection.sendSteerMessage(text, sessionId, attachments),

  reset: () => {
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
}))

const _defaultState = createSessionState()

export function useActiveSessionState<T>(selector: (s: SessionState) => T): T {
  return sessionStore((store) => {
    const sid = store.currentSessionId
    if (!sid) return selector(_defaultState)
    return selector(store.sessionStates.get(sid) ?? _defaultState)
  })
}

export function useSessionState<T>(
  sessionId: string | undefined,
  selector: (s: SessionState) => T,
): T {
  return sessionStore((store) => {
    if (!sessionId) return selector(_defaultState)
    return selector(store.sessionStates.get(sessionId) ?? _defaultState)
  })
}
