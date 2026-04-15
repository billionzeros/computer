import { create } from 'zustand'
import { connection } from '../connection.js'

export interface PublishedPage {
  slug: string
  artifactId?: string
  title: string
  type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  description?: string
  createdAt: number
  updatedAt: number
  projectId?: string
  views: number
}

interface PagesState {
  pages: PublishedPage[]
  host: string | null
  loaded: boolean
  setPages: (pages: PublishedPage[], host?: string) => void
  removePage: (slug: string) => void
  requestPages: () => void
  reset: () => void
}

export const pagesStore = create<PagesState>((set, get) => ({
  pages: [],
  host: null,
  loaded: false,
  setPages: (pages, host) => set({ pages, host: host ?? get().host, loaded: true }),
  removePage: (slug) => {
    set({ pages: get().pages.filter((p) => p.slug !== slug) })
    connection.sendUnpublish(slug)
  },
  requestPages: () => {
    connection.sendPublishedList()
  },
  reset: () => set({ pages: [], host: null, loaded: false }),
}))
