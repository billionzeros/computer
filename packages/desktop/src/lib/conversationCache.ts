/**
 * Session cache — metadata-only localStorage cache for instant sidebar rendering.
 *
 * Messages are NEVER stored here. They live in-memory only (zustand Map).
 * This cache is the client's fast view of server-side session metadata.
 */

const CACHE_KEY = 'anton.sessionCache'

export interface SessionCacheMeta {
  sessionId: string // primary key — same as server's session ID
  title: string
  createdAt: number
  updatedAt: number // == lastActiveAt from server
  projectId?: string
  provider?: string
  model?: string
  messageCount: number
  agentSessionId?: string
}

// Bump to force all clients to do a full bootstrap on next connect.
// This cleans up stale localStorage sessions that predate the sync protocol.
export const SESSION_CACHE_VERSION = 2

export interface SessionCache {
  syncVersion: number // matches server's syncVersion at last sync
  cacheVersion?: number // client-side cache format version
  entries: SessionCacheMeta[]
}

// ── Read / Write ────────────────────────────────────────────────────

export function loadSessionCache(): SessionCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionCache
    if (!parsed.entries || typeof parsed.syncVersion !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function saveSessionCache(cache: SessionCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

export function clearSessionCache(): void {
  localStorage.removeItem(CACHE_KEY)
}

// ── Single-entry helpers ────────────────────────────────────────────

export function updateCacheEntry(sessionId: string, updates: Partial<SessionCacheMeta>): void {
  const cache = loadSessionCache()
  if (!cache) return
  const idx = cache.entries.findIndex((e) => e.sessionId === sessionId)
  if (idx >= 0) {
    cache.entries[idx] = { ...cache.entries[idx], ...updates }
    saveSessionCache(cache)
  }
}

export function addCacheEntry(entry: SessionCacheMeta): void {
  const cache = loadSessionCache() || { syncVersion: 0, entries: [] }
  // Avoid duplicates
  if (cache.entries.some((e) => e.sessionId === entry.sessionId)) return
  cache.entries.push(entry)
  saveSessionCache(cache)
}

export function removeCacheEntry(sessionId: string): void {
  const cache = loadSessionCache()
  if (!cache) return
  cache.entries = cache.entries.filter((e) => e.sessionId !== sessionId)
  saveSessionCache(cache)
}

// ── Conversion helpers ──────────────────────────────────────────────

/** Build a cache entry from a protocol SessionMeta */
export function cacheMetaFromServerSession(s: {
  id: string
  title: string
  createdAt: number
  lastActiveAt: number
  provider: string
  model: string
  messageCount: number
}): SessionCacheMeta {
  return {
    sessionId: s.id,
    title: s.title || 'New conversation',
    createdAt: s.createdAt,
    updatedAt: s.lastActiveAt,
    provider: s.provider,
    model: s.model,
    messageCount: s.messageCount,
  }
}

// ── Migration ───────────────────────────────────────────────────────

const LEGACY_KEY = 'anton.conversations'
const ACTIVE_CONV_KEY = 'anton.activeConversationId'

/**
 * Migrate from old `anton.conversations` format (with conv_xxx IDs and messages)
 * to the new `anton.sessionCache` format (metadata only, sessionId as primary key).
 *
 * Also rewrites `anton.conversations` in-place with messages stripped and id=sessionId
 * so the zustand store can load from it during the transition.
 *
 * Returns true if migration was performed.
 */
export function migrateFromLegacyConversations(): boolean {
  // Only migrate if sessionCache doesn't exist but old conversations do
  if (loadSessionCache()) return false

  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return false

  console.log('[SessionSync] Migration: detected legacy anton.conversations, converting...')

  try {
    const oldConvs = JSON.parse(raw) as Array<{
      id: string
      sessionId: string
      title: string
      messages: unknown[]
      createdAt: number
      updatedAt: number
      projectId?: string
      provider?: string
      model?: string
      agentSessionId?: string
    }>

    if (!Array.isArray(oldConvs) || oldConvs.length === 0) return false

    // Build sessionCache entries from old conversations
    const entries: SessionCacheMeta[] = []
    const migratedConvs: Array<Record<string, unknown>> = []

    for (const conv of oldConvs) {
      if (!conv.sessionId) continue

      entries.push({
        sessionId: conv.sessionId,
        title: conv.title || 'New conversation',
        createdAt: conv.createdAt || Date.now(),
        updatedAt: conv.updatedAt || Date.now(),
        projectId: conv.projectId,
        provider: conv.provider,
        model: conv.model,
        messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
        agentSessionId: conv.agentSessionId,
      })

      // Rewrite conversation with id=sessionId and no messages
      migratedConvs.push({
        ...conv,
        id: conv.sessionId, // drop conv_xxx, use sessionId
        messages: [], // strip messages
      })
    }

    // Save new session cache with syncVersion=0 (forces full bootstrap on next connect)
    console.log(
      `[SessionSync] Migration: converted ${entries.length} conversations, ${migratedConvs.length - entries.length} skipped (no sessionId)`,
    )
    saveSessionCache({ syncVersion: 0, entries })

    // Rewrite old conversations key with migrated data (metadata only)
    localStorage.setItem(LEGACY_KEY, JSON.stringify(migratedConvs))

    // Update activeConversationId if it uses a conv_xxx format
    const activeId = localStorage.getItem(ACTIVE_CONV_KEY)
    if (activeId?.startsWith('conv_')) {
      const matchingConv = oldConvs.find((c) => c.id === activeId)
      if (matchingConv?.sessionId) {
        localStorage.setItem(ACTIVE_CONV_KEY, matchingConv.sessionId)
      }
    }

    console.log('[SessionSync] Migration complete')
    return true
  } catch (err) {
    console.error('[SessionSync] Migration failed:', err)
    return false
  }
}
