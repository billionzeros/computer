/**
 * EVENTS channel handler: job_event, update_available, agent_status.
 */

import type { EventMessage } from '@anton/protocol'
import { connection } from '../../connection.js'
import { useStore } from '../../store.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'
import { updateStore } from '../updateStore.js'

export function handleEventsMessage(msg: EventMessage): void {
  switch (msg.type) {
    case 'job_event': {
      if (msg.projectId === projectStore.getState().activeProjectId) {
        connection.sendAgentsList(msg.projectId)
      }
      return
    }

    case 'update_available': {
      updateStore.getState().setUpdateInfo({
        currentVersion: msg.currentVersion,
        latestVersion: msg.latestVersion,
        updateAvailable: true,
        changelog: msg.changelog,
        releaseUrl: msg.releaseUrl,
      })
      return
    }

    case 'agent_status': {
      uiStore
        .getState()
        .appendEventLog(
          'status',
          `Agent ${msg.status}${msg.detail ? ` — ${msg.detail}` : ''}${msg.sessionId ? ` (${msg.sessionId.slice(0, 12)})` : ''}`,
        )

      const sid: string | undefined = msg.sessionId
      const ss = sessionStore.getState()

      if (sid) {
        ss.updateSessionState(sid, { status: msg.status, statusDetail: msg.detail })
      }

      const activeConv = useStore.getState().getActiveConversation()
      if (sid === activeConv?.sessionId) {
        ss.setAgentStatus(msg.status, sid)
        ss.setAgentStatusDetail(msg.detail || null)
        if (msg.status === 'idle') {
          ss.clearAgentSteps()
        }
      } else if (!sid) {
        ss.setAgentStatus(msg.status)
        ss.setAgentStatusDetail(msg.detail || null)
        if (msg.status === 'idle') {
          ss.clearAgentSteps()
        }
      }
      return
    }
  }
}
