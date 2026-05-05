import { create } from 'zustand'

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'finishing' | 'complete' | 'error'

export interface UploadItem {
  id: string
  name: string
  path: string
  source: 'composer' | 'files'
  status: UploadStatus
  sizeBytes: number
  uploadedBytes: number
  percent: number
  error?: string
  startedAt: number
  updatedAt: number
  completedAt?: number
}

interface UploadState {
  uploads: UploadItem[]
  startUpload: (item: {
    name: string
    path: string
    source: 'composer' | 'files'
    sizeBytes: number
  }) => string
  updateUpload: (
    id: string,
    patch: Partial<Pick<UploadItem, 'status' | 'uploadedBytes' | 'percent' | 'error'>>,
  ) => void
  finishUpload: (id: string) => void
  failUpload: (id: string, error: string) => void
  dismissUpload: (id: string) => void
  clearFinished: (olderThanMs?: number) => void
}

let seq = 0

function nextUploadId(): string {
  seq += 1
  return `upload-${Date.now()}-${seq}`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export const uploadStore = create<UploadState>((set) => ({
  uploads: [],

  startUpload: (item) => {
    const id = nextUploadId()
    const now = Date.now()
    set((state) => ({
      uploads: [
        ...state.uploads,
        {
          id,
          name: item.name,
          path: item.path,
          source: item.source,
          status: 'queued',
          sizeBytes: item.sizeBytes,
          uploadedBytes: 0,
          percent: 0,
          startedAt: now,
          updatedAt: now,
        },
      ],
    }))
    return id
  },

  updateUpload: (id, patch) =>
    set((state) => ({
      uploads: state.uploads.map((item) => {
        if (item.id !== id) return item
        const uploadedBytes = patch.uploadedBytes ?? item.uploadedBytes
        const percent =
          patch.percent ??
          (item.sizeBytes > 0 ? clampPercent((uploadedBytes / item.sizeBytes) * 100) : item.percent)
        return {
          ...item,
          ...patch,
          uploadedBytes,
          percent: clampPercent(percent),
          updatedAt: Date.now(),
        }
      }),
    })),

  finishUpload: (id) =>
    set((state) => ({
      uploads: state.uploads.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'complete',
              uploadedBytes: item.sizeBytes,
              percent: 100,
              updatedAt: Date.now(),
              completedAt: Date.now(),
            }
          : item,
      ),
    })),

  failUpload: (id, error) =>
    set((state) => ({
      uploads: state.uploads.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'error',
              error,
              updatedAt: Date.now(),
              completedAt: Date.now(),
            }
          : item,
      ),
    })),

  dismissUpload: (id) =>
    set((state) => ({
      uploads: state.uploads.filter((item) => item.id !== id),
    })),

  clearFinished: (olderThanMs = 5 * 60 * 1000) =>
    set((state) => {
      const now = Date.now()
      return {
        uploads: state.uploads.filter((item) => {
          if (item.status !== 'complete' && item.status !== 'error') return true
          return !item.completedAt || now - item.completedAt < olderThanMs
        }),
      }
    }),
}))
