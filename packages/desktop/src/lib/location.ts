import type { UserLocationContext } from '@anton/protocol'

const LOCATION_ENABLED_KEY = 'anton.location.enabled'
const LOCATION_CACHE_KEY = 'anton.location.cached'
const CACHE_MAX_AGE_MS = 10 * 60 * 1000
const LOCATION_TIMEOUT_MS = 10 * 1000
const COARSE_ACCURACY_METERS = 1200

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function readLocationSharingEnabled(): boolean {
  try {
    return localStorage.getItem(LOCATION_ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

export function persistLocationSharingEnabled(enabled: boolean): void {
  localStorage.setItem(LOCATION_ENABLED_KEY, String(enabled))
  if (!enabled) localStorage.removeItem(LOCATION_CACHE_KEY)
}

export function readCachedLocation(): UserLocationContext | null {
  return readJson<UserLocationContext>(LOCATION_CACHE_KEY)
}

export function persistCachedLocation(location: UserLocationContext): void {
  localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location))
}

export function isLocationFresh(location: UserLocationContext | null): boolean {
  return Boolean(location && Date.now() - location.capturedAt < CACHE_MAX_AGE_MS)
}

export function formatLocation(location: UserLocationContext | null): string {
  if (!location) return 'Not shared'
  return `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`
}

export async function queryGeolocationPermission(): Promise<PermissionState | 'unsupported'> {
  if (!navigator.permissions?.query) return 'unsupported'
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return result.state
  } catch {
    return 'unsupported'
  }
}

export async function requestApproximateLocation(): Promise<UserLocationContext> {
  if (!navigator.geolocation) {
    throw new Error('Location is not supported in this desktop webview.')
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: CACHE_MAX_AGE_MS,
      timeout: LOCATION_TIMEOUT_MS,
    })
  })

  const location: UserLocationContext = {
    source: 'desktop-geolocation',
    precision: 'coarse',
    latitude: Number(position.coords.latitude.toFixed(2)),
    longitude: Number(position.coords.longitude.toFixed(2)),
    accuracyMeters: Math.max(Math.round(position.coords.accuracy), COARSE_ACCURACY_METERS),
    capturedAt: Date.now(),
  }
  persistCachedLocation(location)
  return location
}
