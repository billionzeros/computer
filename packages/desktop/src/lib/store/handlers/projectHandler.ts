/**
 * AI channel: project_*, agent_*, workflow_* responses.
 */

import type { AiMessage } from '@anton/protocol'
import { connection } from '../../connection.js'
import { useStore } from '../../store.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { uiStore } from '../uiStore.js'

export function handleProjectMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    // ── Projects ──
    case 'project_created': {
      const ps = projectStore.getState()
      ps.addProject(msg.project)
      ps.setActiveProject(msg.project.id)
      connection.sendProjectSessionsList(msg.project.id)
      return true
    }

    case 'projects_list_response': {
      projectStore.getState().setProjects(msg.projects)
      connectionStore.getState().markSynced('projects')
      return true
    }

    case 'project_updated': {
      projectStore.getState().updateProject(msg.project.id, msg.project)
      return true
    }

    case 'project_deleted': {
      projectStore.getState().removeProject(msg.id)
      return true
    }

    case 'project_files_list_response': {
      // Legacy handler — project files are now managed via Files sidebar
      return true
    }

    case 'project_sessions_list_response': {
      if (msg.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectSessions(msg.sessions)
      }
      return true
    }

    case 'project_instructions_response': {
      if (msg.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectInstructions(msg.content)
      }
      return true
    }

    case 'project_preferences_response': {
      if (msg.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectPreferences(msg.preferences)
      }
      return true
    }

    // ── Agents ──
    case 'agents_list_response': {
      const ps = projectStore.getState()
      if (msg.projectId === ps.activeProjectId) {
        ps.setProjectAgents(msg.agents)
      }
      return true
    }

    case 'agent_created': {
      const ps = projectStore.getState()
      if (msg.agent.projectId === ps.activeProjectId) {
        const agents = [...ps.projectAgents]
        const idx = agents.findIndex((a) => a.sessionId === msg.agent.sessionId)
        if (idx >= 0) agents[idx] = msg.agent
        else agents.push(msg.agent)
        ps.setProjectAgents(agents)
      }
      return true
    }

    case 'agent_updated': {
      const ps = projectStore.getState()
      ps.setProjectAgents(
        ps.projectAgents.map((a) => (a.sessionId === msg.agent.sessionId ? msg.agent : a)),
      )
      return true
    }

    case 'agent_deleted': {
      const ps = projectStore.getState()
      ps.setProjectAgents(ps.projectAgents.filter((a) => a.sessionId !== msg.sessionId))
      return true
    }

    case 'agent_run_logs_response': {
      projectStore.getState().setAgentRunLogs(msg.logs)
      return true
    }

    // ── Workflows ──
    case 'workflow_registry_list_response': {
      projectStore.getState().setWorkflowRegistry(msg.entries)
      return true
    }

    case 'workflow_check_connectors_response': {
      projectStore.getState().setWorkflowConnectorCheck({
        workflowId: msg.workflowId,
        satisfied: msg.satisfied,
        missing: msg.missing,
        optional: msg.optional,
      })
      return true
    }

    case 'workflow_installed': {
      const ps = projectStore.getState()
      ps.setProjectWorkflows([...ps.projectWorkflows, msg.workflow])
      if (msg.workflow.projectId) {
        // Switch to the new project and fetch its agents
        ps.setActiveProject(msg.workflow.projectId)
        connection.sendAgentsList(msg.workflow.projectId)
        // Navigate to home view and create a setup conversation
        const store = useStore.getState()
        store.newConversation(
          `${msg.workflow.manifest.name} Setup`,
          undefined,
          msg.workflow.projectId,
        )
        uiStore.setState({ activeView: 'home' })
      } else if (ps.activeProjectId) {
        connection.sendAgentsList(ps.activeProjectId)
      }
      return true
    }

    case 'workflows_list_response': {
      projectStore.getState().setProjectWorkflows(msg.workflows)
      return true
    }

    case 'workflow_uninstalled': {
      const ps = projectStore.getState()
      ps.setProjectWorkflows(ps.projectWorkflows.filter((w) => w.workflowId !== msg.workflowId))
      return true
    }

    case 'workflow_activated': {
      const ps = projectStore.getState()
      // Update the installed workflow with activation data
      ps.setProjectWorkflows(
        ps.projectWorkflows.map((w) =>
          w.workflowId === msg.workflow.workflowId ? msg.workflow : w,
        ),
      )
      // Sync server-created agents into project agents list
      if (msg.agents?.length && msg.workflow.projectId === ps.activeProjectId) {
        const existing = ps.projectAgents.filter(
          (a) => !msg.agents.some((na: { sessionId: string }) => na.sessionId === a.sessionId),
        )
        ps.setProjectAgents([...existing, ...msg.agents])
      }
      return true
    }

    default:
      return false
  }
}
