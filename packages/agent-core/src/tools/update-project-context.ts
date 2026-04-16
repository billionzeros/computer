/**
 * Update Project Context tool — lets a session persist a short summary
 * of what was accomplished plus an optional updated project overview.
 *
 * The tool's execute() just echoes the inputs as JSON; the server's
 * turn loop parses tool_result events for this tool name and then
 * writes `session_summary` + `project_summary` into the project file
 * (same handler for both Pi SDK and harness paths).
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { defineTool, toolResult } from './_helpers.js'

/**
 * Build the `update_project_context` tool definition. Shared between
 * the Pi SDK agent and the harness MCP shim — do not duplicate this
 * schema elsewhere.
 */
export function buildUpdateProjectContextTool(): AgentTool {
  return defineTool({
    name: 'update_project_context',
    label: 'Project Context',
    description:
      'Update the project context with a summary of what was accomplished in this session. ' +
      'Call this once per session when meaningful work has been done (feature implemented, bug fixed, significant decision made). ' +
      'This persists the summary so future sessions have context about past work.',
    parameters: Type.Object({
      session_summary: Type.String({
        description: '1-2 sentence summary of what was accomplished in this session',
      }),
      project_summary: Type.Optional(
        Type.String({
          description:
            'Updated overall project summary incorporating new info. Only provide if something significant changed.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return toolResult(
        JSON.stringify({
          sessionSummary: params.session_summary,
          projectSummary: params.project_summary,
        }),
      )
    },
  })
}
