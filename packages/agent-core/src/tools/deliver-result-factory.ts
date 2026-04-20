/**
 * `deliver_result` — agent → origin conversation handoff. Lifted out of
 * agent.ts so the harness MCP shim can hand it to Codex / Claude Code.
 *
 * Audience is narrow: only scheduled / sub-agent sessions whose context
 * carries an `onDeliverResult` handler get this tool registered. Live
 * user-driven harness sessions never see it (no handler, no tool).
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import type { DeliverResultHandler } from './deliver-result.js'

export function buildDeliverResultTool(handler: DeliverResultHandler): AgentTool {
  return defineTool({
    name: 'deliver_result',
    label: 'Deliver Result',
    description:
      'Send your results back to the conversation that created you. ' +
      'Use this after completing your task to deliver findings, summaries, or data to the user. ' +
      "Only call this when you have meaningful results to share — don't spam empty updates.",
    parameters: Type.Object({
      content: Type.String({
        description:
          'The full result to deliver — findings, data, summaries. Formatted as markdown.',
      }),
      summary: Type.Optional(
        Type.String({
          description: 'One-line summary for notifications (e.g. "Found 5 new AI quotes")',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const output = await handler({
        content: params.content as string,
        summary: params.summary as string | undefined,
      })
      return toolResult(output)
    },
  })
}
