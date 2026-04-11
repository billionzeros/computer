/**
 * Groups consecutive tool messages into collapsible action blocks.
 * Ported from desktop groupMessages.ts, simplified for mobile.
 */

import type { ChatMessage } from './store/types'

export interface ToolAction {
  call: ChatMessage
  result: ChatMessage | null
}

export type GroupedItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'actions'; actions: ToolAction[]; id: string }
  | {
      type: 'task_section'
      title: string
      actions: ToolAction[]
      done: boolean
      id: string
    }

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

function isStepNarration(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant' || msg.isThinking) return false
  const text = stripThinkTags(msg.content)
  if (text.length > 120 || text.length < 3) return false
  if (text.includes('\n\n')) return false
  if (text.match(/^#{1,3}\s/m) || text.match(/^[-*]\s/m) || text.includes('```')) return false
  return true
}

const hiddenTools = new Set(['ask_user', 'plan_confirm', 'task_tracker'])

export function groupMessages(messages: ChatMessage[]): GroupedItem[] {
  const raw: GroupedItem[] = []
  let currentActions: ToolAction[] = []
  let pendingCall: ChatMessage | null = null
  const unmatchedCalls = new Map<string, number>()
  const hiddenCallIds = new Set<string>()

  // Collect sub-agent lifecycle IDs
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

  for (const msg of messages) {
    // Non-tool messages flush and get added as-is
    if (msg.role !== 'tool') {
      if (msg.role === 'assistant' && !msg.isThinking && stripThinkTags(msg.content).length === 0) {
        continue
      }
      // Sub-agent progress: skip (handled within sub-agent groups on desktop)
      if (msg.role === 'assistant' && msg.parentToolCallId) {
        continue
      }
      flushActions()
      raw.push({ type: 'message', message: msg })
      continue
    }

    // Hidden tools
    if (msg.toolName && hiddenTools.has(msg.toolName)) {
      const baseId = msg.id.startsWith('tc_') ? msg.id.slice(3) : msg.id
      hiddenCallIds.add(baseId)
      continue
    }

    // Sub-agent lifecycle messages: skip (they clutter the mobile view)
    if (msg.id.startsWith('sa_start_') || msg.id.startsWith('sa_end_')) {
      continue
    }

    // Skip sub-agent tc_/tr_ when lifecycle handled them
    if (msg.toolName === 'sub_agent' && !msg.parentToolCallId) {
      const baseId = msg.id.startsWith('tc_') ? msg.id.slice(3) : msg.id
      if (subAgentLifecycleIds.has(baseId)) continue
    }

    // Skip child tool calls of sub-agents (we don't nest on mobile)
    if (msg.parentToolCallId) {
      continue
    }

    // Regular tool message - pair calls with results
    const isToolCall = msg.id.startsWith('tc_') || (msg.toolName && !msg.id.startsWith('tr_'))

    if (isToolCall) {
      if (pendingCall) {
        const idx = currentActions.length
        currentActions.push({ call: pendingCall, result: null })
        const baseId = pendingCall.id.startsWith('tc_') ? pendingCall.id.slice(3) : pendingCall.id
        unmatchedCalls.set(baseId, idx)
      }
      pendingCall = msg
    } else {
      // Tool result
      const resultBaseId = msg.id.startsWith('tr_') ? msg.id.slice(3) : msg.id

      if (hiddenCallIds.has(resultBaseId)) continue
      if (subAgentLifecycleIds.has(resultBaseId)) continue

      if (pendingCall) {
        const pendingBaseId = pendingCall.id.startsWith('tc_')
          ? pendingCall.id.slice(3)
          : pendingCall.id

        if (pendingBaseId === resultBaseId) {
          currentActions.push({ call: pendingCall, result: msg })
          pendingCall = null
        } else if (unmatchedCalls.has(resultBaseId)) {
          const idx = unmatchedCalls.get(resultBaseId)!
          currentActions[idx] = { call: currentActions[idx].call, result: msg }
          unmatchedCalls.delete(resultBaseId)
        } else {
          currentActions.push({ call: pendingCall, result: msg })
          pendingCall = null
        }
      } else if (unmatchedCalls.has(resultBaseId)) {
        const idx = unmatchedCalls.get(resultBaseId)!
        currentActions[idx] = { call: currentActions[idx].call, result: msg }
        unmatchedCalls.delete(resultBaseId)
      }
    }
  }

  flushActions()

  // Post-processing: merge step narrations + tool groups into task_sections
  const result: GroupedItem[] = []

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]

    if (
      item.type === 'message' &&
      isStepNarration(item.message) &&
      i + 1 < raw.length &&
      raw[i + 1].type === 'actions'
    ) {
      const next = raw[i + 1] as { type: 'actions'; actions: ToolAction[]; id: string }
      const title = stripThinkTags(item.message.content)
      const allDone = next.actions.every((a) => a.result !== null)
      result.push({
        type: 'task_section',
        title,
        actions: next.actions,
        done: allDone,
        id: `task_${item.message.id}`,
      })
      i++ // skip the actions group
      continue
    }

    result.push(item)
  }

  return result
}

// ── Human-readable action labels ──

export function getActionLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return formatToolName(toolName)

  switch (toolName) {
    case 'shell': {
      const cmd = ((toolInput.command as string) || '').trim()
      if (cmd.length > 60) return `${cmd.slice(0, 57)}...`
      return cmd || 'Running command'
    }
    case 'filesystem': {
      const op = toolInput.operation as string
      const path = (toolInput.path as string) || ''
      const shortPath = path.split('/').slice(-2).join('/')
      switch (op) {
        case 'read':
          return `Reading ${shortPath}`
        case 'write':
        case 'create':
          return `Writing ${shortPath}`
        case 'list':
          return `Listing ${shortPath}`
        case 'tree':
          return `Exploring ${shortPath}`
        case 'search':
          return `Searching ${shortPath}`
        default:
          return `${op || 'File'} ${shortPath}`
      }
    }
    case 'browser': {
      const op = toolInput.operation as string
      switch (op) {
        case 'open':
          return `Opening ${((toolInput.url as string) || '').slice(0, 40)}`
        case 'screenshot':
          return 'Capturing screenshot'
        case 'snapshot':
          return 'Reading page'
        case 'click':
          return `Clicking ${toolInput.ref || 'element'}`
        case 'fetch':
          return `Fetching ${((toolInput.url as string) || '').slice(0, 40)}`
        default:
          return `Browser: ${op}`
      }
    }
    case 'git': {
      const op = toolInput.operation as string
      return `Git ${op || 'operation'}`
    }
    case 'sub_agent':
      return (toolInput.task as string)?.slice(0, 60) || 'Sub-agent'
    default: {
      const path = toolInput.file_path || toolInput.path || toolInput.pattern
      if (path) return `${formatToolName(toolName)} ${String(path).split('/').slice(-2).join('/')}`
      return formatToolName(toolName)
    }
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
