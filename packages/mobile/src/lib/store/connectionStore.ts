/**
 * Connection init state machine — tracks sync progress after auth.
 */

import { create } from 'zustand'

interface ConnectionStoreState {
  initPhase: 'idle' | 'connecting' | 'authenticating' | 'syncing' | 'ready'
  syncProgress: {
    providers: boolean
    sessions: boolean
    projects: boolean
    connectors: boolean
  }
  setInitPhase: (phase: ConnectionStoreState['initPhase']) => void
  startSyncing: () => void
  markSynced: (key: keyof ConnectionStoreState['syncProgress']) => void
  reset: () => void
}

export const connectionStore = create<ConnectionStoreState>((set, get) => ({
  initPhase: 'idle',
  syncProgress: {
    providers: false,
    sessions: false,
    projects: false,
    connectors: false,
  },

  setInitPhase: (phase) => {
    console.log(`[Init] Phase: ${get().initPhase} → ${phase}`)
    set({ initPhase: phase })
  },

  startSyncing: () => {
    console.log('[Init] Starting sync...')
    set({
      initPhase: 'syncing',
      syncProgress: { providers: false, sessions: false, projects: false, connectors: false },
    })
  },

  markSynced: (key) => {
    const progress = { ...get().syncProgress, [key]: true }
    const allDone =
      progress.providers && progress.sessions && progress.projects && progress.connectors
    console.log(`[Init] Synced: ${key}`, allDone ? '→ READY' : '')
    set({
      syncProgress: progress,
      ...(allDone ? { initPhase: 'ready' } : {}),
    })
  },

  reset: () =>
    set({
      initPhase: 'idle',
      syncProgress: { providers: false, sessions: false, projects: false, connectors: false },
    }),
}))
