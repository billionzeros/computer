/**
 * CONTROL channel handler: auth_ok, update responses, config queries.
 */

import type { ControlMessage } from '@anton/protocol'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { uiStore } from '../uiStore.js'
import { updateStore } from '../updateStore.js'

export function handleControlMessage(msg: ControlMessage): void {
  switch (msg.type) {
    case 'auth_ok': {
      const us = updateStore.getState()
      us.setAgentVersionInfo(msg.version || '', msg.gitHash || '')

      if (us.updateStage === 'restarting') {
        us.setUpdateProgress('done', `Updated to v${msg.version}`)
        us.setUpdateInfo({
          currentVersion: msg.version,
          latestVersion: msg.version,
          updateAvailable: false,
          changelog: us.updateInfo?.changelog ?? null,
          releaseUrl: us.updateInfo?.releaseUrl ?? null,
        })
      } else if (msg.updateAvailable) {
        us.setUpdateInfo({
          currentVersion: msg.version,
          latestVersion: msg.updateAvailable.version,
          updateAvailable: true,
          changelog: msg.updateAvailable.changelog,
          releaseUrl: msg.updateAvailable.releaseUrl,
        })
      }

      connectionStore.getState().startSyncing()
      return
    }

    case 'update_check_response': {
      updateStore.getState().setUpdateInfo({
        currentVersion: msg.currentVersion,
        latestVersion: msg.latestVersion,
        updateAvailable: msg.updateAvailable,
        changelog: msg.changelog,
        releaseUrl: msg.releaseUrl,
      })
      return
    }

    case 'update_progress': {
      updateStore.getState().setUpdateProgress(msg.stage, msg.message)
      return
    }

    case 'config_query_response': {
      if (msg.key === 'system_prompt' && typeof msg.value === 'string') {
        uiStore.getState().setDevModeData({ systemPrompt: msg.value })
      } else if (msg.key === 'memories' && Array.isArray(msg.value)) {
        const memories = msg.value as {
          name: string
          content: string
          scope: 'global' | 'conversation' | 'project'
        }[]
        uiStore.getState().setDevModeData({ memories })
        projectStore.getState().setMemories(memories)
      }
      return
    }
  }
}
