/**
 * IndexedDB-backed disk cache for attachment bytes.
 *
 * Survives app restarts so we don't refetch every visible image from the
 * agent-server on each launch — important for users running with a remote
 * server over a slow link. Keyed by `${sessionId}:${storagePath}`, which
 * is content-stable so a hit guarantees the bytes are still correct.
 *
 * Stores ArrayBuffer + mimeType (not Blob directly) — older WebKit /
 * WKWebView builds had quirks with Blob round-trips through IndexedDB,
 * and ArrayBuffer is universally well-supported.
 *
 * Size accounting is kept in memory and seeded once on first open. We
 * never re-scan the full store on each put — that turned the cache into
 * an O(N²) hot path under sustained image fetches.
 */

const DB_NAME = 'anton-attachments'
const STORE = 'blobs'
const DB_VERSION = 1
const SOFT_CAP_BYTES = 256 * 1024 * 1024
const ACCESS_INDEX = 'lastAccess'

export type DiskRecord = {
  key: string
  buffer: ArrayBuffer
  mimeType: string
  sizeBytes: number
  lastAccess: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Running total of bytes in the store. Seeded once on first open from
 *  the existing records, then maintained incrementally on put/delete.
 *  Approximate during the seed window; converges within milliseconds. */
let totalBytesOnDisk = 0
let totalSeeded = false
let seedPromise: Promise<void> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex(ACCESS_INDEX, 'lastAccess')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

function seedTotalBytes(): Promise<void> {
  if (totalSeeded) return Promise.resolve()
  if (seedPromise) return seedPromise
  seedPromise = openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          totalSeeded = true
          resolve()
          return
        }
        try {
          const transaction = db.transaction(STORE, 'readonly')
          const store = transaction.objectStore(STORE)
          const cursorReq = store.openCursor()
          let total = 0
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result
            if (!cursor) return
            const v = cursor.value as DiskRecord
            total += v.sizeBytes
            cursor.continue()
          }
          transaction.oncomplete = () => {
            totalBytesOnDisk = total
            totalSeeded = true
            resolve()
          }
          transaction.onerror = () => {
            totalSeeded = true
            resolve()
          }
          transaction.onabort = () => {
            totalSeeded = true
            resolve()
          }
        } catch {
          totalSeeded = true
          resolve()
        }
      }),
  )
  return seedPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      let result: T | null = null
      try {
        const transaction = db.transaction(STORE, mode)
        const store = transaction.objectStore(STORE)
        const request = work(store)
        request.onsuccess = () => {
          result = request.result
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => resolve(null)
        transaction.onabort = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
}

export async function diskGet(key: string): Promise<DiskRecord | null> {
  const record = await tx<DiskRecord>(
    'readonly',
    (store) => store.get(key) as IDBRequest<DiskRecord>,
  )
  if (!record) return null
  // Touch lastAccess in the background so disk-side LRU reflects reality.
  void tx(
    'readwrite',
    (store) => store.put({ ...record, lastAccess: Date.now() }) as IDBRequest<IDBValidKey>,
  )
  return record
}

export async function diskPut(record: DiskRecord): Promise<void> {
  await seedTotalBytes()
  // diskPut may overwrite an existing record. We don't bother subtracting
  // the prior size — overwrites are rare (same key = same content for
  // content-stable storagePath) and a small over-count just triggers
  // eviction slightly earlier than strictly necessary.
  await tx('readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>)
  totalBytesOnDisk += record.sizeBytes
  if (totalBytesOnDisk > SOFT_CAP_BYTES) {
    void evictOldestUntilUnderCap()
  }
}

async function evictOldestUntilUnderCap(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const index = store.index(ACCESS_INDEX)
      // Walk in oldest-first order. Stop once we're back under the soft cap.
      const cursorReq = index.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        if (totalBytesOnDisk <= SOFT_CAP_BYTES * 0.8) {
          // Done; let the transaction commit.
          return
        }
        const v = cursor.value as DiskRecord
        cursor.delete()
        totalBytesOnDisk = Math.max(0, totalBytesOnDisk - v.sizeBytes)
        cursor.continue()
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
