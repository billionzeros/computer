/**
 * EVENTS channel handler: job_event, update_available, agent_status.
 */

import type { EventMessage } from '@anton/protocol'
import { connection } from '../../connection.js'
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
      if (sid) {
        const ss = sessionStore.getState()
        ss.setSessionStatus(sid, msg.status, msg.detail || null)
        if (msg.status === 'idle') {
          ss.updateSessionState(sid, { agentSteps: [] })
        }
      } else if (msg.status === 'idle') {
        // Global idle (e.g. on reconnect when no turns are active) —
        // reset any client sessions stuck in 'working'
        const ss = sessionStore.getState()
        for (const [sessionId, state] of ss.sessionStates) {
          if (state.status === 'working') {
            ss.setSessionStatus(sessionId, 'idle')
            ss.updateSessionState(sessionId, { agentSteps: [] })
          }
        }
      }
      return
    }
  }
}
