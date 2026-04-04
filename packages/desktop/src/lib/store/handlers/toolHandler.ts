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
      const uiOnlyTools = new Set(['ask_user', 'task_tracker', 'plan_confirm'])
      if (uiOnlyTools.has(msg.name)) {
        ss._hiddenToolCallIds.add(msg.id)
        ss.setAgentStatus('working', ctx.msgSessionId)
        return true
      }
      // Reset assistant message tracking so text after this tool call creates a new bubble
      if (!msg.parentToolCallId) {
        if (ctx.isForActiveSession) {
          useStore.setState({ _currentAssistantMsgId: null })
        } else if (ctx.msgSessionId) {
          useStore.getState()._sessionAssistantMsgIds.delete(ctx.msgSessionId)
        }
      }
      ss._toolCallNames.set(msg.id, { name: msg.name, input: msg.input })
      ctx.addMsg({
        id: `tc_${msg.id}`,
        role: 'tool',
        content: `Running: ${msg.name}`,
        toolName: msg.name,
        toolInput: msg.input,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
      })
      if (msg.name === 'web_search') {
        useStore.getState()._pendingWebSearchToolCallIds.add(msg.id)
      }
      if (!msg.parentToolCallId) {
        ss.addAgentStep({
          id: msg.id,
          type: 'tool_call',
          label: `Running: ${msg.name}`,
          toolName: msg.name,
          status: 'active',
          timestamp: Date.now(),
        })
      }
      ss.setAgentStatus('working', ctx.msgSessionId)
      return true
    }

    case 'tool_result': {
      const ss = sessionStore.getState()
      if (ss._hiddenToolCallIds.has(msg.id)) {
        ss._hiddenToolCallIds.delete(msg.id)
        return true
      }
      const callInfo = ss._toolCallNames.get(msg.id)
      ctx.addMsg({
        id: `tr_${msg.id}`,
        role: 'tool',
        content: msg.output,
        isError: msg.isError,
        timestamp: Date.now(),
        parentToolCallId: msg.parentToolCallId,
        ...(callInfo && { toolName: callInfo.name, toolInput: callInfo.input }),
      })
      ss._toolCallNames.delete(msg.id)

      const store = useStore.getState()
      if (store._pendingWebSearchToolCallIds.has(msg.id)) {
        store._pendingWebSearchToolCallIds.delete(msg.id)
        if (!msg.isError) {
          const sources = parseCitationSources(msg.output)
          if (sources.length > 0) {
            store._pendingCitationSourcesQueue = sources
          }
        }
      }
      if (!msg.parentToolCallId) {
        ss.updateAgentStep(msg.id, { status: msg.isError ? 'error' : 'complete' })
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
      }
      return true
    }

    default:
      return false
  }
}
