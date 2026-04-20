/**
 * AI channel: project, routine, workflow, connector, provider, skill messages.
 */

import type { AiMessage, Project, RoutineSession } from '@anton/protocol'
import { connectionStore } from '../connectionStore'
import { projectStore } from '../projectStore'
import { sessionStore } from '../sessionStore'
import type { ProviderInfo, SessionMeta } from '../types'

export function handleProjectMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'projects_list_response': {
      projectStore.getState().setProjects((msg.projects || []) as Project[])
      connectionStore.getState().markSynced('projects')
      return true
    }

    case 'project_created': {
      const project = msg.project || msg
      projectStore.getState().addProject(project as Project)
      return true
    }

    case 'project_updated': {
      const project = msg.project || msg
      projectStore.getState().updateProject(project as Project)
      return true
    }

    case 'project_deleted': {
      projectStore.getState().removeProject(msg.id as string)
      return true
    }

    case 'project_sessions_list_response': {
      projectStore.getState().setProjectSessions((msg.sessions || []) as SessionMeta[])
      return true
    }

    case 'routines_list_response': {
      projectStore.getState().setProjectRoutines((msg.routines || []) as RoutineSession[])
      return true
    }

    case 'routine_created':
    case 'routine_updated': {
      const routine = msg.routine as RoutineSession
      if (routine) {
        const ps = projectStore.getState()
        const exists = ps.projectRoutines.some((a) => a.sessionId === routine.sessionId)
        if (exists) {
          ps.setProjectRoutines(
            ps.projectRoutines.map((a) => (a.sessionId === routine.sessionId ? routine : a)),
          )
        } else {
          ps.setProjectRoutines([...ps.projectRoutines, routine])
        }
      }
      return true
    }

    case 'routine_deleted': {
      const ps = projectStore.getState()
      ps.setProjectRoutines(ps.projectRoutines.filter((a) => a.sessionId !== msg.sessionId))
      return true
    }

    case 'routine_result_delivered':
      return true

    case 'providers_list_response': {
      const providers = (msg.providers || []) as ProviderInfo[]
      const defaults = (msg.defaults || { provider: 'anthropic', model: 'claude-sonnet-4-6' }) as {
        provider: string
        model: string
      }
      sessionStore.getState().setProviders(providers, defaults)
      connectionStore.getState().markSynced('providers')
      return true
    }

    case 'connectors_list_response': {
      connectionStore.getState().markSynced('connectors')
      return true
    }

    case 'connector_registry_list_response':
    case 'connector_added':
    case 'connector_updated':
    case 'connector_removed':
    case 'connector_status':
    case 'connector_test_response':
      return true

    case 'skill_list_response':
    case 'scheduler_list_response':
    case 'workflow_registry_list_response':
    case 'workflows_list_response':
    case 'workflow_installed':
    case 'workflow_uninstalled':
    case 'workflow_activated':
    case 'workflow_check_connectors_response':
      return true

    case 'provider_set_key_response':
    case 'provider_set_default_response':
    case 'provider_set_models_response':
      return true

    case 'publish_artifact_response':
      return true

    default:
      return false
  }
}
