/**
 * Task tracker — session-scoped work plan (Claude Code–style TodoWrite).
 *
 * Unlike the persistent `todo` tool, this is ephemeral and lives only
 * for the current session. The agent uses it to:
 *   1. Declare all planned steps upfront
 *   2. Mark each step as in_progress before starting it
 *   3. Mark it completed when done
 *
 * Each call replaces the full task list (same semantics as Claude Code's TodoWrite).
 * The session emits a `tasks_update` event so the frontend can render
 * a live checklist.
 */

import type { TaskItem, TaskStatus } from '@anton/protocol'

export interface TaskTrackerInput {
  tasks: {
    content: string
    activeForm: string
    status: TaskStatus
  }[]
}

export type TasksUpdateCallback = (tasks: TaskItem[]) => void

/**
 * Execute the task tracker — validates, stores, and notifies.
 * Returns a text summary for the LLM context.
 */
export function executeTaskTracker(
  input: TaskTrackerInput,
  onUpdate?: TasksUpdateCallback,
): string {
  if (!input.tasks || input.tasks.length === 0) {
    return 'Error: tasks array is required and must not be empty.'
  }

  const tasks: TaskItem[] = input.tasks.map((t) => ({
    content: t.content,
    activeForm: t.activeForm,
    status: t.status,
  }))

  // Notify the session so it can emit the event
  onUpdate?.(tasks)

  // Build a summary for the LLM
  const total = tasks.length
  const completed = tasks.filter((t) => t.status === 'completed').length
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length
  const pending = tasks.filter((t) => t.status === 'pending').length

  const lines = tasks.map((t) => {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'
    return `${icon} ${t.content}`
  })

  return `Tasks updated (${completed}/${total} done, ${inProgress} in progress, ${pending} pending):\n${lines.join('\n')}`
}
