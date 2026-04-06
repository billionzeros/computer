/**
 * Update domain store — manages agent version and update lifecycle.
 */

import { create } from 'zustand'
import { connection } from '../connection.js'
import type { UpdateInfo, UpdateStage } from './types.js'

interface UpdateState {
  agentVersion: string | null
  agentGitHash: string | null
  updateInfo: UpdateInfo | null
  updateStage: UpdateStage
  updateMessage: string | null
  updateDismissed: boolean

  // Actions
  setAgentVersionInfo: (version: string, gitHash: string) => void
  setUpdateInfo: (info: UpdateInfo | null) => void
  setUpdateProgress: (stage: UpdateStage, message: string | null) => void
  dismissUpdate: () => void

  // Connection actions
  startUpdate: () => void

  // Reset
  reset: () => void
  resetKeepIfUpdating: () => void
}

export const updateStore = create<UpdateState>((set, get) => ({
  agentVersion: null,
  agentGitHash: null,
  updateInfo: null,
  updateStage: null,
  updateMessage: null,
  updateDismissed: false,

  setAgentVersionInfo: (version, gitHash) => set({ agentVersion: version, agentGitHash: gitHash }),

  setUpdateInfo: (info) => set({ updateInfo: info }),

  setUpdateProgress: (stage, message) => set({ updateStage: stage, updateMessage: message }),

  dismissUpdate: () => set({ updateDismissed: true }),

  startUpdate: () => {
    connection.sendUpdateStart()
  },

  reset: () =>
    set({
      agentVersion: null,
      agentGitHash: null,
      updateInfo: null,
      updateStage: null,
      updateMessage: null,
      updateDismissed: false,
    }),

  resetKeepIfUpdating: () => {
    const { updateStage, updateInfo, updateMessage } = get()
    const isUpdating = updateStage !== null && updateStage !== 'done' && updateStage !== 'error'
    set({
      agentVersion: null,
      agentGitHash: null,
      updateInfo: isUpdating ? updateInfo : null,
      updateStage: isUpdating ? updateStage : null,
      updateMessage: isUpdating ? updateMessage : null,
      updateDismissed: false,
    })
  },
}))
