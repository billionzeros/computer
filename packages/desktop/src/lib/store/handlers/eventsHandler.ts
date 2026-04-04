/**
 * EVENTS channel handler: job_event, update_available, agent_status.
 */

import type { WsPayload } from '../../connection.js'
import { connection } from '../../connection.js'
import { useStore } from '../../store.js'
import type { WsAgentStatusMsg, WsJobEvent, WsUpdateAvailable } from '../../ws-messages.js'
import { projectStore } from '../projectStore.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'
import { updateStore } from '../updateStore.js'

export function handleEventsMessage(msg: WsPayload): void {
  if (msg.type === 'job_event') {
    const m = msg as unknown as WsJobEvent
    if (m.projectId === projectStore.getState().activeProjectId) {
      connection.sendAgentsList(m.projectId)
    }
    return
  }

  if (msg.type === 'update_available') {
    const m = msg as unknown as WsUpdateAvailable
    updateStore.getState().setUpdateInfo({
      currentVersion: m.currentVersion,
      latestVersion: m.latestVersion,
      updateAvailable: true,
      changelog: m.changelog,
      releaseUrl: m.releaseUrl,
    })
    return
  }

  if (msg.type === 'agent_status') {
    const m = msg as unknown as WsAgentStatusMsg
    uiStore
      .getState()
      .appendEventLog(
        'status',
        `Agent ${m.status}${m.detail ? ` — ${m.detail}` : ''}${m.sessionId ? ` (${m.sessionId.slice(0, 12)})` : ''}`,
      )

    const sid: string | undefined = m.sessionId
    const ss = sessionStore.getState()

    if (sid) {
      ss.updateSessionState(sid, { status: m.status, statusDetail: m.detail })
    }

    const activeConv = useStore.getState().getActiveConversation()
    if (sid === activeConv?.sessionId) {
      ss.setAgentStatus(m.status, sid)
      ss.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
        ss.clearAgentSteps()
      }
    } else if (!sid) {
      ss.setAgentStatus(m.status)
      ss.setAgentStatusDetail(m.detail || null)
      if (m.status === 'idle') {
        ss.clearAgentSteps()
      }
    }
  }
}
