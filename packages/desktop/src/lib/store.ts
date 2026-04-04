import { Channel } from '@anton/protocol'
import { create } from 'zustand'
import { extractArtifact } from './artifacts.js'
import { type ConnectionStatus, type WsPayload, connection } from './connection.js'
import {
  type Conversation,
  autoTitle,
  createConversation,
  loadConversations,
  saveConversations,
} from './conversations.js'
import { artifactStore } from './store/artifactStore.js'
import { connectionStore } from './store/connectionStore.js'
// Domain stores
import { connectorStore } from './store/connectorStore.js'
import { projectStore } from './store/projectStore.js'
import { sessionStore } from './store/sessionStore.js'
import { uiStore } from './store/uiStore.js'
import { updateStore } from './store/updateStore.js'
import { usageStore } from './store/usageStore.js'
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

export type UpdateStage = 'downloading' | 'replacing' | 'restarting' | 'done' | 'error' | null

export function updateStageLabel(stage: string | null): string {
  switch (stage) {
    case 'downloading':
      return 'Downloading update...'
    case 'replacing':
      return 'Installing binary...'
    case 'restarting':
      return 'Restarting your machine...'
    default:
      return 'Updating...'
  }
}

export type SidebarTab = 'history'

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
  // Connection (kept for backward compat during migration)
  connectionStatus: ConnectionStatus

  // Conversations (client-side, linked to sessions)
  conversations: Conversation[]
  activeConversationId: string | null

  // UI
  sidebarTab: SidebarTab
  searchQuery: string

  // Current assistant message ID (for appending text across tool interruptions)
  _currentAssistantMsgId: string | null
  // Per-session assistant message tracking (for multi-conversation isolation)
  _sessionAssistantMsgIds: Map<string, string>

  // Citations: maps assistant message ID → sources extracted from web_search
  citations: Map<string, CitationSource[]>
  _pendingCitationSourcesQueue: CitationSource[]
  _pendingWebSearchToolCallIds: Set<string>

  // Navigation (orchestration — delegates to uiStore but handles conversation routing)
  setActiveView: (
    view:
      | 'home'
      | 'chat'
      | 'memory'
      | 'agents'
      | 'terminal'
      | 'files'
      | 'connectors'
      | 'developer'
      | 'skills'
      | 'workflows'
      | 'projects',
  ) => void
  setActiveMode: (mode: 'chat' | 'computer') => void

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void
  setSidebarTab: (tab: SidebarTab) => void
  setSearchQuery: (query: string) => void

  // Session model update on conversation (keeps conversation provider/model in sync)
  setCurrentSession: (id: string, provider: string, model: string) => void

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

  // Session readiness (delegates to sessionStore)
  registerPendingSession: (id: string) => Promise<void>
  resolvePendingSession: (id: string) => void

  // UI panel actions
  setSidePanelView: (view: 'artifacts' | 'plan' | 'context' | 'browser' | 'devmode') => void
  openContextPanel: () => void

  // Reset actions
  resetForDisconnect: () => void
  resetForMachineSwitch: () => void
}

export const useStore = create<AppState>((set, get) => {
  // Load persisted conversations
  const persisted = loadConversations()
  const savedActiveConvId = localStorage.getItem(ACTIVE_CONV_KEY)
  // Only restore if the conversation still exists
  const restoredActiveId =
    savedActiveConvId && persisted.some((c) => c.id === savedActiveConvId)
      ? savedActiveConvId
      : null

  return {
    connectionStatus: 'disconnected',
    conversations: persisted,
    activeConversationId: restoredActiveId,
    sidebarTab: 'history',
    searchQuery: '',
    _currentAssistantMsgId: null,
    _sessionAssistantMsgIds: new Map(),
    citations: new Map(),
    _pendingCitationSourcesQueue: [],
    _pendingWebSearchToolCallIds: new Set(),

    setActiveMode: (mode) => {
      localStorage.setItem('anton-mode', mode)
      uiStore.setState({
        activeMode: mode,
        activeView: mode === 'computer' ? 'home' : 'chat',
      })
    },
    setActiveView: (view) => {
      if (view === 'chat') {
        // If the current active conversation belongs to a project, clear it
        // so AgentChat picks or creates a proper chat conversation.
        const state = get()
        const activeConv = state.conversations.find((c) => c.id === state.activeConversationId)
        if (activeConv?.projectId) {
          // Try to find an existing chat conversation (default project or legacy)
          const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
          const chatConv = state.conversations.find(
            (c) => !c.projectId || c.projectId === defaultProject?.id,
          )
          if (chatConv) {
            localStorage.setItem(ACTIVE_CONV_KEY, chatConv.id)
            set({ activeConversationId: chatConv.id })
          } else {
            localStorage.removeItem(ACTIVE_CONV_KEY)
            set({ activeConversationId: null })
          }
        }
      }
      uiStore.setState({ activeView: view })
    },

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSearchQuery: (query) => set({ searchQuery: query }),

    setCurrentSession: (id, provider, model) => {
      // Persist model on the active conversation (conversation-level concern)
      set((state) => {
        const activeId = state.activeConversationId
        const conversations = activeId
          ? state.conversations.map((c) =>
              c.id === activeId ? { ...c, provider, model, updatedAt: Date.now() } : c,
            )
          : state.conversations
        if (activeId) saveConversations(conversations)
        return { conversations }
      })
    },

    newConversation: (title, sessionId, projectId, agentSessionId) => {
      const ss = sessionStore.getState()
      const conv = createConversation(
        title,
        sessionId,
        projectId,
        ss.currentProvider,
        ss.currentModel,
        agentSessionId,
      )
      set((state) => {
        const conversations = [conv, ...state.conversations]
        saveConversations(conversations)
        localStorage.setItem(ACTIVE_CONV_KEY, conv.id)
        return {
          conversations,
          activeConversationId: conv.id,
        }
      })
      // Reset session state for new conversation
      ss.setAgentStatus('idle')
      ss.setAgentStatusDetail(null)
      ss.setCurrentTasks([])
      return conv.id
    },

    appendConversation: (title, sessionId, projectId) => {
      const ss = sessionStore.getState()
      const conv = createConversation(
        title,
        sessionId,
        projectId,
        ss.currentProvider,
        ss.currentModel,
      )
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
        sessionStore
          .getState()
          .setCurrentSession(
            conv.sessionId || sessionStore.getState().currentSessionId || '',
            conv.provider,
            conv.model,
          )
      }

      // Restore per-session agent status from sessionStore's consolidated state
      const ss = sessionStore.getState()
      if (conv?.sessionId) {
        const sessionState = ss.getSessionState(conv.sessionId)
        ss.setAgentStatus(sessionState.status, conv.sessionId)
        ss.setAgentStatusDetail(sessionState.statusDetail ?? null)
      } else {
        ss.setAgentStatus('idle')
        ss.setAgentStatusDetail(null)
      }

      // Save current session's tasks before switching, then restore target session's tasks
      const currentState = get()
      const currentConv = currentState.conversations.find(
        (c) => c.id === currentState.activeConversationId,
      )
      if (currentConv?.sessionId) {
        const currentTasks = ss.currentTasks
        if (currentTasks.length > 0) {
          ss.updateSessionState(currentConv.sessionId, { tasks: currentTasks })
        }
      }
      // Restore target session's tasks (or clear if none)
      const restoredTasks = conv?.sessionId ? ss.getSessionState(conv.sessionId).tasks : []
      ss.setCurrentTasks(restoredTasks)

      // Close artifact panel when switching conversations
      artifactStore.setState({ artifactPanelOpen: false })

      // If this session completed a turn in the background, fetch fresh history
      if (conv?.sessionId && ss.getSessionState(conv.sessionId).needsHistoryRefresh) {
        ss.updateSessionState(conv.sessionId, {
          needsHistoryRefresh: false,
          isSyncing: true,
        })
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
        if (!activeId) {
          console.warn('[appendAssistantText] No activeConversationId — dropping text')
          return state
        }

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
        if (!conv) {
          console.warn(
            `[appendAssistantTextToSession] No conversation found for sessionId=${sessionId} — dropping text`,
          )
          return state
        }

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
      return (
        projectStore.getState().projectAgents.find((a) => a.sessionId === conv.agentSessionId) ??
        null
      )
    },

    findConversationBySession: (sessionId) => {
      return get().conversations.find((c) => c.sessionId === sessionId)
    },

    loadSessionMessages: (sessionId, serverMessages) => {
      // Grab queued messages before clearing sync state
      const ss = sessionStore.getState()
      const queuedMessages = ss.getSessionState(sessionId).pendingSyncMessages

      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        // Server is always authoritative. Replace local state unconditionally.
        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, messages: serverMessages, updatedAt: Date.now() }
        })
        saveConversations(conversations)
        return { conversations }
      })

      // Clear syncing flag and pending queue in sessionStore
      ss.updateSessionState(sessionId, { isSyncing: false, pendingSyncMessages: [] })

      // Replay any messages that arrived while we were syncing
      if (queuedMessages.length > 0) {
        console.log(`[Sync] Replaying ${queuedMessages.length} queued messages for ${sessionId}`)
        for (const queued of queuedMessages) {
          handleWsMessage(Channel.AI, queued)
        }
      }
    },

    requestSessionHistory: (sessionId) => {
      const ss = sessionStore.getState()
      // Mark session as syncing and send the request.
      ss.updateSessionState(sessionId, { isSyncing: true })
      connection.sendSessionHistory(sessionId)

      // Safety timeout: clear syncing flag if server never responds
      setTimeout(() => {
        const ssNow = sessionStore.getState()
        const state = ssNow.getSessionState(sessionId)
        if (state.isSyncing) {
          console.warn(`[Sync] Timeout for ${sessionId}, clearing sync flag`)
          const queued = state.pendingSyncMessages
          ssNow.updateSessionState(sessionId, {
            isSyncing: false,
            pendingSyncMessages: [],
          })
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
        return { conversations }
      })

      // Clear loading flag in sessionStore
      sessionStore.getState().updateSessionState(sessionId, { isLoadingOlder: false })
    },

    loadOlderMessages: (sessionId) => {
      const ss = sessionStore.getState()
      const sessionState = ss.getSessionState(sessionId)
      // Don't load if already loading or no more messages
      if (sessionState.isLoadingOlder) return
      if (!sessionState.hasMore) return

      const conv = get().conversations.find((c) => c.sessionId === sessionId)
      if (!conv || conv.messages.length === 0) return

      // Find the lowest seq in current messages to paginate before it
      let minSeq = Number.MAX_SAFE_INTEGER
      for (const m of conv.messages) {
        const match = m.id.match(/^hist_(\d+)_/)
        if (match) {
          minSeq = Math.min(minSeq, Number.parseInt(match[1], 10))
        }
      }
      if (minSeq === Number.MAX_SAFE_INTEGER) return

      ss.updateSessionState(sessionId, { isLoadingOlder: true })
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

    registerPendingSession: (id) => {
      return sessionStore.getState().registerPendingSession(id)
    },

    resolvePendingSession: (id) => {
      sessionStore.getState().resolvePendingSession(id)
    },

    setSidePanelView: (view) => uiStore.setState({ sidePanelView: view }),
    openContextPanel: () => {
      uiStore.setState({ sidePanelView: 'context' })
      artifactStore.setState({ artifactPanelOpen: true })
    },

    resetForDisconnect: () => {
      set({
        // KEEP: conversations, activeConversationId — user's chat history persists
        // Clear conversation-level transient state
        _currentAssistantMsgId: null,
        _sessionAssistantMsgIds: new Map(),
        citations: new Map(),
        _pendingCitationSourcesQueue: [],
        _pendingWebSearchToolCallIds: new Set(),
      })

      // Reset domain stores
      sessionStore.getState().reset()
      connectorStore.getState().reset()
      updateStore.getState().resetKeepIfUpdating()
      usageStore.getState().reset()
      projectStore.getState().resetTransient()
      artifactStore.getState().reset()
    },

    resetForMachineSwitch: () => {
      // Full flush when switching to a different machine.
      set({
        conversations: [],
        activeConversationId: null,
        _currentAssistantMsgId: null,
        _sessionAssistantMsgIds: new Map(),
        citations: new Map(),
        _pendingCitationSourcesQueue: [],
        _pendingWebSearchToolCallIds: new Set(),
      })

      // Reset all domain stores
      sessionStore.getState().reset()
      connectorStore.getState().reset()
      updateStore.getState().reset()
      usageStore.getState().reset()
      uiStore.getState().reset()
      projectStore.getState().reset()
      artifactStore.getState().reset()
    },
  }
})

// ── Wire connection events to store ─────────────────────────────────

connection.onStatusChange((status) => {
  useStore.getState().setConnectionStatus(status)
  sessionStore.getState().setConnectionStatus(status)

  // Drive the init state machine
  const cs = connectionStore.getState()
  if (status === 'connecting' && cs.initPhase === 'idle') {
    cs.setInitPhase('connecting')
  } else if (
    status === 'connected' &&
    (cs.initPhase === 'connecting' || cs.initPhase === 'authenticating')
  ) {
    // auth_ok will trigger syncing via the CONTROL handler below
  } else if (status === 'disconnected' || status === 'error') {
    cs.reset()
  }
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
      const us = updateStore.getState()
      us.setAgentVersionInfo(m.version || '', m.gitHash || '')

      // Reconnected after an update restart — mark update as done
      if (us.updateStage === 'restarting') {
        us.setUpdateProgress('done', `Updated to v${m.version}`)
        us.setUpdateInfo({
          currentVersion: m.version,
          latestVersion: m.version,
          updateAvailable: false,
          changelog: us.updateInfo?.changelog ?? null,
          releaseUrl: us.updateInfo?.releaseUrl ?? null,
        })
      } else if (m.updateAvailable) {
        us.setUpdateInfo({
          currentVersion: m.version,
          latestVersion: m.updateAvailable.version,
          updateAvailable: true,
          changelog: m.updateAvailable.changelog,
          releaseUrl: m.updateAvailable.releaseUrl,
        })
      }

      // Transition to syncing — fires all list requests
      connectionStore.getState().startSyncing()
    } else if (msg.type === 'update_check_response') {
      const m = msg as unknown as WsUpdateCheckResponse
      updateStore.getState().setUpdateInfo({
        currentVersion: m.currentVersion,
        latestVersion: m.latestVersion,
        updateAvailable: m.updateAvailable,
        changelog: m.changelog,
        releaseUrl: m.releaseUrl,
      })
    } else if (msg.type === 'update_progress') {
      const m = msg as unknown as WsUpdateProgress
      updateStore.getState().setUpdateProgress(m.stage, m.message)
    } else if (msg.type === 'config_query_response') {
      const m = msg as unknown as { key: string; value: unknown }
      if (m.key === 'system_prompt' && typeof m.value === 'string') {
        uiStore.getState().setDevModeData({ systemPrompt: m.value })
      } else if (m.key === 'memories' && Array.isArray(m.value)) {
        const memories = m.value as {
          name: string
          content: string
          scope: 'global' | 'conversation' | 'project'
        }[]
        uiStore.getState().setDevModeData({ memories })
        projectStore.getState().setMemories(memories)
      }
    }
    // Don't return — let other control messages fall through for ping/pong etc.
  }

  // ── EVENTS channel: job events ──
  if (channel === Channel.EVENTS && msg.type === 'job_event') {
    const m = msg as unknown as WsJobEvent
    // Refresh job list when a job state changes
    if (m.projectId === projectStore.getState().activeProjectId) {
      connection.sendAgentsList(m.projectId)
    }
    return
  }

  // ── EVENTS channel: agent status + update notifications ──
  if (channel === Channel.EVENTS && msg.type === 'update_available') {
    const m = msg as unknown as WsUpdateAvailable
    updateStore.getState().setUpdateInfo({
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
    uiStore
      .getState()
      .appendEventLog(
        'status',
        `Agent ${m.status}${m.detail ? ` — ${m.detail}` : ''}${m.sessionId ? ` (${m.sessionId.slice(0, 12)})` : ''}`,
      )
    const sid: string | undefined = m.sessionId

    // Update per-session status in sessionStore
    const ss = sessionStore.getState()
    if (sid) {
      ss.updateSessionState(sid, { status: m.status, statusDetail: m.detail })
    }

    // Update global status ONLY for the active session — never let background agent runs
    // affect the UI of unrelated conversations
    const activeConv = store.getActiveConversation()
    if (sid === activeConv?.sessionId) {
      ss.setAgentStatus(m.status, sid)
      ss.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
        ss.clearAgentSteps()
      }
    } else if (!sid) {
      // Legacy path: no sessionId means it's for the active session
      ss.setAgentStatus(m.status)
      ss.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
        ss.clearAgentSteps()
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
  if (
    msgSessionId &&
    sessionStore.getState().getSessionState(msgSessionId).isSyncing &&
    !syncExempt.has(msg.type)
  ) {
    // Queue this message for replay after history loads
    const ss = sessionStore.getState().getSessionState(msgSessionId)
    sessionStore.getState().updateSessionState(msgSessionId, {
      pendingSyncMessages: [...ss.pendingSyncMessages, msg],
    })
    console.log(`[Sync] Queued ${msg.type} for ${msgSessionId} (syncing)`)
    return
  }

  // Log key AI events to the developer event log
  if (
    ['tool_call', 'done', 'error', 'thinking', 'session_created', 'session_destroyed'].includes(
      msg.type,
    )
  ) {
    const summary =
      msg.type === 'tool_call'
        ? `Tool call: ${(msg as any).name || 'unknown'}`
        : msg.type === 'done'
          ? `Turn complete${(msg as any).usage ? ` (${(msg as any).usage.totalTokens} tokens)` : ''}`
          : msg.type === 'error'
            ? `Error: ${(msg as any).message || (msg as any).content || 'unknown'}`
            : msg.type === 'thinking'
              ? 'Thinking...'
              : msg.type === 'session_created'
                ? `Session created: ${(msg as any).sessionId?.slice(0, 12) || ''}`
                : `Session destroyed: ${(msg as any).sessionId?.slice(0, 12) || ''}`
    uiStore.getState().appendEventLog(msg.type, summary)
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
      // Track that this session is actively streaming
      const textSessionId = msgSessionId || activeConv?.sessionId
      if (textSessionId) {
        const ss = sessionStore.getState()
        if (!ss.getSessionState(textSessionId).isStreaming) {
          ss.updateSessionState(textSessionId, { isStreaming: true })
        }
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
      sessionStore.getState().setAgentStatus('working', msgSessionId)
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
      const ss = sessionStore.getState()
      // Tools with dedicated UI — don't pollute the message timeline
      const uiOnlyTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      if (uiOnlyTools.has(m.name)) {
        // Track the ID so we can skip its tool_result too
        ss._hiddenToolCallIds.add(m.id)
        ss.setAgentStatus('working', msgSessionId)
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
      ss._toolCallNames.set(m.id, { name: m.name, input: m.input })
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
        ss.addAgentStep({
          id: m.id,
          type: 'tool_call',
          label: `Running: ${m.name}`,
          toolName: m.name,
          status: 'active',
          timestamp: Date.now(),
        })
      }
      ss.setAgentStatus('working', msgSessionId)
      break
    }

    case 'tool_result': {
      const m = msg as unknown as WsToolResult
      const ss = sessionStore.getState()
      // Skip results for tools with dedicated UI
      if (ss._hiddenToolCallIds.has(m.id)) {
        ss._hiddenToolCallIds.delete(m.id)
        break
      }
      // Inherit toolName/toolInput from matching tool_call
      const callInfo = ss._toolCallNames.get(m.id)
      const resultMsg: ChatMessage = {
        id: `tr_${m.id}`,
        role: 'tool',
        content: m.output,
        isError: m.isError,
        timestamp: Date.now(),
        parentToolCallId: m.parentToolCallId,
        ...(callInfo && { toolName: callInfo.name, toolInput: callInfo.input }),
      }
      ss._toolCallNames.delete(m.id)
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
        ss.updateAgentStep(m.id, {
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
      artifactStore.getState().addArtifact({
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
        projectId: projectStore.getState().activeProjectId || undefined,
      })
      break
    }

    case 'publish_artifact_response': {
      const m = msg as unknown as WsPublishArtifactResponse
      if (m.success && m.artifactId) {
        artifactStore.getState().updateArtifactPublishStatus(m.artifactId, m.publicUrl, m.slug)
      }
      break
    }

    case 'confirm': {
      const m = msg as unknown as WsConfirm
      sessionStore.getState().setPendingConfirm({
        id: m.id,
        command: m.command,
        reason: m.reason,
        sessionId: msgSessionId,
      })
      break
    }

    case 'plan_confirm': {
      const m = msg as unknown as WsPlanConfirm
      sessionStore.getState().setPendingPlan({
        id: m.id,
        title: m.title,
        content: m.content,
        sessionId: msgSessionId,
      })
      break
    }

    case 'ask_user': {
      const m = msg as unknown as WsAskUser
      sessionStore.getState().setPendingAskUser({
        id: m.id,
        questions: m.questions,
        sessionId: msgSessionId,
      })
      break
    }

    case 'error': {
      const m = msg as unknown as WsError
      const ss = sessionStore.getState()
      // Clear syncing flag if this error is for a session we're waiting on
      if (msgSessionId && ss.getSessionState(msgSessionId).isSyncing) {
        ss.updateSessionState(msgSessionId, { isSyncing: false, pendingSyncMessages: [] })
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
        ss.setAgentStatus('error', msgSessionId)
      }
      // Update per-session state on error
      const errSessionId = msgSessionId || activeConv?.sessionId
      if (errSessionId) {
        ss.updateSessionState(errSessionId, { isStreaming: false, status: 'error' })
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
        const ps = projectStore.getState()
        if (ps.projectSessions.some((s: SessionMeta) => s.id === m.sessionId)) {
          ps.setProjectSessions(
            ps.projectSessions.map((s: SessionMeta) =>
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
        const ss = sessionStore.getState()
        // Always store tasks per-session so they persist across conversation switches
        if (msgSessionId) {
          ss.updateSessionState(msgSessionId, { tasks: m.tasks })
        }
        // Only update the visible currentTasks if this is the active session
        if (isForActiveSession) {
          ss.setCurrentTasks(m.tasks)
        }
      }
      break
    }

    case 'browser_state': {
      const m = msg as unknown as WsBrowserState
      if (isForActiveSession) {
        const as = artifactStore.getState()
        const wasActive = as.browserState?.active
        as.setBrowserState({
          url: m.url,
          title: m.title,
          screenshot: m.screenshot,
          lastAction: m.lastAction,
          elementCount: m.elementCount,
        })
        // Auto-open browser viewer on first browser event
        if (!wasActive) {
          store.setSidePanelView('browser')
          artifactStore.setState({ artifactPanelOpen: true })
        }
      }
      break
    }

    case 'browser_close': {
      if (isForActiveSession) {
        artifactStore.getState().clearBrowserState()
      }
      break
    }

    case 'token_update': {
      const m = msg as unknown as WsTokenUpdate
      // Streaming token update — update turnUsage live so the UI can show a counter
      if (isForActiveSession && m.usage) {
        sessionStore.getState().setUsage(m.usage, null)
      }
      break
    }

    case 'done': {
      const m = msg as unknown as WsDone
      const ss = sessionStore.getState()
      // Detect silent failures: server says "done" but never sent any text/tool events
      const doneConv = msgSessionId
        ? store.findConversationBySession(msgSessionId)
        : store.getActiveConversation()
      const lastMsg = doneConv?.messages[doneConv.messages.length - 1]
      const wasWorking = ss.agentStatus === 'working'
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

      // Update per-session status in consolidated state
      const doneSessionId = msgSessionId || activeConv?.sessionId
      if (doneSessionId) {
        ss.updateSessionState(doneSessionId, {
          status: 'idle',
          isStreaming: false,
          assistantMsgId: null,
          needsHistoryRefresh: !isForActiveSession,
        })
      }

      // Only update global status if this is the active session
      if (isForActiveSession || !msgSessionId) {
        ss.setAgentStatus('idle')
        ss.clearAgentSteps()
        ss.setAgentStatusDetail(null)
      }

      // Close out any pending tool calls that never got a result.
      if (doneConv) {
        const resultIds = new Set(
          doneConv.messages.filter((m) => m.id.startsWith('tr_')).map((m) => m.id.slice(3)),
        )
        const pendingCalls = doneConv.messages.filter(
          (m) => m.id.startsWith('tc_') && !resultIds.has(m.id.slice(3)),
        )
        if (pendingCalls.length > 0) {
          for (const call of pendingCalls) {
            const baseId = call.id.slice(3)
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

      // Clear assistant message tracking (conversation-level, stays in old store for now)
      useStore.setState({ _currentAssistantMsgId: null })
      if (msgSessionId) {
        store._sessionAssistantMsgIds.delete(msgSessionId)
      }

      if (m.usage) {
        ss.setUsage(m.usage, m.cumulativeUsage || null)
      }
      if (m.provider && m.model) {
        ss.setLastResponseModel(m.provider, m.model)
      }
      break
    }

    // ── Session responses ──────────────────────────────────────
    case 'session_created': {
      const m = msg as unknown as WsSessionCreated
      const ss = sessionStore.getState()
      ss.setCurrentSession(m.id, m.provider, m.model)
      ss.resolvePendingSession(m.id)
      // Also persist model on the active conversation
      store.setCurrentSession(m.id, m.provider, m.model)
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
      sessionStore.getState().setSessions(m.sessions)
      connectionStore.getState().markSynced('sessions')
      break
    }

    case 'usage_stats_response': {
      const m = msg as unknown as WsUsageStatsResponse
      usageStore.getState().setUsageStats({
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
      const histSs = sessionStore.getState()
      const isFirstPage = !histSs.getSessionState(m.id).isLoadingOlder

      // Update hasMore for this session in consolidated state
      histSs.updateSessionState(m.id, { hasMore: (m.hasMore ?? false) as boolean })

      if (isFirstPage) {
        // First page: replace messages (server authoritative)
        store.loadSessionMessages(m.id, allMessages)
      } else {
        // Older page: prepend to existing messages
        store.prependSessionMessages(m.id, allMessages)
      }

      // Use server-sent artifacts if available (first page includes all artifacts)
      const as = artifactStore.getState()
      if (m.artifacts && Array.isArray(m.artifacts) && m.artifacts.length > 0) {
        as.clearArtifacts()
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
          as.addArtifact({
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
        as.clearArtifacts()
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
                as.addArtifact(artifact)
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
      const ss = sessionStore.getState()
      ss.setSessions(ss.sessions.filter((s: SessionMeta) => s.id !== m.id))
      // Also remove from projectSessions so project view updates immediately
      const ps = projectStore.getState()
      if (ps.projectSessions.some((s: SessionMeta) => s.id !== m.id)) {
        ps.setProjectSessions(ps.projectSessions.filter((s: SessionMeta) => s.id !== m.id))
      }
      break
    }

    // ── Provider responses ─────────────────────────────────────
    case 'providers_list_response': {
      const m = msg as unknown as WsProvidersListResponse
      sessionStore.getState().setProviders(m.providers, m.defaults)
      connectionStore.getState().markSynced('providers')
      // Onboarding state now lives in uiStore
      const ui = uiStore.getState()
      ui.setOnboardingLoaded(true)
      if (m.onboarding?.completed) {
        uiStore.setState({
          onboardingCompleted: true,
          onboardingRole: m.onboarding?.role ?? null,
        })
      }
      break
    }

    case 'provider_set_key_response':
      if (msg.success as boolean) sessionStore.getState().sendProvidersList()
      break

    case 'provider_set_models_response':
      if (msg.success as boolean) sessionStore.getState().sendProvidersList()
      break

    case 'provider_set_default_response': {
      const m = msg as unknown as WsProviderSetDefaultResponse
      if (m.success) {
        const ss = sessionStore.getState()
        ss.setCurrentSession(ss.currentSessionId || '', m.provider, m.model)
        // Also update the old store's conversation model
        store.setCurrentSession(ss.currentSessionId || '', m.provider, m.model)
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
      const ps = projectStore.getState()
      ps.addProject(m.project)
      ps.setActiveProject(m.project.id)
      connection.sendProjectSessionsList(m.project.id)
      break
    }

    case 'projects_list_response': {
      const m = msg as unknown as WsProjectsListResponse
      projectStore.getState().setProjects(m.projects)
      connectionStore.getState().markSynced('projects')
      break
    }

    case 'project_updated': {
      const m = msg as unknown as WsProjectUpdated
      projectStore.getState().updateProject(m.project.id, m.project)
      break
    }

    case 'project_deleted': {
      const m = msg as unknown as WsProjectDeleted
      projectStore.getState().removeProject(m.id)
      break
    }

    case 'project_files_list_response': {
      const m = msg as unknown as WsProjectFilesListResponse
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectFiles(m.files)
      }
      break
    }

    case 'project_sessions_list_response': {
      const m = msg as unknown as WsProjectSessionsListResponse
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectSessions(m.sessions)
      }
      break
    }

    case 'project_instructions_response': {
      const m = msg as unknown as { projectId: string; content: string }
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectInstructions(m.content)
      }
      break
    }

    case 'project_preferences_response': {
      const m = msg as unknown as {
        projectId: string
        preferences: { id: string; title: string; content: string; createdAt: number }[]
      }
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectPreferences(m.preferences)
      }
      break
    }

    // ── Agent responses ──────────────────────────────────────────
    case 'agents_list_response': {
      const m = msg as unknown as WsAgentsListResponse
      const ps = projectStore.getState()
      if (m.projectId === ps.activeProjectId) {
        ps.setProjectAgents(m.agents)
      }
      // Also accumulate into allAgents (replace agents for this project, keep others)
      const otherAgents = ps.allAgents.filter((a) => a.projectId !== m.projectId)
      ps.setAllAgents([...otherAgents, ...m.agents])
      break
    }

    case 'agent_created': {
      const m = msg as unknown as WsAgentCreated
      const ps = projectStore.getState()
      const agents = [...ps.projectAgents]
      const idx = agents.findIndex((a) => a.sessionId === m.agent.sessionId)
      if (idx >= 0) agents[idx] = m.agent
      else agents.push(m.agent)
      ps.setProjectAgents(agents)
      // Also update allAgents
      const allAgents = [...ps.allAgents]
      const allIdx = allAgents.findIndex((a) => a.sessionId === m.agent.sessionId)
      if (allIdx >= 0) allAgents[allIdx] = m.agent
      else allAgents.push(m.agent)
      ps.setAllAgents(allAgents)
      break
    }

    case 'agent_updated': {
      const m = msg as unknown as WsAgentUpdated
      const ps = projectStore.getState()
      ps.setProjectAgents(
        ps.projectAgents.map((a) => (a.sessionId === m.agent.sessionId ? m.agent : a)),
      )
      ps.setAllAgents(ps.allAgents.map((a) => (a.sessionId === m.agent.sessionId ? m.agent : a)))
      break
    }

    case 'agent_deleted': {
      const m = msg as unknown as WsAgentDeleted
      const ps = projectStore.getState()
      ps.setProjectAgents(ps.projectAgents.filter((a) => a.sessionId !== m.sessionId))
      ps.setAllAgents(ps.allAgents.filter((a) => a.sessionId !== m.sessionId))
      break
    }

    case 'agent_run_logs_response': {
      const m = msg as unknown as WsAgentRunLogsResponse
      projectStore.getState().setAgentRunLogs(m.logs)
      break
    }

    // ── Workflow responses ──────────────────────────────────────
    case 'workflow_registry_list_response': {
      const m = msg as any
      projectStore.getState().setWorkflowRegistry(m.entries)
      break
    }

    case 'workflow_check_connectors_response': {
      const m = msg as any
      projectStore.getState().setWorkflowConnectorCheck({
        workflowId: m.workflowId,
        satisfied: m.satisfied,
        missing: m.missing,
        optional: m.optional,
      })
      break
    }

    case 'workflow_installed': {
      const m = msg as any
      const ps = projectStore.getState()
      ps.setProjectWorkflows([...ps.projectWorkflows, m.workflow])
      // Refresh agents list since a new agent was created
      if (ps.activeProjectId) {
        connection.sendAgentsList(ps.activeProjectId)
      }
      // Navigate to the project and open a new conversation for bootstrap
      if (m.workflow.projectId) {
        ps.setActiveProject(m.workflow.projectId)
        store.setActiveView('chat')
        // Small delay to let project switch complete, then create new conversation
        setTimeout(() => {
          store.newConversation(
            `${m.workflow.manifest.name} Setup`,
            undefined,
            m.workflow.projectId,
          )
        }, 100)
      }
      break
    }

    case 'workflows_list_response': {
      const m = msg as any
      projectStore.getState().setProjectWorkflows(m.workflows)
      break
    }

    case 'workflow_uninstalled': {
      const m = msg as any
      const ps = projectStore.getState()
      ps.setProjectWorkflows(ps.projectWorkflows.filter((w) => w.workflowId !== m.workflowId))
      break
    }

    // ── Connector responses ──────────────────────────────────────
    case 'connectors_list_response': {
      const m = msg as unknown as WsConnectorsListResponse
      connectorStore.getState().setConnectors(m.connectors)
      connectionStore.getState().markSynced('connectors')
      break
    }

    case 'connector_added': {
      const m = msg as unknown as WsConnectorAdded
      connectorStore.getState().addOrUpdateConnector(m.connector)
      break
    }

    case 'connector_updated': {
      const m = msg as unknown as WsConnectorUpdated
      connectorStore.getState().addOrUpdateConnector(m.connector)
      break
    }

    case 'connector_removed': {
      const m = msg as unknown as WsConnectorRemoved
      connectorStore.getState().removeConnector(m.id)
      break
    }

    case 'connector_status': {
      const m = msg as unknown as WsConnectorStatus
      connectorStore.getState().updateConnectorStatus(m.id, {
        connected: m.connected,
        toolCount: m.toolCount,
        error: m.error,
      })
      break
    }

    case 'connector_registry_list_response': {
      const m = msg as unknown as WsConnectorRegistryListResponse
      connectorStore.getState().setConnectorRegistry(m.entries)
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
  return sessionStore((s) => s.agentStatus)
}

/** Returns true if the currently active conversation's session is the one that's working. */
export function useIsCurrentSessionWorking(): boolean {
  const agentStatus = sessionStore((s) => s.agentStatus)
  const workingSessionId = sessionStore((s) => s.workingSessionId)
  const activeConv = useStore((s) => s.getActiveConversation())
  if (agentStatus !== 'working') return false
  if (!workingSessionId) return true
  return activeConv?.sessionId === workingSessionId
}
