/**
 * Artifact domain store — code/file artifacts + browser viewer state.
 */

import { Channel } from '@anton/protocol'
import { create } from 'zustand'
import type { Artifact, ArtifactRenderType } from '../artifacts.js'
import { connection } from '../connection.js'

interface BrowserState {
  url: string
  title: string
  screenshot: string | null
  actions: Array<{ action: string; target?: string; value?: string; timestamp: number }>
  active: boolean
}

interface ArtifactState {
  // Artifacts
  artifacts: Artifact[]
  activeArtifactId: string | null
  artifactPanelOpen: boolean
  artifactSearchQuery: string
  artifactFilterType: ArtifactRenderType | 'all'
  artifactViewMode: 'list' | 'detail'
  /** Ordered list of artifact IDs currently open as tabs in the side panel. */
  artifactTabs: string[]

  // Browser viewer
  browserState: BrowserState | null

  // Artifact actions
  addArtifact: (artifact: Artifact) => void
  setActiveArtifact: (id: string | null) => void
  setArtifactPanelOpen: (open: boolean) => void
  clearArtifacts: () => void
  setArtifactSearchQuery: (query: string) => void
  setArtifactFilterType: (type: ArtifactRenderType | 'all') => void
  setArtifactViewMode: (mode: 'list' | 'detail') => void
  updateArtifactPublishStatus: (artifactId: string, url: string, slug: string) => void
  closeArtifactTab: (id: string) => void

  // Browser viewer actions
  setBrowserState: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: { action: string; target?: string; value?: string; timestamp: number }
    elementCount?: number
  }) => void
  clearBrowserState: () => void

  // Publish modal
  publishModalOpen: boolean
  publishModalArtifactId: string | null
  publishError: string | null
  openPublishModal: (artifactId: string) => void
  closePublishModal: () => void
  setPublishError: (error: string | null) => void

  // Connection actions
  publishArtifact: (
    artifactId: string,
    content: string,
    renderType: string,
    title?: string,
    projectId?: string,
    slug?: string,
  ) => void

  // Reset
  reset: () => void
}

export const artifactStore = create<ArtifactState>((set, get) => ({
  artifacts: [],
  activeArtifactId: null,
  artifactPanelOpen: false,
  artifactSearchQuery: '',
  artifactFilterType: 'all',
  artifactViewMode: 'list',
  artifactTabs: [],
  browserState: null,
  publishModalOpen: false,
  publishModalArtifactId: null,
  publishError: null,

  addArtifact: (artifact) =>
    set((state) => {
      const existing = artifact.filepath
        ? state.artifacts.findIndex((a) => a.filepath === artifact.filepath)
        : -1
      let artifacts: Artifact[]
      if (existing >= 0) {
        artifacts = [...state.artifacts]
        artifacts[existing] = artifact
      } else {
        artifacts = [...state.artifacts, artifact]
      }
      const tabs = state.artifactTabs.includes(artifact.id)
        ? state.artifactTabs
        : [...state.artifactTabs, artifact.id]
      return { artifacts, activeArtifactId: artifact.id, artifactTabs: tabs }
    }),

  setActiveArtifact: (id) =>
    set((state) => {
      if (id === null) return { activeArtifactId: null }
      const tabs = state.artifactTabs.includes(id)
        ? state.artifactTabs
        : [...state.artifactTabs, id]
      return { activeArtifactId: id, artifactTabs: tabs }
    }),
  setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),

  clearArtifacts: () =>
    set({ artifacts: [], activeArtifactId: null, artifactPanelOpen: false, artifactTabs: [] }),

  closeArtifactTab: (id) =>
    set((state) => {
      const idx = state.artifactTabs.indexOf(id)
      if (idx === -1) return {}
      const tabs = state.artifactTabs.filter((t) => t !== id)
      let activeArtifactId = state.activeArtifactId
      if (state.activeArtifactId === id) {
        // Pick the neighbor to the right, else left, else null.
        activeArtifactId = tabs[idx] ?? tabs[idx - 1] ?? null
      }
      return { artifactTabs: tabs, activeArtifactId }
    }),

  setArtifactSearchQuery: (query) => set({ artifactSearchQuery: query }),
  setArtifactFilterType: (type) => set({ artifactFilterType: type }),
  setArtifactViewMode: (mode) => set({ artifactViewMode: mode }),

  updateArtifactPublishStatus: (artifactId, url, slug) =>
    set((state) => ({
      artifacts: state.artifacts.map((a) =>
        a.id === artifactId
          ? { ...a, publishedUrl: url, publishedSlug: slug, publishedAt: Date.now() }
          : a,
      ),
    })),

  setBrowserState: (state) => {
    const current = get().browserState
    const actions = current?.actions ?? []
    const newActions = [...actions, state.lastAction].slice(-50)
    set({
      browserState: {
        url: state.url,
        title: state.title,
        screenshot: state.screenshot ?? current?.screenshot ?? null,
        actions: newActions,
        active: true,
      },
    })
  },

  clearBrowserState: () => set({ browserState: null }),

  openPublishModal: (artifactId) =>
    set({ publishModalOpen: true, publishModalArtifactId: artifactId, publishError: null }),
  closePublishModal: () =>
    set({ publishModalOpen: false, publishModalArtifactId: null, publishError: null }),
  setPublishError: (error) => set({ publishError: error }),

  publishArtifact: (artifactId, content, renderType, title, projectId, slug) => {
    connection.send(Channel.AI, {
      type: 'publish_artifact',
      artifactId,
      content,
      contentType: renderType,
      title,
      projectId,
      slug,
    })
  },

  reset: () =>
    set({
      artifacts: [],
      activeArtifactId: null,
      artifactPanelOpen: false,
      artifactSearchQuery: '',
      artifactFilterType: 'all',
      artifactViewMode: 'list',
      artifactTabs: [],
      browserState: null,
      publishModalOpen: false,
      publishModalArtifactId: null,
      publishError: null,
    }),
}))
