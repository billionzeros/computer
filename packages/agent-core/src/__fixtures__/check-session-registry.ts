/**
 * SessionRegistry integration checks.
 *
 * Run with:  pnpm --filter @anton/agent-core check:session-registry
 *
 * Exercises the contract the server depends on:
 *   - Partitioned LRU: sessions in one pool don't evict sessions in
 *     another.
 *   - Pinning: a pinned session is skipped during eviction even when
 *     it's the oldest candidate.
 *   - Recency floor: sessions inserted within the floor window are
 *     protected from eviction; the pool temporarily goes over capacity
 *     and logs a warn.
 *   - `delete()` awaits `shutdown()` so callers can block on cleanup
 *     (what the fix for the destroy-leak depends on).
 *   - Replace-in-place on duplicate id doesn't shut down the prior
 *     session (that's the responsibility of explicit switch paths).
 */

import { SessionRegistry, type Shutdownable } from '../session-registry.js'

class FakeSession implements Shutdownable {
  shutdownCount = 0
  shutdownAt = 0
  constructor(public readonly id: string) {}
  async shutdown(): Promise<void> {
    this.shutdownCount += 1
    this.shutdownAt = Date.now()
  }
}

interface Case {
  name: string
  run: () => Promise<string | null> // null = pass; string = failure message
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

const cases: Case[] = [
  {
    name: 'put then get returns the same session',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>()
      const a = new FakeSession('a')
      reg.put('a', a, 'conversation')
      return reg.get('a') === a ? null : 'get did not return put session'
    },
  },
  {
    name: 'delete() awaits shutdown()',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>()
      const a = new FakeSession('a')
      reg.put('a', a, 'conversation')
      await reg.delete('a')
      if (a.shutdownCount !== 1) return `shutdown called ${a.shutdownCount}x, expected 1`
      if (reg.has('a')) return 'session still registered after delete'
      return null
    },
  },
  {
    name: 'partitioned pools: filling conversation does not evict routine',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>({
        pools: {
          conversation: { maxSessions: 2, recencyFloorMs: 0 },
          routine: { maxSessions: 2, recencyFloorMs: 0 },
          ephemeral: { maxSessions: 2, recencyFloorMs: 0 },
        },
      })
      const r1 = new FakeSession('r1')
      reg.put('r1', r1, 'routine')
      // Fill conversation pool past capacity.
      for (let i = 0; i < 5; i++) {
        reg.put(`c${i}`, new FakeSession(`c${i}`), 'conversation')
        await sleep(1) // ensure distinct lastAccess
      }
      // Let evictions fire-and-forget through the microtask queue.
      await sleep(20)
      if (!reg.has('r1')) return 'routine session was evicted by conversation pressure'
      if (r1.shutdownCount !== 0) return 'routine session was shut down'
      return null
    },
  },
  {
    name: 'LRU eviction picks the oldest non-pinned entry',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>({
        pools: {
          conversation: { maxSessions: 2, recencyFloorMs: 0 },
          routine: { maxSessions: 40, recencyFloorMs: 0 },
          ephemeral: { maxSessions: 20, recencyFloorMs: 0 },
        },
      })
      const a = new FakeSession('a')
      const b = new FakeSession('b')
      reg.put('a', a, 'conversation')
      await sleep(5)
      reg.put('b', b, 'conversation')
      await sleep(5)
      // Touch 'a' so 'b' becomes the LRU victim.
      reg.get('a')
      await sleep(5)
      reg.put('c', new FakeSession('c'), 'conversation')
      await sleep(20) // let background shutdown fire
      if (!reg.has('a')) return "'a' was evicted despite being touched more recently"
      if (reg.has('b')) return "'b' should have been evicted as LRU"
      if (b.shutdownCount !== 1) return `b.shutdown called ${b.shutdownCount}x, expected 1`
      return null
    },
  },
  {
    name: 'pinned session is skipped during eviction',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>({
        pools: {
          conversation: { maxSessions: 2, recencyFloorMs: 0 },
          routine: { maxSessions: 40, recencyFloorMs: 0 },
          ephemeral: { maxSessions: 20, recencyFloorMs: 0 },
        },
      })
      const a = new FakeSession('a')
      const b = new FakeSession('b')
      reg.put('a', a, 'conversation')
      await sleep(5)
      reg.put('b', b, 'conversation')
      await sleep(5)
      reg.pin('a') // oldest, but pinned
      reg.put('c', new FakeSession('c'), 'conversation')
      await sleep(20)
      if (!reg.has('a')) return 'pinned session was evicted'
      if (reg.has('b')) return 'b should have been evicted (next-oldest non-pinned)'
      return null
    },
  },
  {
    name: 'recency floor keeps pool over capacity when no victim is old enough',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>({
        pools: {
          conversation: { maxSessions: 1, recencyFloorMs: 5_000 },
          routine: { maxSessions: 40, recencyFloorMs: 0 },
          ephemeral: { maxSessions: 20, recencyFloorMs: 0 },
        },
      })
      const a = new FakeSession('a')
      const b = new FakeSession('b')
      reg.put('a', a, 'conversation')
      reg.put('b', b, 'conversation') // over capacity but 'a' is within floor
      await sleep(20)
      if (!reg.has('a')) return "'a' was evicted within its recency floor"
      if (!reg.has('b')) return "'b' insert should have succeeded even with no eligible victim"
      if (a.shutdownCount !== 0) return 'a was shut down while within recency floor'
      return null
    },
  },
  {
    name: 'replace-in-place on duplicate id does not shut down prior session',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>()
      const a1 = new FakeSession('a')
      const a2 = new FakeSession('a')
      reg.put('a', a1, 'conversation')
      reg.put('a', a2, 'conversation')
      if (a1.shutdownCount !== 0) return 'replace-in-place invoked shutdown on prior session'
      if (reg.get('a') !== a2) return 'replaced session not returned by get()'
      return null
    },
  },
  {
    name: 'peek() does not bump recency',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>({
        pools: {
          conversation: { maxSessions: 2, recencyFloorMs: 0 },
          routine: { maxSessions: 40, recencyFloorMs: 0 },
          ephemeral: { maxSessions: 20, recencyFloorMs: 0 },
        },
      })
      const a = new FakeSession('a')
      const b = new FakeSession('b')
      reg.put('a', a, 'conversation')
      await sleep(5)
      reg.put('b', b, 'conversation')
      await sleep(5)
      reg.peek('a') // must NOT touch LRU
      await sleep(5)
      reg.put('c', new FakeSession('c'), 'conversation')
      await sleep(20)
      // 'a' is oldest and peek didn't touch it, so 'a' should be evicted.
      if (reg.has('a')) return 'peek() bumped recency (a should have been evicted)'
      return null
    },
  },
  {
    name: 'shutdownAll shuts down every registered session',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>()
      const a = new FakeSession('a')
      const b = new FakeSession('b')
      const c = new FakeSession('c')
      reg.put('a', a, 'conversation')
      reg.put('b', b, 'routine')
      reg.put('c', c, 'ephemeral')
      await reg.shutdownAll()
      if (a.shutdownCount !== 1 || b.shutdownCount !== 1 || c.shutdownCount !== 1) {
        return `shutdown counts: a=${a.shutdownCount} b=${b.shutdownCount} c=${c.shutdownCount}`
      }
      if (reg.size() !== 0) return 'registry not empty after shutdownAll'
      return null
    },
  },
  {
    name: 'session without shutdown() is handled without throwing',
    run: async () => {
      const reg = new SessionRegistry()
      reg.put('noop', { id: 'noop' }, 'conversation')
      await reg.delete('noop')
      if (reg.has('noop')) return 'session still registered'
      return null
    },
  },
  {
    name: 'shutdown throwing does not break delete',
    run: async () => {
      const reg = new SessionRegistry()
      const bad = {
        id: 'bad',
        shutdown: () => {
          throw new Error('boom')
        },
      }
      reg.put('bad', bad, 'conversation')
      await reg.delete('bad') // must resolve
      if (reg.has('bad')) return 'session still registered after delete'
      return null
    },
  },
  {
    name: 'sizeOf reports per-pool counts',
    run: async () => {
      const reg = new SessionRegistry<FakeSession>()
      reg.put('c1', new FakeSession('c1'), 'conversation')
      reg.put('c2', new FakeSession('c2'), 'conversation')
      reg.put('r1', new FakeSession('r1'), 'routine')
      if (reg.sizeOf('conversation') !== 2) return `conversation size ${reg.sizeOf('conversation')}`
      if (reg.sizeOf('routine') !== 1) return `routine size ${reg.sizeOf('routine')}`
      if (reg.sizeOf('ephemeral') !== 0) return `ephemeral size ${reg.sizeOf('ephemeral')}`
      return null
    },
  },
]

async function main(): Promise<void> {
  let failed = 0
  for (const c of cases) {
    try {
      const err = await c.run()
      if (err === null) {
        console.log(`✓ session-registry: ${c.name}`)
      } else {
        failed++
        console.error(`✗ session-registry: ${c.name} — ${err}`)
      }
    } catch (err) {
      failed++
      console.error(`✗ session-registry: ${c.name} (threw)`, err)
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}/${cases.length} session-registry checks failed`)
    process.exit(1)
  }
  console.log(`\nAll ${cases.length} session-registry checks passed`)
}

void main()
