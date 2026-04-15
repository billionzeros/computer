/**
 * AI channel: tool_call, tool_result, artifact messages.
 */

import type { AiMessage } from '@anton/protocol'
import { useStore } from '../../store.js'
import { artifactStore } from '../artifactStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import { parseCitationSources } from './citationParser.js'
import type { MessageContext } from './shared.js'

export function handleToolMessage(msg: AiMessage, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'tool_call': {
      const ss = sessionStore.getState()
      const sid = ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId
      const uiOnlyTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])

      if (uiOnlyTools.has(msg.name)) {
        // Track hidden tool call in per-session state
        if (sid) {
          const state = ss.getSessionState(sid)
          const hiddenIds = new Set(state.hiddenToolCallIds)
          hiddenIds.add(msg.id)
          ss.updateSessionState(sid, { hiddenToolCallIds: hiddenIds })
        }
        if (sid) ss.setSessionStatus(sid, 'working')
        return true
      }

      // Reset assistant message tracking so text after this tool call creates a new bubble
      if (!msg.parentToolCallId && sid) {
        useStore.getState()._sessionAssistantMsgIds.delete(sid)
      }

      // Track tool call name in per-session state
      if (sid) {
        const state = ss.getSessionState(sid)
        const names = new Map(state.toolCallNames)
        names.set(msg.id, { name: msg.name, input: msg.input })
        ss.updateSessionState(sid, { toolCallNames: names })
      }

      ctx.addMsg({
        id: `tc_${msg.id}`,
        role: 'tool',
        content: `Running: ${msg.name}`,
        toolName: msg.name,
        toolInput: msg.input,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
      })

      if (msg.name === 'web_search' && sid) {
        const state = ss.getSessionState(sid)
        const webSearchIds = new Set(state.pendingWebSearchToolCallIds)
        webSearchIds.add(msg.id)
        ss.updateSessionState(sid, { pendingWebSearchToolCallIds: webSearchIds })
      }

      if (!msg.parentToolCallId && sid) {
        ss.addRoutineStep(sid, {
          id: msg.id,
          type: 'tool_call',
          label: `Running: ${msg.name}`,
          toolName: msg.name,
          status: 'active',
          timestamp: Date.now(),
        })
      }

      if (sid) ss.setSessionStatus(sid, 'working')
      return true
    }

    case 'tool_result': {
      const ss = sessionStore.getState()
      const sid = ctx.msgSessionId || useStore.getState().getActiveConversation()?.sessionId

      // Check per-session hidden tool call IDs
      if (sid) {
        const state = ss.getSessionState(sid)
        if (state.hiddenToolCallIds.has(msg.id)) {
          const hiddenIds = new Set(state.hiddenToolCallIds)
          hiddenIds.delete(msg.id)
          ss.updateSessionState(sid, { hiddenToolCallIds: hiddenIds })
          return true
        }
      }

      // Get tool call info from per-session state
      let callInfo: { name: string; input?: Record<string, unknown> } | undefined
      if (sid) {
        const state = ss.getSessionState(sid)
        callInfo = state.toolCallNames.get(msg.id)
        if (callInfo) {
          const names = new Map(state.toolCallNames)
          names.delete(msg.id)
          ss.updateSessionState(sid, { toolCallNames: names })
        }
      }

      ctx.addMsg({
        id: `tr_${msg.id}`,
        role: 'tool',
        content: msg.output,
        isError: msg.isError,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
        ...(callInfo && { toolName: callInfo.name, toolInput: callInfo.input }),
      })

      if (sid) {
        const state = ss.getSessionState(sid)
        if (state.pendingWebSearchToolCallIds.has(msg.id)) {
          const webSearchIds = new Set(state.pendingWebSearchToolCallIds)
          webSearchIds.delete(msg.id)
          const updates: Partial<import('../sessionStore.js').SessionState> = {
            pendingWebSearchToolCallIds: webSearchIds,
          }
          if (!msg.isError) {
            const sources = parseCitationSources(msg.output)
            if (sources.length > 0) {
              updates.pendingCitationSources = sources
            }
          }
          ss.updateSessionState(sid, updates)
        }
      }

      if (!msg.parentToolCallId && sid) {
        ss.updateRoutineStep(sid, msg.id, { status: msg.isError ? 'error' : 'complete' })
      }
      return true
    }

    case 'artifact': {
      artifactStore.getState().addArtifact({
        id: msg.id,
        type: msg.artifactType,
        renderType: msg.renderType,
        title: msg.title,
        filename: msg.filename,
        filepath: msg.filepath,
        language: msg.language || '',
        content: msg.content,
        toolCallId: `tc_${msg.toolCallId}`,
        timestamp: Date.now(),
        conversationId: useStore.getState().activeConversationId || undefined,
        projectId: projectStore.getState().activeProjectId || undefined,
      })
      return true
    }

    case 'publish_artifact_response': {
      if (msg.success && msg.artifactId) {
        artifactStore
          .getState()
          .updateArtifactPublishStatus(msg.artifactId, msg.publicUrl, msg.slug)
      } else if (!msg.success && msg.error) {
        artifactStore.getState().setPublishError(msg.error)
      }
      return true
    }

    default:
      return false
  }
}
