// ── Project types ────────────────────────────────────────────────────

export interface ProjectContext {
  summary: string // auto-maintained by agent after each session
  files: string[] // relevant file paths on server
  notes: string // freeform notes
  stack?: string[] // detected tech stack (for code projects)
}

export interface ProjectStats {
  sessionCount: number
  activeJobs: number
  lastActive: number
}

/** How the project was created */
export type ProjectSource = 'prompt' | 'git-clone' | 'import' | 'manual'

/** Project classification — determines prompt module and UI mode */
export type ProjectType = 'code' | 'document' | 'data' | 'clone' | 'mixed'

export interface Project {
  id: string // e.g. "proj_abc123"
  name: string // "LinkedIn Scraper"
  description: string // "Scrapes VP-level SaaS leads..."
  icon: string // emoji or icon name
  color: string // hex color for UI
  createdAt: number
  updatedAt: number
  context: ProjectContext
  stats: ProjectStats

  // Workspace fields (Phase 1)
  type?: ProjectType // project classification
  workspacePath?: string // absolute path to ~/Anton/{name}/
  source?: ProjectSource // how the project was created
  sourceConversationId?: string // the conversation that triggered creation
}

// ── Job types (runtime not implemented yet) ─────────────────────────

export type JobTrigger =
  | { type: 'cron'; schedule: string }
  | { type: 'manual' }
  | { type: 'event'; event: string }

export type JobStatus = 'active' | 'paused' | 'error' | 'completed'

export interface Job {
  id: string
  projectId: string
  name: string
  description: string
  status: JobStatus
  trigger: JobTrigger
  lastRun: number | null
  nextRun: number | null
  createdAt: number
}

// ── Notification types (runtime not implemented yet) ────────────────

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface NotificationAction {
  label: string
  action: string
}

export interface ProjectNotification {
  id: string
  projectId: string
  jobId?: string
  severity: NotificationSeverity
  title: string
  body: string
  actions?: NotificationAction[]
  read: boolean
  createdAt: number
}
