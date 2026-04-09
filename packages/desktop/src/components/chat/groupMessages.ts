import type { ChatMessage } from '../../lib/store.js'

export interface ToolAction {
  call: ChatMessage
  result: ChatMessage | null
}

export type GroupedItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'actions'; actions: ToolAction[]; id: string }
  | {
      type: 'sub_agent'
      toolCallId: string
      task: string
      agentType?: 'research' | 'execute' | 'verify'
      actions: ToolAction[]
      progressContent: string | null // accumulated streaming text from the sub-agent
      result: ChatMessage | null // the final sub_agent tool_result from the parent
      id: string
    }
  | {
      type: 'task_section'
      title: string
      actions: ToolAction[]
      textContent: string | null // any assistant text that came after the actions
      done: boolean
      id: string
    }

/**
 * Strip <think>…</think> blocks emitted inline by some models.
 * Handles both closed blocks and an unclosed trailing block from streaming.
 */
function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

/**
 * Detect if a message looks like a step narration (short, action-oriented).
 * These get merged with their following tool actions into task_section items.
 */
function isStepNarration(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant' || msg.isThinking) return false
  const text = stripThinkTags(msg.content)
  // Must be short (step title, not a full response)
  if (text.length > 120 || text.length < 3) return false
  // Must not contain multiple sentences or paragraphs (that's a full response)
  if (text.includes('\n\n')) return false
  // Must not contain markdown headers, lists, or code blocks (that's content)
  if (text.match(/^#{1,3}\s/m) || text.match(/^[-*]\s/m) || text.includes('```')) return false
  return true
}

/**
 * Groups consecutive tool messages into action blocks.
 * Tool calls (have toolName) are paired with their following result (no toolName).
 * Sub-agent tool calls collect their child events into nested groups.
 *
 * Post-processing merges short step narrations + following tool groups
 * into task_section items for Manus-style progress display.
 */
export function groupMessages(messages: ChatMessage[]): GroupedItem[] {
  const raw: GroupedItem[] = []
  let currentActions: ToolAction[] = []
  let pendingCall: ChatMessage | null = null
  const subAgentLifecycleIds = new Set(
    messages
      .filter(
        (msg) =>
          msg.role === 'tool' &&
          msg.toolName === 'sub_agent' &&
          !msg.parentToolCallId &&
          msg.id.startsWith('sa_start_'),
      )
      .map((msg) => msg.id.slice('sa_start_'.length)),
  )

  // Track unmatched tool calls for parallel call/result pairing.
  // Key: base ID (without tc_/tr_ prefix), Value: index in currentActions
  const unmatchedCalls = new Map<string, number>()

  // Track active sub-agent groups: toolCallId -> sub-agent state
  type AgentType = 'research' | 'execute' | 'verify'
  const subAgentGroups = new Map<
    string,
    {
      task: string
      agentType?: AgentType
      actions: ToolAction[]
      pendingCall: ChatMessage | null
      progressContent: string | null
    }
  >()
  function flushActions() {
    if (pendingCall) {
      currentActions.push({ call: pendingCall, result: null })
      pendingCall = null
    }
    if (currentActions.length > 0) {
      raw.push({
        type: 'actions',
        actions: currentActions,
        id: `actions_${currentActions[0].call.id}`,
      })
      currentActions = []
    }
    unmatchedCalls.clear()
  }

  // Tool names that should be hidden from the actions timeline.
  // Their call+result pairs are silently discarded.
  const hiddenTools = new Set(['ask_user', 'plan_confirm', 'task_tracker'])
  // Track IDs of hidden tool calls so we can discard their results
  // even if they arrive after a flush (e.g. after an assistant text message).
  const hiddenCallIds = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'tool') {
      if (msg.role === 'assistant' && !msg.isThinking && stripThinkTags(msg.content).length === 0) {
        continue
      }
      // Route assistant progress messages to their sub-agent group
      if (
        msg.role === 'assistant' &&
        msg.parentToolCallId &&
        subAgentGroups.has(msg.parentToolCallId)
      ) {
        const group = subAgentGroups.get(msg.parentToolCallId)!
        group.progressContent = (group.progressContent || '') + msg.content
        continue
      }
      flushActions()
      raw.push({ type: 'message', message: msg })
      continue
    }

    // Hidden tools: track their ID and skip entirely (don't add to actions or pendingCall)
    if (msg.toolName && hiddenTools.has(msg.toolName)) {
      const baseId = msg.id.startsWith('tc_') ? msg.id.slice(3) : msg.id
      hiddenCallIds.add(baseId)
      continue
    }

    // Fallback for restored history: when sa_start_/sa_end_ were not persisted,
    // synthesize the sub-agent group from the original parent tc_/tr_ pair.
    if (msg.toolName === 'sub_agent' && !msg.parentToolCallId && msg.id.startsWith('tc_')) {
      const toolCallId = msg.id.slice('tc_'.length)
      if (subAgentLifecycleIds.has(toolCallId)) {
        continue
      }

      if (pendingCall) {
        currentActions.push({ call: pendingCall, result: null })
        pendingCall = null
      }

      const rawType = msg.toolInput?.type as string | undefined
      const validTypes = new Set<AgentType>(['research', 'execute', 'verify'])
      subAgentGroups.set(toolCallId, {
        task: (msg.toolInput?.task as string) || msg.content,
        agentType:
          rawType && validTypes.has(rawType as AgentType) ? (rawType as AgentType) : undefined,
        actions: [],
        pendingCall: null,
        progressContent: null,
      })
      continue
    }

    // Sub-agent start: begin collecting a sub-agent group (only from sa_start_ messages)
    if (msg.toolName === 'sub_agent' && !msg.parentToolCallId && msg.id.startsWith('sa_start_')) {
      // Flush any pending top-level actions first
      if (pendingCall) {
        currentActions.push({ call: pendingCall, result: null })
        pendingCall = null
      }

      const toolCallId = msg.id.slice('sa_start_'.length)

      const rawType = msg.toolInput?.type as string | undefined
      const validTypes = new Set<AgentType>(['research', 'execute', 'verify'])
      subAgentGroups.set(toolCallId, {
        task: (msg.toolInput?.task as string) || msg.content,
        agentType:
          rawType && validTypes.has(rawType as AgentType) ? (rawType as AgentType) : undefined,
        actions: [],
        pendingCall: null,
        progressContent: null,
      })
      continue
    }

    // Sub-agent end: close the group and emit it inline (NOT as a child event)
    if (
      msg.id.startsWith('sa_end_') &&
      msg.parentToolCallId &&
      subAgentGroups.has(msg.parentToolCallId)
    ) {
      const tcId = msg.parentToolCallId
      const group = subAgentGroups.get(tcId)!
      if (group.pendingCall) {
        group.actions.push({ call: group.pendingCall, result: null })
        group.pendingCall = null
      }
      subAgentGroups.delete(tcId)
      flushActions()
      raw.push({
        type: 'sub_agent',
        toolCallId: tcId,
        task: group.task,
        agentType: group.agentType,
        actions: group.actions,
        progressContent: group.progressContent,
        result: msg,
        id: `sub_agent_${tcId}`,
      })
      continue
    }

    // Check if this message belongs to a sub-agent
    if (msg.parentToolCallId && subAgentGroups.has(msg.parentToolCallId)) {
      const group = subAgentGroups.get(msg.parentToolCallId)!

      if (msg.toolName) {
        // Sub-agent tool call
        if (group.pendingCall) {
          group.actions.push({ call: group.pendingCall, result: null })
        }
        group.pendingCall = msg
      } else {
        // Sub-agent tool result or sub_agent_end
        if (group.pendingCall) {
          group.actions.push({ call: group.pendingCall, result: msg })
          group.pendingCall = null
        }
      }
      continue
    }

    // Restored history only has the parent tr_ result, so close fallback sub-agent groups here.
    if (!msg.toolName && !msg.parentToolCallId) {
      const toolCallId = msg.id.startsWith('tr_') ? msg.id.slice('tr_'.length) : msg.id
      if (subAgentGroups.has(toolCallId) && !subAgentLifecycleIds.has(toolCallId)) {
        const group = subAgentGroups.get(toolCallId)!
        if (group.pendingCall) {
          group.actions.push({ call: group.pendingCall, result: null })
          group.pendingCall = null
        }
        subAgentGroups.delete(toolCallId)

        flushActions()
        raw.push({
          type: 'sub_agent',
          toolCallId,
          task: group.task,
          agentType: group.agentType,
          actions: group.actions,
          progressContent: group.progressContent,
          result: msg,
          id: `sub_agent_${toolCallId}`,
        })
        pendingCall = null
        continue
      }
    }

    // Regular top-level tool message
    // Distinguish calls from results by ID prefix: tc_ = call, tr_ = result.
    // Cannot rely on toolName alone since results inherit toolName from their call.
    const isToolCall = msg.id.startsWith('tc_') || (msg.toolName && !msg.id.startsWith('tr_'))
    if (isToolCall) {
      if (pendingCall) {
        // Push previous pending call as unmatched (parallel calls scenario)
        const idx = currentActions.length
        currentActions.push({ call: pendingCall, result: null })
        // Track by base ID so we can match its result later
        const baseId = pendingCall.id.startsWith('tc_') ? pendingCall.id.slice(3) : pendingCall.id
        unmatchedCalls.set(baseId, idx)
      }
      pendingCall = msg
    } else {
      // This is a tool result — try to match it to a call by ID
      const resultBaseId = msg.id.startsWith('tr_') ? msg.id.slice(3) : msg.id

      // Silently discard results of hidden tool calls
      if (hiddenCallIds.has(resultBaseId)) {
        continue
      }

      // Skip redundant tr_ for sub_agent calls when sa_start_/sa_end_ handled the lifecycle.
      if (subAgentLifecycleIds.has(resultBaseId)) {
        continue
      }

      if (pendingCall) {
        const pendingBaseId = pendingCall.id.startsWith('tc_')
          ? pendingCall.id.slice(3)
          : pendingCall.id

        if (pendingBaseId === resultBaseId) {
          // Direct match with pending call
          currentActions.push({ call: pendingCall, result: msg })
          pendingCall = null
        } else if (unmatchedCalls.has(resultBaseId)) {
          // Match with a previously pushed unmatched call (parallel scenario)
          const idx = unmatchedCalls.get(resultBaseId)!
          currentActions[idx] = { call: currentActions[idx].call, result: msg }
          unmatchedCalls.delete(resultBaseId)
        } else {
          // Fallback: pair with pending call sequentially
          currentActions.push({ call: pendingCall, result: msg })
          pendingCall = null
        }
      } else if (unmatchedCalls.has(resultBaseId)) {
        // No pending call, but we have an unmatched call for this ID
        const idx = unmatchedCalls.get(resultBaseId)!
        currentActions[idx] = { call: currentActions[idx].call, result: msg }
        unmatchedCalls.delete(resultBaseId)
      } else {
        // Orphaned result — use its own toolName if available (inherited from tool_call in store)
        currentActions.push({
          call: {
            ...msg,
            toolName: msg.toolName || 'unknown',
            toolInput: msg.toolInput,
            content: msg.content,
          },
          result: msg,
        })
      }
    }
  }

  // Flush any remaining sub-agent groups that haven't been closed
  for (const [toolCallId, group] of subAgentGroups) {
    if (group.pendingCall) {
      group.actions.push({ call: group.pendingCall, result: null })
    }
    flushActions()
    raw.push({
      type: 'sub_agent',
      toolCallId,
      task: group.task,
      agentType: group.agentType as 'research' | 'execute' | 'verify' | undefined,
      actions: group.actions,
      progressContent: group.progressContent,
      result: null,
      id: `sub_agent_${toolCallId}`,
    })
  }

  flushActions()

  // ── Post-processing: merge step narrations + tool groups into task_sections ──
  //
  // Pattern: [short assistant message] → [actions/sub_agent group] = task_section
  // This creates Manus-style collapsible step cards.
  const result: GroupedItem[] = []

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]

    // Check if this is a step narration followed by an actions group
    if (
      item.type === 'message' &&
      isStepNarration(item.message) &&
      i + 1 < raw.length &&
      (raw[i + 1].type === 'actions' || raw[i + 1].type === 'sub_agent')
    ) {
      const next = raw[i + 1]
      const title = stripThinkTags(item.message.content)

      if (next.type === 'actions') {
        const allDone = next.actions.every((a) => a.result !== null)
        result.push({
          type: 'task_section',
          title,
          actions: next.actions,
          textContent: null,
          done: allDone,
          id: `task_${item.message.id}`,
        })
        i++ // skip the actions group, we consumed it
      } else if (next.type === 'sub_agent') {
        // Convert sub_agent into task_section
        result.push({
          type: 'task_section',
          title,
          actions: next.actions,
          textContent: null,
          done: !!next.result,
          id: `task_${item.message.id}`,
        })
        i++ // skip the sub_agent group
      }
      continue
    }

    result.push(item)
  }

  return result
}
