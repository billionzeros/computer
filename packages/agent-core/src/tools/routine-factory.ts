/**
 * `routine` — create / list / start / stop / delete / status of
 * scheduled routines. Lifted out of agent.ts so the harness MCP shim
 * can hand it to Codex / Claude Code.
 *
 * Project-scoped: only registered when both `projectId` AND a
 * `JobActionHandler` are present. The create / delete operations route
 * through the supplied `AskUserHandler` for confirmation when one is
 * available — same UX as the Pi SDK inline tool.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import type { AskUserHandler } from '../agent.js'
import { humanizeCron } from './cron-humanize.js'
import { defineTool, toolResult } from './_helpers.js'
import type { JobActionHandler, JobToolInput } from './job.js'

export interface RoutineToolDeps {
  projectId: string
  jobActionHandler: JobActionHandler
  askUser?: AskUserHandler
}

export function buildRoutineTool(deps: RoutineToolDeps): AgentTool {
  const { projectId, jobActionHandler, askUser } = deps
  return defineTool({
    name: 'routine',
    label: 'Routine',
    description:
      'Create and manage routines — autonomous conversations that run on a schedule. ' +
      'A routine is its own conversation with full tool and MCP access that executes instructions repeatedly. ' +
      'Operations: create (define a new routine), list (show all routines), start (trigger a run), stop (cancel a run), ' +
      'delete (remove a routine), status (check routine details). ' +
      'IMPORTANT: For create, the user will be asked to confirm before the routine is created.',
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal('create'),
          Type.Literal('list'),
          Type.Literal('start'),
          Type.Literal('stop'),
          Type.Literal('delete'),
          Type.Literal('status'),
        ],
        { description: 'Operation to perform' },
      ),
      name: Type.Optional(
        Type.String({
          description:
            'Routine name (for create, or for delete/start/stop to display in confirmation)',
        }),
      ),
      description: Type.Optional(
        Type.String({ description: 'What the routine does (for create)' }),
      ),
      prompt: Type.Optional(
        Type.String({
          description:
            'Instructions for the routine — what it should do on each run. Be specific.',
        }),
      ),
      schedule: Type.Optional(
        Type.String({
          description:
            'Cron expression for scheduling, e.g. "0 9 * * *" for daily at 9am, "0 */6 * * *" for every 6 hours. Omit for manual-only.',
        }),
      ),
      routine_id: Type.Optional(
        Type.String({ description: 'Routine session ID (for start/stop/delete/status)' }),
      ),
    }),
    async execute(_toolCallId, params) {
      const p = params as {
        operation: 'create' | 'list' | 'start' | 'stop' | 'delete' | 'status'
        name?: string
        description?: string
        prompt?: string
        schedule?: string
        routine_id?: string
      }

      // For create: require user confirmation via ask_user when wired.
      if (p.operation === 'create' && askUser) {
        const humanSchedule = p.schedule ? humanizeCron(p.schedule) : null
        const answers = await askUser([
          {
            question: `Create routine "${p.name || 'Untitled'}"?`,
            description: p.description || '',
            options: ['Yes, create it', 'No, cancel'],
            allowFreeText: false,
            metadata: {
              type: 'routine_create',
              name: p.name || 'Untitled',
              description: p.description || '',
              schedule: humanSchedule,
              cron: p.schedule || null,
              prompt: p.prompt || '',
            },
          },
        ])
        const answer = Object.values(answers)[0]
        if (
          answer &&
          (answer.toLowerCase().includes('no') || answer.toLowerCase().includes('cancel'))
        ) {
          return toolResult('Routine creation cancelled by user.')
        }
      }

      // For delete: also require confirmation.
      if (p.operation === 'delete' && askUser) {
        const displayName = p.name || p.routine_id || 'this routine'
        const answers = await askUser([
          {
            question: `Delete routine "${displayName}"?`,
            description: 'This will remove the routine and its conversation history.',
            options: ['Yes, delete it', 'No, keep it'],
            allowFreeText: false,
            metadata: {
              type: 'routine_delete',
              name: displayName,
              routineId: p.routine_id || '',
            },
          },
        ])
        const answer = Object.values(answers)[0]
        if (
          answer &&
          (answer.toLowerCase().includes('no') || answer.toLowerCase().includes('keep'))
        ) {
          return toolResult('Routine deletion cancelled by user.')
        }
      }

      const input: JobToolInput = {
        operation: p.operation,
        name: p.name,
        description: p.description,
        prompt: p.prompt,
        schedule: p.schedule,
        jobId: p.routine_id,
      }
      const output = await jobActionHandler(projectId, input)
      return toolResult(output)
    },
  })
}
