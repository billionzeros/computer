/**
 * Workflow Prompt Loader — loads and assembles workflow agent prompts for eval.
 *
 * Used by the eval harness to inject real workflow instructions into eval sessions.
 * Reads .md agent files and template resources directly from the builtin workflow
 * directory (no project installation needed).
 *
 * This is a lightweight version of workflow-context.ts that doesn't need
 * project config or memory — just the raw prompts with test variable substitution.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashPromptVersion } from '../tracing.js'

export interface WorkflowPrompt {
  /** Assembled prompt text (agent .md + templates, variables substituted). */
  instructions: string
  /** Short hash of the assembled prompt for version tracking. */
  promptVersion: string
}

/**
 * Default test config values used when running evals.
 * These substitute {{variable}} placeholders in agent prompts.
 */
const DEFAULT_TEST_CONFIG: Record<string, string> = {
  target_sheet: 'https://docs.google.com/spreadsheets/d/test-sheet-id',
  icp_description: 'B2B SaaS companies with 50-500 employees, targeting engineering teams',
  lead_sources: 'Typeform, Webflow contact forms, inbound email',
  score_threshold: '70',
  your_name: 'Alex',
  company_name: 'Anton',
  value_prop: 'AI-powered lead qualification platform that automates prospecting',
  slack_channel: '#leads',
}

/**
 * Load and assemble a workflow agent's prompt from the builtin directory.
 *
 * @param workflowDir - Absolute path to the workflow directory (e.g. .../builtin/lead-qualification)
 * @param agentKey - Agent key in the manifest (e.g. "lead-scanner")
 * @param configOverrides - Optional config overrides (merged with defaults)
 */
export function loadWorkflowPrompt(
  workflowDir: string,
  agentKey: string,
  configOverrides?: Record<string, string>,
): WorkflowPrompt | null {
  const manifestPath = join(workflowDir, 'workflow.json')
  if (!existsSync(manifestPath)) return null

  let manifest: {
    name: string
    description: string
    version: string
    agents: Record<string, { file: string; scripts?: string[] }>
    resources: string[]
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return null
  }

  const agentRef = manifest.agents[agentKey]
  if (!agentRef) return null

  // Merge config: defaults → file defaults → overrides
  const config: Record<string, string> = { ...DEFAULT_TEST_CONFIG }

  // Load defaults.json if present
  const defaultsPath = join(workflowDir, 'config', 'defaults.json')
  if (existsSync(defaultsPath)) {
    try {
      const defaults = JSON.parse(readFileSync(defaultsPath, 'utf-8'))
      for (const [k, v] of Object.entries(defaults)) {
        if (v != null) config[k] = String(v)
      }
    } catch {
      // ignore
    }
  }

  // Apply overrides
  if (configOverrides) Object.assign(config, configOverrides)

  const sections: string[] = []

  // Metadata header
  sections.push(
    [
      `# Workflow: ${manifest.name}`,
      '',
      `> ${manifest.description}`,
      '',
      `**Workflow directory:** ${workflowDir}`,
      `**Scripts directory:** ${workflowDir}/scripts/`,
      `**Version:** ${manifest.version}`,
      '',
      'You are a workflow agent running in EVAL MODE.',
      'Follow the instructions below precisely. When you cannot access external tools,',
      'describe what you would do and output the structured result.',
    ].join('\n'),
  )

  // Agent prompt
  const agentContent = readFileSafe(join(workflowDir, agentRef.file))
  if (agentContent) {
    sections.push(
      `\n---\n## Agent Instructions\n\n${substituteVars(agentContent, config, workflowDir)}`,
    )
  }

  // Task file (if per-agent mode with task.md)
  const taskPath = join(workflowDir, 'agents', agentKey, 'task.md')
  const taskContent = readFileSafe(taskPath)
  if (taskContent) {
    sections.push(`\n---\n## YOUR TASK\n\n${substituteVars(taskContent, config, workflowDir)}`)
  }

  // Shared resources/templates
  for (const resourcePath of manifest.resources) {
    const content = readFileSafe(join(workflowDir, resourcePath))
    if (content) {
      const filename = resourcePath.split('/').pop() || resourcePath
      sections.push(
        `\n---\n## Reference: ${filename}\n\n${substituteVars(content, config, workflowDir)}`,
      )
    }
  }

  // Scripts section
  if (agentRef.scripts && agentRef.scripts.length > 0) {
    const scriptLines = [
      '\n---\n## Available Scripts',
      '',
      'These scripts are available for this agent:',
      '',
    ]
    for (const script of agentRef.scripts) {
      scriptLines.push(`- \`python3 ${workflowDir}/${script}\` — ${script.split('/').pop()}`)
    }
    sections.push(scriptLines.join('\n'))
  }

  const instructions = sections.join('\n\n')
  const promptVersion = hashPromptVersion(instructions)

  return { instructions, promptVersion }
}

// ── Helpers ─────────────────────────────────────────────────────────

function readFileSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function substituteVars(
  content: string,
  config: Record<string, string>,
  workflowDir: string,
): string {
  let result = content
  for (const [key, value] of Object.entries(config)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  result = result.replaceAll('{{workflow_dir}}', workflowDir)
  return result
}
