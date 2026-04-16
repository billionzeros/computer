/**
 * TypeScript types for Codex CLI's `--json` JSONL output.
 *
 * Each line of stdout is a JSON object with a `type` field.
 * Event flow: thread.started → turn.started → item.* → turn.completed
 */

// ── Item types ──────────────────────────────────────────────────────

export interface CodexAgentMessageItem {
  id: string
  type: 'agent_message'
  text: string
}

export interface CodexCommandExecutionItem {
  id: string
  type: 'command_execution'
  command: string
  aggregated_output: string
  exit_code: number | null
  status: 'in_progress' | 'completed'
}

export interface CodexMcpCallItem {
  id: string
  type: 'mcp_call'
  server_label: string
  tool_name: string
  arguments: string
  result?: string
  error?: string
  status: 'in_progress' | 'completed'
}

export type CodexItem = CodexAgentMessageItem | CodexCommandExecutionItem | CodexMcpCallItem

// ── Stream event types ──────────────────────────────────────────────

export interface CodexThreadStartedEvent {
  type: 'thread.started'
  thread_id: string
}

export interface CodexTurnStartedEvent {
  type: 'turn.started'
}

export interface CodexItemStartedEvent {
  type: 'item.started'
  item: CodexItem
}

export interface CodexItemCompletedEvent {
  type: 'item.completed'
  item: CodexItem
}

export interface CodexTurnCompletedEvent {
  type: 'turn.completed'
  usage: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens?: number
  }
}

export interface CodexErrorEvent {
  type: 'error'
  message: string
}

export type CodexStreamEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent
  | CodexTurnCompletedEvent
  | CodexErrorEvent
