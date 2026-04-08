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

  // Side panel
  sidePanelView: SidePanelView
  setSidePanelView: (view: SidePanelView) => void

  // Onboarding
  onboardingLoaded: boolean
  onboardingCompleted: boolean
  onboardingRole: string | null
  setOnboardingLoaded: (loaded: boolean) => void
  setOnboardingCompleted: (role?: string) => void

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

  // Reset
  reset: () => void
}

export const uiStore = create<UIState>((set, get) => ({
  // Theme
  theme: (localStorage.getItem('anton-theme') as 'light' | 'dark' | 'system') || 'dark',
  resolvedTheme: (() => {
    const saved = localStorage.getItem('anton-theme') || 'dark'
    if (saved === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return saved as 'light' | 'dark'
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
  activeMode: (localStorage.getItem('anton-mode') as ActiveMode) || 'computer',
  setActiveMode: (mode) => {
    localStorage.setItem('anton-mode', mode)
    if (mode === 'computer') {
      set({ activeMode: mode, activeView: 'home' })
    } else {
      set({ activeMode: mode, activeView: 'chat' })
    }
  },

  activeView: (localStorage.getItem('anton-mode') || 'computer') === 'chat' ? 'chat' : 'home',
  setActiveView: (view) => set({ activeView: view }),

  // Side panel
  sidePanelView: 'artifacts',
  setSidePanelView: (view) => set({ sidePanelView: view }),

  // Onboarding
  onboardingLoaded: false,
  onboardingCompleted: false,
  onboardingRole: null,
  setOnboardingLoaded: (loaded) => set({ onboardingLoaded: loaded }),
  setOnboardingCompleted: (role?: string) => {
    set({ onboardingCompleted: true, onboardingRole: role ?? null })
    connection.send(Channel.CONTROL, {
      type: 'config_update',
      key: 'onboarding',
      value: { completed: true, role: role ?? undefined },
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
