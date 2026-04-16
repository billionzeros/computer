/**
 * Activate Workflow tool — creates all agents defined in a workflow manifest.
 * Called by the bootstrap agent after the user approves the final configuration.
 * Uses a callback to bridge agent-core → agent-server.
 */

export interface ActivateWorkflowInput {
  workflowId: string
}

export type ActivateWorkflowHandler = (projectId: string, workflowId: string) => Promise<string>

// ── Tool factory ────────────────────────────────────────────────────

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { defineTool, toolResult } from './_helpers.js'

/**
 * Build the `activate_workflow` tool definition. Shared between the Pi
 * SDK agent and the harness MCP shim — do not duplicate this schema
 * elsewhere. Gated on `projectId + handler` because both are required
 * to actually install a workflow's agents.
 */
export function buildActivateWorkflowTool(
  projectId: string,
  handler: ActivateWorkflowHandler,
): AgentTool {
  return defineTool({
    name: 'activate_workflow',
    label: 'Activate Workflow',
    description:
      'Activate a workflow by creating all its agents. Call this ONLY after the user has approved the final configuration plan. ' +
      'This creates the scheduled agents defined in the workflow manifest and starts them running.',
    parameters: Type.Object({
      workflow_id: Type.String({
        description: 'The workflow ID to activate (e.g. "lead-qualification")',
      }),
    }),
    async execute(_toolCallId, params) {
      const output = await handler(projectId, params.workflow_id)
      return toolResult(output)
    },
  })
}
