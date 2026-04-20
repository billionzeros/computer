/**
 * `task_tracker` — session-scoped work plan, lifted out of agent.ts so
 * the harness MCP shim can hand it to Codex / Claude Code.
 *
 * The tool itself runs synchronously and returns a text summary. The
 * `tasks_update` SessionEvent that drives the desktop checklist is
 * emitted by the harness session at the protocol layer when it sees an
 * incoming call to `anton:task_tracker` (codex) or
 * `mcp__anton__task_tracker` (Claude Code) — the same pattern the
 * artifact tool uses. Pi SDK takes a different path (passes a callback
 * via agent.ts because the inline tool has direct access to
 * `Session.emitTasksUpdate`); both end at the same client-visible event.
 *
 * Why this is a fallback for Claude Code: codex emits its own
 * `turn/plan/updated` items which the codex harness session translates
 * into `tasks_update` directly. Claude Code has no equivalent native
 * surface, so without this MCP tool, Claude Code sessions could never
 * populate the desktop task checklist.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { type TaskTrackerInput, executeTaskTracker } from './task-tracker.js'

export function buildTaskTrackerTool(): AgentTool {
  return defineTool({
    name: 'task_tracker',
    label: 'Task Tracker',
    description:
      'Update the task list for the current session. To be used proactively and often to track progress and pending tasks. ' +
      'Make sure that at least one task is in_progress at all times. ' +
      'Always provide both content (imperative) and activeForm (present continuous) for each task. ' +
      'Each call replaces the full task list. Mark tasks as pending/in_progress/completed. ' +
      'Only one task should be in_progress at a time.',
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          content: Type.String({
            description: 'What needs to be done (imperative, e.g. "Run tests")',
          }),
          activeForm: Type.String({
            description: 'Present-continuous form (e.g. "Running tests")',
          }),
          status: Type.Union(
            [Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')],
            { description: 'Task status' },
          ),
        }),
        { description: 'The full task list (replaces previous list)' },
      ),
    }),
    async execute(_toolCallId, params) {
      // No callback here — the harness session detects the call by name
      // and emits the tasks_update event itself.
      const output = executeTaskTracker(params as TaskTrackerInput)
      return toolResult(output)
    },
  })
}
