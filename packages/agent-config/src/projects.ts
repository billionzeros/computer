/**
 * Project persistence — stores project metadata and directory structure.
 *
 * Each project gets its own directory under ~/.anton/projects/ with:
 * - project.json: metadata + context
 * - sessions/: project-scoped sessions (same format as global sessions)
 * - jobs/: job definitions (future)
 * - notifications/: notification feed (future)
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Project,
  ProjectSource,
  ProjectType,
  RoutineMetadata,
  RoutineSession,
} from '@anton/protocol'
import { type SessionMeta, ensureWorkspaceRoot, getAntonDir } from './config.js'
import type { AgentConfig } from './config.js'

export type { Project } from '@anton/protocol'
export type { RoutineMetadata, RoutineSession } from '@anton/protocol'

let _projectsDir: string | undefined
let _indexPath: string | undefined

function projectsDir(): string {
  _projectsDir ??= join(getAntonDir(), 'projects')
  return _projectsDir
}

/**
 * Atomically write JSON to `path`.
 *
 * Crash-safe per-file: writes to `{path}.tmp`, fsyncs, then renames onto the
 * target (POSIX rename is atomic on a single filesystem). Without this, a
 * crash/OOM/power loss mid-write can leave `index.json` or `project.json`
 * truncated, which then JSON.parse-errors and zeroes the user's state.
 *
 * Caveats:
 *  - Not transactional across files. If a caller writes `project.json` and
 *    then `index.json` separately, a crash in between leaves them internally
 *    consistent but logically out of sync. Callers should treat the index as
 *    a view over per-project records and be tolerant of orphans/drift.
 *  - Assumes single-process writers. Multiple processes writing the same
 *    path would race on the shared `.tmp` name. Anton runs a single
 *    agent-server today; if that changes, add a pid/random suffix.
 */
function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  const body = `${JSON.stringify(data, null, 2)}\n`
  const fd = openSync(tmp, 'w')
  try {
    try {
      writeSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, path)
  } catch (err) {
    // Write or rename failed — remove the orphan tmp so it doesn't
    // accumulate on a flaky disk. Swallow the cleanup error: the caller
    // will see the original write failure, which is what matters.
    try {
      rmSync(tmp, { force: true })
    } catch {}
    throw err
  }
}

function indexPath(): string {
  _indexPath ??= join(projectsDir(), 'index.json')
  return _indexPath
}

export function getProjectsDir(): string {
  return projectsDir()
}

export function getProjectDir(id: string): string {
  return join(projectsDir(), id)
}

export function getProjectSessionsDir(id: string): string {
  return join(getProjectDir(id), 'conversations')
}

let _sweptTmpFiles = false

/** Remove `.tmp` files left behind by a SIGKILL between `openSync` and
 *  `renameSync` in writeJsonAtomic. Runs once per process, best-effort.
 *  Without this, orphan tmp files accumulate over time on flaky systems. */
function sweepOrphanTmpFiles(): void {
  if (_sweptTmpFiles) return
  _sweptTmpFiles = true
  const root = projectsDir()
  if (!existsSync(root)) return
  const walk = (d: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.tmp')) {
        try {
          rmSync(full, { force: true })
        } catch {}
      }
    }
  }
  walk(root)
}

/** Ensure projects directory and index exist */
function ensureProjectsDir(): void {
  if (!existsSync(projectsDir())) {
    mkdirSync(projectsDir(), { recursive: true })
  }
  if (!existsSync(indexPath())) {
    writeJsonAtomic(indexPath(), [])
  }
  sweepOrphanTmpFiles()
}

/** Rebuild the index by scanning each `proj_<id>/project.json` under the
 *  projects dir. Used when `index.json` is unreadable (corrupted by a
 *  pre-atomic-write crash). Prevents silent data loss — previous behavior
 *  returned `[]` on JSON.parse errors, which the next `saveIndex([])` would
 *  permanently overwrite. */
function rebuildIndexFromDisk(): Project[] {
  const root = projectsDir()
  if (!existsSync(root)) return []
  const rebuilt: Project[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('proj_')) continue
    const file = join(root, entry.name, 'project.json')
    if (!existsSync(file)) continue
    try {
      rebuilt.push(JSON.parse(readFileSync(file, 'utf-8')))
    } catch {
      // Skip individual corrupt records — preserve the rest.
    }
  }
  return rebuilt
}

/** Load the project index. Falls back to rebuilding from per-project
 *  records if the index file is corrupt, so a single bad JSON parse
 *  doesn't silently zero the user's project list. */
function loadIndex(): Project[] {
  ensureProjectsDir()
  let raw: string
  try {
    raw = readFileSync(indexPath(), 'utf-8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    // Parsed to something other than an array — treat as corrupt.
    throw new Error('index.json is not an array')
  } catch (err) {
    const rebuilt = rebuildIndexFromDisk()
    console.warn(
      `[loadIndex] index.json unreadable (${(err as Error).message}); rebuilt ${rebuilt.length} project(s) from disk`,
    )
    if (rebuilt.length > 0) {
      saveIndex(rebuilt)
    }
    return rebuilt
  }
}

/** Save the project index */
function saveIndex(projects: Project[]): void {
  ensureProjectsDir()
  writeJsonAtomic(indexPath(), projects)
}

/** Sanitize a project name into a filesystem-safe directory name */
function toDirectoryName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'project'
  )
}

/** Write .anton.json link file into a workspace directory */
function writeAntonLink(workspacePath: string, project: Project): void {
  const linkData = {
    projectId: project.id,
    name: project.name,
    createdAt: new Date(project.createdAt).toISOString(),
    type: project.type || 'mixed',
    source: project.source || 'manual',
    sourceConversationId: project.sourceConversationId,
  }
  writeJsonAtomic(join(workspacePath, '.anton.json'), linkData)
}

/** Create a new project with full directory structure */
export function createProject(input: {
  name: string
  description?: string
  icon?: string
  color?: string
  type?: ProjectType
  source?: ProjectSource
  sourceConversationId?: string
  workspacePath?: string // custom location — if not provided, auto-generates
  config?: AgentConfig
}): Project {
  ensureProjectsDir()

  const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()

  // Determine workspace path — use custom if provided, otherwise auto-generate
  let workspacePath: string
  if (input.workspacePath) {
    workspacePath = input.workspacePath
  } else {
    const dirName = toDirectoryName(input.name)
    const workspaceRoot = ensureWorkspaceRoot(input.config)
    workspacePath = join(workspaceRoot, dirName)

    // Handle name collisions by appending a suffix
    if (existsSync(workspacePath)) {
      let suffix = 2
      while (existsSync(`${workspacePath}-${suffix}`)) suffix++
      workspacePath = `${workspacePath}-${suffix}`
    }
  }

  const project: Project = {
    id,
    name: input.name,
    description: input.description || '',
    icon: input.icon || '📁',
    color: input.color || '#6366f1',
    createdAt: now,
    updatedAt: now,
    type: input.type || 'mixed',
    workspacePath,
    source: input.source || 'manual',
    sourceConversationId: input.sourceConversationId,
    context: {
      summary: '',
      files: [],
      notes: input.description || '',
    },
    stats: {
      sessionCount: 0,
      activeRoutines: 0,
      lastActive: now,
    },
  }

  // Create internal project directory structure (~/.anton/projects/{id}/)
  // Note: files/ no longer created here — uploads go directly to workspacePath
  const dir = getProjectDir(id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'conversations'), { recursive: true })
  mkdirSync(join(dir, 'jobs'), { recursive: true })
  mkdirSync(join(dir, 'context'), { recursive: true })

  // Create user-visible workspace directory (~/Anton/{name}/)
  mkdirSync(workspacePath, { recursive: true })
  writeAntonLink(workspacePath, project)

  // Write project.json
  writeJsonAtomic(join(dir, 'project.json'), project)

  // Update index
  const index = loadIndex()
  index.unshift(project)
  saveIndex(index)

  return project
}

/** Load all projects from index, refreshing stats from disk */
export function loadProjects(): Project[] {
  const projects = loadIndex()
  let dirty = false

  for (const project of projects) {
    const sessions = listProjectSessions(project.id)
    if (project.stats.sessionCount !== sessions.length) {
      project.stats.sessionCount = sessions.length
      dirty = true
    }
  }

  if (dirty) {
    saveIndex(projects)
  }

  return projects
}

/** Load a single project by ID */
export function loadProject(id: string): Project | null {
  const dir = getProjectDir(id)
  const path = join(dir, 'project.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** Update a project */
export function updateProject(
  id: string,
  changes: Partial<Pick<Project, 'name' | 'description' | 'icon' | 'color'>>,
): Project | null {
  const project = loadProject(id)
  if (!project) return null

  const updated: Project = {
    ...project,
    ...changes,
    updatedAt: Date.now(),
  }

  const dir = getProjectDir(id)
  writeJsonAtomic(join(dir, 'project.json'), updated)

  // Update index
  const index = loadIndex()
  const idx = index.findIndex((p) => p.id === id)
  if (idx !== -1) {
    index[idx] = updated
    saveIndex(index)
  }

  return updated
}

/** Update a project's context field (notes or summary) */
export function updateProjectContext(
  id: string,
  field: 'notes' | 'summary',
  value: string,
): Project | null {
  const project = loadProject(id)
  if (!project) return null

  project.context[field] = value
  project.updatedAt = Date.now()

  const dir = getProjectDir(id)
  writeJsonAtomic(join(dir, 'project.json'), project)

  // Also persist notes to context/notes.md for injection into sessions
  if (field === 'notes') {
    const contextDir = join(dir, 'context')
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true })
    }
    writeFileSync(join(contextDir, 'notes.md'), value, 'utf-8')
  }

  // Update index
  const index = loadIndex()
  const idx = index.findIndex((p) => p.id === id)
  if (idx !== -1) {
    index[idx] = project
    saveIndex(index)
  }

  return project
}

/** Get the workspace path for file operations (uploaded files live in the workspace) */
function getProjectFilesDir(projectId: string): string | null {
  const project = loadProject(projectId)
  if (!project?.workspacePath) return null
  return project.workspacePath
}

/** Save a file to the project's workspace directory */
export function saveProjectFile(projectId: string, filename: string, content: Buffer): string {
  const filesDir = getProjectFilesDir(projectId)
  if (!filesDir) {
    // Fallback to internal storage if no workspace
    const dir = join(getProjectDir(projectId), 'files')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, filename)
    writeFileSync(filePath, content)
    return filePath
  }

  if (!existsSync(filesDir)) {
    mkdirSync(filesDir, { recursive: true })
  }

  const filePath = join(filesDir, filename)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)

  // Update project context.files tracking
  const project = loadProject(projectId)
  if (project && !project.context.files.includes(filename)) {
    project.context.files.push(filename)
    project.updatedAt = Date.now()
    const dir = getProjectDir(projectId)
    writeJsonAtomic(join(dir, 'project.json'), project)
    const index = loadIndex()
    const idx = index.findIndex((p) => p.id === projectId)
    if (idx !== -1) {
      index[idx] = project
      saveIndex(index)
    }
  }

  return filePath
}

/** Delete a file from the project's workspace directory */
export function deleteProjectFile(projectId: string, filename: string): boolean {
  const filesDir = getProjectFilesDir(projectId)
  const filePath = filesDir
    ? join(filesDir, filename)
    : join(getProjectDir(projectId), 'files', filename)

  if (!existsSync(filePath)) return false
  rmSync(filePath)

  // Update project context.files tracking
  const project = loadProject(projectId)
  if (project) {
    project.context.files = project.context.files.filter((f) => f !== filename)
    project.updatedAt = Date.now()
    const dir = getProjectDir(projectId)
    writeJsonAtomic(join(dir, 'project.json'), project)
    const index = loadIndex()
    const idx = index.findIndex((p) => p.id === projectId)
    if (idx !== -1) {
      index[idx] = project
      saveIndex(index)
    }
  }

  return true
}

const MIME_MAP: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  html: 'text/html',
  css: 'text/css',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/** List files in the project's workspace directory */
export function listProjectFiles(
  projectId: string,
): { name: string; size: number; mimeType: string }[] {
  const filesDir = getProjectFilesDir(projectId)
  if (!filesDir || !existsSync(filesDir)) {
    // Fallback: check internal files/ directory for legacy projects
    const legacyDir = join(getProjectDir(projectId), 'files')
    if (!existsSync(legacyDir)) return []
    return listFilesFromDir(legacyDir)
  }

  return listFilesFromDir(filesDir)
}

function listFilesFromDir(dir: string): { name: string; size: number; mimeType: string }[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name !== '.anton.json')
    .map((e) => {
      const ext = e.name.split('.').pop()?.toLowerCase() || ''
      const stat = statSync(join(dir, e.name))
      return {
        name: e.name,
        size: stat.size,
        mimeType: MIME_MAP[ext] || 'application/octet-stream',
      }
    })
}

/** Delete a project and all its data. Cannot delete the default project. */
export function deleteProject(id: string): boolean {
  const dir = getProjectDir(id)
  if (!existsSync(dir)) return false

  // Load project to get workspace path before deleting
  const project = loadProject(id)

  // Prevent deletion of the default project
  if (project?.isDefault) return false

  rmSync(dir, { recursive: true, force: true })

  // Remove user-visible workspace directory (~/Anton/{name}/)
  if (project?.workspacePath && existsSync(project.workspacePath)) {
    rmSync(project.workspacePath, { recursive: true, force: true })
  }

  // Update index
  const index = loadIndex()
  const filtered = index.filter((p) => p.id !== id)
  saveIndex(filtered)

  return true
}

/** List sessions belonging to a project */
export function listProjectSessions(projectId: string): SessionMeta[] {
  const metas: SessionMeta[] = []

  const dir = join(getProjectDir(projectId), 'conversations')
  if (existsSync(dir)) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (metas.some((m) => m.id === entry.name)) continue
      const metaPath = join(dir, entry.name, 'meta.json')
      if (!existsSync(metaPath)) continue
      try {
        const meta: SessionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        metas.push(meta)
      } catch {
        // skip corrupt entries
      }
    }
  }

  // Sort by lastActiveAt descending
  return metas.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

/**
 * Build project context for injection into a system-reminder block.
 * Returns clean content without bracket wrappers — session.ts wraps in <system-reminder> tags.
 */
export function buildProjectContext(project: Project, projectId: string): string {
  const lines: string[] = []

  lines.push(`- Project: ${project.name}`)
  if (project.description) lines.push(`- Description: ${project.description}`)
  if (project.type) lines.push(`- Type: ${project.type}`)
  if (project.workspacePath) {
    lines.push(`- Project files: ${project.workspacePath}/`)
    lines.push('  Use for ALL user-facing files: code, images, documents, generated artifacts.')
    lines.push('  This is your primary working directory for shell commands and file operations.')
    lines.push(`  User-uploaded images are in ${project.workspacePath}/.uploads/`)
  }

  // Load project instructions (instructions.md)
  const instructions = loadProjectInstructions(projectId)
  if (instructions) {
    lines.push(`\n## Project Instructions\n${instructions}`)
  }

  // Load user preferences (preferences.json)
  const preferences = loadProjectPreferences(projectId)
  if (preferences.length > 0) {
    const prefLines = preferences.map((p) => `- **${p.title}**: ${p.content}`)
    lines.push(`\n## User Preferences\n${prefLines.join('\n')}`)
  }

  if (project.context.summary) {
    lines.push(`\n## Project Summary\n${project.context.summary}`)
  }

  // Legacy notes — kept for backward compat
  if (project.context.notes && !instructions) {
    lines.push(`\n## Project Notes\n${project.context.notes}`)
  }

  // Load recent session history (last 5 sessions)
  const historyPath = join(getProjectDir(projectId), 'context', 'session-history.jsonl')
  if (existsSync(historyPath)) {
    try {
      const raw = readFileSync(historyPath, 'utf-8').trim()
      if (raw) {
        const entries = raw.split('\n').slice(-5)
        const sessionLines: string[] = []
        for (const line of entries) {
          try {
            const entry = JSON.parse(line)
            sessionLines.push(`- ${entry.title}: ${entry.summary}`)
          } catch {
            // skip malformed lines
          }
        }
        if (sessionLines.length > 0) {
          lines.push(`\n## Recent Sessions\n${sessionLines.join('\n')}`)
        }
      }
    } catch {
      // ignore read errors
    }
  }

  lines.push(
    '\nYou are working within this project. Use the context above to inform your responses.',
  )
  return lines.join('\n')
}

/** Append a session summary to the project's session history */
export function appendSessionHistory(
  projectId: string,
  entry: { sessionId: string; title: string; summary: string; ts: number },
): void {
  const contextDir = join(getProjectDir(projectId), 'context')
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true })
  }
  const historyPath = join(contextDir, 'session-history.jsonl')
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, 'utf-8')
}

// ── Project instructions ─────────────────────────────────────────────

/** Load project instructions (instructions.md) */
export function loadProjectInstructions(projectId: string): string {
  const filePath = join(getProjectDir(projectId), 'instructions.md')
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf-8')
}

/** Save project instructions (instructions.md) */
export function saveProjectInstructions(projectId: string, content: string): void {
  const dir = getProjectDir(projectId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'instructions.md'), content, 'utf-8')
}

// ── User preferences (per-project) ──────────────────────────────────

export interface Preference {
  id: string
  title: string
  content: string
  createdAt: number
}

function getPreferencesPath(projectId: string): string {
  return join(getProjectDir(projectId), 'preferences.json')
}

/** Load preferences for a project */
export function loadProjectPreferences(projectId: string): Preference[] {
  const filePath = getPreferencesPath(projectId)
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

/** Save preferences for a project */
function saveProjectPreferences(projectId: string, prefs: Preference[]): void {
  const dir = getProjectDir(projectId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeJsonAtomic(getPreferencesPath(projectId), prefs)
}

/** Add a preference to a project */
export function addProjectPreference(
  projectId: string,
  title: string,
  content: string,
): Preference {
  const prefs = loadProjectPreferences(projectId)
  const pref: Preference = {
    id: `pref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    content,
    createdAt: Date.now(),
  }
  prefs.push(pref)
  saveProjectPreferences(projectId, prefs)
  return pref
}

/** Delete a preference from a project */
export function deleteProjectPreference(projectId: string, preferenceId: string): boolean {
  const prefs = loadProjectPreferences(projectId)
  const filtered = prefs.filter((p) => p.id !== preferenceId)
  if (filtered.length === prefs.length) return false
  saveProjectPreferences(projectId, filtered)
  return true
}

// ── Default project ──────────────────────────────────────────────────

/** Ensure the default "My Computer" project exists. Creates it if missing,
 *  and self-heals incomplete records (missing workspacePath / absent workspace dir).
 *  Self-heal matters: older indexes — or partially-written records — could land
 *  on disk without workspacePath, which downstream forces a `/root` fallback in
 *  the desktop Files view that EACCES on non-root agent-server installs. */
export function ensureDefaultProject(config?: AgentConfig): Project {
  const projects = loadIndex()
  const existing = projects.find((p) => p.isDefault)
  if (existing) {
    const healed: string[] = []

    if (!existing.workspacePath) {
      const workspaceRoot = ensureWorkspaceRoot(config)
      existing.workspacePath = join(workspaceRoot, 'my-computer')
      healed.push('workspacePath')
    }

    let workspaceCreated = false
    if (!existsSync(existing.workspacePath)) {
      mkdirSync(existing.workspacePath, { recursive: true })
      workspaceCreated = true
      healed.push('workspaceDir')
    }

    // Ensure the `.anton.json` marker exists whenever we touched the
    // workspace binding — covers "dir already existed but had no marker"
    // (manual mkdir) as well as "we just created the dir". The marker is
    // what identifies a directory as belonging to an Anton project; tools
    // that scan disk depend on it.
    if (healed.length > 0) {
      const markerPath = join(existing.workspacePath, '.anton.json')
      if (workspaceCreated || !existsSync(markerPath)) {
        writeAntonLink(existing.workspacePath, existing)
      }
    }

    if (healed.length > 0) {
      console.warn(
        `[ensureDefaultProject] Repaired default project ${existing.id}: backfilled [${healed.join(', ')}] → workspacePath=${existing.workspacePath}`,
      )
      // mkdirSync is idempotent + cheap; guards the edge case where the
      // internal project dir was manually deleted while the index still
      // references the project. Without it, writeJsonAtomic throws ENOENT.
      const dir = getProjectDir(existing.id)
      mkdirSync(dir, { recursive: true })
      writeJsonAtomic(join(dir, 'project.json'), existing)
      const idx = projects.findIndex((p) => p.id === existing.id)
      if (idx !== -1) {
        projects[idx] = existing
        saveIndex(projects)
      }
    }

    return existing
  }

  // Create the default project with standard directory structure
  ensureProjectsDir()

  const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()

  const dirName = 'my-computer'
  const workspaceRoot = ensureWorkspaceRoot(config)
  const workspacePath = join(workspaceRoot, dirName)

  const project: Project = {
    id,
    name: 'My Computer',
    description: 'Your default workspace for all tasks',
    icon: '💻',
    color: '#6366f1',
    createdAt: now,
    updatedAt: now,
    type: 'mixed',
    workspacePath,
    source: 'manual',
    isDefault: true,
    context: {
      summary: '',
      files: [],
      notes: '',
    },
    stats: {
      sessionCount: 0,
      activeRoutines: 0,
      lastActive: now,
    },
  }

  // Create internal project directory structure
  const dir = getProjectDir(id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'conversations'), { recursive: true })
  mkdirSync(join(dir, 'jobs'), { recursive: true })
  mkdirSync(join(dir, 'context'), { recursive: true })
  mkdirSync(join(dir, 'files'), { recursive: true })

  // Create user-visible workspace directory
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true })
  }
  writeAntonLink(workspacePath, project)

  // Write project.json
  writeJsonAtomic(join(dir, 'project.json'), project)

  // Update index — default project goes first
  const index = loadIndex()
  index.unshift(project)
  saveIndex(index)

  return project
}

// ── Agent persistence (agent.json in conversation directory) ─────────

/** Load agent metadata from a conversation directory, if it exists */
export function loadAgentMetadata(projectId: string, sessionId: string): RoutineMetadata | null {
  const agentPath = join(getProjectSessionsDir(projectId), sessionId, 'agent.json')
  if (!existsSync(agentPath)) return null
  try {
    return JSON.parse(readFileSync(agentPath, 'utf-8'))
  } catch {
    return null
  }
}

/** Save agent metadata to a conversation directory */
export function saveAgentMetadata(
  projectId: string,
  sessionId: string,
  agent: RoutineMetadata,
): void {
  const dir = join(getProjectSessionsDir(projectId), sessionId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeJsonAtomic(join(dir, 'agent.json'), agent)
}

/** Load agent memory from memory.md in the agent's directory */
export function loadAgentMemory(projectId: string, sessionId: string): string | null {
  const memoryPath = join(getProjectSessionsDir(projectId), sessionId, 'memory.md')
  if (!existsSync(memoryPath)) return null
  return readFileSync(memoryPath, 'utf-8')
}

/** Save agent memory to memory.md in the agent's directory */
export function saveAgentMemory(projectId: string, sessionId: string, memory: string): void {
  const dir = join(getProjectSessionsDir(projectId), sessionId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'memory.md'), memory, 'utf-8')
}

/** Delete agent metadata (and optionally the whole conversation directory) */
export function deleteAgentSession(projectId: string, sessionId: string): boolean {
  const dir = join(getProjectSessionsDir(projectId), sessionId)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/** List all agents in a project (conversations that have agent.json) */
export function listProjectAgents(projectId: string): RoutineSession[] {
  const agents: RoutineSession[] = []
  const dir = getProjectSessionsDir(projectId)
  if (!existsSync(dir)) return agents

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const agentPath = join(dir, entry.name, 'agent.json')
    if (!existsSync(agentPath)) continue

    try {
      const agent: RoutineMetadata = JSON.parse(readFileSync(agentPath, 'utf-8'))
      // Also read meta.json for conversation title/lastActiveAt
      const metaPath = join(dir, entry.name, 'meta.json')
      let title: string | undefined
      let lastActiveAt: number | undefined
      if (existsSync(metaPath)) {
        try {
          const meta: SessionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          title = meta.title
          lastActiveAt = meta.lastActiveAt
        } catch {
          /* skip */
        }
      }

      agents.push({
        sessionId: entry.name,
        projectId,
        agent,
        title,
        lastActiveAt,
      })
    } catch {
      // skip corrupt agent.json
    }
  }

  return agents.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
}

/**
 * Lightweight project listing — reads the index file only, no session-count
 * refresh. Use this in hot paths (slash commands, bindings) where you just
 * need names/ids, not up-to-date stats.
 */
export function listProjectIndex(): Project[] {
  return loadIndex()
}

/** Case-insensitive substring search for projects by name. */
export function findProjectsByName(query: string): Project[] {
  const lower = query.toLowerCase()
  return loadIndex().filter((p) => p.name.toLowerCase().includes(lower))
}

/** Update project stats (e.g. after session creation) */
export function updateProjectStats(projectId: string): void {
  const project = loadProject(projectId)
  if (!project) return

  const sessions = listProjectSessions(projectId)
  project.stats.sessionCount = sessions.length
  project.stats.lastActive = Date.now()
  project.updatedAt = Date.now()

  const dir = getProjectDir(projectId)
  writeJsonAtomic(join(dir, 'project.json'), project)

  // Update index
  const index = loadIndex()
  const idx = index.findIndex((p) => p.id === projectId)
  if (idx !== -1) {
    index[idx] = project
    saveIndex(index)
  }
}
