/**
 * Connection domain store — initialization state machine.
 *
 * Replaces scattered useEffect chains in App.tsx with a deterministic
 * init sequence: idle → connecting → authenticating → syncing → ready.
 *
 * During the `syncing` phase, the store fires all initial list requests
 * and tracks which responses have arrived. Components can gate on
 * `initPhase === 'ready'` instead of checking individual flags.
 */

import { create } from 'zustand'
import { connection } from '../connection.js'
import { projectStore } from './projectStore.js'
import { sessionStore } from './sessionStore.js'

// ── Types ────────────────────────────────────────────────────────

export type InitPhase = 'idle' | 'connecting' | 'authenticating' | 'syncing' | 'ready'

export interface SyncProgress {
  providers: boolean
  sessions: boolean
  projects: boolean
  connectors: boolean
}

interface ConnectionStoreState {
  initPhase: InitPhase
  syncProgress: SyncProgress

  // Actions
  setInitPhase: (phase: InitPhase) => void
  startSyncing: () => void
  markSynced: (key: keyof SyncProgress) => void
  reset: () => void
}

// ── Store ────────────────────────────────────────────────────────

export const connectionStore = create<ConnectionStoreState>((set, get) => ({
  initPhase: 'idle',
  syncProgress: {
    providers: false,
    sessions: false,
    projects: false,
    connectors: false,
  },

  setInitPhase: (phase) => set({ initPhase: phase }),

  startSyncing: () => {
    set({
      initPhase: 'syncing',
      syncProgress: { providers: false, sessions: false, projects: false, connectors: false },
    })

    // Fire all initial list requests
    sessionStore.getState().sendProvidersList()
    connection.sendSessionsList()
    projectStore.getState().listProjects()
    connection.sendConnectorsList()
    connection.sendConnectorRegistryList()

    // If there's an active project, also fetch its sessions
    const activeProjectId = projectStore.getState().activeProjectId
    if (activeProjectId) {
      projectStore.setState({ projectSessionsLoading: true })
      projectStore.getState().listProjectSessions(activeProjectId)
    }
  },

  markSynced: (key) => {
    const progress = { ...get().syncProgress, [key]: true }
    const allDone =
      progress.providers && progress.sessions && progress.projects && progress.connectors
    set({
      syncProgress: progress,
      initPhase: allDone ? 'ready' : get().initPhase,
    })
  },

  reset: () =>
    set({
      initPhase: 'idle',
      syncProgress: { providers: false, sessions: false, projects: false, connectors: false },
    }),
}))
