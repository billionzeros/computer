import { Channel } from '@anton/protocol'
import { create } from 'zustand'
import { type ConnectionStatus, connection } from './connection.js'
import { migrateFromLegacyConversations } from './conversationCache.js'
import {
  type Conversation,
  autoTitle,
  createConversation,
  loadConversations,
  reconcileActiveConversationId,
  saveConversations,
} from './conversations.js'
import { artifactStore } from './store/artifactStore.js'
import { connectionStore } from './store/connectionStore.js'
import { connectorStore } from './store/connectorStore.js'
import { handleWsMessage } from './store/handlers/index.js'
import { projectStore } from './store/projectStore.js'
import { sessionStore, useActiveSessionState } from './store/sessionStore.js'
import type { AgentStatus } from './store/types.js'
import { uiStore } from './store/uiStore.js'
import { updateStore } from './store/updateStore.js'
import { usageStore } from './store/usageStore.js'

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
  isThinking?: boolean // thinking/reasoning content from the model
  parentToolCallId?: string // set when this message is from a sub-agent
  isSteering?: boolean // sent while agent was working
  askUserAnswers?: Record<string, string>
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

// Re-export protocol-backed types for backward compat with existing imports
export type { ProviderInfo, SessionMeta } from './store/types.js'

export interface SavedMachine {
  id: string
  name: string
  host: string
  port: number
  token: string
  useTLS: boolean
}

export type {
  AgentStep,
  AgentStatus,
  ConnectorStatusInfo,
  ConnectorRegistryInfo,
  UpdateInfo,
  UpdateStage,
} from './store/types.js'
export { updateStageLabel } from './store/types.js'

export type SidebarTab = 'history'

const MACHINES_KEY = 'anton.machines'
const ACTIVE_CONV_KEY = 'anton.activeConversationId'

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
  connectionStatus: ConnectionStatus

  // Conversations (client-side, linked to sessions)
  conversations: Conversation[]
  activeConversationId: string | null

  // UI
  sidebarTab: SidebarTab
  searchQuery: string

  // Draft input persistence (keyed by conversationId)
  draftInputs: Map<string, { text: string; attachments: ChatImageAttachment[] }>
  setDraftInput: (convId: string, text: string, attachments: ChatImageAttachment[]) => void
  getDraftInput: (convId: string) => { text: string; attachments: ChatImageAttachment[] } | undefined
  clearDraftInput: (convId: string) => void

  // Per-session assistant message tracking (keyed by sessionId for isolation)
  _sessionAssistantMsgIds: Map<string, string>
  // Per-session thinking message tracking (keyed by sessionId for isolation)
  _sessionThinkingMsgIds: Map<string, string>
  // Sub-agent progress message tracking (keyed by toolCallId for accumulation)
  _subAgentProgressMsgIds: Map<string, string>

  // Citations: maps assistant message ID → sources extracted from web_search
  citations: Map<string, CitationSource[]>

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
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (msg: ChatMessage) => void
  addMessageToSession: (sessionId: string, msg: ChatMessage) => void
  appendAssistantText: (content: string) => void
  appendAssistantTextToSession: (sessionId: string, content: string) => void
  appendThinkingText: (content: string) => void
  appendThinkingTextToSession: (sessionId: string, content: string) => void
  appendSubAgentProgress: (toolCallId: string, content: string, parentToolCallId: string) => void
  appendSubAgentProgressToSession: (
    sessionId: string,
    toolCallId: string,
    content: string,
    parentToolCallId: string,
  ) => void
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
  // Migrate from old conversation format if needed (conv_xxx IDs + messages → sessionId + metadata only)
  migrateFromLegacyConversations()

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
    draftInputs: new Map(),
    _sessionAssistantMsgIds: new Map(),
    _sessionThinkingMsgIds: new Map(),
    _subAgentProgressMsgIds: new Map(),
    citations: new Map(),

    setActiveMode: (mode) => {
      localStorage.setItem('anton-mode', mode)
      uiStore.setState({
        activeMode: mode,
        activeView: mode === 'computer' ? 'home' : 'chat',
      })
    },
    setActiveView: (view) => {
      if (view === 'chat') {
        const state = get()
        const activeConv = state.conversations.find((c) => c.id === state.activeConversationId)
        if (activeConv?.projectId) {
          // Active conversation belongs to a project — switch to a chat conversation
          const defaultProject = projectStore.getState().projects.find((p) => p.isDefault)
          const chatConv = state.conversations.find(
            (c) => !c.projectId || c.projectId === defaultProject?.id,
          )
          if (chatConv) {
            state.switchConversation(chatConv.id)
          } else {
            localStorage.removeItem(ACTIVE_CONV_KEY)
            set({ activeConversationId: null })
          }
        } else if (activeConv && !sessionStore.getState().currentSessionId) {
          // Active conversation exists but sessionStore was never initialized
          // (e.g. init skipped switchConversation in Home view) — sync it now
          state.switchConversation(activeConv.id)
        }
      }
      uiStore.setState({ activeView: view })
    },

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSearchQuery: (query) => set({ searchQuery: query }),

    setCurrentSession: (_id, provider, model) => {
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
      // New conversation gets a fresh SessionState with idle defaults automatically
      return conv.id
    },

    switchConversation: (id) => {
      localStorage.setItem(ACTIVE_CONV_KEY, id)
      // Restore per-conversation model and set currentSessionId
      const conv = get().conversations.find((c) => c.id === id)
      const updates: Partial<AppState> = { activeConversationId: id }
      const ss = sessionStore.getState()
      if (conv?.sessionId) {
        ss.setCurrentSession(
          conv.sessionId,
          conv.provider || ss.currentProvider,
          conv.model || ss.currentModel,
        )
      }

      // No save/restore needed — all transient state lives per-session in sessionStates Map.
      // Switching just changes currentSessionId; components read from the active session automatically.

      // Close artifact panel when switching conversations
      artifactStore.setState({ artifactPanelOpen: false })

      // If this session completed a turn in the background, fetch fresh history
      if (conv?.sessionId && ss.getSessionState(conv.sessionId).needsHistoryRefresh) {
        ss.updateSessionState(conv.sessionId, {
          needsHistoryRefresh: false,
        })
        get().requestSessionHistory(conv.sessionId)
      }

      set(updates)
    },

    setDraftInput: (convId, text, attachments) => {
      const drafts = new Map(get().draftInputs)
      if (!text && attachments.length === 0) {
        drafts.delete(convId)
      } else {
        drafts.set(convId, { text, attachments })
      }
      set({ draftInputs: drafts })
    },

    getDraftInput: (convId) => {
      return get().draftInputs.get(convId)
    },

    clearDraftInput: (convId) => {
      const drafts = new Map(get().draftInputs)
      drafts.delete(convId)
      set({ draftInputs: drafts })
    },

    deleteConversation: (id) => {
      // Clean up per-session state for the deleted conversation
      const conv = get().conversations.find((c) => c.id === id)
      const ss = sessionStore.getState()
      if (conv?.sessionId) {
        // Destroy session on the backend so it's fully removed from disk
        ss.destroySession(conv.sessionId)
        ss.removeSessionState(conv.sessionId)
        // Also clean up message tracking maps
        get()._sessionAssistantMsgIds.delete(conv.sessionId)
        get()._sessionThinkingMsgIds.delete(conv.sessionId)
      }
      get().clearDraftInput(id)

      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id)
        saveConversations(conversations)
        const activeConversationId = reconcileActiveConversationId(
          conversations,
          state.activeConversationId === id ? null : state.activeConversationId,
        )
        const nextActiveConv = conversations.find((c) => c.id === activeConversationId)
        if (nextActiveConv?.sessionId) {
          ss.setCurrentSession(
            nextActiveConv.sessionId,
            nextActiveConv.provider || ss.currentProvider,
            nextActiveConv.model || ss.currentModel,
          )
        } else {
          sessionStore.setState({ currentSessionId: null })
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

        const conv = state.conversations.find((c) => c.id === activeId)
        const sessionId = conv?.sessionId
        let newMsgId: string | null = null

        const conversations = state.conversations.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages]

          // Use per-session tracking to find the target message
          const targetId = sessionId ? (state._sessionAssistantMsgIds.get(sessionId) ?? null) : null
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

        // Track in per-session map
        if (newMsgId && sessionId) {
          state._sessionAssistantMsgIds.set(sessionId, newMsgId)
        }

        // Associate pending citation sources from per-session state
        const citationUpdate: Record<string, unknown> = {}
        if (newMsgId && sessionId) {
          const ss = sessionStore.getState().getSessionState(sessionId)
          if (ss.pendingCitationSources.length > 0) {
            const newCitations = new Map(state.citations)
            newCitations.set(newMsgId, ss.pendingCitationSources)
            citationUpdate.citations = newCitations
            sessionStore.getState().updateSessionState(sessionId, { pendingCitationSources: [] })
          }
        }
        return {
          conversations,
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

        // Associate pending citation sources from per-session state
        const citationUpdate: Record<string, unknown> = {}
        if (newMsgId) {
          const ss = sessionStore.getState().getSessionState(sessionId)
          if (ss.pendingCitationSources.length > 0) {
            const newCitations = new Map(state.citations)
            newCitations.set(newMsgId, ss.pendingCitationSources)
            citationUpdate.citations = newCitations
            sessionStore.getState().updateSessionState(sessionId, { pendingCitationSources: [] })
          }
        }
        return { conversations, ...citationUpdate }
      })
    },

    appendSubAgentProgress: (toolCallId, content, parentToolCallId) => {
      set((state) => {
        const activeId = state.activeConversationId
        if (!activeId) return state

        const conversations = state.conversations.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages]

          // Find existing progress message for this sub-agent
          const targetId = state._subAgentProgressMsgIds.get(toolCallId) ?? null
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            // Append to existing progress message
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            // Create new progress message with stable ID
            const newId = `sa_progress_${toolCallId}`
            messages.push({
              id: newId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
              parentToolCallId,
            })
            state._subAgentProgressMsgIds.set(toolCallId, newId)
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return { conversations }
      })
    },

    appendSubAgentProgressToSession: (sessionId, toolCallId, content, parentToolCallId) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          const messages = [...c.messages]

          const targetId = state._subAgentProgressMsgIds.get(toolCallId) ?? null
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            const newId = `sa_progress_${toolCallId}`
            messages.push({
              id: newId,
              role: 'assistant',
              content,
              timestamp: Date.now(),
              parentToolCallId,
            })
            state._subAgentProgressMsgIds.set(toolCallId, newId)
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        saveConversations(conversations)
        return { conversations }
      })
    },

    appendThinkingText: (content) => {
      set((state) => {
        const activeId = state.activeConversationId
        if (!activeId) return state

        const conv = state.conversations.find((c) => c.id === activeId)
        const sessionId = conv?.sessionId
        let newMsgId: string | null = null

        const conversations = state.conversations.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages]
          const targetId = sessionId ? (state._sessionThinkingMsgIds.get(sessionId) ?? null) : null
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            newMsgId = `think_${Date.now()}`
            messages.push({
              id: newMsgId,
              role: 'assistant',
              content,
              isThinking: true,
              timestamp: Date.now(),
            })
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        // Track in per-session map
        if (newMsgId && sessionId) {
          state._sessionThinkingMsgIds.set(sessionId, newMsgId)
        }

        return { conversations }
      })
    },

    appendThinkingTextToSession: (sessionId, content) => {
      set((state) => {
        const conv = state.conversations.find((c) => c.sessionId === sessionId)
        if (!conv) return state

        const conversations = state.conversations.map((c) => {
          if (c.sessionId !== sessionId) return c
          const messages = [...c.messages]
          const targetId = state._sessionThinkingMsgIds.get(sessionId) ?? null
          const idx = targetId ? messages.findIndex((m) => m.id === targetId) : -1

          if (idx >= 0) {
            const target = messages[idx]
            messages[idx] = { ...target, content: target.content + content }
          } else {
            const newId = `think_${Date.now()}`
            messages.push({
              id: newId,
              role: 'assistant',
              content,
              isThinking: true,
              timestamp: Date.now(),
            })
            state._sessionThinkingMsgIds.set(sessionId, newId)
          }
          return { ...c, messages, updatedAt: Date.now() }
        })

        return { conversations }
      })
    },

    replaceAssistantText: (search, replacement, sessionId?) => {
      set((state) => {
        // Find the conversation — by sessionId or active
        const conv = sessionId
          ? state.conversations.find((c) => c.sessionId === sessionId)
          : state.conversations.find((c) => c.id === state.activeConversationId)
        if (!conv) return state

        // Find the current assistant message — always use per-session tracking
        const resolvedSessionId = sessionId || conv.sessionId
        const targetId = resolvedSessionId
          ? state._sessionAssistantMsgIds.get(resolvedSessionId)
          : undefined
        if (!targetId) return state

        const conversations = state.conversations.map((c) => {
          if (c.id !== conv.id) return c
          const messages = c.messages.map((m) => {
            if (m.id !== targetId) return m
            return { ...m, content: m.content.replace(search, replacement) }
          })
          return { ...c, messages, updatedAt: Date.now() }
        })

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
          return { ...c, messages: serverMessages }
        })
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
      // Include projectId so the server knows where to find project-scoped
      // sessions whose ID doesn't encode the project (e.g. sess_* in a project dir).
      const conv = get().conversations.find((c) => c.sessionId === sessionId)
      connection.sendSessionHistory(sessionId, { projectId: conv?.projectId })

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
          return { ...c, messages: [...newMessages, ...c.messages] }
        })
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
      connection.sendSessionHistory(sessionId, {
        before: minSeq,
        limit: 200,
        projectId: conv.projectId,
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
        _sessionAssistantMsgIds: new Map(),
        _sessionThinkingMsgIds: new Map(),
        _subAgentProgressMsgIds: new Map(),
        citations: new Map(),
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
        draftInputs: new Map(),
        _sessionAssistantMsgIds: new Map(),
        _sessionThinkingMsgIds: new Map(),
        _subAgentProgressMsgIds: new Map(),
        citations: new Map(),
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

// Wire message handler from split handlers
connection.onMessage(handleWsMessage)

// ── Convenience hooks ───────────────────────────────────────────────

export function useConnectionStatus(): ConnectionStatus {
  return useStore((s) => s.connectionStatus)
}

export function useAgentStatus(): AgentStatus {
  return useActiveSessionState((s) => s.status)
}

/** Returns true if the currently active conversation's session is working. */
export function useIsCurrentSessionWorking(): boolean {
  return useActiveSessionState((s) => s.status === 'working')
}
