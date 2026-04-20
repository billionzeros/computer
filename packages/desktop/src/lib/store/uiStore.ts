/**
 * UI domain store — theme, sidebar, navigation, dev mode, onboarding.
 */

import { Channel } from '@anton/protocol'
import { create } from 'zustand'
import { connection } from '../connection.js'
import type { ActiveMode, ActiveView, SidePanelView, SidebarTab } from './types.js'

interface UIState {
  // Theme
  theme: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark' | 'system') => void

  // Timezone
  timezone: string
  setTimezone: (tz: string) => void

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
  searchQuery: string
  setSearchQuery: (query: string) => void

  // Tasks visibility
  tasksHidden: boolean
  setTasksHidden: (hidden: boolean) => void
  toggleTasksHidden: () => void

  // Navigation
  activeMode: ActiveMode
  setActiveMode: (mode: ActiveMode) => void
  activeView: ActiveView
  setActiveView: (view: ActiveView) => void
  viewSubCrumb: string | null
  setViewSubCrumb: (crumb: string | null) => void

  // Side panel
  sidePanelView: SidePanelView
  setSidePanelView: (view: SidePanelView) => void

  // Onboarding
  onboardingLoaded: boolean
  onboardingCompleted: boolean
  onboardingRole: string | null
  tourCompleted: boolean
  setOnboardingLoaded: (loaded: boolean) => void
  setOnboardingCompleted: (role?: string) => void
  setTourCompleted: (completed: boolean) => void

  // Dev mode
  devMode: boolean
  setDevMode: (enabled: boolean) => void
  devModeData: {
    systemPrompt: string | null
    memories: { name: string; content: string; scope?: string }[]
    lastFetched: number
  }
  setDevModeData: (data: {
    systemPrompt?: string | null
    memories?: { name: string; content: string; scope?: string }[]
  }) => void
  eventLog: { id: number; timestamp: number; type: string; summary: string }[]
  appendEventLog: (type: string, summary: string) => void

  // Terminal & filesystem wrappers
  sendTerminalSpawn: (id: string, cols: number, rows: number, cwd?: string) => void
  sendTerminalData: (id: string, data: string) => void
  sendTerminalResize: (id: string, cols: number, rows: number) => void
  sendFilesystemList: (path: string, showHidden?: boolean) => void

  // Notifications
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void

  // Reset
  reset: () => void
}

export const uiStore = create<UIState>((set, get) => ({
  // Theme — only 'light' | 'dark' | 'system'. 'dark' resolves to the Ink palette.
  // Legacy stored values ('paper', 'soft-dark', 'ink') migrate to the closest
  // equivalent so existing user prefs keep working.
  theme: ((): 'light' | 'dark' | 'system' => {
    const saved = localStorage.getItem('anton-theme')
    if (saved === 'light' || saved === 'system') return saved
    return 'dark'
  })(),
  resolvedTheme: (() => {
    const saved = localStorage.getItem('anton-theme')
    const normalized = saved === 'light' || saved === 'system' ? saved : 'dark'
    if (normalized === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return normalized as 'light' | 'dark'
  })(),
  setTheme: (theme) => {
    localStorage.setItem('anton-theme', theme)
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    document.documentElement.setAttribute('data-theme', resolved)
    set({ theme, resolvedTheme: resolved })
  },

  // Timezone — auto-detect from browser, allow override
  timezone:
    localStorage.getItem('anton-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone,
  setTimezone: (tz) => {
    localStorage.setItem('anton-timezone', tz)
    set({ timezone: tz })
  },

  // Sidebar
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sidebarWidth: 240,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  sidebarTab: 'history',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  // Tasks visibility
  tasksHidden: false,
  setTasksHidden: (hidden) => set({ tasksHidden: hidden }),
  toggleTasksHidden: () => set((s) => ({ tasksHidden: !s.tasksHidden })),

  // Navigation
  activeMode: 'computer' as ActiveMode,
  setActiveMode: (_mode) => {
    localStorage.setItem('anton-mode', 'computer')
    set({ activeMode: 'computer', activeView: 'home' })
  },

  activeView: 'home' as ActiveView,
  setActiveView: (view) => set({ activeView: view, viewSubCrumb: null }),

  viewSubCrumb: null as string | null,
  setViewSubCrumb: (crumb: string | null) => set({ viewSubCrumb: crumb }),

  // Side panel
  sidePanelView: 'artifacts',
  setSidePanelView: (view) => set({ sidePanelView: view }),

  // Onboarding
  onboardingLoaded: false,
  onboardingCompleted: false,
  onboardingRole: null,
  tourCompleted: (() => {
    try {
      return localStorage.getItem('anton.tourSeen.v1') === '1'
    } catch {
      return false
    }
  })(),
  setOnboardingLoaded: (loaded) => set({ onboardingLoaded: loaded }),
  setOnboardingCompleted: (role?: string) => {
    set({ onboardingCompleted: true, onboardingRole: role ?? null })
    connection.send(Channel.CONTROL, {
      type: 'config_update',
      key: 'onboarding',
      value: { completed: true, role: role ?? undefined },
    })
  },
  setTourCompleted: (completed) => {
    set({ tourCompleted: completed })
    try {
      if (completed) localStorage.setItem('anton.tourSeen.v1', '1')
      else localStorage.removeItem('anton.tourSeen.v1')
    } catch {
      // localStorage unavailable — server is authoritative anyway
    }
    connection.send(Channel.CONTROL, {
      type: 'config_update',
      key: 'onboarding',
      value: {
        tourCompleted: completed,
        tourCompletedAt: completed ? new Date().toISOString() : undefined,
      },
    })
  },

  // Dev mode
  devMode: localStorage.getItem('anton-devmode') === 'true',
  setDevMode: (enabled) => {
    localStorage.setItem('anton-devmode', String(enabled))
    set({ devMode: enabled })
    if (!enabled) {
      const s = get()
      if (s.sidePanelView === 'devmode') {
        // Note: artifactPanelOpen lives in the main store for now
        // This will move to artifactStore in Phase 2
      }
    }
  },
  devModeData: { systemPrompt: null, memories: [], lastFetched: 0 },
  setDevModeData: (data) =>
    set((s) => ({
      devModeData: {
        systemPrompt:
          data.systemPrompt !== undefined ? data.systemPrompt : s.devModeData.systemPrompt,
        memories: data.memories !== undefined ? data.memories : s.devModeData.memories,
        lastFetched: Date.now(),
      },
    })),
  eventLog: [],
  appendEventLog: (type, summary) =>
    set((s) => {
      const entry = { id: Date.now() + Math.random(), timestamp: Date.now(), type, summary }
      const log = [entry, ...s.eventLog]
      return { eventLog: log.length > 200 ? log.slice(0, 200) : log }
    }),

  // Terminal & filesystem wrappers
  sendTerminalSpawn: (id, cols, rows, cwd) => connection.sendTerminalSpawn(id, cols, rows, cwd),
  sendTerminalData: (id, data) => connection.sendTerminalData(id, data),
  sendTerminalResize: (id, cols, rows) => connection.sendTerminalResize(id, cols, rows),
  sendFilesystemList: (path, showHidden) => connection.sendFilesystemList(path, showHidden),

  // Notifications — persisted via localStorage
  notificationsEnabled: localStorage.getItem('anton-notifications') !== 'false', // default on
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('anton-notifications', String(enabled))
    set({ notificationsEnabled: enabled })
  },

  // Reset — preserves theme, devMode, and sidebar preferences
  reset: () =>
    set({
      activeView: 'home',
      onboardingLoaded: false,
      onboardingCompleted: false,
      onboardingRole: null,
      eventLog: [],
    }),
}))
