import {
  type AskUserQuestion,
  Channel,
  type Project,
  type TokenUsage,
  type UsageStatsDayBreakdown,
  type UsageStatsModelBreakdown,
  type UsageStatsSessionEntry,
} from '@anton/protocol'
import { create } from 'zustand'
import { type Artifact, type ArtifactRenderType, extractArtifact } from './artifacts.js'
import { type ConnectionStatus, type WsPayload, connection } from './connection.js'
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
import type {
  WsAgentCreated,
  WsAgentDeleted,
  WsAgentRunLogsResponse,
  WsAgentStatusMsg,
  WsAgentUpdated,
  WsAgentsListResponse,
  WsArtifact,
  WsAskUser,
  WsAuthOk,
  WsBrowserState,
  WsCompactionComplete,
  WsConfirm,
  WsConnectorAdded,
  WsConnectorRegistryListResponse,
  WsConnectorRemoved,
  WsConnectorStatus,
  WsConnectorUpdated,
  WsConnectorsListResponse,
  WsContextInfo,
  WsDone,
  WsError,
  WsJobEvent,
  WsPlanConfirm,
  WsProjectCreated,
  WsProjectDeleted,
  WsProjectFilesListResponse,
  WsProjectSessionsListResponse,
  WsProjectUpdated,
  WsProjectsListResponse,
  WsProviderSetDefaultResponse,
  WsProvidersListResponse,
  WsPublishArtifactResponse,
  WsSessionCreated,
  WsSessionDestroyed,
  WsSessionHistoryResponse,
  WsSessionsListResponse,
  WsSteerAck,
  WsSubAgentEnd,
  WsSubAgentProgress,
  WsSubAgentStart,
  WsTasksUpdate,
  WsText,
  WsTextReplace,
  WsThinking,
  WsTitleUpdate,
  WsTokenUpdate,
  WsToolCall,
  WsToolResult,
  WsUpdateAvailable,
  WsUpdateCheckResponse,
  WsUpdateProgress,
  WsUsageStatsResponse,
} from './ws-messages.js'

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
  isSteering?: boolean // sent while agent was working
}

export interface CitationSource {
  index: number
  title: string
  url: string
  domain: string
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
  type: 'mcp' | 'api' | 'oauth'
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
  type: 'mcp' | 'api' | 'oauth'
  command?: string
  args?: string[]
  requiredEnv: string[]
  optionalFields?: { key: string; label: string; hint?: string }[]
  featured?: boolean
  oauthProvider?: string
  oauthScopes?: string[]
  setupGuide?: {
    steps: string[]
    url: string
    urlLabel?: string
  }
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

export type UpdateStage =
  | 'downloading'
  | 'replacing'
  | 'pulling'
  | 'installing'
  | 'building'
  | 'restarting'
  | 'done'
  | 'error'
  | null
export type SidebarTab = 'history' | 'skills'

// ── Saved machines (localStorage) ───────────────────────────────────

// ── Citation parsing ─────────────────────────────────────────────

function parseCitationSources(output: string): CitationSource[] {
  // Primary: extract structured JSON from <!-- citations:[...] --> block
  const marker = '<!-- citations:'
  const start = output.indexOf(marker)
  if (start !== -1) {
    const jsonStart = start + marker.length
    const end = output.indexOf(' -->', jsonStart)
    if (end !== -1) {
      try {
        const raw: Array<{ i: number; t: string; d: string; u: string }> = JSON.parse(
          output.slice(jsonStart, end),
        )
        return raw.map((s) => ({
          index: s.i,
          title: s.t,
          url: s.u,
          domain: s.d,
        }))
      } catch {
        /* fall through to legacy parser */
      }
    }
  }
  // Legacy fallback: regex parse for old session history
  const sources: CitationSource[] = []
  const regex = /\[(\d+)\]\s+(.+?)\s*\|\s*(\S+)\s*—\s*(https?:\/\/\S+)/g
  for (const match of output.matchAll(regex)) {
    sources.push({
      index: Number.parseInt(match[1], 10),
      title: match[2].trim(),
      domain: match[3].trim(),
      url: match[4].trim(),
    })
  }
  return sources
}

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
  turnStatsConversationId: string | null // which conversation the turn stats belong to
  workingSessionId: string | null // which session is currently processing

  // Agent status detail & steps
  agentStatusDetail: string | null
  agentSteps: AgentStep[]

  // Task tracker (Claude Code–style work plan)
  currentTasks: import('@anton/protocol').TaskItem[]
  // Per-session task storage so tasks don't leak across conversations
  _sessionTasks: Map<string, import('@anton/protocol').TaskItem[]>

  // Session readiness tracking (race condition fix)
  _sessionResolvers: Map<string, () => void>

  // Current assistant message ID (for appending text across tool interruptions)
  _currentAssistantMsgId: string | null
  // Per-session assistant message tracking (for multi-conversation isolation)
  _sessionAssistantMsgIds: Map<string, string>
  // Track tool call IDs for tools with dedicated UI (ask_user, task_tracker, etc.)
  // so their tool_results can be silently discarded
  _hiddenToolCallIds: Set<string>
  // Map tool call IDs to their names so tool_results can inherit the toolName
  _toolCallNames: Map<string, { name: string; input?: Record<string, unknown> }>

  // Citations: maps assistant message ID → sources extracted from web_search
  citations: Map<string, CitationSource[]>
  _pendingCitationSourcesQueue: CitationSource[]
  _pendingWebSearchToolCallIds: Set<string>

  // Browser viewer
  browserState: {
    url: string
    title: string
    screenshot: string | null
    actions: Array<{ action: string; target?: string; value?: string; timestamp: number }>
    active: boolean
  } | null

  // Artifacts
  artifacts: Artifact[]
  activeArtifactId: string | null
  artifactPanelOpen: boolean
  artifactSearchQuery: string
  artifactFilterType: ArtifactRenderType | 'all'
  artifactViewMode: 'list' | 'detail'

  // Per-session status tracking
  sessionStatuses: Map<string, { status: AgentStatus; detail?: string }>

  // Session streaming & history tracking
  _activeStreamingSessions: Set<string>
  _sessionsNeedingHistoryRefresh: Set<string>
  // Sync-first protocol: sessions currently loading history from server
  _syncingSessionIds: Set<string>
  // Messages received while a session was still syncing (queued for replay)
  _pendingSyncMessages: Map<string, WsPayload[]>
  // Pagination: whether a session has older messages to load
  _sessionHasMore: Map<string, boolean>
  // Sessions currently loading older messages (scroll-up pagination)
  _loadingOlderSessions: Set<string>

  // Pending confirmation
  pendingConfirm: { id: string; command: string; reason: string; sessionId?: string } | null

  // Plan review
  pendingPlan: { id: string; title: string; content: string; sessionId?: string } | null
  sidePanelView: 'artifacts' | 'plan' | 'context' | 'browser'

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
  projectAgents: import('@anton/protocol').AgentSession[]
  projectAgentsLoading: boolean
  selectedAgentId: string | null
  agentRunLogs: import('@anton/protocol').AgentRunLogEntry[] | null
  agentRunLogsLoading: boolean
  activeView: 'chat' | 'projects' | 'terminal'

  // Usage stats (server-computed)
  usageStats: {
    totals: TokenUsage
    byModel: UsageStatsModelBreakdown[]
    byDay: UsageStatsDayBreakdown[]
    sessions: UsageStatsSessionEntry[]
  } | null
  usageStatsLoading: boolean

  // Connectors
  connectors: ConnectorStatusInfo[]
  connectorRegistry: ConnectorRegistryInfo[]

  // Theme
  theme: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark' | 'system') => void

  // Onboarding
  onboardingLoaded: boolean
  onboardingCompleted: boolean
  onboardingRole: string | null
  setOnboardingCompleted: (role?: string) => void

  // Dev Mode
  devMode: boolean
  setDevMode: (enabled: boolean) => void
  devModeData: { systemPrompt: string | null; memories: { name: string; content: string; scope?: string }[]; lastFetched: number }
  setDevModeData: (data: { systemPrompt?: string | null; memories?: { name: string; content: string; scope?: string }[] }) => void

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
  setProjectAgents: (agents: import('@anton/protocol').AgentSession[]) => void
  setSelectedAgent: (id: string | null) => void
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
  newConversation: (
    title?: string,
    sessionId?: string,
    projectId?: string,
    agentSessionId?: string,
  ) => string
  appendConversation: (title?: string, sessionId?: string, projectId?: string) => string
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (msg: ChatMessage) => void
  addMessageToSession: (sessionId: string, msg: ChatMessage) => void
  appendAssistantText: (content: string) => void
  appendAssistantTextToSession: (sessionId: string, content: string) => void
  replaceAssistantText: (search: string, replacement: string, sessionId?: string) => void
  getActiveConversation: () => Conversation | null
  getActiveAgentSession: () => import('@anton/protocol').AgentSession | null
  findConversationBySession: (sessionId: string) => Conversation | undefined
  loadSessionMessages: (sessionId: string, messages: ChatMessage[]) => void
  prependSessionMessages: (sessionId: string, messages: ChatMessage[]) => void
  requestSessionHistory: (sessionId: string) => void
  loadOlderMessages: (sessionId: string) => void
  updateConversationTitle: (sessionId: string, title: string) => void

  // Response model tracking
  setLastResponseModel: (provider: string, model: string) => void

  // Usage actions
  setUsage: (turn: TokenUsage | null, session: TokenUsage | null) => void
  requestUsageStats: () => void
  setUsageStats: (stats: AppState['usageStats']) => void

  // Agent status & steps actions
  setAgentStatusDetail: (detail: string | null) => void
  addAgentStep: (step: AgentStep) => void
  updateAgentStep: (id: string, updates: Partial<AgentStep>) => void
  clearAgentSteps: () => void

  // Session readiness actions
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void

  // Browser viewer actions
  setBrowserState: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: { action: string; target?: string; value?: string; timestamp: number }
    elementCount?: number
  }) => void
  clearBrowserState: () => void

  // Artifact actions
  addArtifact: (artifact: Artifact) => void
  setActiveArtifact: (id: string | null) => void
  setArtifactPanelOpen: (open: boolean) => void
  clearArtifacts: () => void
  setArtifactSearchQuery: (query: string) => void
  setArtifactFilterType: (type: ArtifactRenderType | 'all') => void
  setArtifactViewMode: (mode: 'list' | 'detail') => void
  updateArtifactPublishStatus: (artifactId: string, url: string, slug: string) => void

  // Confirm actions
  setPendingConfirm: (
    confirm: { id: string; command: string; reason: string; sessionId?: string } | null,
  ) => void

  // Plan actions
  setPendingPlan: (
    plan: { id: string; title: string; content: string; sessionId?: string } | null,
  ) => void
  setSidePanelView: (view: 'artifacts' | 'plan' | 'context' | 'browser') => void
  openContextPanel: () => void

  // Ask-user actions
  setPendingAskUser: (
    ask: { id: string; questions: AskUserQuestion[]; sessionId?: string } | null,
  ) => void

  // Update actions
  setAgentVersionInfo: (version: string, gitHash: string) => void
  setUpdateInfo: (info: UpdateInfo | null) => void
  setUpdateProgress: (stage: UpdateStage, message: string | null) => void
  dismissUpdate: () => void

  // Reset actions
  resetForDisconnect: () => void
  resetForMachineSwitch: () => void
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
  const activeConvModel = restoredActiveId ? persisted.find((c) => c.id === restoredActiveId) : null
  const initProvider = activeConvModel?.provider ?? savedModel?.provider ?? 'anthropic'
  const initModel = activeConvModel?.model ?? savedModel?.model ?? 'claude-sonnet-4-6'

  return {
    connectionStatus: 'disconnected',
    agentStatus: 'idle',
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
    turnStatsConversationId: null,
    workingSessionId: null,
    agentStatusDetail: null,
    agentSteps: [],
    currentTasks: [],
    _sessionTasks: new Map(),
    _sessionResolvers: new Map(),
    _currentAssistantMsgId: null,
    _sessionAssistantMsgIds: new Map(),
    _hiddenToolCallIds: new Set(),
    _toolCallNames: new Map(),
    citations: new Map(),
    _pendingCitationSourcesQueue: [],
    _pendingWebSearchToolCallIds: new Set(),
    browserState: null,
    artifacts: [],
    activeArtifactId: null,
    artifactPanelOpen: false,
    artifactSearchQuery: '',
    artifactFilterType: 'all' as const,
    artifactViewMode: 'list' as const,
    sessionStatuses: new Map(),
    _activeStreamingSessions: new Set(),
    _sessionsNeedingHistoryRefresh: new Set(),
    _syncingSessionIds: new Set(),
    _pendingSyncMessages: new Map(),
    _sessionHasMore: new Map(),
    _loadingOlderSessions: new Set(),
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
    projectAgents: [],
    projectAgentsLoading: false,
    selectedAgentId: null,
    agentRunLogs: null,
    agentRunLogsLoading: false,
    activeView: 'chat',

    // Usage stats
    usageStats: null,
    usageStatsLoading: false,

    // Connectors
    connectors: [],
    connectorRegistry: [],

    theme: (localStorage.getItem('anton-theme') as 'light' | 'dark' | 'system') || 'dark',
    resolvedTheme: (() => {
      const saved = localStorage.getItem('anton-theme') || 'dark'
      if (saved === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      return saved as 'light' | 'dark'
    })(),
    setTheme: (theme) => {
      localStorage.setItem('anton-theme', theme)
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme
      document.documentElement.setAttribute('data-theme', resolved)
      set({ theme, resolvedTheme: resolved })
    },

    onboardingLoaded: false,
    onboardingCompleted: false,
    onboardingRole: null,
    setOnboardingCompleted: (role?: string) => {
      set({ onboardingCompleted: true, onboardingRole: role ?? null })
      connection.send(Channel.CONTROL, {
        type: 'config_update',
        key: 'onboarding',
        value: { completed: true, role: role ?? undefined },
      })
    },

    devMode: localStorage.getItem('anton-devmode') === 'true',
    setDevMode: (enabled) => {
      localStorage.setItem('anton-devmode', String(enabled))
      set({ devMode: enabled })
      if (!enabled) {
        // Close dev panel if open
        const s = get()
        if (s.sidePanelView === 'devmode') {
          set({ artifactPanelOpen: false })
        }
      }
    },
    devModeData: { systemPrompt: null, memories: [], lastFetched: 0 },
    setDevModeData: (data) => set((s) => ({
      devModeData: {
        systemPrompt: data.systemPrompt !== undefined ? data.systemPrompt : s.devModeData.systemPrompt,
        memories: data.memories !== undefined ? data.memories : s.devModeData.memories,
        lastFetched: Date.now(),
      },
    })),

    sidebarCollapsed: false,
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setProjects: (projects) => {
      savePersistedProjects(projects)
      set({ projects })
    },
    setActiveProject: (id) => {
      saveActiveProjectId(id)
      set({
        activeProjectId: id,
        activeProjectSessionId: null,
        projectSessions: [],
        projectSessionsLoading: !!id,
        projectFiles: [],
        projectFilesLoading: !!id,
        projectAgents: [],
        projectAgentsLoading: !!id,
        selectedAgentId: null,
        agentRunLogs: null,
        agentRunLogsLoading: false,
      })
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
    setProjectSessions: (sessions) =>
      set({ projectSessions: sessions, projectSessionsLoading: false }),
    setProjectFiles: (files) => set({ projectFiles: files, projectFilesLoading: false }),
    setProjectAgents: (agents) => set({ projectAgents: agents, projectAgentsLoading: false }),
    setSelectedAgent: (id) => set({ selectedAgentId: id }),
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
            (c) => c.sessionId === state.activeProjectSessionId,
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
    removeConnector: (id) => set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) })),
    updateConnectorStatus: (id, updates) =>
      set((s) => ({
        connectors: s.connectors.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      })),
    setConnectorRegistry: (entries) => set({ connectorRegistry: entries }),

    setConnectionStatus: (status) => set({ connectionStatus: status }),
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
          currentTasks: [], // Clear previous turn's task list
          workingSessionId: sessionId || null,
        })

        // Safety net: if stuck in "working" for 5 min with no events, auto-recover
        ;(window as unknown as Record<string, unknown>).__stuckTimeout = window.setTimeout(
          () => {
            const current = get()
            if (current.agentStatus === 'working') {
              console.error(
                '[store] Stuck-state timeout: agent has been "working" for 5 minutes without completing. Auto-recovering to idle.',
              )
              set({ agentStatus: 'idle', workingSessionId: null, _currentAssistantMsgId: null })
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
          turnStatsConversationId: get().activeConversationId,
          workingSessionId: null,
        })
      } else {
        set({
          agentStatus: status,
          workingSessionId: status === 'working' ? sessionId || null : null,
        })
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
        return {
          currentSessionId: id,
          currentProvider: provider,
          currentModel: model,
          conversations,
        }
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

    newConversation: (title, sessionId, projectId, agentSessionId) => {
      const { currentProvider, currentModel } = get()
      const conv = createConversation(
        title,
        sessionId,
        projectId,
        currentProvider,
        currentModel,
        agentSessionId,
      )
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

      // Save current session's tasks before switching, then restore target session's tasks
      const currentState = get()
      const currentConv = currentState.conversations.find(
        (c) => c.id === currentState.activeConversationId,
      )
      if (currentConv?.sessionId && currentState.currentTasks.length > 0) {
        const sessionTasks = new Map(currentState._sessionTasks)
        sessionTasks.set(currentConv.sessionId, currentState.currentTasks)
        updates._sessionTasks = sessionTasks
      }
      // Restore target session's tasks (or clear if none)
      updates.currentTasks =
        (conv?.sessionId
          ? (updates._sessionTasks ?? currentState._sessionTasks).get(conv.sessionId)
          : undefined) ?? []

      // Close artifact panel when switching conversations
      updates.artifactPanelOpen = false

      // If this session completed a turn in the background, fetch fresh history
      if (conv?.sessionId && get()._sessionsNeedingHistoryRefresh.has(conv.sessionId)) {
        const needsRefresh = new Set(get()._sessionsNeedingHistoryRefresh)
        needsRefresh.delete(conv.sessionId)
        updates._sessionsNeedingHistoryRefresh = needsRefresh
        // Mark syncing and request history (will be set in a separate setState)
        const syncing = new Set(get()._syncingSessionIds)
        syncing.add(conv.sessionId)
        updates._syncingSessionIds = syncing
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
        // Associate pending citation sources with new assistant message
        const citationUpdate: Record<string, unknown> = {}
        if (newMsgId && state._pendingCitationSourcesQueue?.length > 0) {
          const newCitations = new Map(state.citations)
          newCitations.set(newMsgId, state._pendingCitationSourcesQueue)
          citationUpdate.citations = newCitations
          citationUpdate._pendingCitationSourcesQueue = []
        }
        return {
          conversations,
          ...(newMsgId ? { _currentAssistantMsgId: newMsgId } : {}),
          ...citationUpdate,
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
        // Associate pending citation sources with new assistant message
        const citationUpdate: Record<string, unknown> = {}
        if (newMsgId && state._pendingCitationSourcesQueue?.length > 0) {
          const newCitations = new Map(state.citations)
          newCitations.set(newMsgId, state._pendingCitationSourcesQueue)
          citationUpdate.citations = newCitations
          citationUpdate._pendingCitationSourcesQueue = []
        }
        return { conversations, ...citationUpdate }
      })
    },

    replaceAssistantText: (search, replacement, sessionId?) => {
      set((state) => {
        // Find the conversation — by sessionId or active
        const conv = sessionId
          ? state.conversations.find((c) => c.sessionId === sessionId)
          : state.conversations.find((c) => c.id === state.activeConversationId)
        if (!conv) return state

        // Find the current assistant message
        const targetId = sessionId
          ? state._sessionAssistantMsgIds.get(sessionId)
          : state._currentAssistantMsgId
        if (!targetId) return state

        const conversations = state.conversations.map((c) => {
          if (c.id !== conv.id) return c
          const messages = c.messages.map((m) => {
            if (m.id !== targetId) return m
            return { ...m, content: m.content.replace(search, replacement) }
          })
          return { ...c, messages, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return { conversations }
      })
    },

    getActiveConversation: () => {
      const { conversations, activeConversationId } = get()
      return conversations.find((c) => c.id === activeConversationId) || null
    },

    getActiveAgentSession: () => {
      const state = get()
      const conv = state.conversations.find((c) => c.id === state.activeConversationId)
      if (!conv?.agentSessionId) return null
      return state.projectAgents.find((a) => a.sessionId === conv.agentSessionId) ?? null
    },

    findConversationBySession: (sessionId) => {
      return get().conversations.find((c) => c.sessionId === sessionId)
    },

    loadSessionMessages: (sessionId, serverMessages) => {
      // Grab queued messages before clearing sync state
      const queuedMessages = get()._pendingSyncMessages.get(sessionId) ?? []

      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        // Server is always authoritative. Replace local state unconditionally.
        // This fixes sync issues where stale localStorage data diverged from
        // the server's persisted history (e.g. after client disconnect/reconnect).
        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, messages: serverMessages, updatedAt: Date.now() }
        })
        saveConversations(conversations)

        // Clear syncing flag and pending queue — history has been loaded
        const syncing = new Set(state._syncingSessionIds)
        syncing.delete(sessionId)
        const pending = new Map(state._pendingSyncMessages)
        pending.delete(sessionId)

        return { conversations, _syncingSessionIds: syncing, _pendingSyncMessages: pending }
      })

      // Replay any messages that arrived while we were syncing
      if (queuedMessages.length > 0) {
        console.log(`[Sync] Replaying ${queuedMessages.length} queued messages for ${sessionId}`)
        for (const queued of queuedMessages) {
          handleWsMessage(Channel.AI, queued)
        }
      }
    },

    requestSessionHistory: (sessionId) => {
      // Mark session as syncing and send the request.
      // While syncing, incoming streaming messages are queued.
      set((state) => {
        const syncing = new Set(state._syncingSessionIds)
        syncing.add(sessionId)
        return { _syncingSessionIds: syncing }
      })
      connection.sendSessionHistory(sessionId)

      // Safety timeout: clear syncing flag if server never responds
      // (e.g. session not found, error response instead of history)
      setTimeout(() => {
        const state = get()
        if (state._syncingSessionIds.has(sessionId)) {
          console.warn(`[Sync] Timeout for ${sessionId}, clearing sync flag`)
          const syncing = new Set(state._syncingSessionIds)
          syncing.delete(sessionId)
          const pending = new Map(state._pendingSyncMessages)
          const queued = pending.get(sessionId) ?? []
          pending.delete(sessionId)
          set({ _syncingSessionIds: syncing, _pendingSyncMessages: pending })
          // Replay any queued messages
          for (const msg of queued) {
            handleWsMessage(Channel.AI, msg)
          }
        }
      }, 5000)
    },

    prependSessionMessages: (sessionId, olderMessages) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        // Prepend older messages, avoiding duplicates by seq-based ID
        const existingIds = new Set(conv.messages.map((m) => m.id))
        const newMessages = olderMessages.filter((m) => !existingIds.has(m.id))
        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, messages: [...newMessages, ...c.messages], updatedAt: Date.now() }
        })
        saveConversations(conversations)

        // Clear loading flag
        const loading = new Set(state._loadingOlderSessions)
        loading.delete(sessionId)
        return { conversations, _loadingOlderSessions: loading }
      })
    },

    loadOlderMessages: (sessionId) => {
      const state = get()
      // Don't load if already loading or no more messages
      if (state._loadingOlderSessions.has(sessionId)) return
      if (state._sessionHasMore.get(sessionId) === false) return

      const conv = state.conversations.find((c) => c.sessionId === sessionId)
      if (!conv || conv.messages.length === 0) return

      // Find the lowest seq in current messages to paginate before it
      // Message IDs are like hist_3_..., tc_xxx, tr_xxx — extract seq from hist_ prefix
      let minSeq = Number.MAX_SAFE_INTEGER
      for (const m of conv.messages) {
        const match = m.id.match(/^hist_(\d+)_/)
        if (match) {
          minSeq = Math.min(minSeq, Number.parseInt(match[1], 10))
        }
      }
      if (minSeq === Number.MAX_SAFE_INTEGER) return

      set((state) => {
        const loading = new Set(state._loadingOlderSessions)
        loading.add(sessionId)
        return { _loadingOlderSessions: loading }
      })

      connection.sendSessionHistory(sessionId, { before: minSeq, limit: 200 })
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

    requestUsageStats: () => {
      set({ usageStatsLoading: true })
      connection.send(Channel.AI, { type: 'usage_stats' })
    },
    setUsageStats: (stats) => set({ usageStats: stats, usageStatsLoading: false }),

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
        }
      }),

    setActiveArtifact: (id) => set({ activeArtifactId: id }),

    setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),

    setBrowserState: (state) => {
      const current = get().browserState
      const actions = current?.actions ?? []
      // Keep last 50 actions
      const newActions = [...actions, state.lastAction].slice(-50)
      set({
        browserState: {
          url: state.url,
          title: state.title,
          screenshot: state.screenshot ?? current?.screenshot ?? null,
          actions: newActions,
          active: true,
        },
      })
    },

    clearBrowserState: () => set({ browserState: null }),

    clearArtifacts: () => set({ artifacts: [], activeArtifactId: null, artifactPanelOpen: false }),

    setArtifactSearchQuery: (query) => set({ artifactSearchQuery: query }),
    setArtifactFilterType: (type) => set({ artifactFilterType: type }),
    setArtifactViewMode: (mode) => set({ artifactViewMode: mode }),

    updateArtifactPublishStatus: (artifactId, url, slug) =>
      set((state) => ({
        artifacts: state.artifacts.map((a) =>
          a.id === artifactId
            ? { ...a, publishedUrl: url, publishedSlug: slug, publishedAt: Date.now() }
            : a,
        ),
      })),

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
      const { updateStage, updateInfo, updateMessage } = get()
      const isUpdating = updateStage === 'restarting'

      set({
        // KEEP: conversations, activeConversationId — user's chat history persists
        // KEEP: projects, activeProjectId — project context persists
        // KEEP: activeView — don't reset navigation
        // KEEP: update state if agent is restarting for an update (expected disconnect)

        // Clear transient session/connection state
        currentSessionId: null,
        sessions: [],
        agentStatus: 'idle',
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
        turnStatsConversationId: null,
        lastResponseProvider: null,
        lastResponseModel: null,
        providers: [],
        agentVersion: null,
        agentGitHash: null,
        updateInfo: isUpdating ? updateInfo : null,
        updateStage: isUpdating ? updateStage : null,
        updateMessage: isUpdating ? updateMessage : null,
        updateDismissed: false,
        projectSessions: [],
        projectSessionsLoading: false,
        projectFiles: [],
        projectFilesLoading: false,
        projectAgents: [],
        projectAgentsLoading: false,
        selectedAgentId: null,
        // Clear stale streaming/sync state so reconnection doesn't think
        // old sessions are still streaming (which would block history sync)
        _activeStreamingSessions: new Set(),
        _sessionsNeedingHistoryRefresh: new Set(),
        _syncingSessionIds: new Set(),
        _pendingSyncMessages: new Map(),
        _sessionHasMore: new Map(),
        _loadingOlderSessions: new Set(),
      })
      // DO NOT clear conversations or active conversation — preserve chat history
      // On reconnect, session_history will sync the server's persisted state
    },

    resetForMachineSwitch: () => {
      // Full flush when switching to a different machine.
      // The new server will re-sync its sessions on connect.
      set({
        conversations: [],
        activeConversationId: null,
        currentSessionId: null,
        sessions: [],
        projects: [],
        activeProjectId: null,
        activeView: 'chat',
        agentStatus: 'idle',
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
        turnStatsConversationId: null,
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
        projectAgents: [],
        projectAgentsLoading: false,
        selectedAgentId: null,
        _activeStreamingSessions: new Set(),
        _sessionsNeedingHistoryRefresh: new Set(),
        _syncingSessionIds: new Set(),
        _pendingSyncMessages: new Map(),
        _sessionHasMore: new Map(),
        _loadingOlderSessions: new Set(),
      })
    },
  }
})

// ── Wire connection events to store ─────────────────────────────────

connection.onStatusChange((status) => {
  useStore.getState().setConnectionStatus(status)
})

// ── WS message type interfaces ─────────────────────────────────────
function handleWsMessage(channel: number, msg: WsPayload) {
  const store = useStore.getState()

  // Debug logging for all messages
  console.log(`[WS] ch=${channel} type=${msg.type}`, msg)

  // ── CONTROL channel: auth_ok version info + update messages ──
  if (channel === Channel.CONTROL) {
    if (msg.type === 'auth_ok') {
      const m = msg as unknown as WsAuthOk
      store.setAgentVersionInfo(m.version || '', m.gitHash || '')

      // Reconnected after an update restart — mark update as done
      if (store.updateStage === 'restarting') {
        store.setUpdateProgress('done', `Updated to v${m.version}`)
        store.setUpdateInfo({
          currentVersion: m.version,
          latestVersion: m.version,
          updateAvailable: false,
          changelog: store.updateInfo?.changelog ?? null,
          releaseUrl: store.updateInfo?.releaseUrl ?? null,
        })
      } else if (m.updateAvailable) {
        // If agent already knows about an update, store it
        store.setUpdateInfo({
          currentVersion: m.version,
          latestVersion: m.updateAvailable.version,
          updateAvailable: true,
          changelog: m.updateAvailable.changelog,
          releaseUrl: m.updateAvailable.releaseUrl,
        })
      }
    } else if (msg.type === 'update_check_response') {
      const m = msg as unknown as WsUpdateCheckResponse
      store.setUpdateInfo({
        currentVersion: m.currentVersion,
        latestVersion: m.latestVersion,
        updateAvailable: m.updateAvailable,
        changelog: m.changelog,
        releaseUrl: m.releaseUrl,
      })
    } else if (msg.type === 'update_progress') {
      const m = msg as unknown as WsUpdateProgress
      store.setUpdateProgress(m.stage, m.message)
    } else if (msg.type === 'config_query_response') {
      const m = msg as { key: string; value: unknown }
      if (m.key === 'system_prompt' && typeof m.value === 'string') {
        store.setDevModeData({ systemPrompt: m.value })
      } else if (m.key === 'memories' && Array.isArray(m.value)) {
        store.setDevModeData({ memories: m.value as { name: string; content: string; scope?: string }[] })
      }
    }
    // Don't return — let other control messages fall through for ping/pong etc.
  }

  // ── EVENTS channel: job events ──
  if (channel === Channel.EVENTS && msg.type === 'job_event') {
    const m = msg as unknown as WsJobEvent
    // Refresh job list when a job state changes
    if (m.projectId === store.activeProjectId) {
      connection.sendAgentsList(m.projectId)
    }
    return
  }

  // ── EVENTS channel: agent status + update notifications ──
  if (channel === Channel.EVENTS && msg.type === 'update_available') {
    const m = msg as unknown as WsUpdateAvailable
    store.setUpdateInfo({
      currentVersion: m.currentVersion,
      latestVersion: m.latestVersion,
      updateAvailable: true,
      changelog: m.changelog,
      releaseUrl: m.releaseUrl,
    })
    return
  }

  if (channel === Channel.EVENTS && msg.type === 'agent_status') {
    const m = msg as unknown as WsAgentStatusMsg
    console.log(`[WS] Agent status: ${m.status}`, m.detail || '', m.sessionId || '')
    const sid: string | undefined = m.sessionId

    // Update per-session status map
    if (sid) {
      const statuses = new Map(store.sessionStatuses)
      statuses.set(sid, { status: m.status, detail: m.detail })
      useStore.setState({ sessionStatuses: statuses })
    }

    // Update global status ONLY for the active session — never let background agent runs
    // affect the UI of unrelated conversations
    const activeConv = store.getActiveConversation()
    if (sid === activeConv?.sessionId) {
      store.setAgentStatus(m.status, sid)
      store.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
        store.clearAgentSteps()
      }
    } else if (!sid) {
      // Legacy path: no sessionId means it's for the active session
      store.setAgentStatus(m.status)
      store.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
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
  const msgSessionId: string | undefined = msg.sessionId as string | undefined
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

  // ── Sync-first gate ─────────────────────────────────────────
  // If this session is still loading history from the server, queue streaming
  // messages so they appear AFTER the full history has been loaded.
  // Exceptions: session_history_response (the sync itself), done, error, tasks_update
  const syncExempt = new Set([
    'session_history_response',
    'sessions_list_response',
    'session_created',
    'session_destroyed',
    'context_info',
    'usage_stats_response',
    'project_sessions_list_response',
    'providers_list_response',
  ])
  if (msgSessionId && store._syncingSessionIds.has(msgSessionId) && !syncExempt.has(msg.type)) {
    // Queue this message for replay after history loads
    const pending = new Map(store._pendingSyncMessages)
    const queue = pending.get(msgSessionId) ?? []
    queue.push(msg)
    pending.set(msgSessionId, queue)
    useStore.setState({ _pendingSyncMessages: pending })
    console.log(`[Sync] Queued ${msg.type} for ${msgSessionId} (syncing)`)
    return
  }

  switch (msg.type) {
    // ── Steering ack — user message sent while agent was working ──
    case 'steer_ack': {
      const m = msg as unknown as WsSteerAck
      addMsg({
        id: `steer_${Date.now()}`,
        role: 'user',
        content: m.content,
        timestamp: Date.now(),
        isSteering: true,
      })
      break
    }

    // ── Chat messages ──────────────────────────────────────────
    case 'text': {
      const m = msg as unknown as WsText
      const textContent = m.content ?? ''
      if (!textContent) break
      console.log(`[WS] AI text chunk: "${textContent.slice(0, 80)}..."`)
      // Track that this session is actively streaming
      const textSessionId = msgSessionId || activeConv?.sessionId
      if (textSessionId && !store._activeStreamingSessions.has(textSessionId)) {
        const streaming = new Set(store._activeStreamingSessions)
        streaming.add(textSessionId)
        useStore.setState({ _activeStreamingSessions: streaming })
      }
      appendText(textContent)
      break
    }

    case 'thinking': {
      const m = msg as unknown as WsThinking
      addMsg({
        id: `think_${Date.now()}`,
        role: 'system',
        content: m.text,
        timestamp: Date.now(),
      })
      store.setAgentStatus('working', msgSessionId)
      break
    }

    case 'text_replace': {
      const m = msg as unknown as WsTextReplace
      // Strip internal tags from the displayed message
      if (m.remove) {
        store.replaceAssistantText(m.remove, '', msgSessionId)
      }
      break
    }

    case 'tool_call': {
      const m = msg as unknown as WsToolCall
      // Tools with dedicated UI — don't pollute the message timeline
      const uiOnlyTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      if (uiOnlyTools.has(m.name)) {
        // Track the ID so we can skip its tool_result too
        store._hiddenToolCallIds = store._hiddenToolCallIds || new Set()
        store._hiddenToolCallIds.add(m.id)
        store.setAgentStatus('working', msgSessionId)
        break
      }
      // Reset assistant message tracking so any text AFTER this tool call
      // creates a new assistant bubble (shows reasoning between tool groups)
      if (!m.parentToolCallId) {
        if (isForActiveSession) {
          useStore.setState({ _currentAssistantMsgId: null })
        } else if (msgSessionId) {
          store._sessionAssistantMsgIds.delete(msgSessionId)
        }
      }
      // Track tool name so tool_result can inherit it
      store._toolCallNames.set(m.id, { name: m.name, input: m.input })
      addMsg({
        id: `tc_${m.id}`,
        role: 'tool',
        content: `Running: ${m.name}`,
        toolName: m.name,
        toolInput: m.input,
        timestamp: Date.now(),
        parentToolCallId: m.parentToolCallId,
      })
      // Track web_search calls for citation extraction
      if (m.name === 'web_search') {
        store._pendingWebSearchToolCallIds.add(m.id)
      }
      if (!m.parentToolCallId) {
        store.addAgentStep({
          id: m.id,
          type: 'tool_call',
          label: `Running: ${m.name}`,
          toolName: m.name,
          status: 'active',
          timestamp: Date.now(),
        })
      }
      store.setAgentStatus('working', msgSessionId)
      break
    }

    case 'tool_result': {
      const m = msg as unknown as WsToolResult
      // Skip results for tools with dedicated UI
      if (store._hiddenToolCallIds?.has(m.id)) {
        store._hiddenToolCallIds.delete(m.id)
        break
      }
      // Inherit toolName/toolInput from matching tool_call
      const callInfo = store._toolCallNames.get(m.id)
      const resultMsg: ChatMessage = {
        id: `tr_${m.id}`,
        role: 'tool',
        content: m.output,
        isError: m.isError,
        timestamp: Date.now(),
        parentToolCallId: m.parentToolCallId,
        ...(callInfo && { toolName: callInfo.name, toolInput: callInfo.input }),
      }
      store._toolCallNames.delete(m.id)
      addMsg(resultMsg)
      // Extract citation sources from web_search results
      if (store._pendingWebSearchToolCallIds.has(m.id)) {
        store._pendingWebSearchToolCallIds.delete(m.id)
        if (!m.isError) {
          const sources = parseCitationSources(m.output)
          if (sources.length > 0) {
            store._pendingCitationSourcesQueue = sources
          }
        }
      }
      if (!m.parentToolCallId) {
        store.updateAgentStep(m.id, {
          status: m.isError ? 'error' : 'complete',
        })
      }

      break
    }

    // ── Sub-agent lifecycle ──────────────────────────────────────
    case 'sub_agent_start': {
      const m = msg as unknown as WsSubAgentStart
      addMsg({
        id: `sa_start_${m.toolCallId}`,
        role: 'tool',
        content: m.task,
        toolName: 'sub_agent',
        toolInput: { task: m.task },
        timestamp: Date.now(),
      })
      break
    }

    case 'sub_agent_end': {
      const m = msg as unknown as WsSubAgentEnd
      addMsg({
        id: `sa_end_${m.toolCallId}`,
        role: 'tool',
        content: m.success ? 'Sub-agent completed' : 'Sub-agent failed',
        isError: !m.success,
        timestamp: Date.now(),
        parentToolCallId: m.toolCallId,
      })
      break
    }

    case 'sub_agent_progress': {
      const m = msg as unknown as WsSubAgentProgress
      // Live progress text from sub-agent — rendered inside SubAgentGroup pill
      addMsg({
        id: `sa_progress_${m.toolCallId}_${Date.now()}`,
        role: 'assistant',
        content: m.content,
        timestamp: Date.now(),
        parentToolCallId: m.toolCallId,
      })
      break
    }

    case 'artifact': {
      const m = msg as unknown as WsArtifact
      // Server-side artifact detection — add directly to store
      store.addArtifact({
        id: m.id,
        type: m.artifactType,
        renderType: m.renderType,
        title: m.title,
        filename: m.filename,
        filepath: m.filepath,
        language: m.language || '',
        content: m.content,
        toolCallId: `tc_${m.toolCallId}`,
        timestamp: Date.now(),
        conversationId: store.activeConversationId || undefined,
        projectId: store.activeProjectId || undefined,
      })
      break
    }

    case 'publish_artifact_response': {
      const m = msg as unknown as WsPublishArtifactResponse
      if (m.success && m.artifactId) {
        store.updateArtifactPublishStatus(m.artifactId, m.publicUrl, m.slug)
      }
      break
    }

    case 'confirm': {
      const m = msg as unknown as WsConfirm
      store.setPendingConfirm({
        id: m.id,
        command: m.command,
        reason: m.reason,
        sessionId: msgSessionId,
      })
      break
    }

    case 'plan_confirm': {
      const m = msg as unknown as WsPlanConfirm
      store.setPendingPlan({
        id: m.id,
        title: m.title,
        content: m.content,
        sessionId: msgSessionId,
      })
      break
    }

    case 'ask_user': {
      const m = msg as unknown as WsAskUser
      store.setPendingAskUser({
        id: m.id,
        questions: m.questions,
        sessionId: msgSessionId,
      })
      break
    }

    case 'error': {
      const m = msg as unknown as WsError
      // Clear syncing flag if this error is for a session we're waiting on
      if (msgSessionId && store._syncingSessionIds.has(msgSessionId)) {
        const syncing = new Set(store._syncingSessionIds)
        syncing.delete(msgSessionId)
        const pending = new Map(store._pendingSyncMessages)
        pending.delete(msgSessionId)
        useStore.setState({ _syncingSessionIds: syncing, _pendingSyncMessages: pending })
      }

      // Session permanently gone — remove the stale conversation from the sidebar
      if (m.code === 'session_not_found' && msgSessionId) {
        const staleConv = store.conversations.find((c) => c.sessionId === msgSessionId)
        if (staleConv) {
          store.deleteConversation(staleConv.id)
        }
        break
      }

      // Only add error messages to a conversation if we know which session it belongs to.
      // Errors without sessionId are non-session-scoped (project ops, connector ops, etc.)
      // and should NOT be dumped into whatever conversation happens to be active.
      if (msgSessionId) {
        addMsg({
          id: `err_${Date.now()}`,
          role: 'system',
          content: m.message,
          isError: true,
          timestamp: Date.now(),
        })
      } else {
        console.warn(
          '[WS] Received error without sessionId, not adding to conversation:',
          m.message,
        )
      }
      // Only set global error status if this error belongs to the active session
      if (isForActiveSession && msgSessionId) {
        store.setAgentStatus('error', msgSessionId)
      }
      // Clear streaming flag on error
      const errSessionId = msgSessionId || activeConv?.sessionId
      if (errSessionId && store._activeStreamingSessions.has(errSessionId)) {
        const streaming = new Set(store._activeStreamingSessions)
        streaming.delete(errSessionId)
        useStore.setState({ _activeStreamingSessions: streaming })
      }
      break
    }

    case 'title_update': {
      const m = msg as unknown as WsTitleUpdate
      console.log('[WS] title_update received:', { sessionId: m.sessionId, title: m.title })
      if (m.sessionId) {
        const matchingConv = store.findConversationBySession(m.sessionId)
        console.log(
          '[WS] title_update matching conv:',
          matchingConv?.id,
          matchingConv?.sessionId,
          matchingConv?.title,
        )
        store.updateConversationTitle(m.sessionId, m.title)
        // Also update projectSessions so sidebar reflects the new title
        if (store.projectSessions.some((s: SessionMeta) => s.id === m.sessionId)) {
          store.setProjectSessions(
            store.projectSessions.map((s: SessionMeta) =>
              s.id === m.sessionId ? { ...s, title: m.title } : s,
            ),
          )
        }
      } else {
        console.warn('[WS] title_update has no sessionId, skipping')
      }
      break
    }

    case 'tasks_update': {
      const m = msg as unknown as WsTasksUpdate
      if (m.tasks) {
        // Always store tasks per-session so they persist across conversation switches
        if (msgSessionId) {
          const sessionTasks = new Map(store._sessionTasks)
          sessionTasks.set(msgSessionId, m.tasks)
          const updates: Partial<AppState> = { _sessionTasks: sessionTasks }
          // Only update the visible currentTasks if this is the active session
          if (isForActiveSession) {
            updates.currentTasks = m.tasks
          }
          useStore.setState(updates)
        } else if (isForActiveSession) {
          useStore.setState({ currentTasks: m.tasks })
        }
      }
      break
    }

    case 'browser_state': {
      const m = msg as unknown as WsBrowserState
      if (isForActiveSession) {
        const wasActive = store.browserState?.active
        store.setBrowserState({
          url: m.url,
          title: m.title,
          screenshot: m.screenshot,
          lastAction: m.lastAction,
          elementCount: m.elementCount,
        })
        // Auto-open browser viewer on first browser event
        if (!wasActive) {
          store.setSidePanelView('browser')
          useStore.setState({ artifactPanelOpen: true })
        }
      }
      break
    }

    case 'browser_close': {
      if (isForActiveSession) {
        store.clearBrowserState()
      }
      break
    }

    case 'token_update': {
      const m = msg as unknown as WsTokenUpdate
      // Streaming token update — update turnUsage live so the UI can show a counter
      if (isForActiveSession && m.usage) {
        store.setUsage(m.usage, null)
      }
      break
    }

    case 'done': {
      const m = msg as unknown as WsDone
      // Detect silent failures: server says "done" but never sent any text/tool events
      const doneConv = msgSessionId
        ? store.findConversationBySession(msgSessionId)
        : store.getActiveConversation()
      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = store.agentStatus === 'working'
      const noResponse = wasWorking && lastMsg?.role === 'user'
      const zeroTokens = m.usage && m.usage.inputTokens === 0 && m.usage.outputTokens === 0

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

      // Only update global status if this is the active session
      if (isForActiveSession || !msgSessionId) {
        store.setAgentStatus('idle')
        store.clearAgentSteps()
        store.setAgentStatusDetail(null)
      }
      // Background sessions finishing should NOT affect the active session's UI

      // Close out any pending tool calls that never got a result.
      // This prevents spinner icons from staying stuck forever.
      if (doneConv) {
        const resultIds = new Set(
          doneConv.messages.filter((m) => m.id.startsWith('tr_')).map((m) => m.id.slice(3)),
        )
        const pendingCalls = doneConv.messages.filter(
          (m) => m.id.startsWith('tc_') && !resultIds.has(m.id.slice(3)),
        )
        if (pendingCalls.length > 0) {
          for (const call of pendingCalls) {
            const baseId = call.id.slice(3) // strip tc_ prefix
            addMsg({
              id: `tr_${baseId}`,
              role: 'tool',
              content: '',
              timestamp: Date.now(),
              parentToolCallId: call.parentToolCallId,
            })
          }
        }
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

      if (m.usage) {
        store.setUsage(m.usage, m.cumulativeUsage || null)
      }
      // Track the actual model used for this turn (display only)
      if (m.provider && m.model) {
        try {
          useStore.setState({ lastResponseProvider: m.provider, lastResponseModel: m.model })
        } catch {
          /* ignore during HMR transitions */
        }
      }
      break
    }

    // ── Session responses ──────────────────────────────────────
    case 'session_created': {
      const m = msg as unknown as WsSessionCreated
      // Session created — update session ID and persist model on the conversation.
      // The server echoes back the actual provider/model being used for this session.
      // Update currentProvider/currentModel since this is a fresh session the user just created.
      store.setCurrentSession(m.id, m.provider, m.model)
      store.resolvePendingSession(m.id)
      break
    }

    case 'context_info': {
      const m = msg as unknown as WsContextInfo
      // Store context info on the conversation linked to this session
      const convs = store.conversations.map((c: Conversation) =>
        c.sessionId === m.sessionId
          ? {
              ...c,
              contextInfo: {
                globalMemories: m.globalMemories || [],
                conversationMemories: m.conversationMemories || [],
                crossConversationMemories: m.crossConversationMemories || [],
                projectId: m.projectId,
              },
            }
          : c,
      )
      saveConversations(convs as Conversation[])
      useStore.setState({ conversations: convs as Conversation[] })
      break
    }

    case 'sessions_list_response': {
      const m = msg as unknown as WsSessionsListResponse
      store.setSessions(m.sessions)
      break
    }

    case 'usage_stats_response': {
      const m = msg as unknown as WsUsageStatsResponse
      store.setUsageStats({
        totals: m.totals,
        byModel: m.byModel,
        byDay: m.byDay,
        sessions: m.sessions,
      })
      break
    }

    case 'session_history_response': {
      const m = msg as unknown as WsSessionHistoryResponse
      // Convert server history entries to ChatMessage format
      type HistoryEntry = {
        seq: number
        role: string
        content: string
        ts: number
        toolName?: string
        toolInput?: Record<string, unknown>
        toolId?: string
        isError?: boolean
        attachments?: ChatImageAttachment[]
      }
      // Tools with dedicated UI — collect their IDs so we can filter them out
      // and render Q&A summaries instead
      const uiOnlyHistoryTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      const hiddenHistoryIds = new Set<string>()
      for (const entry of m.messages as HistoryEntry[]) {
        if (
          entry.role === 'tool_call' &&
          entry.toolName &&
          uiOnlyHistoryTools.has(entry.toolName) &&
          entry.toolId
        ) {
          hiddenHistoryIds.add(entry.toolId)
        }
      }

      // Build ask_user Q&A summary messages from tool_result content
      const askUserSummaries: ChatMessage[] = []
      for (const entry of m.messages as HistoryEntry[]) {
        if (entry.role === 'tool_result' && entry.toolId && hiddenHistoryIds.has(entry.toolId)) {
          // Find the matching tool_call to check if it's ask_user
          const call = (m.messages as HistoryEntry[]).find(
            (e: HistoryEntry) => e.role === 'tool_call' && e.toolId === entry.toolId,
          )
          if (call?.toolName === 'ask_user' && entry.content) {
            try {
              const answers = JSON.parse(entry.content)
              const summary = Object.entries(answers)
                .map(([q, a]) => `**${q}** → ${a}`)
                .join('\n')
              if (summary) {
                askUserSummaries.push({
                  id: `askuser_hist_${entry.toolId}`,
                  role: 'system',
                  content: summary,
                  timestamp: entry.ts,
                })
              }
            } catch {
              /* not valid JSON, skip */
            }
          }
        }
      }

      const historyMessages: ChatMessage[] = (m.messages as HistoryEntry[])
        .filter((entry: HistoryEntry) => {
          // Skip tools with dedicated UI
          if (entry.toolId && hiddenHistoryIds.has(entry.toolId)) return false
          return true
        })
        .map((entry: HistoryEntry) => {
          // Use tc_/tr_ prefixed IDs for tool messages so groupMessages can match
          // tool_calls with their corresponding tool_results by base ID.
          let id: string
          if (entry.role === 'tool_call' && entry.toolId) {
            id = `tc_${entry.toolId}`
          } else if (entry.role === 'tool_result' && entry.toolId) {
            id = `tr_${entry.toolId}`
          } else {
            id = `hist_${entry.seq}_${Date.now()}`
          }
          return {
            id,
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
          } as ChatMessage
        })
      // Insert ask_user Q&A summaries into the history
      const allMessages = [...historyMessages, ...askUserSummaries].sort(
        (a, b) => a.timestamp - b.timestamp,
      )
      // Determine if this is a first page (sync) or an older-page (scroll-up pagination)
      const isFirstPage = !store._loadingOlderSessions.has(m.id)

      // Update hasMore for this session
      const hasMoreMap = new Map(store._sessionHasMore)
      hasMoreMap.set(m.id, (m.hasMore ?? false) as boolean)
      useStore.setState({ _sessionHasMore: hasMoreMap })

      if (isFirstPage) {
        // First page: replace messages (server authoritative)
        store.loadSessionMessages(m.id, allMessages)
      } else {
        // Older page: prepend to existing messages
        store.prependSessionMessages(m.id, allMessages)
      }

      // Use server-sent artifacts if available (first page includes all artifacts)
      if (m.artifacts && Array.isArray(m.artifacts) && m.artifacts.length > 0) {
        store.clearArtifacts()
        for (const _a of m.artifacts as unknown[]) {
          const a = _a as {
            id: string
            type: string
            renderType: string
            title?: string
            filename?: string
            filepath?: string
            language?: string
            content: string
            toolCallId: string
          }
          store.addArtifact({
            id: a.id,
            type: a.type as 'file' | 'output' | 'artifact',
            renderType: a.renderType as import('./artifacts.js').ArtifactRenderType,
            title: a.title,
            filename: a.filename,
            filepath: a.filepath,
            language: (a.language as string) || '',
            content: a.content,
            toolCallId: a.toolCallId,
            timestamp: Date.now(),
          })
        }
      } else if (isFirstPage) {
        // Fallback: reconstruct artifacts from messages (backward compat)
        store.clearArtifacts()
        const toolCalls = new Map<string, ChatMessage>()
        for (const m of historyMessages) {
          if (m.id.startsWith('tc_') && m.toolName) {
            toolCalls.set(m.id.slice(3), m)
          }
        }
        for (const m of historyMessages) {
          if (m.id.startsWith('tr_')) {
            const baseId = m.id.slice(3)
            const call = toolCalls.get(baseId)
            if (call && !m.isError) {
              const artifact = extractArtifact(call, m)
              if (artifact) {
                store.addArtifact(artifact)
              }
            }
          }
        }
      }

      // Reconstruct citations from web_search tool results in history
      {
        const citToolCalls = new Map<string, ChatMessage>()
        for (const m of historyMessages) {
          if (m.id.startsWith('tc_') && m.toolName) {
            citToolCalls.set(m.id.slice(3), m)
          }
        }
        const newCitations = new Map(store.citations)
        let pendingSources: CitationSource[] = []
        for (const m of allMessages) {
          if (m.id.startsWith('tr_')) {
            const baseId = m.id.slice(3)
            const call = citToolCalls.get(baseId)
            if (call?.toolName === 'web_search' && !m.isError) {
              const sources = parseCitationSources(m.content)
              if (sources.length > 0) pendingSources = sources
            }
          } else if (m.role === 'assistant' && pendingSources.length > 0) {
            newCitations.set(m.id, pendingSources)
            pendingSources = []
          }
        }
        if (newCitations.size > store.citations.size) {
          useStore.setState({ citations: newCitations })
        }
      }
      break
    }

    case 'session_destroyed': {
      const m = msg as unknown as WsSessionDestroyed
      store.setSessions(store.sessions.filter((s: SessionMeta) => s.id !== m.id))
      // Also remove from projectSessions so project view updates immediately
      if (store.projectSessions.some((s: SessionMeta) => s.id === m.id)) {
        store.setProjectSessions(store.projectSessions.filter((s: SessionMeta) => s.id !== m.id))
      }
      break
    }

    // ── Provider responses ─────────────────────────────────────
    case 'providers_list_response': {
      const m = msg as unknown as WsProvidersListResponse
      store.setProviders(m.providers, m.defaults)
      useStore.setState({
        onboardingLoaded: true,
        onboardingCompleted: !!m.onboarding?.completed,
        onboardingRole: m.onboarding?.role ?? null,
      })
      break
    }

    case 'provider_set_key_response':
      if (msg.success as boolean) connection.sendProvidersList()
      break

    case 'provider_set_models_response':
      if (msg.success as boolean) connection.sendProvidersList()
      break

    case 'provider_set_default_response': {
      const m = msg as unknown as WsProviderSetDefaultResponse
      if (m.success) {
        store.setCurrentSession(store.currentSessionId || '', m.provider, m.model)
      }
      break
    }

    // ── Compaction ──────────────────────────────────────────────
    case 'compaction_start':
      addMsg({
        id: `compact_${Date.now()}`,
        role: 'system',
        content: 'Compacting context...',
        timestamp: Date.now(),
      })
      break

    case 'compaction_complete': {
      const m = msg as unknown as WsCompactionComplete
      addMsg({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${m.compactedMessages} messages summarized (compaction #${m.totalCompactions})`,
        timestamp: Date.now(),
      })
      break
    }

    // ── Project responses ──────────────────────────────────────
    case 'project_created': {
      const m = msg as unknown as WsProjectCreated
      store.addProject(m.project)
      store.setActiveProject(m.project.id)
      connection.sendProjectSessionsList(m.project.id)
      break
    }

    case 'projects_list_response': {
      const m = msg as unknown as WsProjectsListResponse
      store.setProjects(m.projects)
      break
    }

    case 'project_updated': {
      const m = msg as unknown as WsProjectUpdated
      store.updateProject(m.project.id, m.project)
      break
    }

    case 'project_deleted': {
      const m = msg as unknown as WsProjectDeleted
      store.removeProject(m.id)
      break
    }

    case 'project_files_list_response': {
      const m = msg as unknown as WsProjectFilesListResponse
      if (m.projectId === store.activeProjectId) {
        store.setProjectFiles(m.files)
      }
      break
    }

    case 'project_sessions_list_response': {
      const m = msg as unknown as WsProjectSessionsListResponse
      if (m.projectId === store.activeProjectId) {
        store.setProjectSessions(m.sessions)
      }
      break
    }

    // ── Agent responses ──────────────────────────────────────────
    case 'agents_list_response': {
      const m = msg as unknown as WsAgentsListResponse
      if (m.projectId === store.activeProjectId) {
        store.setProjectAgents(m.agents)
      }
      break
    }

    case 'agent_created': {
      const m = msg as unknown as WsAgentCreated
      const agents = [...store.projectAgents]
      const idx = agents.findIndex((a) => a.sessionId === m.agent.sessionId)
      if (idx >= 0) agents[idx] = m.agent
      else agents.push(m.agent)
      store.setProjectAgents(agents)
      break
    }

    case 'agent_updated': {
      const m = msg as unknown as WsAgentUpdated
      const agents = store.projectAgents.map((a) =>
        a.sessionId === m.agent.sessionId ? m.agent : a,
      )
      store.setProjectAgents(agents)
      break
    }

    case 'agent_deleted': {
      const m = msg as unknown as WsAgentDeleted
      const agents = store.projectAgents.filter((a) => a.sessionId !== m.sessionId)
      store.setProjectAgents(agents)
      break
    }

    case 'agent_run_logs_response': {
      const m = msg as unknown as WsAgentRunLogsResponse
      useStore.setState({ agentRunLogs: m.logs, agentRunLogsLoading: false })
      break
    }

    // ── Connector responses ──────────────────────────────────────
    case 'connectors_list_response': {
      const m = msg as unknown as WsConnectorsListResponse
      store.setConnectors(m.connectors)
      break
    }

    case 'connector_added': {
      const m = msg as unknown as WsConnectorAdded
      store.addOrUpdateConnector(m.connector)
      break
    }

    case 'connector_updated': {
      const m = msg as unknown as WsConnectorUpdated
      store.addOrUpdateConnector(m.connector)
      break
    }

    case 'connector_removed': {
      const m = msg as unknown as WsConnectorRemoved
      store.removeConnector(m.id)
      break
    }

    case 'connector_status': {
      const m = msg as unknown as WsConnectorStatus
      store.updateConnectorStatus(m.id, {
        connected: m.connected,
        toolCount: m.toolCount,
        error: m.error,
      })
      break
    }

    case 'connector_registry_list_response': {
      const m = msg as unknown as WsConnectorRegistryListResponse
      store.setConnectorRegistry(m.entries)
      break
    }
  }
}

connection.onMessage(handleWsMessage)

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
