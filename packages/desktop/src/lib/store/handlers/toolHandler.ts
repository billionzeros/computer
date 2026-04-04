/**
 * AI channel: tool_call, tool_result, artifact messages.
 */

import type { WsPayload } from '../../connection.js'
import { useStore } from '../../store.js'
import type {
  WsArtifact,
  WsPublishArtifactResponse,
  WsToolCall,
  WsToolResult,
} from '../../ws-messages.js'
import { artifactStore } from '../artifactStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import { parseCitationSources } from './citationParser.js'
import type { MessageContext } from './shared.js'

export function handleToolMessage(msg: WsPayload, ctx: MessageContext): boolean {
  switch (msg.type) {
    case 'tool_call': {
      const m = msg as unknown as WsToolCall
      const ss = sessionStore.getState()
      const uiOnlyTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      if (uiOnlyTools.has(m.name)) {
        ss._hiddenToolCallIds.add(m.id)
        ss.setAgentStatus('working', ctx.msgSessionId)
        return true
      }
      // Reset assistant message tracking so text after this tool call creates a new bubble
      if (!m.parentToolCallId) {
        if (ctx.isForActiveSession) {
          useStore.setState({ _currentAssistantMsgId: null })
        } else if (ctx.msgSessionId) {
          useStore.getState()._sessionAssistantMsgIds.delete(ctx.msgSessionId)
        }
      }
      ss._toolCallNames.set(m.id, { name: m.name, input: m.input })
      ctx.addMsg({
        id: `tc_${m.id}`,
        role: 'tool',
        content: `Running: ${m.name}`,
        toolName: m.name,
        toolInput: m.input,
        timestamp: Date.now(),
        parentToolCallId: m.parentToolCallId,
      })
      if (m.name === 'web_search') {
        useStore.getState()._pendingWebSearchToolCallIds.add(m.id)
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
      ss.setAgentStatus('working', ctx.msgSessionId)
      return true
    }

    case 'tool_result': {
      const m = msg as unknown as WsToolResult
      const ss = sessionStore.getState()
      if (ss._hiddenToolCallIds.has(m.id)) {
        ss._hiddenToolCallIds.delete(m.id)
        return true
      }
      const callInfo = ss._toolCallNames.get(m.id)
      ctx.addMsg({
        id: `tr_${m.id}`,
        role: 'tool',
        content: m.output,
        isError: m.isError,
        timestamp: Date.now(),
        parentToolCallId: m.parentToolCallId,
        ...(callInfo && { toolName: callInfo.name, toolInput: callInfo.input }),
      })
      ss._toolCallNames.delete(m.id)

      const store = useStore.getState()
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
        ss.updateAgentStep(m.id, { status: m.isError ? 'error' : 'complete' })
      }
      return true
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
        conversationId: useStore.getState().activeConversationId || undefined,
        projectId: projectStore.getState().activeProjectId || undefined,
      })
      return true
    }

    case 'publish_artifact_response': {
      const m = msg as unknown as WsPublishArtifactResponse
      if (m.success && m.artifactId) {
        artifactStore.getState().updateArtifactPublishStatus(m.artifactId, m.publicUrl, m.slug)
      }
      return true
    }

    default:
      return false
  }
}
