import { type AskUserQuestion, Channel, type Project, type TokenUsage } from '@anton/protocol'
import { create } from 'zustand'
import type { Artifact } from './artifacts.js'
import { type ConnectionStatus, connection } from './connection.js'
import {
  type Conversation,
  autoTitle,
  createConversation,
  loadConversations,
  saveConversations,
} from './conversations.js'
import {
  loadActiveProjectId,
  loadProjects as loadPersistedProjects,
  saveActiveProjectId,
  saveProjects as savePersistedProjects,
} from './projects.js'

// ── Types ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  attachments?: ChatImageAttachment[]
  toolName?: string
  toolInput?: Record<string, unknown>
  isError?: boolean
  parentToolCallId?: string // set when this message is from a sub-agent
}

export interface ChatImageAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  data?: string
  storagePath?: string
}

export interface ProviderInfo {
  name: string
  models: string[]
  defaultModels?: string[]
  hasApiKey: boolean
  baseUrl?: string
}

export interface SessionMeta {
  id: string
  title: string
  provider: string
  model: string
  messageCount: number
  createdAt: number
  lastActiveAt: number
}

export interface SavedMachine {
  id: string
  name: string
  host: string
  port: number
  token: string
  useTLS: boolean
}

export interface AgentStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result'
  label: string
  toolName?: string
  status: 'active' | 'complete' | 'error'
  timestamp: number
}

export type AgentStatus = 'idle' | 'working' | 'error' | 'unknown'

export interface ConnectorStatusInfo {
  id: string
  name: string
  description?: string
  icon?: string
  type: 'mcp' | 'api'
  connected: boolean
  enabled: boolean
  toolCount: number
  tools: string[]
  error?: string
}

export interface ConnectorRegistryInfo {
  id: string
  name: string
  description: string
  icon: string
  category: string
  type: 'mcp' | 'api'
  command?: string
  args?: string[]
  requiredEnv: string[]
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

export type UpdateStage =
  | 'pulling'
  | 'installing'
  | 'building'
  | 'restarting'
  | 'done'
  | 'error'
  | null
export type SidebarTab = 'history' | 'skills'

// ── Saved machines (localStorage) ───────────────────────────────────

const MACHINES_KEY = 'anton.machines'
const MODEL_KEY = 'anton.selectedModel'
const ACTIVE_CONV_KEY = 'anton.activeConversationId'

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

export function loadMachines(): SavedMachine[] {
  try {
    const raw = localStorage.getItem(MACHINES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveMachines(machines: SavedMachine[]) {
  localStorage.setItem(MACHINES_KEY, JSON.stringify(machines))
}

// ── Store ───────────────────────────────────────────────────────────

interface AppState {
  // Connection
  connectionStatus: ConnectionStatus
  agentStatus: AgentStatus

  // Sessions (server-side)
  currentSessionId: string | null
  currentProvider: string
  currentModel: string
  sessions: SessionMeta[]
  providers: ProviderInfo[]
  defaults: { provider: string; model: string }

  // Conversations (client-side, linked to sessions)
  conversations: Conversation[]
  activeConversationId: string | null

  // UI
  sidebarTab: SidebarTab
  searchQuery: string

  // Last response model info (for display only)
  lastResponseProvider: string | null
  lastResponseModel: string | null

  // Token usage
  turnUsage: TokenUsage | null
  sessionUsage: TokenUsage | null

  // Turn timing
  workingStartedAt: number | null
  lastTurnDurationMs: number | null
  workingSessionId: string | null // which session is currently processing

  // Agent status detail & steps
  agentStatusDetail: string | null
  agentSteps: AgentStep[]

  // Task tracker (Claude Code–style work plan)
  currentTasks: import('@anton/protocol').TaskItem[]

  // Session readiness tracking (race condition fix)
  _sessionResolvers: Map<string, () => void>

  // Current assistant message ID (for appending text across tool interruptions)
  _currentAssistantMsgId: string | null
  // Per-session assistant message tracking (for multi-conversation isolation)
  _sessionAssistantMsgIds: Map<string, string>

  // Artifacts
  artifacts: Artifact[]
  activeArtifactId: string | null
  artifactPanelOpen: boolean

  // Per-session status tracking
  sessionStatuses: Map<string, { status: AgentStatus; detail?: string }>

  // Session streaming & history tracking
  _activeStreamingSessions: Set<string>
  _sessionsNeedingHistoryRefresh: Set<string>

  // Pending confirmation
  pendingConfirm: { id: string; command: string; reason: string; sessionId?: string } | null

  // Plan review
  pendingPlan: { id: string; title: string; content: string; sessionId?: string } | null
  sidePanelView: 'artifacts' | 'plan' | 'context'

  // Ask-user questionnaire
  pendingAskUser: { id: string; questions: AskUserQuestion[]; sessionId?: string } | null

  // Version & updates
  agentVersion: string | null
  agentGitHash: string | null
  updateInfo: UpdateInfo | null
  updateStage: UpdateStage
  updateMessage: string | null
  updateDismissed: boolean

  // Projects
  projects: Project[]
  activeProjectId: string | null
  activeProjectSessionId: string | null // when set, ProjectView shows embedded chat
  projectSessions: SessionMeta[] // sessions for the active project
  projectSessionsLoading: boolean // true while fetching project sessions
  projectFiles: { name: string; size: number; mimeType: string }[]
  projectFilesLoading: boolean
  activeView: 'chat' | 'projects' | 'terminal'

  // Connectors
  connectors: ConnectorStatusInfo[]
  connectorRegistry: ConnectorRegistryInfo[]

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  // Project actions
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null) => void
  addProject: (project: Project) => void
  updateProject: (id: string, changes: Partial<Project>) => void
  removeProject: (id: string) => void
  setProjectSessions: (sessions: SessionMeta[]) => void
  setProjectFiles: (files: { name: string; size: number; mimeType: string }[]) => void
  setActiveProjectSession: (sessionId: string | null) => void
  setActiveView: (view: 'chat' | 'projects' | 'terminal') => void

  // Connector actions
  setConnectors: (connectors: ConnectorStatusInfo[]) => void
  addOrUpdateConnector: (connector: ConnectorStatusInfo) => void
  removeConnector: (id: string) => void
  updateConnectorStatus: (id: string, updates: Partial<ConnectorStatusInfo>) => void
  setConnectorRegistry: (entries: ConnectorRegistryInfo[]) => void

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void
  setAgentStatus: (status: AgentStatus, sessionId?: string) => void
  setSidebarTab: (tab: SidebarTab) => void
  setSearchQuery: (query: string) => void

  // Session actions
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void

  // Conversation actions
  newConversation: (title?: string, sessionId?: string, projectId?: string) => string
  appendConversation: (title?: string, sessionId?: string, projectId?: string) => string
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (msg: ChatMessage) => void
  addMessageToSession: (sessionId: string, msg: ChatMessage) => void
  appendAssistantText: (content: string) => void
  appendAssistantTextToSession: (sessionId: string, content: string) => void
  getActiveConversation: () => Conversation | null
  findConversationBySession: (sessionId: string) => Conversation | undefined
  loadSessionMessages: (sessionId: string, messages: ChatMessage[]) => void
  updateConversationTitle: (sessionId: string, title: string) => void

  // Response model tracking
  setLastResponseModel: (provider: string, model: string) => void

  // Usage actions
  setUsage: (turn: TokenUsage | null, session: TokenUsage | null) => void

  // Agent status & steps actions
  setAgentStatusDetail: (detail: string | null) => void
  addAgentStep: (step: AgentStep) => void
  updateAgentStep: (id: string, updates: Partial<AgentStep>) => void
  clearAgentSteps: () => void

  // Session readiness actions
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void

  // Artifact actions
  addArtifact: (artifact: Artifact) => void
  setActiveArtifact: (id: string | null) => void
  setArtifactPanelOpen: (open: boolean) => void
  clearArtifacts: () => void

  // Confirm actions
  setPendingConfirm: (confirm: { id: string; command: string; reason: string; sessionId?: string } | null) => void

  // Plan actions
  setPendingPlan: (plan: { id: string; title: string; content: string; sessionId?: string } | null) => void
  setSidePanelView: (view: 'artifacts' | 'plan' | 'context') => void
  openContextPanel: () => void

  // Ask-user actions
  setPendingAskUser: (ask: { id: string; questions: AskUserQuestion[]; sessionId?: string } | null) => void

  // Update actions
  setAgentVersionInfo: (version: string, gitHash: string) => void
  setUpdateInfo: (info: UpdateInfo | null) => void
  setUpdateProgress: (stage: UpdateStage, message: string | null) => void
  dismissUpdate: () => void

  // Reset actions
  resetForDisconnect: () => void
}

export const useStore = create<AppState>((set, get) => {
  // Load persisted conversations
  const persisted = loadConversations()
  const savedModel = loadSelectedModel()
  const savedActiveConvId = localStorage.getItem(ACTIVE_CONV_KEY)
  // Only restore if the conversation still exists
  const restoredActiveId =
    savedActiveConvId && persisted.some((c) => c.id === savedActiveConvId)
      ? savedActiveConvId
      : null
  // Prefer per-conversation model over global saved model
  const activeConvModel = restoredActiveId
    ? persisted.find((c) => c.id === restoredActiveId)
    : null
  const initProvider = activeConvModel?.provider ?? savedModel?.provider ?? 'anthropic'
  const initModel = activeConvModel?.model ?? savedModel?.model ?? 'claude-sonnet-4-6'

  return {
    connectionStatus: 'disconnected',
    agentStatus: 'unknown',
    currentSessionId: null,
    currentProvider: initProvider,
    currentModel: initModel,
    sessions: [],
    providers: [],
    defaults: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    conversations: persisted,
    activeConversationId: restoredActiveId,
    sidebarTab: 'history',
    searchQuery: '',
    lastResponseProvider: null,
    lastResponseModel: null,
    turnUsage: null,
    sessionUsage: null,
    workingStartedAt: null,
    lastTurnDurationMs: null,
    workingSessionId: null,
    agentStatusDetail: null,
    agentSteps: [],
    currentTasks: [],
    _sessionResolvers: new Map(),
    _currentAssistantMsgId: null,
    _sessionAssistantMsgIds: new Map(),
    artifacts: [],
    activeArtifactId: null,
    artifactPanelOpen: false,
    sessionStatuses: new Map(),
    _activeStreamingSessions: new Set(),
    _sessionsNeedingHistoryRefresh: new Set(),
    pendingConfirm: null,
    pendingPlan: null,
    sidePanelView: 'artifacts' as const,
    pendingAskUser: null,
    agentVersion: null,
    agentGitHash: null,
    updateInfo: null,
    updateStage: null,
    updateMessage: null,
    updateDismissed: false,
    projects: loadPersistedProjects(),
    activeProjectId: loadActiveProjectId(),
    activeProjectSessionId: null,
    projectSessions: [],
    projectSessionsLoading: false,
    projectFiles: [],
    projectFilesLoading: false,
    activeView: 'chat',

    // Connectors
    connectors: [],
    connectorRegistry: [],

    sidebarCollapsed: false,
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setProjects: (projects) => {
      savePersistedProjects(projects)
      set({ projects })
    },
    setActiveProject: (id) => {
      saveActiveProjectId(id)
      set({ activeProjectId: id, activeProjectSessionId: null, projectSessions: [], projectSessionsLoading: !!id, projectFiles: [], projectFilesLoading: !!id })
    },
    addProject: (project) => {
      set((state) => {
        const projects = [project, ...state.projects]
        savePersistedProjects(projects)
        return { projects }
      })
    },
    updateProject: (id, changes) => {
      set((state) => {
        const projects = state.projects.map((p) =>
          p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p,
        )
        savePersistedProjects(projects)
        return { projects }
      })
    },
    removeProject: (id) => {
      set((state) => {
        const projects = state.projects.filter((p) => p.id !== id)
        savePersistedProjects(projects)
        const activeProjectId = state.activeProjectId === id ? null : state.activeProjectId
        if (!activeProjectId) saveActiveProjectId(null)
        return { projects, activeProjectId }
      })
    },
    setProjectSessions: (sessions) => set({ projectSessions: sessions, projectSessionsLoading: false }),
    setProjectFiles: (files) => set({ projectFiles: files, projectFilesLoading: false }),
    setActiveProjectSession: (sessionId) => set({ activeProjectSessionId: sessionId }),
    setActiveView: (view) => {
      if (view === 'chat') {
        // If the current active conversation belongs to a project, clear it
        // so AgentChat picks or creates a proper chat conversation.
        const state = get()
        const activeConv = state.conversations.find((c) => c.id === state.activeConversationId)
        if (activeConv?.projectId) {
          // Try to find an existing chat conversation to switch to
          const chatConv = state.conversations.find((c) => !c.projectId)
          if (chatConv) {
            localStorage.setItem(ACTIVE_CONV_KEY, chatConv.id)
            set({ activeView: view, activeConversationId: chatConv.id })
          } else {
            localStorage.removeItem(ACTIVE_CONV_KEY)
            set({ activeView: view, activeConversationId: null })
          }
          return
        }
      } else if (view === 'projects') {
        // Restore the project conversation when switching back to projects view.
        // If there's an active project session, ensure activeConversationId matches it.
        const state = get()
        if (state.activeProjectSessionId) {
          const projConv = state.conversations.find(
            (c) => c.sessionId === state.activeProjectSessionId
          )
          if (projConv && projConv.id !== state.activeConversationId) {
            localStorage.setItem(ACTIVE_CONV_KEY, projConv.id)
            set({ activeView: view, activeConversationId: projConv.id })
            return
          }
        }
      }
      set({ activeView: view })
    },

    // Connector actions
    setConnectors: (connectors) => set({ connectors }),
    addOrUpdateConnector: (connector) =>
      set((s) => {
        const idx = s.connectors.findIndex((c) => c.id === connector.id)
        if (idx >= 0) {
          const updated = [...s.connectors]
          updated[idx] = connector
          return { connectors: updated }
        }
        return { connectors: [...s.connectors, connector] }
      }),
    removeConnector: (id) =>
      set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) })),
    updateConnectorStatus: (id, updates) =>
      set((s) => ({
        connectors: s.connectors.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      })),
    setConnectorRegistry: (entries) => set({ connectorRegistry: entries }),

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setAgentStatus: (status, sessionId?) => {
      const prev = get().agentStatus
      if (status === 'working' && prev !== 'working') {
        set({ agentStatus: status, workingStartedAt: Date.now(), lastTurnDurationMs: null, turnUsage: null, workingSessionId: sessionId || null })
      } else if (status === 'idle' && prev === 'working') {
        const started = get().workingStartedAt
        const duration = started ? Date.now() - started : null
        set({ agentStatus: status, lastTurnDurationMs: duration, workingSessionId: null })
      } else {
        set({ agentStatus: status, workingSessionId: status === 'working' ? (sessionId || null) : null })
      }
    },
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSearchQuery: (query) => set({ searchQuery: query }),

    setCurrentSession: (id, provider, model) => {
      saveSelectedModel(provider, model)
      // Also persist model on the active conversation
      set((state) => {
        const activeId = state.activeConversationId
        const conversations = activeId
          ? state.conversations.map((c) =>
              c.id === activeId ? { ...c, provider, model, updatedAt: Date.now() } : c,
            )
          : state.conversations
        if (activeId) saveConversations(conversations)
        return { currentSessionId: id, currentProvider: provider, currentModel: model, conversations }
      })
    },

    setSessions: (sessions) => set({ sessions }),

    setProviders: (providers, defaults) => {
      const saved = loadSelectedModel()
      // Only use server defaults if no local selection is persisted
      const provider = saved?.provider ?? defaults.provider
      const model = saved?.model ?? defaults.model
      set({
        providers,
        defaults,
        currentProvider: provider,
        currentModel: model,
      })
    },

    newConversation: (title, sessionId, projectId) => {
      const { currentProvider, currentModel } = get()
      const conv = createConversation(title, sessionId, projectId, currentProvider, currentModel)
      set((state) => {
        const conversations = [conv, ...state.conversations]
        saveConversations(conversations)
        localStorage.setItem(ACTIVE_CONV_KEY, conv.id)
        return {
          conversations,
          activeConversationId: conv.id,
          agentStatus: 'idle' as AgentStatus,
          agentStatusDetail: null,
          workingSessionId: null,
          workingStartedAt: null,
          currentTasks: [],
        }
      })
      return conv.id
    },

    appendConversation: (title, sessionId, projectId) => {
      const { currentProvider, currentModel } = get()
      const conv = createConversation(title, sessionId, projectId, currentProvider, currentModel)
      set((state) => {
        // Append at end instead of prepending — used for syncing server sessions
        // so they don't displace the user's current conversation
        const conversations = [...state.conversations, conv]
        saveConversations(conversations)
        return { conversations }
      })
      return conv.id
    },

    switchConversation: (id) => {
      localStorage.setItem(ACTIVE_CONV_KEY, id)
      // Restore per-conversation model when switching
      const conv = get().conversations.find((c) => c.id === id)
      const updates: Partial<AppState> = { activeConversationId: id }
      if (conv?.provider && conv?.model) {
        updates.currentProvider = conv.provider
        updates.currentModel = conv.model
      }

      // Restore per-session agent status so stale sessions don't show "working"
      if (conv?.sessionId) {
        const sessionStatus = get().sessionStatuses.get(conv.sessionId)
        updates.agentStatus = sessionStatus?.status ?? 'idle'
        updates.agentStatusDetail = sessionStatus?.detail ?? null
        updates.workingSessionId = sessionStatus?.status === 'working' ? conv.sessionId : null
        if (sessionStatus?.status !== 'working') {
          updates.workingStartedAt = null
        }
      } else {
        updates.agentStatus = 'idle'
        updates.agentStatusDetail = null
        updates.workingSessionId = null
        updates.workingStartedAt = null
      }

      // If this session completed a turn in the background, fetch fresh history
      if (conv?.sessionId && get()._sessionsNeedingHistoryRefresh.has(conv.sessionId)) {
        const needsRefresh = new Set(get()._sessionsNeedingHistoryRefresh)
        needsRefresh.delete(conv.sessionId)
        updates._sessionsNeedingHistoryRefresh = needsRefresh
        connection.sendSessionHistory(conv.sessionId)
      }

      set(updates)
    },

    deleteConversation: (id) => {
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id)
        saveConversations(conversations)
        const activeConversationId =
          state.activeConversationId === id
            ? conversations[0]?.id || null
            : state.activeConversationId
        if (activeConversationId) {
          localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId)
        } else {
          localStorage.removeItem(ACTIVE_CONV_KEY)
        }
        return { conversations, activeConversationId }
      })
    },

    addMessage: (msg) => {
      set((state) => {
        const activeId = state.activeConversationId
        if (!activeId) return state

        const conversations = state.conversations.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages, msg]
          const title =
            c.messages.length === 0 && msg.role === 'user' ? autoTitle(messages) : c.title
          return { ...c, messages, title, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return { conversations }
      })
    },

    addMessageToSession: (sessionId, msg) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          const messages = [...c.messages, msg]
          const title =
            c.messages.length === 0 && msg.role === 'user' ? autoTitle(messages) : c.title
          return { ...c, messages, title, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return { conversations }
      })
    },

    appendAssistantText: (content) => {
      set((state) => {
        const activeId = state.activeConversationId
        if (!activeId) return state

        let newMsgId: string | null = null

        const conversations = state.conversations.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages]

          // Find the tracked assistant message, or the last assistant message
          const targetId = state._currentAssistantMsgId
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            // Append to tracked message
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            // Create new assistant message
            newMsgId = `msg_${Date.now()}`
            messages.push({
              id: newMsgId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
            })
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return {
          conversations,
          ...(newMsgId ? { _currentAssistantMsgId: newMsgId } : {}),
        }
      })
    },

    appendAssistantTextToSession: (sessionId, content) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        let newMsgId: string | null = null

        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          const messages = [...c.messages]

          const targetId = state._sessionAssistantMsgIds.get(sessionId) ?? null
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            newMsgId = `msg_${Date.now()}`
            messages.push({
              id: newMsgId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
            })
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        if (newMsgId) {
          state._sessionAssistantMsgIds.set(sessionId, newMsgId)
        }

        saveConversations(conversations)
        return { conversations }
      })
    },

    getActiveConversation: () => {
      const { conversations, activeConversationId } = get()
      return conversations.find((c) => c.id === activeConversationId) || null
    },

    findConversationBySession: (sessionId) => {
      return get().conversations.find((c) => c.sessionId === sessionId)
    },

    loadSessionMessages: (sessionId, serverMessages) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        const localMessages = conv.messages
        const isStreaming = state._activeStreamingSessions.has(sessionId)

        let mergedMessages: ChatMessage[]

        if (localMessages.length === 0) {
          // No local messages — use server history as-is (first load)
          mergedMessages = serverMessages
        } else if (isStreaming) {
          // Session is actively streaming — client has newer data than server.
          // Skip the server response to avoid overwriting in-progress data.
          return state
        } else {
          // Session is idle. Server is authoritative for completed turns.
          // Use server data unless local has more (turn just ended but
          // server response was queued before persist completed)
          mergedMessages = serverMessages.length >= localMessages.length
            ? serverMessages
            : localMessages
        }

        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, messages: mergedMessages, updatedAt: Date.now() }
        })
        saveConversations(conversations)
        return { conversations }
      })
    },

    updateConversationTitle: (sessionId, title) => {
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, title, updatedAt: Date.now() }
        })
        saveConversations(conversations)
        return { conversations }
      })
    },

    setLastResponseModel: (provider, model) =>
      set({ lastResponseProvider: provider, lastResponseModel: model }),

    setUsage: (turn, session) => set({ turnUsage: turn, sessionUsage: session }),

    setAgentStatusDetail: (detail) => set({ agentStatusDetail: detail }),

    addAgentStep: (step) => set((state) => ({ agentSteps: [...state.agentSteps, step] })),

    updateAgentStep: (id, updates) =>
      set((state) => ({
        agentSteps: state.agentSteps.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      })),

    clearAgentSteps: () => set({ agentSteps: [] }),

    registerPendingSession: (id) => {
      return new Promise<void>((resolve) => {
        get()._sessionResolvers.set(id, resolve)
      })
    },

    resolvePendingSession: (id) => {
      const resolvers = get()._sessionResolvers
      const resolver = resolvers.get(id)
      if (resolver) {
        resolver()
        resolvers.delete(id)
      }
    },

    addArtifact: (artifact) =>
      set((state) => {
        // Deduplicate by filepath (update existing if same file written again)
        const existing = artifact.filepath
          ? state.artifacts.findIndex((a) => a.filepath === artifact.filepath)
          : -1
        let artifacts: Artifact[]
        if (existing >= 0) {
          artifacts = [...state.artifacts]
          artifacts[existing] = artifact
        } else {
          artifacts = [...state.artifacts, artifact]
        }
        return {
          artifacts,
          activeArtifactId: artifact.id,
          artifactPanelOpen: true,
        }
      }),

    setActiveArtifact: (id) => set({ activeArtifactId: id }),

    setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),

    clearArtifacts: () => set({ artifacts: [], activeArtifactId: null, artifactPanelOpen: false }),

    setPendingConfirm: (confirm) => set({ pendingConfirm: confirm }),

    setPendingPlan: (plan) => set({ pendingPlan: plan }),
    setSidePanelView: (view) => set({ sidePanelView: view }),
    openContextPanel: () => set({ sidePanelView: 'context', artifactPanelOpen: true }),
    setPendingAskUser: (ask) => set({ pendingAskUser: ask }),

    setAgentVersionInfo: (version, gitHash) =>
      set({ agentVersion: version, agentGitHash: gitHash }),

    setUpdateInfo: (info) => set({ updateInfo: info, updateDismissed: false }),

    setUpdateProgress: (stage, message) => set({ updateStage: stage, updateMessage: message }),

    dismissUpdate: () => set({ updateDismissed: true }),

    resetForDisconnect: () => {
      set({
        // KEEP: conversations, activeConversationId — user's chat history persists
        // KEEP: projects, activeProjectId — project context persists
        // KEEP: activeView — don't reset navigation

        // Clear transient session/connection state
        currentSessionId: null,
        sessions: [],
        agentStatus: 'unknown',
        agentStatusDetail: null,
        workingSessionId: null,
        agentSteps: [],
        _currentAssistantMsgId: null,
        _sessionAssistantMsgIds: new Map(),
        _sessionResolvers: new Map(),
        pendingConfirm: null,
        pendingPlan: null,
        pendingAskUser: null,
        turnUsage: null,
        sessionUsage: null,
        workingStartedAt: null,
        lastTurnDurationMs: null,
        lastResponseProvider: null,
        lastResponseModel: null,
        providers: [],
        agentVersion: null,
        agentGitHash: null,
        updateInfo: null,
        updateStage: null,
        updateMessage: null,
        updateDismissed: false,
        projectSessions: [],
        projectSessionsLoading: false,
        projectFiles: [],
        projectFilesLoading: false,
      })
      // DO NOT clear conversations or active conversation — preserve chat history
      // On reconnect, session_history will sync the server's persisted state
    },
  }
})

// ── Wire connection events to store ─────────────────────────────────

connection.onStatusChange((status) => {
  useStore.getState().setConnectionStatus(status)
})

connection.onMessage((channel, msg) => {
  const store = useStore.getState()

  // Debug logging for all messages
  console.log(`[WS] ch=${channel} type=${msg.type}`, msg)

  // ── CONTROL channel: auth_ok version info + update messages ──
  if (channel === Channel.CONTROL) {
    if (msg.type === 'auth_ok') {
      store.setAgentVersionInfo(msg.version || '', msg.gitHash || '')
      // If agent already knows about an update, store it
      if (msg.updateAvailable) {
        store.setUpdateInfo({
          currentVersion: msg.version,
          latestVersion: msg.updateAvailable.version,
          updateAvailable: true,
          changelog: msg.updateAvailable.changelog,
          releaseUrl: msg.updateAvailable.releaseUrl,
        })
      }
    } else if (msg.type === 'update_check_response') {
      store.setUpdateInfo({
        currentVersion: msg.currentVersion,
        latestVersion: msg.latestVersion,
        updateAvailable: msg.updateAvailable,
        changelog: msg.changelog,
        releaseUrl: msg.releaseUrl,
      })
    } else if (msg.type === 'update_progress') {
      store.setUpdateProgress(msg.stage, msg.message)
    }
    // Don't return — let other control messages fall through for ping/pong etc.
  }

  // ── EVENTS channel: agent status + update notifications ──
  if (channel === Channel.EVENTS && msg.type === 'update_available') {
    store.setUpdateInfo({
      currentVersion: msg.currentVersion,
      latestVersion: msg.latestVersion,
      updateAvailable: true,
      changelog: msg.changelog,
      releaseUrl: msg.releaseUrl,
    })
    return
  }

  if (channel === Channel.EVENTS && msg.type === 'agent_status') {
    console.log(`[WS] Agent status: ${msg.status}`, msg.detail || '', msg.sessionId || '')
    const sid: string | undefined = msg.sessionId

    // Update per-session status map
    if (sid) {
      const statuses = new Map(store.sessionStatuses)
      statuses.set(sid, { status: msg.status, detail: msg.detail })
      useStore.setState({ sessionStatuses: statuses })
    }

    // Update global status only for the active session (or if no sessionId)
    const activeConv = store.getActiveConversation()
    if (!sid || sid === activeConv?.sessionId) {
      store.setAgentStatus(msg.status, sid)
      store.setAgentStatusDetail(msg.detail || null)
      if (msg.status === 'idle') {
        store.clearAgentSteps()
      }
    }
    return
  }

  if (channel !== Channel.AI) {
    console.log(`[WS] Ignoring non-AI channel: ${channel}`)
    return
  }

  // ── Session-aware message routing ─────────────────────────────
  // Determine whether this message belongs to the active conversation or another one.
  // If it has a sessionId that matches a non-active conversation, route it there.
  const msgSessionId: string | undefined = msg.sessionId
  const activeConv = store.getActiveConversation()
  const isForActiveSession = !msgSessionId || activeConv?.sessionId === msgSessionId
  // Helper: add message to the correct conversation
  const addMsg = (chatMsg: ChatMessage) => {
    if (isForActiveSession) {
      store.addMessage(chatMsg)
    } else if (msgSessionId) {
      store.addMessageToSession(msgSessionId, chatMsg)
    }
  }
  const appendText = (content: string) => {
    if (isForActiveSession) {
      store.appendAssistantText(content)
    } else if (msgSessionId) {
      store.appendAssistantTextToSession(msgSessionId, content)
    }
  }

  switch (msg.type) {
    // ── Chat messages ──────────────────────────────────────────
    case 'text': {
      console.log(`[WS] AI text chunk: "${msg.content?.slice(0, 80)}..."`)
      // Track that this session is actively streaming
      const textSessionId = msgSessionId || activeConv?.sessionId
      if (textSessionId && !store._activeStreamingSessions.has(textSessionId)) {
        const streaming = new Set(store._activeStreamingSessions)
        streaming.add(textSessionId)
        useStore.setState({ _activeStreamingSessions: streaming })
      }
      appendText(msg.content)
      break
    }

    case 'thinking':
      addMsg({
        id: `think_${Date.now()}`,
        role: 'system',
        content: msg.text,
        timestamp: Date.now(),
      })
      store.setAgentStatus('working', msgSessionId)
      break

    case 'tool_call':
      // Reset assistant message tracking so any text AFTER this tool call
      // creates a new assistant bubble (shows reasoning between tool groups)
      if (!msg.parentToolCallId) {
        if (isForActiveSession) {
          useStore.setState({ _currentAssistantMsgId: null })
        } else if (msgSessionId) {
          store._sessionAssistantMsgIds.delete(msgSessionId)
        }
      }
      addMsg({
        id: `tc_${msg.id}`,
        role: 'tool',
        content: `Running: ${msg.name}`,
        toolName: msg.name,
        toolInput: msg.input,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
      })
      if (!msg.parentToolCallId) {
        store.addAgentStep({
          id: msg.id,
          type: 'tool_call',
          label: `Running: ${msg.name}`,
          toolName: msg.name,
          status: 'active',
          timestamp: Date.now(),
        })
      }
      store.setAgentStatus('working', msgSessionId)
      break

    case 'tool_result': {
      const resultMsg: ChatMessage = {
        id: `tr_${msg.id}`,
        role: 'tool',
        content: msg.output,
        isError: msg.isError,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
      }
      addMsg(resultMsg)
      if (!msg.parentToolCallId) {
        store.updateAgentStep(msg.id, {
          status: msg.isError ? 'error' : 'complete',
        })
      }

      break
    }

    // ── Sub-agent lifecycle ──────────────────────────────────────
    case 'sub_agent_start':
      addMsg({
        id: `sa_start_${msg.toolCallId}`,
        role: 'tool',
        content: msg.task,
        toolName: 'sub_agent',
        toolInput: { task: msg.task },
        timestamp: Date.now(),
      })
      break

    case 'sub_agent_end':
      addMsg({
        id: `sa_end_${msg.toolCallId}`,
        role: 'tool',
        content: msg.success ? 'Sub-agent completed' : 'Sub-agent failed',
        isError: !msg.success,
        timestamp: Date.now(),
        parentToolCallId: msg.toolCallId,
      })
      break

    case 'artifact':
      // Server-side artifact detection — add directly to store
      store.addArtifact({
        id: msg.id,
        type: msg.artifactType,
        renderType: msg.renderType,
        title: msg.title,
        filename: msg.filename,
        filepath: msg.filepath,
        language: msg.language,
        content: msg.content,
        toolCallId: `tc_${msg.toolCallId}`,
        timestamp: Date.now(),
      })
      break

    case 'confirm':
      store.setPendingConfirm({
        id: msg.id,
        command: msg.command,
        reason: msg.reason,
        sessionId: msgSessionId,
      })
      break

    case 'plan_confirm':
      store.setPendingPlan({
        id: msg.id,
        title: msg.title,
        content: msg.content,
        sessionId: msgSessionId,
      })
      store.setSidePanelView('plan')
      store.setArtifactPanelOpen(true)
      break

    case 'ask_user':
      store.setPendingAskUser({
        id: msg.id,
        questions: msg.questions,
        sessionId: msgSessionId,
      })
      break

    case 'error': {
      addMsg({
        id: `err_${Date.now()}`,
        role: 'system',
        content: msg.message,
        isError: true,
        timestamp: Date.now(),
      })
      store.setAgentStatus('error')
      // Clear streaming flag on error
      const errSessionId = msgSessionId || activeConv?.sessionId
      if (errSessionId && store._activeStreamingSessions.has(errSessionId)) {
        const streaming = new Set(store._activeStreamingSessions)
        streaming.delete(errSessionId)
        useStore.setState({ _activeStreamingSessions: streaming })
      }
      break
    }

    case 'title_update':
      console.log('[WS] title_update received:', { sessionId: msg.sessionId, title: msg.title })
      if (msg.sessionId) {
        const matchingConv = store.findConversationBySession(msg.sessionId)
        console.log('[WS] title_update matching conv:', matchingConv?.id, matchingConv?.sessionId, matchingConv?.title)
        store.updateConversationTitle(msg.sessionId, msg.title)
        // Also update projectSessions so sidebar reflects the new title
        if (store.projectSessions.some((s: SessionMeta) => s.id === msg.sessionId)) {
          store.setProjectSessions(
            store.projectSessions.map((s: SessionMeta) =>
              s.id === msg.sessionId ? { ...s, title: msg.title } : s
            )
          )
        }
      } else {
        console.warn('[WS] title_update has no sessionId, skipping')
      }
      break

    case 'tasks_update': {
      if (isForActiveSession && msg.tasks) {
        useStore.setState({ currentTasks: msg.tasks })
      }
      break
    }

    case 'token_update': {
      // Streaming token update — update turnUsage live so the UI can show a counter
      if (isForActiveSession && msg.usage) {
        store.setUsage(msg.usage, null)
      }
      break
    }

    case 'done': {
      // Detect silent failures: server says "done" but never sent any text/tool events
      const doneConv = msgSessionId
        ? store.findConversationBySession(msgSessionId)
        : store.getActiveConversation()
      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = store.agentStatus === 'working'
      const noResponse = wasWorking && lastMsg?.role === 'user'
      const zeroTokens = msg.usage && msg.usage.inputTokens === 0 && msg.usage.outputTokens === 0

      if (noResponse && zeroTokens) {
        console.error(
          '[WS] Silent failure: "done" with zero tokens and no response. Likely missing API key on server.',
        )
        addMsg({
          id: `err_silent_${Date.now()}`,
          role: 'system',
          content:
            'No response from the agent. The LLM was never called (0 tokens used). Check that a valid API key is configured on the server.',
          isError: true,
          timestamp: Date.now(),
        })
      } else if (noResponse) {
        console.warn('[WS] Agent completed with no visible response.')
        addMsg({
          id: `err_empty_${Date.now()}`,
          role: 'system',
          content: 'Agent finished but produced no response.',
          isError: true,
          timestamp: Date.now(),
        })
      }

      // Update per-session status
      if (msgSessionId) {
        const statuses = new Map(store.sessionStatuses)
        statuses.set(msgSessionId, { status: 'idle' })
        useStore.setState({ sessionStatuses: statuses })
      }

      // Only update global status if this is the active session or no other session is working
      if (isForActiveSession) {
        store.setAgentStatus('idle')
        store.clearAgentSteps()
        store.setAgentStatusDetail(null)
      } else if (msgSessionId) {
        // Check if any session is still working
        const anyWorking = Array.from(store.sessionStatuses.values()).some(
          (s) => s.status === 'working',
        )
        if (!anyWorking) {
          store.setAgentStatus('idle')
        }
      } else {
        store.setAgentStatus('idle')
        store.clearAgentSteps()
        store.setAgentStatusDetail(null)
      }

      useStore.setState({ _currentAssistantMsgId: null })
      if (msgSessionId) {
        store._sessionAssistantMsgIds.delete(msgSessionId)
      }

      // Clear streaming flag; if this was a background session, mark it for history refresh
      const doneSessionId = msgSessionId || activeConv?.sessionId
      if (doneSessionId) {
        const streaming = new Set(store._activeStreamingSessions)
        streaming.delete(doneSessionId)
        const needsRefresh = new Set(store._sessionsNeedingHistoryRefresh)
        if (!isForActiveSession) {
          needsRefresh.add(doneSessionId)
        }
        useStore.setState({
          _activeStreamingSessions: streaming,
          _sessionsNeedingHistoryRefresh: needsRefresh,
        })
      }

      if (msg.usage) {
        store.setUsage(msg.usage, msg.cumulativeUsage || null)
      }
      // Track the actual model used for this turn (display only)
      if (msg.provider && msg.model) {
        try {
          useStore.setState({ lastResponseProvider: msg.provider, lastResponseModel: msg.model })
        } catch {
          /* ignore during HMR transitions */
        }
      }
      break
    }

    // ── Session responses ──────────────────────────────────────
    case 'session_created': {
      // Session created — update session ID and persist model on the conversation.
      // The server echoes back the actual provider/model being used for this session.
      // Update currentProvider/currentModel since this is a fresh session the user just created.
      store.setCurrentSession(msg.id, msg.provider, msg.model)
      store.resolvePendingSession(msg.id)
      break
    }

    case 'session_resumed': {
      // Session resumed — update session ID but preserve the user's global model selection.
      // The resumed session may have been created with a different model, but the user's
      // current preference (from the model selector) should not be overwritten.
      // Only update currentSessionId; persist the session's model on its conversation.
      const resumedConv = store.findConversationBySession(msg.id)
      if (resumedConv) {
        // Update the conversation's stored model and title to match what the server has
        const convs = store.conversations.map((c: Conversation) =>
          c.sessionId === msg.id
            ? {
                ...c,
                provider: msg.provider,
                model: msg.model,
                // Sync title from server if the server has a real title and local is still default
                ...(msg.title && msg.title !== 'New conversation' && c.title === 'New conversation'
                  ? { title: msg.title }
                  : {}),
                updatedAt: Date.now(),
              }
            : c,
        )
        saveConversations(convs)
        useStore.setState({ conversations: convs, currentSessionId: msg.id })
      } else {
        useStore.setState({ currentSessionId: msg.id })
      }
      break
    }

    case 'context_info': {
      // Store context info on the conversation linked to this session
      const convs = store.conversations.map((c: Conversation) =>
        c.sessionId === msg.sessionId
          ? {
              ...c,
              contextInfo: {
                globalMemories: msg.globalMemories || [],
                conversationMemories: msg.conversationMemories || [],
                crossConversationMemories: msg.crossConversationMemories || [],
                projectId: msg.projectId,
              },
            }
          : c,
      )
      saveConversations(convs)
      useStore.setState({ conversations: convs })
      break
    }

    case 'sessions_list_response':
      store.setSessions(msg.sessions)
      break

    case 'session_history_response': {
      // Convert server history entries to ChatMessage format
      type HistoryEntry = {
        seq: number
        role: string
        content: string
        ts: number
        toolName?: string
        toolInput?: Record<string, unknown>
        isError?: boolean
        attachments?: ChatImageAttachment[]
      }
      const historyMessages: ChatMessage[] = msg.messages.map((entry: HistoryEntry) => ({
        id: `hist_${entry.seq}_${Date.now()}`,
        role:
          entry.role === 'user'
            ? 'user'
            : entry.role === 'assistant'
              ? 'assistant'
              : entry.role === 'tool_call' || entry.role === 'tool_result'
                ? 'tool'
                : 'system',
        content: entry.content,
        timestamp: entry.ts,
        attachments: entry.attachments,
        toolName: entry.toolName,
        toolInput: entry.toolInput,
        isError: entry.isError,
      }))
      store.loadSessionMessages(msg.id, historyMessages)
      break
    }

    case 'session_destroyed':
      store.setSessions(store.sessions.filter((s: SessionMeta) => s.id !== msg.id))
      // Also remove from projectSessions so project view updates immediately
      if (store.projectSessions.some((s: SessionMeta) => s.id === msg.id)) {
        store.setProjectSessions(store.projectSessions.filter((s: SessionMeta) => s.id !== msg.id))
      }
      break

    // ── Provider responses ─────────────────────────────────────
    case 'providers_list_response':
      store.setProviders(msg.providers, msg.defaults)
      break

    case 'provider_set_key_response':
      if (msg.success) connection.sendProvidersList()
      break

    case 'provider_set_models_response':
      if (msg.success) connection.sendProvidersList()
      break

    case 'provider_set_default_response':
      if (msg.success) {
        store.setCurrentSession(store.currentSessionId || '', msg.provider, msg.model)
      }
      break

    // ── Compaction ──────────────────────────────────────────────
    case 'compaction_start':
      addMsg({
        id: `compact_${Date.now()}`,
        role: 'system',
        content: 'Compacting context...',
        timestamp: Date.now(),
      })
      break

    case 'compaction_complete':
      addMsg({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${msg.compactedMessages} messages summarized (compaction #${msg.totalCompactions})`,
        timestamp: Date.now(),
      })
      break

    // ── Project responses ──────────────────────────────────────
    case 'project_created':
      store.addProject(msg.project)
      store.setActiveProject(msg.project.id)
      connection.sendProjectSessionsList(msg.project.id)
      break

    case 'projects_list_response':
      store.setProjects(msg.projects)
      break

    case 'project_updated':
      store.updateProject(msg.project.id, msg.project)
      break

    case 'project_deleted':
      store.removeProject(msg.id)
      break

    case 'project_files_list_response':
      if (msg.projectId === store.activeProjectId) {
        store.setProjectFiles(msg.files)
      }
      break

    case 'project_sessions_list_response':
      if (msg.projectId === store.activeProjectId) {
        store.setProjectSessions(msg.sessions)
      }
      break

    // ── Connector responses ──────────────────────────────────────
    case 'connectors_list_response':
      store.setConnectors(msg.connectors)
      break

    case 'connector_added':
      store.addOrUpdateConnector(msg.connector)
      break

    case 'connector_updated':
      store.addOrUpdateConnector(msg.connector)
      break

    case 'connector_removed':
      store.removeConnector(msg.id)
      break

    case 'connector_status':
      store.updateConnectorStatus(msg.id, {
        connected: msg.connected,
        toolCount: msg.toolCount,
        error: msg.error,
      })
      break

    case 'connector_registry_list_response':
      store.setConnectorRegistry(msg.entries)
      break
  }
})

// ── Convenience hooks ───────────────────────────────────────────────

export function useConnectionStatus(): ConnectionStatus {
  return useStore((s) => s.connectionStatus)
}

export function useAgentStatus(): AgentStatus {
  return useStore((s) => s.agentStatus)
}

/** Returns true if the currently active conversation's session is the one that's working. */
export function useIsCurrentSessionWorking(): boolean {
  return useStore((s) => {
    if (s.agentStatus !== 'working') return false
    if (!s.workingSessionId) return true // fallback: if no sessionId tracked, assume current
    const activeConv = s.getActiveConversation()
    return activeConv?.sessionId === s.workingSessionId
  })
}
