/**
 * Lazy attachment loader.
 *
 * History payloads carry only metadata for image attachments — the renderer
 * fetches bytes through this module on demand via a `request_attachment`
 * WS round-trip. Bytes get wrapped in a Blob URL once and cached, so chip
 * thumbnail / hover preview / full viewer all reuse the same object URL.
 *
 * Three-tier cache:
 *   1. In-memory blob URL cache (this module) — fastest, refCounted, LRU.
 *   2. IndexedDB disk cache — survives app restart.
 *   3. WS request to the agent-server — source of truth.
 *
 * Pending requests survive WS reconnects: status transitions back to
 * 'connected' replay every still-unresolved request with a fresh timeout.
 * A page reload was previously the only fix for a mid-flight disconnect.
 */

import { Channel } from '@anton/protocol'
import { useEffect, useMemo, useState } from 'react'
import { type DiskRecord, diskGet, diskPut } from './attachmentDiskCache.js'
import { connection } from './connection.js'

type CacheEntry = {
  blobUrl: string
  sizeBytes: number
  lastAccess: number
  refCount: number
}

type PendingRequest = {
  requestId: string
  sessionId: string
  storagePath: string
  resolve: (result: { blobUrl: string; sizeBytes: number }) => void
  reject: (err: Error) => void
  timer: number
}

const SOFT_CAP_BYTES = 64 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

// `${sessionId}:${storagePath}` — sessionIds are UUID-shaped (no `:`),
// storagePaths always start with `images/`, so this is collision-free
// in practice. If those invariants ever loosen, switch to a `\0` separator.
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string>>()
const pendingByRequestId = new Map<string, PendingRequest>()
let totalBytes = 0
let nextSeq = 0

function cacheKey(sessionId: string, storagePath: string): string {
  return `${sessionId}:${storagePath}`
}

function nextRequestId(): string {
  nextSeq += 1
  return `att-${nextSeq}-${Date.now()}`
}

function decodeBase64ToArrayBuffer(s: string): ArrayBuffer {
  const bin = atob(s)
  const buf = new ArrayBuffer(bin.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i)
  return buf
}

function evictIfNeeded() {
  if (totalBytes <= SOFT_CAP_BYTES) return
  const entries = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  for (const [key, entry] of entries) {
    if (totalBytes <= SOFT_CAP_BYTES * 0.8) break
    if (entry.refCount > 0) continue
    URL.revokeObjectURL(entry.blobUrl)
    totalBytes -= entry.sizeBytes
    cache.delete(key)
  }
}

function bufferToBlobUrl(buffer: ArrayBuffer, mimeType: string): string {
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' })
  return URL.createObjectURL(blob)
}

function armTimeout(pending: PendingRequest) {
  pending.timer = window.setTimeout(() => {
    if (pendingByRequestId.delete(pending.requestId)) {
      pending.reject(new Error('timeout'))
    }
  }, REQUEST_TIMEOUT_MS)
}

function sendRequest(pending: PendingRequest) {
  connection.send(Channel.AI, {
    type: 'request_attachment',
    id: pending.requestId,
    sessionId: pending.sessionId,
    storagePath: pending.storagePath,
  })
}

connection.onMessage((channel, msg) => {
  if (channel !== Channel.AI || msg.type !== 'attachment_data') return
  const pending = pendingByRequestId.get(msg.id)
  if (!pending) return
  pendingByRequestId.delete(msg.id)
  window.clearTimeout(pending.timer)
  if (msg.error || typeof msg.data !== 'string') {
    pending.reject(new Error(msg.error || 'no_data'))
    return
  }
  const buffer = decodeBase64ToArrayBuffer(msg.data)
  const mimeType = msg.mimeType || 'application/octet-stream'
  pending.resolve({
    blobUrl: bufferToBlobUrl(buffer, mimeType),
    sizeBytes: buffer.byteLength,
  })
  // Persist to disk cache so the next app launch finds it without a fetch.
  // Failures here are non-fatal (next launch just refetches); swallow so
  // we don't leak an unhandled rejection.
  diskPut({
    key: cacheKey(pending.sessionId, pending.storagePath),
    buffer,
    mimeType,
    sizeBytes: buffer.byteLength,
    lastAccess: Date.now(),
  }).catch(() => {})
})

// Replay every unresolved request when the WS comes back. Without this, a
// disconnect mid-fetch leaves the chip stuck on the icon for 30s until
// the per-request timeout fires.
//
// The clearTimeout below is load-bearing: armTimeout() reassigns
// pending.timer, but the prior timer handle is still scheduled. If we
// don't cancel it, that earlier timer will fire later and incorrectly
// reject a request whose response is now in flight again.
connection.onStatusChange((status) => {
  if (status !== 'connected') return
  for (const pending of pendingByRequestId.values()) {
    window.clearTimeout(pending.timer)
    armTimeout(pending)
    sendRequest(pending)
  }
})

function fetchAttachmentBlobUrl(sessionId: string, storagePath: string): Promise<string> {
  const key = cacheKey(sessionId, storagePath)
  const cached = cache.get(key)
  if (cached) {
    cached.lastAccess = Date.now()
    return Promise.resolve(cached.blobUrl)
  }
  const inFlight = inflight.get(key)
  if (inFlight) return inFlight

  // Register the inflight entry BEFORE starting the work, so any
  // re-entrant call within this microtask sees the same promise.
  let resolveOuter!: (url: string) => void
  let rejectOuter!: (err: Error) => void
  const outer = new Promise<string>((res, rej) => {
    resolveOuter = res
    rejectOuter = rej
  })
  inflight.set(key, outer)

  loadFromDiskOrServer(sessionId, storagePath).then(
    ({ blobUrl, sizeBytes }) => {
      const entry: CacheEntry = {
        blobUrl,
        sizeBytes,
        lastAccess: Date.now(),
        refCount: 0,
      }
      cache.set(key, entry)
      totalBytes += entry.sizeBytes
      inflight.delete(key)
      resolveOuter(blobUrl)
      // Defer eviction one microtask so any awaiting consumer's .then
      // callback runs first and bumps refCount before we consider
      // evicting this entry. Without this, a near-full cache pinned by
      // other components could revoke the URL we just resolved.
      queueMicrotask(evictIfNeeded)
    },
    (err) => {
      inflight.delete(key)
      rejectOuter(err instanceof Error ? err : new Error(String(err)))
    },
  )
  return outer
}

async function loadFromDiskOrServer(
  sessionId: string,
  storagePath: string,
): Promise<{ blobUrl: string; sizeBytes: number }> {
  const key = cacheKey(sessionId, storagePath)
  let diskHit: DiskRecord | null = null
  try {
    diskHit = await diskGet(key)
  } catch {
    diskHit = null
  }
  if (diskHit) {
    return {
      blobUrl: bufferToBlobUrl(diskHit.buffer, diskHit.mimeType),
      sizeBytes: diskHit.sizeBytes,
    }
  }
  return new Promise<{ blobUrl: string; sizeBytes: number }>((resolve, reject) => {
    const pending: PendingRequest = {
      requestId: nextRequestId(),
      sessionId,
      storagePath,
      resolve,
      reject,
      timer: 0,
    }
    pendingByRequestId.set(pending.requestId, pending)
    armTimeout(pending)
    sendRequest(pending)
  })
}

function acquire(key: string) {
  const entry = cache.get(key)
  if (entry) entry.refCount += 1
}

function release(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  entry.refCount = Math.max(0, entry.refCount - 1)
}

export type AttachmentBlobState = {
  url: string | undefined
  loading: boolean
  error: string | undefined
}

/**
 * Resolve image bytes to a renderable URL.
 *
 * - When `inlineData` is provided (live just-sent message), returns a
 *   data: URL synchronously — no WS round-trip.
 * - Otherwise checks the in-memory cache, then IndexedDB, then asks the
 *   server. The same URL is shared across chip thumbnail / hover preview
 *   / full viewer for the rest of the session lifetime.
 */
export function useAttachmentBlobUrl(
  sessionId: string | undefined,
  storagePath: string | undefined,
  mimeType: string | undefined,
  inlineData?: string,
): AttachmentBlobState {
  // Memoize so multi-MB base64 doesn't re-concat into a fresh string on
  // every render — and so the effect's dependency reference stays stable.
  const inlineUrl = useMemo(
    () => (inlineData && mimeType ? `data:${mimeType};base64,${inlineData}` : undefined),
    [inlineData, mimeType],
  )

  const [state, setState] = useState<AttachmentBlobState>(() =>
    inlineUrl
      ? { url: inlineUrl, loading: false, error: undefined }
      : { url: undefined, loading: !!sessionId && !!storagePath, error: undefined },
  )

  useEffect(() => {
    if (inlineUrl) {
      setState({ url: inlineUrl, loading: false, error: undefined })
      return
    }
    if (!sessionId || !storagePath) {
      setState({ url: undefined, loading: false, error: undefined })
      return
    }
    const key = cacheKey(sessionId, storagePath)
    let cancelled = false
    let acquired = false
    setState((prev) => ({ url: prev.url, loading: true, error: undefined }))
    fetchAttachmentBlobUrl(sessionId, storagePath)
      .then((url) => {
        if (cancelled) return
        acquire(key)
        acquired = true
        setState({ url, loading: false, error: undefined })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          url: undefined,
          loading: false,
          error: err instanceof Error ? err.message : 'fetch_failed',
        })
      })
    return () => {
      cancelled = true
      // Pair release with acquire — if the fetch was cancelled before
      // we acquired, releasing here would decrement another component's
      // refCount and let eviction revoke a URL still in use.
      if (acquired) release(key)
    }
  }, [sessionId, storagePath, inlineUrl])

  return state
}
