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

/**
 * MCP tool invocation. Codex emits this for every MCP server call,
 * including its own hosted "codex_apps" server (Gmail, Calendar, GitHub,
 * etc.) and any user-registered server like Anton's MCP shim.
 *
 * NOTE: Field names changed in newer Codex versions — type is now
 * `mcp_tool_call` (was `mcp_call`), `server` (was `server_label`),
 * `tool` (was `tool_name`); `arguments` is a parsed object (was a JSON
 * string); `result` is an MCP-style structured response (was a string).
 */
export interface CodexMcpToolCallItem {
  id: string
  type: 'mcp_tool_call'
  server: string
  tool: string
  arguments: Record<string, unknown>
  result: CodexMcpResult | null
  error: string | null
  status: 'in_progress' | 'completed'
}

export interface CodexMcpResult {
  content?: Array<{ type: 'text'; text: string } | { type: string; [key: string]: unknown }>
  structured_content?: unknown
}

export type CodexItem = CodexAgentMessageItem | CodexCommandExecutionItem | CodexMcpToolCallItem

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
