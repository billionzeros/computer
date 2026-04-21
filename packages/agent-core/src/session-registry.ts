/**
 * SessionRegistry — a bounded, LRU-ordered registry for every live
 * session object the server holds.
 *
 * Pre-registry, `server.ts` stored sessions in an unbounded `Map` and
 * relied on explicit `session_destroy` messages from the client to clean
 * up. Two problems fell out of that:
 *
 *   1. `handleSessionDestroy` deleted the Map entry but never awaited
 *      `session.shutdown()`, so the codex app-server subprocess (and its
 *      MCP shim child) lived until the host process died. Over hours of
 *      normal use a VPS would accumulate tens of orphaned node + codex
 *      processes.
 *
 *   2. Nothing ever evicted sessions the client forgot about. Crashed
 *      browsers, abandoned tabs, or simply long-running desktops would
 *      keep the in-memory set growing without bound — each harness
 *      session costing ~30 MB RSS between codex + shim + our own state.
 *
 * The registry solves both with the same contract:
 *   - `put(id, session, category)` inserts, evicting the least-recently
 *     used entry in the same pool if capacity is reached.
 *   - `get(id)` touches recency; `peek(id)` doesn't.
 *   - `delete(id)` always awaits `session.shutdown()` when present.
 *   - `pin(id)` / `unpin(id)` mark active turns unevictable for the
 *     window they're streaming.
 *
 * Pools are partitioned so a burst of routines can't evict live
 * conversations (and vice-versa). Each category has an independent
 * capacity and recency floor.
 *
 * This file has no dependency on `Session` or `HarnessSession` —
 * callers pass an opaque `Shutdownable` so agent-core stays free to
 * introduce new session types without touching the registry.
 */

import { createLogger } from '@anton/logger'

const log = createLogger('session-registry')

/**
 * The subset of the session API the registry cares about. Anything that
 * owns resources we need to free on eviction implements the optional
 * `shutdown()`. Pi SDK `Session` doesn't today; harness sessions do.
 */
export interface Shutdownable {
  readonly id: string
  shutdown?: () => Promise<void> | void
}

/**
 * Why a session is in the registry. Category is a required discriminator
 * — the caller states intent at `put()` time rather than the registry
 * inferring it. This keeps eviction policy explicit and testable.
 *
 * - `conversation`: user-driven chat session (Pi SDK or harness).
 * - `routine`: agent-manager routine / scheduled job run.
 * - `ephemeral`: sub-agent spawn, publish job, fork — short-lived,
 *   typically destroyed by its own finally-block before eviction
 *   matters.
 */
export type SessionCategory = 'conversation' | 'routine' | 'ephemeral'

export interface PoolConfig {
  maxSessions: number
  /**
   * Minimum age (in ms) a session must have to be eligible for eviction.
   * Prevents thrashing when the pool is at capacity and a new entry
   * arrives in the same breath as the last one. 0 disables the floor.
   */
  recencyFloorMs: number
}

export const DEFAULT_POOLS: Record<SessionCategory, PoolConfig> = {
  conversation: { maxSessions: 40, recencyFloorMs: 30_000 },
  routine: { maxSessions: 40, recencyFloorMs: 30_000 },
  ephemeral: { maxSessions: 20, recencyFloorMs: 10_000 },
}

interface Entry<T extends Shutdownable> {
  session: T
  category: SessionCategory
  lastAccess: number
  pinned: boolean
}

export interface SessionRegistryOpts {
  pools?: Partial<Record<SessionCategory, PoolConfig>>
}

export class SessionRegistry<T extends Shutdownable = Shutdownable> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly pools: Record<SessionCategory, PoolConfig>

  constructor(opts: SessionRegistryOpts = {}) {
    this.pools = {
      ...DEFAULT_POOLS,
      ...opts.pools,
    }
  }

  size(): number {
    return this.entries.size
  }

  /** Count sessions in a single pool — useful for diagnostics / tests. */
  sizeOf(category: SessionCategory): number {
    let n = 0
    for (const entry of this.entries.values()) {
      if (entry.category === category) n += 1
    }
    return n
  }

  /**
   * Insert a session. If the target pool is at capacity, the least-recently
   * accessed eligible entry is evicted in the background (its
   * `shutdown()` runs without blocking the new put). If no entry is
   * eligible (everything pinned or within the recency floor), the insert
   * still succeeds — the pool temporarily goes over capacity and we log
   * a warning. This avoids blocking the foreground turn on eviction.
   */
  put(id: string, session: T, category: SessionCategory): void {
    const now = Date.now()

    // Replace-in-place if the same id was already registered. Don't
    // shutdown the prior entry — callers use put() for fresh inserts;
    // replacements come through the dedicated switch path in server.ts
    // which already calls shutdown() explicitly.
    if (this.entries.has(id)) {
      const entry = this.entries.get(id)!
      entry.session = session
      entry.category = category
      entry.lastAccess = now
      entry.pinned = false
      return
    }

    this.entries.set(id, { session, category, lastAccess: now, pinned: false })

    const pool = this.pools[category]
    if (this.sizeOf(category) > pool.maxSessions) {
      const victim = this.pickEvictionVictim(category, now)
      if (victim) {
        this.entries.delete(victim.id)
        // Fire-and-forget shutdown. Eviction logic must never block the
        // foreground insert path.
        void this.runShutdown(victim.id, victim.entry.session, 'eviction')
      } else {
        log.warn(
          {
            category,
            poolSize: this.sizeOf(category),
            cap: pool.maxSessions,
          },
          'session pool over capacity but no eligible victim (all pinned or within recency floor)',
        )
      }
    }
  }

  /** Read and bump LRU recency. */
  get(id: string): T | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    entry.lastAccess = Date.now()
    return entry.session
  }

  /** Read without touching LRU order — for diagnostics / server shutdown. */
  peek(id: string): T | undefined {
    return this.entries.get(id)?.session
  }

  /** Whether an id is registered, without side-effects. */
  has(id: string): boolean {
    return this.entries.has(id)
  }

  /** Pin a session so it's ineligible for eviction. Safe to call on unknown ids. */
  pin(id: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.pinned = true
  }

  unpin(id: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.pinned = false
  }

  /**
   * Remove and shut down a session. Awaits `shutdown()` so callers that
   * want to block on cleanup (session_destroy handler, server shutdown)
   * can do so. No-op if the id isn't registered.
   */
  async delete(id: string, reason: 'explicit' | 'server-shutdown' = 'explicit'): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    await this.runShutdown(id, entry.session, reason)
  }

  /** Shut down every registered session. Used on graceful server shutdown. */
  async shutdownAll(): Promise<void> {
    const snapshot = [...this.entries]
    this.entries.clear()
    await Promise.all(
      snapshot.map(([id, entry]) => this.runShutdown(id, entry.session, 'server-shutdown')),
    )
  }

  /** Iterate over entries — used by server.ts where we need to scan all sessions (e.g. MCP probe fallout). */
  *[Symbol.iterator](): IterableIterator<[string, T]> {
    for (const [id, entry] of this.entries) yield [id, entry.session]
  }

  /**
   * Iterate over just the session values. Mirrors `Map.values()` so code
   * that previously held `Map<string, Session>` doesn't need to know it's
   * talking to a registry. Does NOT touch LRU recency.
   */
  *values(): IterableIterator<T> {
    for (const entry of this.entries.values()) yield entry.session
  }

  // ── internal ─────────────────────────────────────────────────

  private pickEvictionVictim(
    category: SessionCategory,
    now: number,
  ): { id: string; entry: Entry<T> } | null {
    const floor = this.pools[category].recencyFloorMs
    let victimId: string | null = null
    let victimEntry: Entry<T> | null = null

    // Iterate in insertion order — Map preserves it. The first non-pinned,
    // old-enough entry in the target category wins. LRU ordering is
    // maintained by having `get()` re-touch entries; we don't move them
    // to the end of the Map explicitly (that's an O(n) operation for
    // large maps), because the "age" signal (lastAccess) is kept on the
    // entry itself and we pick the oldest by timestamp below.
    for (const [id, entry] of this.entries) {
      if (entry.category !== category) continue
      if (entry.pinned) continue
      if (now - entry.lastAccess < floor) continue
      if (!victimEntry || entry.lastAccess < victimEntry.lastAccess) {
        victimId = id
        victimEntry = entry
      }
    }

    if (victimId !== null && victimEntry !== null) {
      return { id: victimId, entry: victimEntry }
    }
    return null
  }

  private async runShutdown(id: string, session: T, reason: string): Promise<void> {
    const fn = session.shutdown
    if (typeof fn !== 'function') {
      log.debug({ sessionId: id, reason }, 'session has no shutdown() — nothing to do')
      return
    }
    try {
      await Promise.resolve(fn.call(session))
      log.info({ sessionId: id, reason }, 'session shutdown complete')
    } catch (err) {
      log.warn(
        { err: (err as Error).message, sessionId: id, reason },
        'session shutdown threw — continuing',
      )
    }
  }
}
