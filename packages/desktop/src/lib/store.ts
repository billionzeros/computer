import { type AskUserQuestion, Channel, type TokenUsage } from '@anton/protocol'
import { create } from 'zustand'
import { type Artifact, extractArtifact } from './artifacts.js'
import { type ConnectionStatus, connection } from './connection.js'
import {
  type Conversation,
  autoTitle,
  createConversation,
  loadConversations,
  saveConversations,
} from './conversations.js'

// ── Types ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  toolName?: string
  toolInput?: Record<string, unknown>
  isError?: boolean
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

  // Agent status detail & steps
  agentStatusDetail: string | null
  agentSteps: AgentStep[]

  // Session readiness tracking (race condition fix)
  _sessionResolvers: Map<string, () => void>

  // Current assistant message ID (for appending text across tool interruptions)
  _currentAssistantMsgId: string | null

  // Artifacts
  artifacts: Artifact[]
  activeArtifactId: string | null
  artifactPanelOpen: boolean

  // Pending confirmation
  pendingConfirm: { id: string; command: string; reason: string } | null

  // Plan review
  pendingPlan: { id: string; title: string; content: string } | null
  sidePanelView: 'artifacts' | 'plan'

  // Ask-user questionnaire
  pendingAskUser: { id: string; questions: AskUserQuestion[] } | null

  // Version & updates
  agentVersion: string | null
  agentGitHash: string | null
  updateInfo: UpdateInfo | null
  updateStage: UpdateStage
  updateMessage: string | null
  updateDismissed: boolean

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void
  setAgentStatus: (status: AgentStatus) => void
  setSidebarTab: (tab: SidebarTab) => void
  setSearchQuery: (query: string) => void

  // Session actions
  setCurrentSession: (id: string, provider: string, model: string) => void
  setSessions: (sessions: SessionMeta[]) => void
  setProviders: (providers: ProviderInfo[], defaults: { provider: string; model: string }) => void

  // Conversation actions
  newConversation: (title?: string, sessionId?: string) => string
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (msg: ChatMessage) => void
  appendAssistantText: (content: string) => void
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
  setPendingConfirm: (confirm: { id: string; command: string; reason: string } | null) => void

  // Plan actions
  setPendingPlan: (plan: { id: string; title: string; content: string } | null) => void
  setSidePanelView: (view: 'artifacts' | 'plan') => void

  // Ask-user actions
  setPendingAskUser: (ask: { id: string; questions: AskUserQuestion[] } | null) => void

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

  return {
    connectionStatus: 'disconnected',
    agentStatus: 'unknown',
    currentSessionId: null,
    currentProvider: savedModel?.provider ?? 'anthropic',
    currentModel: savedModel?.model ?? 'claude-sonnet-4-6',
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
    agentStatusDetail: null,
    agentSteps: [],
    _sessionResolvers: new Map(),
    _currentAssistantMsgId: null,
    artifacts: [],
    activeArtifactId: null,
    artifactPanelOpen: false,
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
    sidebarCollapsed: false,
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setAgentStatus: (status) => set({ agentStatus: status }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSearchQuery: (query) => set({ searchQuery: query }),

    setCurrentSession: (id, provider, model) => {
      saveSelectedModel(provider, model)
      set({ currentSessionId: id, currentProvider: provider, currentModel: model })
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

    newConversation: (title, sessionId) => {
      const conv = createConversation(title, sessionId)
      set((state) => {
        const conversations = [conv, ...state.conversations]
        saveConversations(conversations)
        localStorage.setItem(ACTIVE_CONV_KEY, conv.id)
        return { conversations, activeConversationId: conv.id }
      })
      return conv.id
    },

    switchConversation: (id) => {
      localStorage.setItem(ACTIVE_CONV_KEY, id)
      set({ activeConversationId: id })
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

    getActiveConversation: () => {
      const { conversations, activeConversationId } = get()
      return conversations.find((c) => c.id === activeConversationId) || null
    },

    findConversationBySession: (sessionId) => {
      return get().conversations.find((c) => c.sessionId === sessionId)
    },

    loadSessionMessages: (sessionId, messages) => {
      set((state) => {
        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          return { ...c, messages, updatedAt: Date.now() }
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
    setPendingAskUser: (ask) => set({ pendingAskUser: ask }),

    setAgentVersionInfo: (version, gitHash) =>
      set({ agentVersion: version, agentGitHash: gitHash }),

    setUpdateInfo: (info) => set({ updateInfo: info, updateDismissed: false }),

    setUpdateProgress: (stage, message) => set({ updateStage: stage, updateMessage: message }),

    dismissUpdate: () => set({ updateDismissed: true }),

    resetForDisconnect: () => {
      set({
        currentSessionId: null,
        sessions: [],
        conversations: [],
        activeConversationId: null,
        agentStatus: 'unknown',
        agentStatusDetail: null,
        agentSteps: [],
        _currentAssistantMsgId: null,
        _sessionResolvers: new Map(),
        artifacts: [],
        activeArtifactId: null,
        artifactPanelOpen: false,
        pendingConfirm: null,
        pendingPlan: null,
        sidePanelView: 'artifacts' as const,
        pendingAskUser: null,
        turnUsage: null,
        sessionUsage: null,
        lastResponseProvider: null,
        lastResponseModel: null,
        providers: [],
        agentVersion: null,
        agentGitHash: null,
        updateInfo: null,
        updateStage: null,
        updateMessage: null,
        updateDismissed: false,
      })
      // Clear persisted conversation data
      saveConversations([])
      localStorage.removeItem(ACTIVE_CONV_KEY)
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
    console.log(`[WS] Agent status: ${msg.status}`, msg.detail || '')
    store.setAgentStatus(msg.status)
    store.setAgentStatusDetail(msg.detail || null)
    if (msg.status === 'idle') {
      store.clearAgentSteps()
    }
    return
  }

  if (channel !== Channel.AI) {
    console.log(`[WS] Ignoring non-AI channel: ${channel}`)
    return
  }

  switch (msg.type) {
    // ── Chat messages ──────────────────────────────────────────
    case 'text':
      console.log(`[WS] AI text chunk: "${msg.content?.slice(0, 80)}..."`)
      store.appendAssistantText(msg.content)
      break

    case 'thinking':
      store.addMessage({
        id: `think_${Date.now()}`,
        role: 'system',
        content: msg.text,
        timestamp: Date.now(),
      })
      store.setAgentStatus('working')
      break

    case 'tool_call':
      // Reset assistant message tracking so any text AFTER this tool call
      // creates a new assistant bubble (shows reasoning between tool groups)
      useStore.setState({ _currentAssistantMsgId: null })
      store.addMessage({
        id: `tc_${msg.id}`,
        role: 'tool',
        content: `Running: ${msg.name}`,
        toolName: msg.name,
        toolInput: msg.input,
        timestamp: Date.now(),
      })
      store.addAgentStep({
        id: msg.id,
        type: 'tool_call',
        label: `Running: ${msg.name}`,
        toolName: msg.name,
        status: 'active',
        timestamp: Date.now(),
      })
      store.setAgentStatus('working')
      break

    case 'tool_result': {
      const resultMsg: ChatMessage = {
        id: `tr_${msg.id}`,
        role: 'tool',
        content: msg.output,
        isError: msg.isError,
        timestamp: Date.now(),
      }
      store.addMessage(resultMsg)
      store.updateAgentStep(msg.id, {
        status: msg.isError ? 'error' : 'complete',
      })

      // Legacy client-side artifact extraction (fallback if server doesn't emit artifact events)
      if (!msg.isError) {
        const conv = store.getActiveConversation()
        const toolCallMsg = conv?.messages.find((m) => m.id === `tc_${msg.id}`)
        if (toolCallMsg) {
          const artifact = extractArtifact(toolCallMsg, resultMsg)
          if (artifact) store.addArtifact(artifact)
        }
      }
      break
    }

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
      })
      break

    case 'plan_confirm':
      store.setPendingPlan({
        id: msg.id,
        title: msg.title,
        content: msg.content,
      })
      store.setSidePanelView('plan')
      store.setArtifactPanelOpen(true)
      break

    case 'ask_user':
      store.setPendingAskUser({
        id: msg.id,
        questions: msg.questions,
      })
      break

    case 'error':
      store.addMessage({
        id: `err_${Date.now()}`,
        role: 'system',
        content: msg.message,
        isError: true,
        timestamp: Date.now(),
      })
      store.setAgentStatus('error')
      break

    case 'title_update':
      if (msg.sessionId) {
        store.updateConversationTitle(msg.sessionId, msg.title)
      }
      break

    case 'done': {
      // Detect silent failures: server says "done" but never sent any text/tool events
      const conv = store.getActiveConversation()
      const lastMsg = conv?.messages[conv.messages.length - 1]
      const wasWorking = store.agentStatus === 'working'
      const noResponse = wasWorking && lastMsg?.role === 'user'
      const zeroTokens = msg.usage && msg.usage.inputTokens === 0 && msg.usage.outputTokens === 0

      if (noResponse && zeroTokens) {
        console.error(
          '[WS] Silent failure: "done" with zero tokens and no response. Likely missing API key on server.',
        )
        store.addMessage({
          id: `err_silent_${Date.now()}`,
          role: 'system',
          content:
            'No response from the agent. The LLM was never called (0 tokens used). Check that a valid API key is configured on the server.',
          isError: true,
          timestamp: Date.now(),
        })
      } else if (noResponse) {
        console.warn('[WS] Agent completed with no visible response.')
        store.addMessage({
          id: `err_empty_${Date.now()}`,
          role: 'system',
          content: 'Agent finished but produced no response.',
          isError: true,
          timestamp: Date.now(),
        })
      }

      store.setAgentStatus('idle')
      store.clearAgentSteps()
      store.setAgentStatusDetail(null)
      useStore.setState({ _currentAssistantMsgId: null })
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
    case 'session_created':
      store.setCurrentSession(msg.id, msg.provider, msg.model)
      store.resolvePendingSession(msg.id)
      break

    case 'session_resumed':
      store.setCurrentSession(msg.id, msg.provider, msg.model)
      break

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
        toolName: entry.toolName,
        toolInput: entry.toolInput,
        isError: entry.isError,
      }))
      store.loadSessionMessages(msg.id, historyMessages)
      break
    }

    case 'session_destroyed':
      store.setSessions(store.sessions.filter((s: SessionMeta) => s.id !== msg.id))
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
      store.addMessage({
        id: `compact_${Date.now()}`,
        role: 'system',
        content: 'Compacting context...',
        timestamp: Date.now(),
      })
      break

    case 'compaction_complete':
      store.addMessage({
        id: `compact_done_${Date.now()}`,
        role: 'system',
        content: `Context compacted: ${msg.compactedMessages} messages summarized (compaction #${msg.totalCompactions})`,
        timestamp: Date.now(),
      })
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
