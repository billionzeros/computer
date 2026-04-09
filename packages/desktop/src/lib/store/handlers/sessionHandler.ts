/**
 * AI channel: session_created, session_destroyed, sessions_sync_response,
 * session_sync, session_history_response, context_info, usage_stats_response.
 */

import type { AiMessage, SessionHistoryEntry, SyncDelta } from '@anton/protocol'
import type { ArtifactRenderType } from '../../artifacts.js'
import { extractArtifact } from '../../artifacts.js'
import {
  SESSION_CACHE_VERSION,
  type SessionCacheMeta,
  cacheMetaFromServerSession,
  loadSessionCache,
  removeCacheEntry,
  saveSessionCache,
} from '../../conversationCache.js'
import {
  type Conversation,
  reconcileActiveConversationId,
  saveConversations,
} from '../../conversations.js'
import { useStore } from '../../store.js'
import { artifactStore } from '../artifactStore.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import type { ChatImageAttachment, ChatMessage, SessionMeta } from '../types.js'
import { usageStore } from '../usageStore.js'
import { parseCitationSources } from './citationParser.js'

/** Apply sync deltas to conversations and cache */
function cleanupRemovedSession(sessionId: string): void {
  const ss = sessionStore.getState()
  ss.removeSessionState(sessionId)

  const store = useStore.getState()
  store._sessionAssistantMsgIds.delete(sessionId)
  store._sessionThinkingMsgIds.delete(sessionId)
}

function getConversationStateUpdates(conversations: Conversation[]): {
  activeConversationId: string | null
} {
  const store = useStore.getState()
  const nextActiveId = reconcileActiveConversationId(conversations, store.activeConversationId)

  if (nextActiveId !== store.activeConversationId) {
    const ss = sessionStore.getState()
    const nextActiveConv = conversations.find((c) => c.id === nextActiveId)
    if (nextActiveConv?.sessionId) {
      ss.setCurrentSession(
        nextActiveConv.sessionId,
        nextActiveConv.provider || ss.currentProvider,
        nextActiveConv.model || ss.currentModel,
      )
    } else {
      sessionStore.setState({ currentSessionId: null })
    }
  }

  return { activeConversationId: nextActiveId }
}

function applySyncDeltas(deltas: SyncDelta[], newSyncVersion: number): void {
  if (deltas.length === 0) {
    console.log(`[SessionSync] No deltas, updating cache syncVersion to ${newSyncVersion}`)
    const cache = loadSessionCache() || { syncVersion: 0, entries: [] }
    cache.syncVersion = newSyncVersion
    saveSessionCache(cache)
    return
  }

  console.log(`[SessionSync] Applying ${deltas.length} delta(s), version ${newSyncVersion}`)

  const store = useStore.getState()
  let conversations = [...store.conversations]
  const cache = loadSessionCache() || { syncVersion: 0, entries: [] }
  let conversationsChanged = false

  for (const delta of deltas) {
    const { action, sessionId, session } = delta

    // Only manage sess_* conversations in the sidebar
    if (!sessionId.startsWith('sess_')) continue

    const idx = conversations.findIndex((c) => c.sessionId === sessionId)

    if (action === 'I' && session && idx === -1 && session.messageCount > 0) {
      console.log(`[SessionSync] Delta INSERT: ${sessionId} "${session.title}"`)
      conversations.push({
        id: sessionId,
        sessionId,
        title: session.title || 'New conversation',
        messages: [],
        createdAt: session.createdAt,
        updatedAt: session.lastActiveAt,
        provider: session.provider,
        model: session.model,
      })
      if (!cache.entries.some((e) => e.sessionId === sessionId)) {
        cache.entries.push(cacheMetaFromServerSession(session))
      }
      conversationsChanged = true
    } else if (action === 'U' && session && idx >= 0) {
      console.log(`[SessionSync] Delta UPDATE: ${sessionId} "${session.title}"`)

      conversations[idx] = {
        ...conversations[idx],
        title: session.title || conversations[idx].title,
        updatedAt: session.lastActiveAt,
        provider: session.provider,
        model: session.model,
      }
      const cacheIdx = cache.entries.findIndex((e) => e.sessionId === sessionId)
      if (cacheIdx >= 0) {
        cache.entries[cacheIdx] = {
          ...cache.entries[cacheIdx],
          title: session.title,
          updatedAt: session.lastActiveAt,
          provider: session.provider,
          model: session.model,
          messageCount: session.messageCount,
        }
      }
      conversationsChanged = true
    } else if (action === 'D') {
      console.log(`[SessionSync] Delta DELETE: ${sessionId}`)

      if (idx >= 0) {
        conversations = conversations.filter((c) => c.sessionId !== sessionId)
        conversationsChanged = true
      }
      cache.entries = cache.entries.filter((e) => e.sessionId !== sessionId)
      cleanupRemovedSession(sessionId)
    }
  }

  if (conversationsChanged) {
    saveConversations(conversations)
    useStore.setState({
      conversations,
      ...getConversationStateUpdates(conversations),
    })
  }

  // Always persist cache with updated syncVersion
  cache.syncVersion = newSyncVersion
  saveSessionCache(cache)

  // Update sessionStore with delta changes
  const ss = sessionStore.getState()
  const updatedSessionIds = new Set(deltas.map((d) => d.sessionId))
  const updatedSessions = ss.sessions.map((s) => {
    if (!updatedSessionIds.has(s.id)) return s
    const delta = [...deltas].reverse().find((d: SyncDelta) => d.sessionId === s.id)
    if (delta?.session) {
      return { ...s, ...delta.session }
    }
    return s
  })
  for (const delta of deltas) {
    if (
      delta.action === 'I' &&
      delta.session &&
      !updatedSessions.some((s) => s.id === delta.sessionId)
    ) {
      updatedSessions.push(delta.session as SessionMeta)
    }
  }
  const deletedIds = new Set(deltas.filter((d) => d.action === 'D').map((d) => d.sessionId))
  ss.setSessions(updatedSessions.filter((s) => !deletedIds.has(s.id)))
}

function unwrapUserSteering(content: string): { content: string; isSteering: boolean } {
  const match = content.match(
    /^<user_steering>[\s\S]*?User message:\s*"([\s\S]*)"\s*<\/user_steering>\s*$/,
  )
  if (match) {
    return { content: match[1], isSteering: true }
  }
  return { content, isSteering: false }
}

export function handleSessionMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'session_created': {
      const ss = sessionStore.getState()
      ss.setCurrentSession(msg.id, msg.provider, msg.model)
      ss.resolvePendingSession(msg.id)
      useStore.getState().setCurrentSession(msg.id, msg.provider, msg.model)

      // Clear pendingCreation — server has confirmed this session
      const createdStore = useStore.getState()
      const pendingConv = createdStore.conversations.find((c) => c.sessionId === msg.id)
      if (pendingConv?.pendingCreation) {
        console.log(`[SessionSync] Session confirmed by server: ${msg.id}`)
        const updated = createdStore.conversations.map((c) =>
          c.sessionId === msg.id ? { ...c, pendingCreation: false } : c,
        )
        saveConversations(updated)
        useStore.setState({ conversations: updated })
      }
      return true
    }

    case 'context_info': {
      const store = useStore.getState()
      const convs: Conversation[] = store.conversations.map((c) =>
        c.sessionId === msg.sessionId
          ? {
              ...c,
              contextInfo: {
                globalMemories: msg.globalMemories || [],
                conversationMemories: msg.conversationMemories || [],
                crossConversationMemories: msg.crossConversationMemories || [],
                projectId: msg.projectId as string,
              },
            }
          : c,
      )
      // contextInfo is transient — don't persist to localStorage
      useStore.setState({ conversations: convs })
      return true
    }

    case 'sessions_sync_response': {
      const syncVersion = msg.syncVersion as number
      const full = msg.full as boolean

      if (full) {
        // Full bootstrap — server sent complete session list
        const serverSessions = (msg.sessions || []) as SessionMeta[]
        console.log(
          `[SessionSync] Full bootstrap: ${serverSessions.length} session(s) from server, syncVersion=${syncVersion}`,
        )
        sessionStore.getState().setSessions(serverSessions)

        // Full bidirectional reconciliation with conversations
        const store = useStore.getState()
        const serverById = new Map(serverSessions.map((s) => [s.id, s]))
        const staleSessionIds = new Set<string>()
        const reconciled: Conversation[] = []

        // Update existing conversations from server, remove ones server doesn't have
        for (const conv of store.conversations) {
          const serverMeta = serverById.get(conv.sessionId)
          if (serverMeta) {
            // Server has this session — update metadata (server wins)
            reconciled.push({
              ...conv,
              title: serverMeta.title || conv.title,
              updatedAt: serverMeta.lastActiveAt,
              provider: serverMeta.provider,
              model: serverMeta.model,
            })
            serverById.delete(conv.sessionId)
          } else if (!conv.sessionId.startsWith('sess_') || conv.pendingCreation) {
            // Keep non-sess_ conversations (managed elsewhere) and
            // pendingCreation conversations (not yet confirmed by server)
            reconciled.push(conv)
          } else {
            staleSessionIds.add(conv.sessionId)
          }
          // else: sess_* not on server and not pending → dropped (deleted on server)
        }

        // Add new sessions from server that we don't have
        for (const [, s] of serverById) {
          if (!s.id.startsWith('sess_')) continue
          if (s.messageCount === 0) continue
          reconciled.push({
            id: s.id,
            sessionId: s.id,
            title: s.title || 'New conversation',
            messages: [],
            createdAt: s.createdAt,
            updatedAt: s.lastActiveAt,
            provider: s.provider,
            model: s.model,
          })
        }

        const added = reconciled.length - store.conversations.length
        const removed = store.conversations.filter(
          (c) =>
            c.sessionId.startsWith('sess_') && !reconciled.some((r) => r.sessionId === c.sessionId),
        ).length
        console.log(
          `[SessionSync] Bootstrap reconciled: ${reconciled.length} conversations (added ${Math.max(0, added)}, removed ${removed})`,
        )

        saveConversations(reconciled)
        useStore.setState({
          conversations: reconciled,
          ...getConversationStateUpdates(reconciled),
        })

        for (const sessionId of staleSessionIds) {
          cleanupRemovedSession(sessionId)
        }

        // Update cache from server metadata first; enrich only with client-only fields.
        const reconciledById = new Map(reconciled.map((c) => [c.sessionId, c]))
        const cacheEntries: SessionCacheMeta[] = serverSessions
          .filter((s) => s.id.startsWith('sess_') && s.messageCount > 0)
          .map((s) => {
            const reconciledConv = reconciledById.get(s.id)
            return {
              ...cacheMetaFromServerSession(s),
              projectId: reconciledConv?.projectId,
              agentSessionId: reconciledConv?.agentSessionId,
            }
          })
        saveSessionCache({
          syncVersion,
          cacheVersion: SESSION_CACHE_VERSION,
          entries: cacheEntries,
        })
      } else {
        // Incremental sync — apply deltas only
        const deltas = (msg.deltas || []) as SyncDelta[]
        console.log(
          `[SessionSync] Incremental sync: ${deltas.length} delta(s), syncVersion=${syncVersion}`,
        )
        applySyncDeltas(deltas, syncVersion)
      }

      connectionStore.getState().markSynced('sessions')
      return true
    }

    case 'session_sync': {
      // Real-time push from server — apply single delta
      const delta = msg.delta as SyncDelta
      const syncVersion = msg.syncVersion as number
      console.log(
        `[SessionSync] Push: ${delta.action} ${delta.sessionId}, syncVersion=${syncVersion}`,
      )
      applySyncDeltas([delta], syncVersion)
      return true
    }

    case 'usage_stats_response': {
      usageStore.getState().setUsageStats({
        totals: msg.totals,
        byModel: msg.byModel,
        byDay: msg.byDay,
        sessions: msg.sessions,
      })
      return true
    }

    case 'session_history_response': {
      type HistoryEntry = SessionHistoryEntry & {
        attachments?: ChatImageAttachment[]
        messageId?: string
        parentToolCallId?: string
      }

      const uiOnlyHistoryTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      const hiddenHistoryIds = new Set<string>()
      for (const entry of msg.messages as HistoryEntry[]) {
        if (
          entry.role === 'tool_call' &&
          entry.toolName &&
          uiOnlyHistoryTools.has(entry.toolName) &&
          entry.toolId
        ) {
          hiddenHistoryIds.add(entry.toolId)
        }
      }

      // Build ask_user Q&A summary messages
      const askUserSummaries: ChatMessage[] = []
      for (const entry of msg.messages as HistoryEntry[]) {
        if (entry.role === 'tool_result' && entry.toolId && hiddenHistoryIds.has(entry.toolId)) {
          const call = (msg.messages as HistoryEntry[]).find(
            (e: HistoryEntry) => e.role === 'tool_call' && e.toolId === entry.toolId,
          )
          if (call?.toolName === 'ask_user' && entry.content) {
            try {
              const answers = JSON.parse(entry.content) as Record<string, string>
              if (Object.keys(answers).length > 0) {
                askUserSummaries.push({
                  id: `askuser_hist_${entry.toolId}`,
                  role: 'system',
                  content: '',
                  timestamp: entry.ts,
                  askUserAnswers: answers,
                })
              }
            } catch {
              /* not valid JSON, skip */
            }
          }
        }
      }

      const historyMessages: ChatMessage[] = (msg.messages as HistoryEntry[])
        .filter((entry: HistoryEntry) => {
          if (entry.toolId && hiddenHistoryIds.has(entry.toolId)) return false
          return true
        })
        .map((entry: HistoryEntry) => {
          let id = entry.messageId || ''
          if (!id && entry.role === 'tool_call' && entry.toolId) {
            id = `tc_${entry.toolId}`
          } else if (!id && entry.role === 'tool_result' && entry.toolId) {
            id = `tr_${entry.toolId}`
          } else if (!id) {
            id = `hist_${entry.seq}`
          }
          const role =
            entry.role === 'user'
              ? 'user'
              : entry.role === 'assistant'
                ? 'assistant'
                : entry.role === 'tool_call' || entry.role === 'tool_result'
                  ? 'tool'
                  : 'system'

          let content = entry.content
          let isSteering = false
          if (role === 'user') {
            const unwrapped = unwrapUserSteering(content)
            content = unwrapped.content
            isSteering = unwrapped.isSteering
          }

          return {
            id,
            role,
            content,
            timestamp: entry.ts,
            attachments: entry.attachments,
            toolName: entry.toolName,
            toolInput: entry.toolInput,
            isError: entry.isError,
            isThinking: entry.isThinking,
            parentToolCallId: entry.parentToolCallId,
            isSteering,
          } as ChatMessage
        })

      const allMessages = [...historyMessages, ...askUserSummaries].sort(
        (a, b) => a.timestamp - b.timestamp,
      )

      const histSs = sessionStore.getState()
      const isFirstPage = !histSs.getSessionState(msg.id).isLoadingOlder
      histSs.updateSessionState(msg.id, { hasMore: (msg.hasMore ?? false) as boolean })

      const store = useStore.getState()
      if (isFirstPage) {
        store.loadSessionMessages(msg.id, allMessages)
      } else {
        store.prependSessionMessages(msg.id, allMessages)
      }

      // Reconstruct artifacts from server or messages
      const as = artifactStore.getState()
      if (msg.artifacts && Array.isArray(msg.artifacts) && msg.artifacts.length > 0) {
        as.clearArtifacts()
        for (const _a of msg.artifacts) {
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
            renderType: a.renderType as ArtifactRenderType,
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

      // Reconstruct citations from web_search results in history
      {
        const citToolCalls = new Map<string, ChatMessage>()
        for (const m of historyMessages) {
          if (m.id.startsWith('tc_') && m.toolName) {
            citToolCalls.set(m.id.slice(3), m)
          }
        }
        const currentCitations = store.citations
        const newCitations = new Map(currentCitations)
        let pendingSources: import('../types.js').CitationSource[] = []
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
        if (newCitations.size > currentCitations.size) {
          useStore.setState({ citations: newCitations })
        }
      }
      return true
    }

    case 'session_destroyed': {
      const ss = sessionStore.getState()
      ss.setSessions(ss.sessions.filter((s: SessionMeta) => s.id !== msg.id))
      cleanupRemovedSession(msg.id as string)
      const ps = projectStore.getState()
      if (ps.projectSessions.some((s: SessionMeta) => s.id === msg.id)) {
        ps.setProjectSessions(ps.projectSessions.filter((s: SessionMeta) => s.id !== msg.id))
      }

      // Also remove the conversation from the UI store and cache
      const destroyStore = useStore.getState()
      const destroyedConv = destroyStore.conversations.find((c) => c.sessionId === msg.id)
      if (destroyedConv) {
        console.log(`[SessionSync] Session destroyed, removing conversation: ${msg.id}`)
        const updated = destroyStore.conversations.filter((c) => c.sessionId !== msg.id)
        saveConversations(updated)
        useStore.setState({
          conversations: updated,
          ...getConversationStateUpdates(updated),
        })
      }
      removeCacheEntry(msg.id as string)

      return true
    }

    default:
      return false
  }
}
