/**
 * Workspace dual-write for conversation images.
 *
 * Separated from config.ts to avoid circular dependency:
 *   config.ts <-> projects.ts
 * This file imports from projects.ts only, breaking the cycle.
 *
 * NOTE: A circular chain still exists at the module level:
 *   config.ts -> image-storage.ts -> projects.ts -> config.ts
 * This is safe because all cross-module calls happen inside function bodies
 * (never at module evaluation time). Do NOT add top-level side effects that
 * use imports from this chain.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProject } from './projects.js'

/** Extract projectId from any session ID format */
export function extractProjectId(sessionId: string): string | undefined {
  const projMatch = sessionId.match(/^proj_(.+?)_sess_/)
  if (projMatch) return projMatch[1]
  const agentJobMatch = sessionId.match(/^agent-job-(.+?)-job_/)
  if (agentJobMatch) return agentJobMatch[1]
  const agentMatch = sessionId.match(/^(?:agent-run--)?agent--(.+?)--/)
  if (agentMatch) return agentMatch[1]
  return undefined
}

/** Resolve a unique filename in a directory, appending -timestamp if needed. */
function resolveUniqueFilename(dir: string, name: string): string {
  const target = join(dir, name)
  if (!existsSync(target)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${base}-${Date.now()}${ext}`
}

/** Ensure .uploads/ is in the workspace .gitignore */
function ensureGitignoreEntry(workspacePath: string): void {
  const gitignorePath = join(workspacePath, '.gitignore')
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (content.includes('.uploads')) return
      writeFileSync(gitignorePath, `${content.trimEnd()}\n.uploads/\n`, 'utf-8')
    } else {
      writeFileSync(gitignorePath, '.uploads/\n', 'utf-8')
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Copy an image file to the workspace .uploads/ directory.
 * Returns the workspace-relative path (e.g. `.uploads/photo.png`) or undefined on failure.
 */
export function copyImageToWorkspace(
  sessionId: string,
  sourceAbsPath: string,
  sanitizedName: string,
): string | undefined {
  const projectId = extractProjectId(sessionId)
  if (!projectId) return undefined

  const project = loadProject(projectId)
  if (!project?.workspacePath) return undefined

  const uploadsDir = join(project.workspacePath, '.uploads')

  try {
    mkdirSync(uploadsDir, { recursive: true })
    ensureGitignoreEntry(project.workspacePath)
    const uniqueName = resolveUniqueFilename(uploadsDir, sanitizedName)
    const wsAbsPath = join(uploadsDir, uniqueName)
    copyFileSync(sourceAbsPath, wsAbsPath)
    return `.uploads/${uniqueName}`
  } catch {
    // Non-fatal: session copy is the safety net
    return undefined
  }
}
