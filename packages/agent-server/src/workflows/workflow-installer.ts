/**
 * Workflow Installer — installs workflow directories into projects
 * and activates agents after user completes setup.
 *
 * Flow: install() → user completes bootstrap → activateWorkflow() → agents created
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import {
  getWorkflowDir,
  getWorkflowStateDbPath,
  getWorkflowsDir,
  loadInstalledMeta,
  loadWorkflowManifest,
  loadWorkflowResource,
  deleteWorkflow as removeWorkflowDir,
  saveAgentMetadata,
  saveInstalledMeta,
  saveProjectInstructions,
  saveWorkflowUserConfig,
} from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { InstalledWorkflow, WorkflowManifest } from '@anton/protocol'
import type { AgentManager } from '../agents/agent-manager.js'
import { WorkflowStateDb } from './shared-state-db.js'

const log = createLogger('workflow-installer')

/**
 * Callback that validates a routine's provider/model pair. Owned by
 * server.ts (needs `this.config`); injected here to avoid reaching
 * back into server internals from the installer.
 */
export type ProviderModelValidator = (
  provider: string | undefined,
  model: string | undefined,
) => { ok: true } | { ok: false; error: string }

export class WorkflowInstaller {
  constructor(
    private agentManager: AgentManager,
    private validateProviderModel?: ProviderModelValidator,
  ) {}

  /**
   * Install a workflow from a source directory into a project.
   * Does NOT create agents — those are created after bootstrap via activateWorkflow().
   *
   * 1. Copies workflow files to project's workflows/ directory
   * 2. Saves user config
   * 3. Writes installed.json (no agents yet)
   * 4. Saves bootstrap prompt as project instructions
   */
  install(
    projectId: string,
    workflowId: string,
    sourceDir: string,
    manifest: WorkflowManifest,
    userInputs: Record<string, unknown>,
  ): InstalledWorkflow {
    // Ensure workflows dir exists
    const workflowsDir = getWorkflowsDir(projectId)
    if (!existsSync(workflowsDir)) {
      mkdirSync(workflowsDir, { recursive: true })
    }

    // Check if already installed
    const existing = loadInstalledMeta(projectId, workflowId)
    if (existing) {
      throw new Error(`Workflow "${workflowId}" is already installed in this project`)
    }

    // Copy workflow directory to project
    const targetDir = getWorkflowDir(projectId, workflowId)
    if (!sourceDir || !existsSync(sourceDir)) {
      throw new Error(`Workflow source not found: ${sourceDir}`)
    }
    cpSync(sourceDir, targetDir, { recursive: true })

    // Create state directory
    const stateDir = `${targetDir}/state`
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true })
    }

    // Save user config
    saveWorkflowUserConfig(projectId, workflowId, userInputs)

    // If workflow has a bootstrap agent, save its prompt as project instructions.
    // The FIRST conversation the user has in this project will be guided by this prompt.
    if (manifest.bootstrap) {
      const bootstrapPrompt = loadWorkflowResource(projectId, workflowId, manifest.bootstrap.file)
      const bootstrapTask = loadWorkflowResource(projectId, workflowId, 'agents/bootstrap/task.md')
      if (bootstrapPrompt) {
        const sections = [
          `# Workflow Bootstrap: ${manifest.name}`,
          '',
          `This project is powered by the "${manifest.name}" workflow.`,
          `Workflow ID: \`${workflowId}\``,
          `Workflow directory: \`${getWorkflowDir(projectId, workflowId)}\``,
          '',
          'No routines have been created yet — they will be deployed after you complete setup.',
          `When the user approves the final plan, call the \`activate_workflow\` tool with workflow_id: "${workflowId}".`,
        ]

        // Include bootstrap task.md as the primary instruction
        if (bootstrapTask) {
          sections.push('', '---', '', bootstrapTask)
        }

        // Include bootstrap process guide
        sections.push('', '---', '', bootstrapPrompt)

        saveProjectInstructions(projectId, sections.join('\n'))
      }
    }

    // Write installed.json — NO agents created yet
    const installed: InstalledWorkflow = {
      workflowId,
      projectId,
      agentSessionId: '', // no agent yet
      agentSessionIds: [],
      installedAt: Date.now(),
      userConfig: userInputs,
      manifest,
      bootstrapped: !manifest.bootstrap, // true if no bootstrap needed
    }
    saveInstalledMeta(projectId, workflowId, installed)

    return installed
  }

  /**
   * Activate a workflow — creates all agents after bootstrap is complete.
   * Called after the user has approved the final configuration plan.
   */
  activateWorkflow(projectId: string, workflowId: string): InstalledWorkflow {
    const manifest = loadWorkflowManifest(projectId, workflowId)
    if (!manifest) {
      throw new Error(`Workflow manifest not found for "${workflowId}"`)
    }

    const installed = loadInstalledMeta(projectId, workflowId)
    if (!installed) {
      throw new Error(`Workflow "${workflowId}" is not installed`)
    }

    if (
      installed.bootstrapped &&
      installed.agentSessionIds &&
      installed.agentSessionIds.length > 0
    ) {
      throw new Error(`Workflow "${workflowId}" is already activated`)
    }

    // Create shared state DB if manifest defines one
    if (manifest.sharedState) {
      const dbPath = getWorkflowStateDbPath(projectId, workflowId)
      const db = new WorkflowStateDb(dbPath, manifest.sharedState.transitions)
      db.setup(manifest.sharedState.setupSql)
      db.close()
    }

    const defaultSchedule =
      manifest.trigger.type === 'schedule' ? manifest.trigger.schedule : undefined
    const agentSessionIds: string[] = []

    for (const [key, ref] of Object.entries(manifest.agents)) {
      // Each agent can have its own schedule, or fall back to the workflow default for main agents
      const agentSchedule = ref.schedule || (ref.role === 'main' ? defaultSchedule : undefined)
      const agentName = ref.name || formatAgentName(key)

      // Validate the workflow author's preferredProvider/preferredModel
      // against the user's actual config. If the user doesn't have the
      // provider installed or the model isn't recognised, drop the pair
      // (with a warning) so the routine inherits config.defaults at run
      // time. This is best-effort: install succeeds, and the routine
      // can still run — just not on the exact model the author picked.
      let provider = ref.preferredProvider
      let model = ref.preferredModel
      if (this.validateProviderModel && (provider || model)) {
        const check = this.validateProviderModel(provider, model)
        if (!check.ok) {
          log.warn(
            { workflowId, agentKey: key, provider, model, reason: check.error },
            'workflow preferredProvider/preferredModel not usable on this host — dropping; routine will inherit config.defaults',
          )
          provider = undefined
          model = undefined
        }
      }

      const agentSession = this.agentManager.createAgent(projectId, {
        name: agentName,
        description: ref.description || manifest.description,
        instructions: `[Workflow Agent: ${key}] Instructions loaded from workflow at runtime.`,
        schedule: agentSchedule,
        provider,
        model,
        workflowId,
        workflowAgentKey: key,
      })

      saveAgentMetadata(projectId, agentSession.sessionId, agentSession.agent)
      agentSessionIds.push(agentSession.sessionId)
    }

    // Update installed metadata
    installed.bootstrapped = true
    installed.agentSessionIds = agentSessionIds
    installed.agentSessionId = agentSessionIds[0] || ''
    saveInstalledMeta(projectId, workflowId, installed)

    return installed
  }

  /**
   * Check which required/optional connectors are satisfied.
   */
  checkConnectors(
    manifest: WorkflowManifest,
    activeConnectors: string[],
  ): {
    satisfied: string[]
    missing: string[]
    optional: { id: string; connected: boolean }[]
  } {
    const satisfied = manifest.connectors.required.filter((c) => activeConnectors.includes(c))
    const missing = manifest.connectors.required.filter((c) => !activeConnectors.includes(c))
    const optional = manifest.connectors.optional.map((c) => ({
      id: c,
      connected: activeConnectors.includes(c),
    }))

    return { satisfied, missing, optional }
  }

  /**
   * Uninstall a workflow — removes ALL agents and the workflow directory.
   */
  uninstall(projectId: string, workflowId: string): boolean {
    const installed = loadInstalledMeta(projectId, workflowId)
    if (!installed) return false

    // Delete all agents created by this workflow
    const allAgents = this.agentManager.listAgents(projectId)
    for (const agent of allAgents) {
      if (agent.agent.workflowId === workflowId) {
        this.agentManager.deleteAgent(agent.sessionId)
      }
    }

    // Remove the workflow directory
    removeWorkflowDir(projectId, workflowId)

    return true
  }
}

/** Convert kebab-case agent key to display name */
function formatAgentName(key: string): string {
  return key
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
