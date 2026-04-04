/**
 * Workflow persistence — reads and writes workflow files within projects.
 *
 * Each workflow is a directory at ~/.anton/projects/{pid}/workflows/{wid}/ containing:
 * - workflow.json: manifest
 * - agents/: agent prompt files (.md)
 * - scripts/: Python/Node scripts
 * - templates/: reference files
 * - config/: defaults.json + user-config.json
 * - state/: memory.md + last-run.json (created at runtime)
 * - installed.json: links workflow to its agent session
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InstalledWorkflow, WorkflowManifest } from '@anton/protocol'
import { getProjectDir } from './projects.js'

// ── Path helpers ────────────────────────────────────────────────────

export function getWorkflowsDir(projectId: string): string {
  return join(getProjectDir(projectId), 'workflows')
}

export function getWorkflowDir(projectId: string, workflowId: string): string {
  return join(getWorkflowsDir(projectId), workflowId)
}

// ── Manifest ────────────────────────────────────────────────────────

/** Load and parse workflow.json from a workflow directory */
export function loadWorkflowManifest(
  projectId: string,
  workflowId: string,
): WorkflowManifest | null {
  const manifestPath = join(getWorkflowDir(projectId, workflowId), 'workflow.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return null
  }
}

// ── Resource loading ────────────────────────────────────────────────

/** Read any file from the workflow directory by relative path */
export function loadWorkflowResource(
  projectId: string,
  workflowId: string,
  relativePath: string,
): string | null {
  const filePath = join(getWorkflowDir(projectId, workflowId), relativePath)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ── User config ─────────────────────────────────────────────────────

/** Save user's input answers to config/user-config.json */
export function saveWorkflowUserConfig(
  projectId: string,
  workflowId: string,
  config: Record<string, unknown>,
): void {
  const configDir = join(getWorkflowDir(projectId, workflowId), 'config')
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'user-config.json'), JSON.stringify(config, null, 2), 'utf-8')
}

/** Load user's input answers from config/user-config.json */
export function loadWorkflowUserConfig(
  projectId: string,
  workflowId: string,
): Record<string, unknown> | null {
  const configPath = join(getWorkflowDir(projectId, workflowId), 'config', 'user-config.json')
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return null
  }
}

// ── Installed metadata ──────────────────────────────────────────────

/** Save installed workflow metadata (links workflow to agent session) */
export function saveInstalledMeta(
  projectId: string,
  workflowId: string,
  meta: InstalledWorkflow,
): void {
  const dir = getWorkflowDir(projectId, workflowId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'installed.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

/** Load installed workflow metadata */
export function loadInstalledMeta(projectId: string, workflowId: string): InstalledWorkflow | null {
  const metaPath = join(getWorkflowDir(projectId, workflowId), 'installed.json')
  if (!existsSync(metaPath)) return null
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

// ── Listing ─────────────────────────────────────────────────────────

/** List all installed workflows in a project */
export function listProjectWorkflows(projectId: string): InstalledWorkflow[] {
  const workflows: InstalledWorkflow[] = []
  const dir = getWorkflowsDir(projectId)
  if (!existsSync(dir)) return workflows

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = loadInstalledMeta(projectId, entry.name)
    if (meta) workflows.push(meta)
  }

  return workflows.sort((a, b) => b.installedAt - a.installedAt)
}

// ── State (memory + last run) ───────────────────────────────────────

/** Load workflow-specific memory (state/memory.md) */
export function loadWorkflowMemory(projectId: string, workflowId: string): string | null {
  const memoryPath = join(getWorkflowDir(projectId, workflowId), 'state', 'memory.md')
  if (!existsSync(memoryPath)) return null
  return readFileSync(memoryPath, 'utf-8')
}

/** Save workflow-specific memory (state/memory.md) */
export function saveWorkflowMemory(projectId: string, workflowId: string, memory: string): void {
  const stateDir = join(getWorkflowDir(projectId, workflowId), 'state')
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'memory.md'), memory, 'utf-8')
}

/** Load last run result (state/last-run.json) */
export function loadWorkflowLastRun(
  projectId: string,
  workflowId: string,
): Record<string, unknown> | null {
  const lastRunPath = join(getWorkflowDir(projectId, workflowId), 'state', 'last-run.json')
  if (!existsSync(lastRunPath)) return null
  try {
    return JSON.parse(readFileSync(lastRunPath, 'utf-8'))
  } catch {
    return null
  }
}

/** Save last run result (state/last-run.json) */
export function saveWorkflowLastRun(
  projectId: string,
  workflowId: string,
  lastRun: Record<string, unknown>,
): void {
  const stateDir = join(getWorkflowDir(projectId, workflowId), 'state')
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'last-run.json'), JSON.stringify(lastRun, null, 2), 'utf-8')
}

// ── Deletion ────────────────────────────────────────────────────────

/** Remove a workflow directory entirely */
export function deleteWorkflow(projectId: string, workflowId: string): boolean {
  const dir = getWorkflowDir(projectId, workflowId)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}
