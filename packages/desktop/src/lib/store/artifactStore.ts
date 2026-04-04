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

  // Browser viewer actions
  setBrowserState: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: { action: string; target?: string; value?: string; timestamp: number }
    elementCount?: number
  }) => void
  clearBrowserState: () => void

  // Connection actions
  publishArtifact: (artifactId: string, content: string, renderType: string, title?: string) => void

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
  browserState: null,

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
      return { artifacts, activeArtifactId: artifact.id }
    }),

  setActiveArtifact: (id) => set({ activeArtifactId: id }),
  setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),

  clearArtifacts: () => set({ artifacts: [], activeArtifactId: null, artifactPanelOpen: false }),

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

  publishArtifact: (artifactId, content, renderType, title) => {
    connection.send(Channel.AI, {
      type: 'publish_artifact',
      artifactId,
      content,
      renderType,
      title,
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
      browserState: null,
    }),
}))
