/**
 * Workflow Installer — installs workflow directories into projects
 * and creates the associated agent for execution.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import {
  getWorkflowDir,
  getWorkflowsDir,
  loadInstalledMeta,
  loadWorkflowResource,
  deleteWorkflow as removeWorkflowDir,
  saveAgentMetadata,
  saveInstalledMeta,
  saveProjectInstructions,
  saveWorkflowUserConfig,
} from '@anton/agent-config'
import type { InstalledWorkflow, WorkflowManifest } from '@anton/protocol'
import type { AgentManager } from '../agents/agent-manager.js'

export class WorkflowInstaller {
  constructor(private agentManager: AgentManager) {}

  /**
   * Install a workflow from a source directory into a project.
   *
   * 1. Copies workflow files to project's workflows/ directory
   * 2. Saves user config
   * 3. Creates an agent with the workflow's cron schedule
   * 4. Writes installed.json linking workflow to agent
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

    // Create agent — this is a regular agent that the AgentManager schedules
    // The key difference: agent.workflowId is set, so buildSessionOptions()
    // will call buildWorkflowAgentContext() instead of using flat instructions
    const schedule = manifest.trigger.type === 'schedule' ? manifest.trigger.schedule : undefined

    const agentSession = this.agentManager.createAgent(projectId, {
      name: manifest.name,
      description: manifest.description,
      instructions: `[Workflow Agent] This agent is powered by the "${manifest.name}" workflow. Instructions are loaded from the workflow directory at runtime.`,
      schedule,
    })

    // Set workflowId on the agent metadata
    agentSession.agent.workflowId = workflowId

    // Pause the scheduled agent until bootstrap completes —
    // the agent shouldn't run on cron until the user finishes setup
    if (manifest.bootstrap) {
      agentSession.agent.status = 'paused'
    }

    saveAgentMetadata(projectId, agentSession.sessionId, agentSession.agent)

    // If workflow has a bootstrap agent, save its prompt as project instructions.
    // This means the FIRST conversation the user has in this project will be
    // guided by the bootstrap prompt — the AI will walk them through setup.
    if (manifest.bootstrap) {
      const bootstrapPrompt = loadWorkflowResource(projectId, workflowId, manifest.bootstrap.file)
      if (bootstrapPrompt) {
        const instructions = [
          `# Workflow Bootstrap: ${manifest.name}`,
          '',
          `This project is powered by the "${manifest.name}" workflow.`,
          'The workflow agent is PAUSED until you complete this setup.',
          '',
          '## Your Task',
          'Guide the user through the setup process below. When setup is complete:',
          '1. Save all configuration to memory',
          '2. Tell the user the workflow is ready and the scheduled agent will now activate',
          '',
          '---',
          '',
          bootstrapPrompt,
        ].join('\n')

        saveProjectInstructions(projectId, instructions)
      }
    }

    // Write installed.json
    const installed: InstalledWorkflow = {
      workflowId,
      projectId,
      agentSessionId: agentSession.sessionId,
      installedAt: Date.now(),
      userConfig: userInputs,
      manifest,
      bootstrapped: !manifest.bootstrap, // true if no bootstrap needed
    }
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
   * Uninstall a workflow — removes the agent and workflow directory.
   */
  uninstall(projectId: string, workflowId: string): boolean {
    const installed = loadInstalledMeta(projectId, workflowId)
    if (!installed) return false

    // Delete the agent
    this.agentManager.deleteAgent(installed.agentSessionId)

    // Remove the workflow directory
    removeWorkflowDir(projectId, workflowId)

    return true
  }
}
