/**
 * AI channel: session_created, session_destroyed, sessions_list_response,
 * session_history_response, context_info, usage_stats_response.
 */

import type { AiMessage, SessionHistoryEntry } from '@anton/protocol'
import type { ArtifactRenderType } from '../../artifacts.js'
import { extractArtifact } from '../../artifacts.js'
import { type Conversation, saveConversations } from '../../conversations.js'
import { useStore } from '../../store.js'
import { artifactStore } from '../artifactStore.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import type { ChatImageAttachment, ChatMessage, SessionMeta } from '../types.js'
import { usageStore } from '../usageStore.js'
import { parseCitationSources } from './citationParser.js'

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
      saveConversations(convs)
      useStore.setState({ conversations: convs })
      return true
    }

    case 'sessions_list_response': {
      sessionStore.getState().setSessions(msg.sessions)
      connectionStore.getState().markSynced('sessions')
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
          let id: string
          if (entry.role === 'tool_call' && entry.toolId) {
            id = `tc_${entry.toolId}`
          } else if (entry.role === 'tool_result' && entry.toolId) {
            id = `tr_${entry.toolId}`
          } else {
            id = `hist_${entry.seq}_${Date.now()}`
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
      const ps = projectStore.getState()
      if (ps.projectSessions.some((s: SessionMeta) => s.id !== msg.id)) {
        ps.setProjectSessions(ps.projectSessions.filter((s: SessionMeta) => s.id !== msg.id))
      }
      return true
    }

    default:
      return false
  }
}
