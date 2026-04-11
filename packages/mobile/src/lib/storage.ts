/**
 * Persistent storage helpers using expo-secure-store for credentials
 * and a simple JSON-based approach for app state.
 */

import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export interface SavedMachine {
  id: string
  name: string
  host: string
  port: number
  token: string
  useTLS: boolean
}

const MACHINES_META_KEY = 'anton_machines_meta'
const MACHINE_TOKEN_PREFIX = 'anton_machine_token_'

/** SecureStore keys only allow alphanumeric, ".", "-", and "_". Replace invalid chars. */
function tokenKey(machineId: string): string {
  return `${MACHINE_TOKEN_PREFIX}${machineId.replace(/:/g, '_')}`
}
const LAST_MACHINE_KEY = 'anton_last_machine'
const MODEL_KEY = 'anton_selected_model'
const _CONVERSATIONS_KEY = 'anton_conversations'
const SYNC_VERSION_KEY = 'anton_sync_version'

// SecureStore has a 2048 byte limit per value on iOS.
// Each machine's token is stored under its own SecureStore key to stay
// within the limit. The machine list metadata (without tokens) is stored
// separately — it is small enough to fit in a single SecureStore entry.

type MachineMetadata = Omit<SavedMachine, 'token'>

async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null
  try {
    return await SecureStore.getItemAsync(key)
  } catch (err) {
    console.warn(`[SecureStore] Failed to read key "${key}":`, err)
    return null
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(key, value)
  }
}

async function removeSecureItem(key: string): Promise<void> {
  if (Platform.OS !== 'web') {
    try {
      await SecureStore.deleteItemAsync(key)
    } catch {
      // Ignore
    }
  }
}

// ── Machines ──────────────────────────────────────────────────────

export async function loadMachines(): Promise<SavedMachine[]> {
  const raw = await getSecureItem(MACHINES_META_KEY)
  if (!raw) return []
  try {
    const metas: MachineMetadata[] = JSON.parse(raw)
    const machines = await Promise.all(
      metas.map(async (meta) => {
        const token = (await getSecureItem(tokenKey(meta.id))) ?? ''
        return { ...meta, token }
      }),
    )
    return machines
  } catch {
    return []
  }
}

export async function saveMachines(machines: SavedMachine[]): Promise<void> {
  const metas: MachineMetadata[] = machines.map(({ token: _, ...meta }) => meta)
  await setSecureItem(MACHINES_META_KEY, JSON.stringify(metas))
  await Promise.all(machines.map((m) => setSecureItem(tokenKey(m.id), m.token)))
}

export async function removeMachineToken(machineId: string): Promise<void> {
  await removeSecureItem(tokenKey(machineId))
}

export async function loadLastMachineId(): Promise<string | null> {
  return getSecureItem(LAST_MACHINE_KEY)
}

export async function saveLastMachineId(id: string): Promise<void> {
  await setSecureItem(LAST_MACHINE_KEY, id)
}

// ── Model ─────────────────────────────────────────────────────────

export async function loadSelectedModel(): Promise<{ provider: string; model: string } | null> {
  const raw = await getSecureItem(MODEL_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function saveSelectedModel(provider: string, model: string): Promise<void> {
  await setSecureItem(MODEL_KEY, JSON.stringify({ provider, model }))
}

// ── Sync version ──────────────────────────────────────────────────

export async function loadSyncVersion(): Promise<number> {
  const raw = await getSecureItem(SYNC_VERSION_KEY)
  return raw ? Number.parseInt(raw, 10) : 0
}

export async function saveSyncVersion(version: number): Promise<void> {
  await setSecureItem(SYNC_VERSION_KEY, String(version))
}
