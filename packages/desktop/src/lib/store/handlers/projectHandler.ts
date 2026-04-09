/**
 * AI channel: project_*, agent_*, workflow_* responses.
 */

import type { AiMessage } from '@anton/protocol'
import { connection } from '../../connection.js'
import { type Conversation, saveConversations } from '../../conversations.js'
import { useStore } from '../../store.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'

export function handleProjectMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    // ── Projects ──
    case 'project_created': {
      const ps = projectStore.getState()
      ps.addProject(msg.project)
      ps.setActiveProject(msg.project.id)
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
      const activeId = projectStore.getState().activeProjectId
      const sessions = (msg.sessions || []) as import('../../store.js').SessionMeta[]
      const projectId = msg.projectId as string
      console.log(
        `[ProjectSync] Sessions response: projectId=${projectId}, count=${sessions.length}, activeProjectId=${activeId}, match=${projectId === activeId}`,
      )
      if (projectId === activeId) {
        projectStore.getState().setProjectSessions(sessions)
      }

      // Bidirectional reconciliation: the session sync protocol only handles
      // global sess_* sessions. Project sessions (proj_*) must be reconciled
      // here so TaskListView (which reads from useStore.conversations) can
      // render them. Server is authoritative — add missing, update stale,
      // remove deleted.
      const store = useStore.getState()
      const serverSessionIds = new Set(sessions.filter((s) => s.messageCount > 0).map((s) => s.id))
      const localBySessionId = new Map(
        store.conversations.filter((c) => c.projectId === projectId).map((c) => [c.sessionId, c]),
      )

      let changed = false
      let conversations = store.conversations

      // 1. Add missing sessions & update stale metadata
      const newConvs: Conversation[] = []
      for (const s of sessions) {
        if (s.messageCount === 0) continue
        const existing = localBySessionId.get(s.id)
        if (!existing) {
          newConvs.push({
            id: s.id,
            sessionId: s.id,
            title: s.title || 'New conversation',
            messages: [],
            createdAt: s.createdAt,
            updatedAt: s.lastActiveAt,
            projectId,
            provider: s.provider,
            model: s.model,
          })
        } else if (existing.title !== s.title || existing.updatedAt !== s.lastActiveAt) {
          // Update stale metadata (title from server title-gen, timestamps from agent runs)
          conversations = conversations.map((c) =>
            c.sessionId === s.id
              ? { ...c, title: s.title || c.title, updatedAt: s.lastActiveAt }
              : c,
          )
          changed = true
        }
      }

      // 2. Remove local conversations whose session no longer exists on server
      const staleIds = [...localBySessionId.keys()].filter(
        (id) => !serverSessionIds.has(id) && !localBySessionId.get(id)?.pendingCreation,
      )
      if (staleIds.length > 0) {
        const staleSet = new Set(staleIds)
        conversations = conversations.filter((c) => !staleSet.has(c.sessionId))
        changed = true
      }

      if (newConvs.length > 0) {
        conversations = [...conversations, ...newConvs]
        changed = true
      }

      if (changed) {
        // Count how many existing conversations got metadata updates
        const updatedCount = sessions.filter((s) => {
          const existing = localBySessionId.get(s.id)
          return existing && (existing.title !== s.title || existing.updatedAt !== s.lastActiveAt)
        }).length
        console.log(
          `[ProjectSync] Reconciled project ${projectId}: +${newConvs.length} added, ~${updatedCount} updated, -${staleIds.length} removed, ${conversations.length} total`,
        )
        saveConversations(conversations)
        useStore.setState({ conversations })
      } else {
        console.log(
          `[ProjectSync] Project ${projectId} in sync: ${localBySessionId.size} local, ${serverSessionIds.size} server`,
        )
      }

      // Merge project session metadata into sessionStore.sessions so
      // TaskListView's sessionsById has status for all sessions, not just
      // the currently active project's. Without this, project sessions
      // show "idle" instead of "completed" when viewing a different project.
      const ss = sessionStore.getState()
      const existingIds = new Set(ss.sessions.map((s) => s.id))
      const toAdd = sessions.filter((s) => s.messageCount > 0 && !existingIds.has(s.id))
      if (toAdd.length > 0) {
        ss.setSessions([...ss.sessions, ...toAdd])
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

    case 'agent_result_delivered': {
      // Agent delivered results to a project conversation — refresh that conversation's history
      const store = useStore.getState()
      const conv = store.conversations.find(
        (c) => c.sessionId === msg.originConversationId || c.id === msg.originConversationId,
      )
      if (conv?.sessionId) {
        store.requestSessionHistory(conv.sessionId)
      }
      // Refresh project sessions list so the UI reflects updated metadata
      if (msg.projectId) {
        connection.sendProjectSessionsList(msg.projectId)
      }
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
