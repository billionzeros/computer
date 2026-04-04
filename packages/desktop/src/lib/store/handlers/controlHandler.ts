/**
 * CONTROL channel handler: auth_ok, update responses, config queries.
 */

import type { WsPayload } from '../../connection.js'
import type {
  WsAuthOk,
  WsUpdateCheckResponse,
  WsUpdateProgress,
} from '../../ws-messages.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { uiStore } from '../uiStore.js'
import { updateStore } from '../updateStore.js'

export function handleControlMessage(msg: WsPayload): void {
  if (msg.type === 'auth_ok') {
    const m = msg as unknown as WsAuthOk
    const us = updateStore.getState()
    us.setAgentVersionInfo(m.version || '', m.gitHash || '')

    if (us.updateStage === 'restarting') {
      us.setUpdateProgress('done', `Updated to v${m.version}`)
      us.setUpdateInfo({
        currentVersion: m.version,
        latestVersion: m.version,
        updateAvailable: false,
        changelog: us.updateInfo?.changelog ?? null,
        releaseUrl: us.updateInfo?.releaseUrl ?? null,
      })
    } else if (m.updateAvailable) {
      us.setUpdateInfo({
        currentVersion: m.version,
        latestVersion: m.updateAvailable.version,
        updateAvailable: true,
        changelog: m.updateAvailable.changelog,
        releaseUrl: m.updateAvailable.releaseUrl,
      })
    }

    connectionStore.getState().startSyncing()
  } else if (msg.type === 'update_check_response') {
    const m = msg as unknown as WsUpdateCheckResponse
    updateStore.getState().setUpdateInfo({
      currentVersion: m.currentVersion,
      latestVersion: m.latestVersion,
      updateAvailable: m.updateAvailable,
      changelog: m.changelog,
      releaseUrl: m.releaseUrl,
    })
  } else if (msg.type === 'update_progress') {
    const m = msg as unknown as WsUpdateProgress
    updateStore.getState().setUpdateProgress(m.stage, m.message)
  } else if (msg.type === 'config_query_response') {
    const m = msg as unknown as { key: string; value: unknown }
    if (m.key === 'system_prompt' && typeof m.value === 'string') {
      uiStore.getState().setDevModeData({ systemPrompt: m.value })
    } else if (m.key === 'memories' && Array.isArray(m.value)) {
      const memories = m.value as {
        name: string
        content: string
        scope: 'global' | 'conversation' | 'project'
      }[]
      uiStore.getState().setDevModeData({ memories })
      projectStore.getState().setMemories(memories)
    }
  }
}
