/**
 * Workflow Context Builder — assembles the rich system prompt for workflow agents.
 *
 * When a workflow agent runs, instead of flat `agentInstructions`, the agent gets:
 * - Orchestrator prompt (main agent .md)
 * - Sub-agent prompts (loaded as reference sections)
 * - Template/resource files (rubrics, patterns, checklists)
 * - User config (merged with defaults, variables substituted)
 * - Workflow metadata (paths to scripts, workflow dir)
 *
 * All assembled into a single instructions string + memory.
 */

import {
  getWorkflowDir,
  loadWorkflowManifest,
  loadWorkflowMemory,
  loadWorkflowResource,
  loadWorkflowUserConfig,
} from '@anton/agent-config'
import type { WorkflowManifest } from '@anton/protocol'

export interface WorkflowContext {
  /** Assembled system prompt with all workflow content */
  instructions: string
  /** Persistent memory from previous runs (state/memory.md) */
  memory: string | null
}

/**
 * Build the full agent context for a workflow run.
 * This replaces the flat `agentInstructions` string with a rich prompt
 * assembled from all workflow files.
 */
export function buildWorkflowAgentContext(
  projectId: string,
  workflowId: string,
): WorkflowContext | null {
  const manifest = loadWorkflowManifest(projectId, workflowId)
  if (!manifest) return null

  const workflowDir = getWorkflowDir(projectId, workflowId)
  const sections: string[] = []

  // ── 1. Workflow metadata header ──────────────────────────────────
  sections.push(buildMetadataHeader(manifest, workflowDir))

  // ── 2. Load user config + defaults, merge ────────────────────────
  const config = loadMergedConfig(projectId, workflowId)

  // ── 3. Main orchestrator prompt ──────────────────────────────────
  const mainAgent = Object.entries(manifest.agents).find(([, ref]) => ref.role === 'main')
  if (mainAgent) {
    const [, ref] = mainAgent
    const content = loadWorkflowResource(projectId, workflowId, ref.file)
    if (content) {
      sections.push(substituteVariables(content, config, workflowDir))
    }
  }

  // ── 4. Sub-agent prompts as reference sections ───────────────────
  for (const [name, ref] of Object.entries(manifest.agents)) {
    if (ref.role === 'sub') {
      const content = loadWorkflowResource(projectId, workflowId, ref.file)
      if (content) {
        sections.push(
          `\n---\n## Sub-Agent Module: ${name}\n\n${substituteVariables(content, config, workflowDir)}`,
        )
      }
    }
  }

  // ── 5. Resource/template files ───────────────────────────────────
  for (const resourcePath of manifest.resources) {
    const content = loadWorkflowResource(projectId, workflowId, resourcePath)
    if (content) {
      const filename = resourcePath.split('/').pop() || resourcePath
      sections.push(
        `\n---\n## Reference: ${filename}\n\n${substituteVariables(content, config, workflowDir)}`,
      )
    }
  }

  // ── 6. Scripts listing ───────────────────────────────────────────
  const scriptsSection = buildScriptsSection(manifest, workflowDir)
  if (scriptsSection) {
    sections.push(scriptsSection)
  }

  // ── 7. Assemble final instructions ───────────────────────────────
  const instructions = sections.join('\n\n')

  // ── 8. Load workflow memory ──────────────────────────────────────
  const memory = loadWorkflowMemory(projectId, workflowId)

  return { instructions, memory }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildMetadataHeader(manifest: WorkflowManifest, workflowDir: string): string {
  return [
    `# Workflow: ${manifest.name}`,
    ``,
    `> ${manifest.description}`,
    ``,
    `**Workflow directory:** ${workflowDir}`,
    `**Scripts directory:** ${workflowDir}/scripts/`,
    `**Version:** ${manifest.version}`,
    ``,
    `You are a workflow agent. Follow the orchestrator instructions below precisely.`,
    `You have access to connector tools (Gmail, Sheets, Slack, Exa) and can run code via the shell tool.`,
    `Scripts are pre-written in the scripts/ directory — use them. You can also write new code as needed.`,
  ].join('\n')
}

function loadMergedConfig(projectId: string, workflowId: string): Record<string, string> {
  // Load defaults
  const defaultsRaw = loadWorkflowResource(projectId, workflowId, 'config/defaults.json')
  let defaults: Record<string, unknown> = {}
  if (defaultsRaw) {
    try {
      defaults = JSON.parse(defaultsRaw)
    } catch {
      // ignore parse errors
    }
  }

  // Load user config (overrides defaults)
  const userConfig = loadWorkflowUserConfig(projectId, workflowId) || {}

  // Merge: user config takes priority
  const merged = { ...defaults, ...userConfig }

  // Convert all values to strings for substitution
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) {
      result[key] = ''
    } else if (typeof value === 'object') {
      result[key] = JSON.stringify(value)
    } else {
      result[key] = String(value)
    }
  }

  return result
}

function substituteVariables(
  content: string,
  config: Record<string, string>,
  workflowDir: string,
): string {
  let result = content

  // Substitute {{variable}} placeholders
  for (const [key, value] of Object.entries(config)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }

  // Always substitute workflow_dir
  result = result.replaceAll('{{workflow_dir}}', workflowDir)

  return result
}

function buildScriptsSection(manifest: WorkflowManifest, workflowDir: string): string | null {
  // Collect all script paths from agent refs
  const scripts = new Set<string>()
  for (const ref of Object.values(manifest.agents)) {
    if (ref.scripts) {
      for (const s of ref.scripts) scripts.add(s)
    }
  }

  if (scripts.size === 0) return null

  const lines = [
    `\n---\n## Available Scripts`,
    ``,
    `These scripts are pre-written and tested. Run them via the shell tool.`,
    ``,
  ]

  for (const script of scripts) {
    const fullPath = `${workflowDir}/${script}`
    lines.push(`- \`python3 ${fullPath}\` — ${script.split('/').pop()}`)
  }

  lines.push(``)
  lines.push(
    `You can also write new scripts as needed. Save them to ${workflowDir}/scripts/ for reuse.`,
  )

  return lines.join('\n')
}
