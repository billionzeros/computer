/**
 * TypeScript types for Claude Code's `--output-format stream-json` NDJSON output.
 *
 * Each line of stdout is a JSON object with a `type` field.
 * See: https://docs.anthropic.com/en/docs/claude-code/cli-usage
 */

// ── Content block types ─────────────────────────────────────────────

export interface ClaudeTextBlock {
  type: 'text'
  text: string
}

export interface ClaudeToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ClaudeToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface ClaudeThinkingBlock {
  type: 'thinking'
  thinking: string
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock
  | ClaudeThinkingBlock

// ── Stream event types ──────────────────────────────────────────────

export interface ClaudeSystemEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  tools: string[]
  model?: string
  cwd?: string
  mcp_servers?: { name: string; status: string }[]
}

export interface ClaudeAssistantEvent {
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: ClaudeContentBlock[]
    model: string
    stop_reason?: string
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

export interface ClaudeUserEvent {
  type: 'user'
  message: {
    role: 'user'
    content: ClaudeContentBlock[]
  }
}

export interface ClaudeResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  session_id: string
  is_error: boolean
  total_cost_usd: number
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  result?: string
  error?: string
}

export type ClaudeStreamEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
