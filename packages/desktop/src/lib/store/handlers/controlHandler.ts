/**
 * CONTROL channel handler: auth_ok, update responses, config queries.
 */

import type { ControlMessage } from '@anton/protocol'
import { connection } from '../../connection.js'
import { connectionStore } from '../connectionStore.js'
import { projectStore } from '../projectStore.js'
import { uiStore } from '../uiStore.js'
import { updateStore } from '../updateStore.js'

export function handleControlMessage(msg: ControlMessage): void {
  switch (msg.type) {
    case 'auth_ok': {
      connectionStore.getState().setDomain(msg.domain ?? null)
      connectionStore.getState().setServerProtocolVersion(msg.protocolVersion ?? null)

      const us = updateStore.getState()

      // Capture previous version BEFORE updating state
      const prevVersion = us.updateInfo?.currentVersion ?? us.agentVersion
      const wasUpdating =
        us.updateStage !== null && us.updateStage !== 'done' && us.updateStage !== 'error'

      us.setAgentVersionInfo(msg.version || '', msg.gitHash || '')

      if (wasUpdating) {
        // Agent reconnected after update — check if version changed
        const versionChanged = prevVersion && msg.version !== prevVersion

        if (versionChanged) {
          us.setUpdateProgress('done', `Updated to v${msg.version}`)
        } else {
          us.setUpdateProgress('error', 'Update failed — rolled back to previous version')
        }
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
      // Hydrate the disconnect mode from server so Settings reflects
      // the authoritative value on every reconnect.
      connection.sendConfigQuery('sessions')
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
      } else if (msg.key === 'sessions' && msg.value && typeof msg.value === 'object') {
        const v = msg.value as { disconnectMode?: 'attached' | 'detached' }
        if (v.disconnectMode === 'attached' || v.disconnectMode === 'detached') {
          uiStore.getState().setDisconnectMode(v.disconnectMode, { fromServer: true })
        }
      }
      return
    }
  }
}
