/**
 * Shared helpers for tool factory modules.
 *
 * Each per-tool file (memory.ts, database.ts, etc.) exports its own
 * `buildXTool()` factory that uses `defineTool` to wrap the impl with
 * proper typing, and `toolResult` to build the AgentToolResult envelope.
 *
 * These helpers are intentionally tiny and colocated so a reader
 * opening any single tool file has everything they need in view.
 */

import type { Static, TSchema } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import type { TextContent } from '@mariozechner/pi-ai'

export function toolResult(output: string, isError = false): AgentToolResult<unknown> {
  const content: TextContent[] = [{ type: 'text', text: output }]
  return { content, details: { raw: output, isError } }
}

/**
 * Type-safe tool builder. Takes a tool spec whose `parameters` is a
 * TypeBox schema; returns an `AgentTool` with its `execute` params
 * typed correctly (via `Static<T>`).
 *
 * Pure passthrough — same semantics as agent.ts's internal `defineTool`.
 */
export function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      toolCallId: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}
