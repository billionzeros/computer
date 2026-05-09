import type { UserLocationContext } from '@anton/protocol'
import { create } from 'zustand'
import {
  formatLocation,
  isLocationFresh,
  persistLocationSharingEnabled,
  queryGeolocationPermission,
  readCachedLocation,
  readLocationSharingEnabled,
  requestApproximateLocation,
} from '../location.js'

type LocationStatus = 'idle' | 'checking' | 'ready' | 'denied' | 'unsupported' | 'error'

interface LocationState {
  enabled: boolean
  status: LocationStatus
  current: UserLocationContext | null
  error: string | null
  label: string
  setEnabled: (enabled: boolean) => Promise<void>
  refresh: () => Promise<UserLocationContext | null>
  locationForTurn: () => Promise<UserLocationContext | null>
}

function classifyLocationError(err: unknown): { status: LocationStatus; message: string } {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = Number((err as GeolocationPositionError).code)
    if (code === 1) {
      return {
        status: 'denied',
        message: 'Location access was denied in macOS or the webview permission prompt.',
      }
    }
    if (code === 2) {
      return { status: 'error', message: 'Current location is unavailable.' }
    }
    if (code === 3) {
      return { status: 'error', message: 'Location request timed out.' }
    }
  }
  const message = err instanceof Error ? err.message : 'Location request failed.'
  return {
    status: message.toLowerCase().includes('not supported') ? 'unsupported' : 'error',
    message,
  }
}

async function readPermissionStatus(): Promise<LocationStatus> {
  const permission = await queryGeolocationPermission()
  if (permission === 'denied') return 'denied'
  if (permission === 'unsupported') return 'idle'
  return permission === 'granted' ? 'ready' : 'idle'
}

export const locationStore = create<LocationState>((set, get) => {
  const current = readCachedLocation()
  const enabled = readLocationSharingEnabled()
  return {
    enabled,
    current,
    status: enabled && current ? 'ready' : 'idle',
    error: null,
    label: formatLocation(current),

    setEnabled: async (enabledNext) => {
      if (!enabledNext) {
        persistLocationSharingEnabled(false)
        set({ enabled: false, current: null, status: 'idle', error: null, label: 'Not shared' })
        return
      }

      persistLocationSharingEnabled(true)
      set({ enabled: true, status: 'checking', error: null })
      try {
        const location = await requestApproximateLocation()
        set({ current: location, status: 'ready', error: null, label: formatLocation(location) })
      } catch (err) {
        const { status, message } = classifyLocationError(err)
        persistLocationSharingEnabled(false)
        set({ enabled: false, current: null, status, error: message, label: 'Not shared' })
      }
    },

    refresh: async () => {
      if (!get().enabled) return null
      set({ status: 'checking', error: null })
      try {
        const location = await requestApproximateLocation()
        set({ current: location, status: 'ready', error: null, label: formatLocation(location) })
        return location
      } catch (err) {
        const { status, message } = classifyLocationError(err)
        if (status === 'denied') {
          persistLocationSharingEnabled(false)
          set({ enabled: false, current: null, status, error: message, label: 'Not shared' })
        } else {
          set({ status, error: message })
        }
        return null
      }
    },

    locationForTurn: async () => {
      const state = get()
      if (!state.enabled) return null
      if (isLocationFresh(state.current)) return state.current

      const permissionStatus = await readPermissionStatus()
      if (permissionStatus === 'denied') {
        set({
          enabled: false,
          current: null,
          status: 'denied',
          error: 'Location access was denied in macOS or the webview permission prompt.',
          label: 'Not shared',
        })
        persistLocationSharingEnabled(false)
        return null
      }

      return get().refresh()
    },
  }
})
