/**
 * Routine tool — lets a conversation create, manage, and control routines.
 *
 * A routine is just another conversation that runs on a schedule.
 * Uses a callback pattern to bridge agent-core → agent-server.
 */

export interface RoutineToolInput {
  operation: 'create' | 'list' | 'start' | 'stop' | 'delete' | 'status'
  // Create params
  name?: string
  description?: string
  prompt?: string // instructions for the routine
  schedule?: string // cron expression
  // Action params
  routineId?: string // session ID of the routine
}

// Keep old name as alias for backward compat with server handler signature
export type JobToolInput = RoutineToolInput & {
  // Legacy fields — ignored but kept so the handler type doesn't break
  kind?: string
  command?: string
  args?: string[]
  workingDirectory?: string
  env?: Record<string, string>
  timeout?: number
  restartPolicy?: string
  maxRestarts?: number
  jobId?: string
  tail?: number
}

export type JobActionHandler = (projectId: string, input: JobToolInput) => Promise<string>
