/**
 * AI channel: project_*, agent_*, workflow_* responses.
 */

import type { InstalledWorkflow, WorkflowRegistryEntry } from '@anton/protocol'
import type { WsPayload } from '../../connection.js'
import { connection } from '../../connection.js'
import { useStore } from '../../store.js'
import type {
  WsAgentCreated,
  WsAgentDeleted,
  WsAgentRunLogsResponse,
  WsAgentUpdated,
  WsAgentsListResponse,
  WsProjectCreated,
  WsProjectDeleted,
  WsProjectFilesListResponse,
  WsProjectSessionsListResponse,
  WsProjectUpdated,
  WsProjectsListResponse,
} from '../../ws-messages.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { uiStore } from '../uiStore.js'

// Workflow WS message types (not in ws-messages.ts yet)
interface WsWorkflowRegistryListResponse {
  type: 'workflow_registry_list_response'
  entries: WorkflowRegistryEntry[]
}
interface WsWorkflowCheckConnectorsResponse {
  type: 'workflow_check_connectors_response'
  workflowId: string
  satisfied: string[]
  missing: string[]
  optional: { id: string; connected: boolean }[]
}
interface WsWorkflowInstalled {
  type: 'workflow_installed'
  workflow: InstalledWorkflow
}
interface WsWorkflowsListResponse {
  type: 'workflows_list_response'
  workflows: InstalledWorkflow[]
}
interface WsWorkflowUninstalled {
  type: 'workflow_uninstalled'
  workflowId: string
}

export function handleProjectMessage(msg: WsPayload): boolean {
  switch (msg.type) {
    // ── Projects ──
    case 'project_created': {
      const m = msg as unknown as WsProjectCreated
      const ps = projectStore.getState()
      ps.addProject(m.project)
      ps.setActiveProject(m.project.id)
      connection.sendProjectSessionsList(m.project.id)
      return true
    }

    case 'projects_list_response': {
      const m = msg as unknown as WsProjectsListResponse
      projectStore.getState().setProjects(m.projects)
      connectionStore.getState().markSynced('projects')
      return true
    }

    case 'project_updated': {
      const m = msg as unknown as WsProjectUpdated
      projectStore.getState().updateProject(m.project.id, m.project)
      return true
    }

    case 'project_deleted': {
      const m = msg as unknown as WsProjectDeleted
      projectStore.getState().removeProject(m.id)
      return true
    }

    case 'project_files_list_response': {
      const m = msg as unknown as WsProjectFilesListResponse
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectFiles(m.files)
      }
      return true
    }

    case 'project_sessions_list_response': {
      const m = msg as unknown as WsProjectSessionsListResponse
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectSessions(m.sessions)
      }
      return true
    }

    case 'project_instructions_response': {
      const m = msg as unknown as { projectId: string; content: string }
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectInstructions(m.content)
      }
      return true
    }

    case 'project_preferences_response': {
      const m = msg as unknown as {
        projectId: string
        preferences: { id: string; title: string; content: string; createdAt: number }[]
      }
      if (m.projectId === projectStore.getState().activeProjectId) {
        projectStore.getState().setProjectPreferences(m.preferences)
      }
      return true
    }

    // ── Agents ──
    case 'agents_list_response': {
      const m = msg as unknown as WsAgentsListResponse
      const ps = projectStore.getState()
      if (m.projectId === ps.activeProjectId) {
        ps.setProjectAgents(m.agents)
      }
      const otherAgents = ps.allAgents.filter((a) => a.projectId !== m.projectId)
      ps.setAllAgents([...otherAgents, ...m.agents])
      return true
    }

    case 'agent_created': {
      const m = msg as unknown as WsAgentCreated
      const ps = projectStore.getState()
      const agents = [...ps.projectAgents]
      const idx = agents.findIndex((a) => a.sessionId === m.agent.sessionId)
      if (idx >= 0) agents[idx] = m.agent
      else agents.push(m.agent)
      ps.setProjectAgents(agents)
      const allAgents = [...ps.allAgents]
      const allIdx = allAgents.findIndex((a) => a.sessionId === m.agent.sessionId)
      if (allIdx >= 0) allAgents[allIdx] = m.agent
      else allAgents.push(m.agent)
      ps.setAllAgents(allAgents)
      return true
    }

    case 'agent_updated': {
      const m = msg as unknown as WsAgentUpdated
      const ps = projectStore.getState()
      ps.setProjectAgents(
        ps.projectAgents.map((a) => (a.sessionId === m.agent.sessionId ? m.agent : a)),
      )
      ps.setAllAgents(ps.allAgents.map((a) => (a.sessionId === m.agent.sessionId ? m.agent : a)))
      return true
    }

    case 'agent_deleted': {
      const m = msg as unknown as WsAgentDeleted
      const ps = projectStore.getState()
      ps.setProjectAgents(ps.projectAgents.filter((a) => a.sessionId !== m.sessionId))
      ps.setAllAgents(ps.allAgents.filter((a) => a.sessionId !== m.sessionId))
      return true
    }

    case 'agent_run_logs_response': {
      const m = msg as unknown as WsAgentRunLogsResponse
      projectStore.getState().setAgentRunLogs(m.logs)
      return true
    }

    // ── Workflows ──
    case 'workflow_registry_list_response': {
      const m = msg as unknown as WsWorkflowRegistryListResponse
      projectStore.getState().setWorkflowRegistry(m.entries)
      return true
    }

    case 'workflow_check_connectors_response': {
      const m = msg as unknown as WsWorkflowCheckConnectorsResponse
      projectStore.getState().setWorkflowConnectorCheck({
        workflowId: m.workflowId,
        satisfied: m.satisfied,
        missing: m.missing,
        optional: m.optional,
      })
      return true
    }

    case 'workflow_installed': {
      const m = msg as unknown as WsWorkflowInstalled
      const ps = projectStore.getState()
      ps.setProjectWorkflows([...ps.projectWorkflows, m.workflow])
      if (ps.activeProjectId) {
        connection.sendAgentsList(ps.activeProjectId)
      }
      if (m.workflow.projectId) {
        ps.setActiveProject(m.workflow.projectId)
        uiStore.setState({ activeView: 'chat' })
        const store = useStore.getState()
        setTimeout(() => {
          store.newConversation(
            `${m.workflow.manifest.name} Setup`,
            undefined,
            m.workflow.projectId,
          )
        }, 100)
      }
      return true
    }

    case 'workflows_list_response': {
      const m = msg as unknown as WsWorkflowsListResponse
      projectStore.getState().setProjectWorkflows(m.workflows)
      return true
    }

    case 'workflow_uninstalled': {
      const m = msg as unknown as WsWorkflowUninstalled
      const ps = projectStore.getState()
      ps.setProjectWorkflows(ps.projectWorkflows.filter((w) => w.workflowId !== m.workflowId))
      return true
    }

    default:
      return false
  }
}
