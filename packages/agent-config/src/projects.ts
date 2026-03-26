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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectSource, ProjectType } from '@anton/protocol'
import { type SessionMeta, ensureWorkspaceRoot, getAntonDir, getWorkspaceRoot } from './config.js'
import type { AgentConfig } from './config.js'

export type { Project } from '@anton/protocol'

const PROJECTS_DIR = join(getAntonDir(), 'projects')
const INDEX_PATH = join(PROJECTS_DIR, 'index.json')

export function getProjectsDir(): string {
  return PROJECTS_DIR
}

export function getProjectDir(id: string): string {
  return join(PROJECTS_DIR, id)
}

export function getProjectSessionsDir(id: string): string {
  return join(getProjectDir(id), 'conversations')
}


/** Ensure projects directory and index exist */
function ensureProjectsDir(): void {
  if (!existsSync(PROJECTS_DIR)) {
    mkdirSync(PROJECTS_DIR, { recursive: true })
  }
  if (!existsSync(INDEX_PATH)) {
    writeFileSync(INDEX_PATH, '[]', 'utf-8')
  }
}

/** Load the project index */
function loadIndex(): Project[] {
  ensureProjectsDir()
  try {
    const raw = readFileSync(INDEX_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/** Save the project index */
function saveIndex(projects: Project[]): void {
  ensureProjectsDir()
  writeFileSync(INDEX_PATH, JSON.stringify(projects, null, 2), 'utf-8')
}

/** Sanitize a project name into a filesystem-safe directory name */
function toDirectoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'project'
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
  writeFileSync(join(workspacePath, '.anton.json'), JSON.stringify(linkData, null, 2), 'utf-8')
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
  config?: AgentConfig
}): Project {
  ensureProjectsDir()

  const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()

  // Determine workspace path in ~/Anton/{dir-name}/
  const dirName = toDirectoryName(input.name)
  const workspaceRoot = ensureWorkspaceRoot(input.config)
  let workspacePath = join(workspaceRoot, dirName)

  // Handle name collisions by appending a suffix
  if (existsSync(workspacePath)) {
    let suffix = 2
    while (existsSync(`${workspacePath}-${suffix}`)) suffix++
    workspacePath = `${workspacePath}-${suffix}`
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
      notes: '',
    },
    stats: {
      sessionCount: 0,
      activeJobs: 0,
      lastActive: now,
    },
  }

  // Create internal project directory structure (~/.anton/projects/{id}/)
  const dir = getProjectDir(id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'conversations'), { recursive: true })
  mkdirSync(join(dir, 'jobs'), { recursive: true })
  mkdirSync(join(dir, 'notifications'), { recursive: true })
  mkdirSync(join(dir, 'context'), { recursive: true })
  mkdirSync(join(dir, 'files'), { recursive: true })

  // Create user-visible workspace directory (~/Anton/{name}/)
  mkdirSync(workspacePath, { recursive: true })
  writeAntonLink(workspacePath, project)

  // Write project.json
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')

  // Update index
  const index = loadIndex()
  index.unshift(project)
  saveIndex(index)

  return project
}

/** Load all projects from index */
export function loadProjects(): Project[] {
  return loadIndex()
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
  writeFileSync(join(dir, 'project.json'), JSON.stringify(updated, null, 2), 'utf-8')

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
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')

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

/** Save a file to a project's files directory */
export function saveProjectFile(
  projectId: string,
  filename: string,
  content: Buffer,
): string {
  const dir = getProjectDir(projectId)
  const filesDir = join(dir, 'files')
  if (!existsSync(filesDir)) {
    mkdirSync(filesDir, { recursive: true })
  }

  const filePath = join(filesDir, filename)
  writeFileSync(filePath, content)

  // Update project context.files
  const project = loadProject(projectId)
  if (project) {
    if (!project.context.files.includes(filename)) {
      project.context.files.push(filename)
      project.updatedAt = Date.now()
      writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')
      const index = loadIndex()
      const idx = index.findIndex((p) => p.id === projectId)
      if (idx !== -1) {
        index[idx] = project
        saveIndex(index)
      }
    }
  }

  return filePath
}

/** Delete a file from a project's files directory */
export function deleteProjectFile(projectId: string, filename: string): boolean {
  const dir = getProjectDir(projectId)
  const filePath = join(dir, 'files', filename)
  if (!existsSync(filePath)) return false

  rmSync(filePath)

  // Update project context.files
  const project = loadProject(projectId)
  if (project) {
    project.context.files = project.context.files.filter((f) => f !== filename)
    project.updatedAt = Date.now()
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')
    const index = loadIndex()
    const idx = index.findIndex((p) => p.id === projectId)
    if (idx !== -1) {
      index[idx] = project
      saveIndex(index)
    }
  }

  return true
}

/** List files in a project's files directory */
export function listProjectFiles(
  projectId: string,
): { name: string; size: number; mimeType: string }[] {
  const filesDir = join(getProjectDir(projectId), 'files')
  if (!existsSync(filesDir)) return []

  const entries = readdirSync(filesDir, { withFileTypes: true })

  const mimeMap: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    csv: 'text/csv', js: 'text/javascript', ts: 'text/typescript',
    py: 'text/x-python', html: 'text/html', css: 'text/css',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  }

  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const ext = e.name.split('.').pop()?.toLowerCase() || ''
      const stat = statSync(join(filesDir, e.name))
      return {
        name: e.name,
        size: stat.size,
        mimeType: mimeMap[ext] || 'application/octet-stream',
      }
    })
}

/** Delete a project and all its data */
export function deleteProject(id: string): boolean {
  const dir = getProjectDir(id)
  if (!existsSync(dir)) return false

  rmSync(dir, { recursive: true, force: true })

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
 * Build a context string to inject into a project session's system prompt.
 * Includes project metadata, summary, notes, and recent session history.
 */
export function buildProjectContext(project: Project, projectId: string): string {
  let ctx = `\n\n[PROJECT CONTEXT: ${project.name}]`
  if (project.description) {
    ctx += `\nDescription: ${project.description}`
  }
  if (project.type) {
    ctx += `\nType: ${project.type}`
  }
  if (project.workspacePath) {
    ctx += `\nWorkspace: ${project.workspacePath}/`
    ctx += `\nIMPORTANT: Use ${project.workspacePath}/ as the working directory for all shell commands and file operations in this project.`
  }
  if (project.context.summary) {
    ctx += `\n\nProject Summary:\n${project.context.summary}`
  }
  if (project.context.notes) {
    ctx += `\n\nProject Notes:\n${project.context.notes}`
  }

  // Load recent session history (last 5 sessions)
  const historyPath = join(getProjectDir(projectId), 'context', 'session-history.jsonl')
  if (existsSync(historyPath)) {
    try {
      const raw = readFileSync(historyPath, 'utf-8').trim()
      if (raw) {
        const lines = raw.split('\n').slice(-5)
        ctx += '\n\nRecent Sessions:'
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            ctx += `\n- ${entry.title}: ${entry.summary}`
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  ctx += '\n\nYou are working within this project. Use the context above to inform your responses.'
  ctx += '\n[END PROJECT CONTEXT]\n'
  return ctx
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

/** Update project stats (e.g. after session creation) */
export function updateProjectStats(projectId: string): void {
  const project = loadProject(projectId)
  if (!project) return

  const sessions = listProjectSessions(projectId)
  project.stats.sessionCount = sessions.length
  project.stats.lastActive = Date.now()
  project.updatedAt = Date.now()

  const dir = getProjectDir(projectId)
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')

  // Update index
  const index = loadIndex()
  const idx = index.findIndex((p) => p.id === projectId)
  if (idx !== -1) {
    index[idx] = project
    saveIndex(index)
  }
}
