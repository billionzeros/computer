# Session Lifecycle — Registry, Eviction, Shutdown

> **Status:** authoritative description as of Apr 2026.
> **Companion to:** [HARNESS_ARCHITECTURE.md](./HARNESS_ARCHITECTURE.md) (session ownership and turn flow within a single conversation).
> **Scope:** every live session object the server holds — Pi SDK `Session`, `HarnessSession`, `CodexHarnessSession`, and scheduled agent runs.

## Why a registry exists

Pre-registry, `server.ts` stored sessions in an unbounded `Map<string, Session | HarnessSession | CodexHarnessSession>` and relied on explicit `session_destroy` messages from the client to clean up. Two production failures fell out of that:

1. **`handleSessionDestroy` leak.** The handler deleted the Map entry but never `await`ed `session.shutdown()`. For Pi SDK sessions this was harmless (no owned subprocess). For harness sessions this meant the `codex app-server` subprocess and its `anton-mcp-shim` child survived until the host process died. Over hours of normal use a VPS would accumulate tens of orphaned `node` + `codex` processes.

2. **Unbounded accumulation.** Nothing evicted sessions the client forgot about — crashed browsers, abandoned tabs, long-running desktops. Each harness session holds ~30 MB RSS between codex + shim + our own state, so the set grew without bound until memory pressure ended the process.

The registry solves both with the same contract, so every session type gets the same guarantees.

## Contract

`SessionRegistry<T extends Shutdownable>` lives in [`packages/agent-core/src/session-registry.ts`](../../packages/agent-core/src/session-registry.ts). The server instantiates one for all session types:

```ts
private sessions: SessionRegistry<Session | HarnessSession | CodexHarnessSession>
```

### Category (required at put-time)

Every session declares its category when inserted. The category discriminates eviction pools so a burst of short-lived runs can't evict live conversations.

| Category | Used for | Default pool |
|---|---|---|
| `conversation` | user-driven chat (Pi SDK or harness) | `{maxSessions: 40, recencyFloorMs: 30_000}` |
| `routine` | agent-manager routines / scheduled jobs | `{maxSessions: 40, recencyFloorMs: 30_000}` |
| `ephemeral` | sub-agent spawns, publish jobs, forks | `{maxSessions: 20, recencyFloorMs: 10_000}` |

Defaults live in `DEFAULT_POOLS`. The server uses them as-is; tests override per-case.

### Methods

| Method | Touches LRU? | Awaits shutdown? | Blocking? |
|---|---|---|---|
| `put(id, session, category)` | yes (insert timestamp) | no | yes (eviction is fire-and-forget) |
| `get(id)` | yes | n/a | no |
| `peek(id)` | no | n/a | no |
| `has(id)` | no | n/a | no |
| `pin(id)` / `unpin(id)` | no | n/a | no |
| `delete(id, reason?)` | n/a | **yes** | yes |
| `shutdownAll()` | n/a | yes (in parallel) | yes |
| `size()` / `sizeOf(category)` | no | n/a | no |

### Invariants

- **`delete()` awaits `shutdown()`.** Callers that need to block on cleanup (the `session_destroy` handler, graceful server shutdown) can do so by awaiting the return value.
- **Eviction never blocks the foreground put.** When a pool hits capacity, the victim's `shutdown()` runs via `void`. Foreground turn latency is independent of eviction.
- **Replace-in-place on duplicate id does NOT shut down the prior session.** Provider-switch paths explicitly `await shutdown()` before replacing.
- **`shutdown()` throwing does not break eviction or delete.** Errors are logged at warn level and the session is still removed from the registry.
- **A session without `shutdown()` (Pi SDK `Session`) is handled as a no-op.** The `Shutdownable` interface marks `shutdown` optional.

## Eviction policy

When `put()` would exceed a pool's `maxSessions`, the registry picks the **least-recently-accessed, non-pinned, older-than-floor** entry in the same pool and shuts it down in the background.

If no entry is eligible (everything is pinned or within the recency floor), the `put()` still succeeds — the pool temporarily goes over capacity and the registry logs a warn. This avoids blocking the foreground turn on eviction and keeps the failure mode visible (ops sees the warn, capacity tuning follows).

The recency floor prevents thrash when the pool is at capacity and a new entry arrives in the same breath as the last one. Without it, two quick turns could evict each other.

## Pinning during active turns

`server.ts` pins a session for the duration of `processMessage` / `runHarness` / agent-run flows:

```ts
this.activeTurns.add(sessionId)
this.sessions.pin(sessionId)
try {
  // ... stream turn ...
} finally {
  this.activeTurns.delete(sessionId)
  this.sessions.unpin(sessionId)
}
```

This guarantees a mid-stream eviction can't rip the session out from under a turn that's still writing to stdout. Routines and ephemeral runs use the same pattern.

## Server-shutdown path

`this.sessions.shutdownAll()` fans out `shutdown()` across every category in parallel. This replaces the pre-registry loop that iterated the Map and awaited sequentially.

## Interaction with the MCP probe

The registry's `shutdown()` path ensures that the codex subprocess **and** its spawned shim child are torn down on every eviction or explicit destroy. This closes the socket connection and unregisters the per-session auth token in the IPC handler, so a stale registry entry can never be revived by a shim reconnect attempt. The MCP health probe documented in [HARNESS_ARCHITECTURE.md](./HARNESS_ARCHITECTURE.md#mcp-shim-spawn--health) is independent of the registry — it runs even when no sessions exist — but it shares the same `buildMcpSpawnConfig` source of truth, so a shim that fails the probe would also fail for any new session the registry accepts.

## Integration tests

- [`packages/agent-core/src/__fixtures__/check-session-registry.ts`](../../packages/agent-core/src/__fixtures__/check-session-registry.ts) — LRU ordering, pool partitioning, pinning, recency-floor warn path, `delete()` awaits shutdown, replace-in-place, `peek()` no-touch, `shutdown()` error handling.

  Run with: `pnpm --filter @anton/agent-core check:session-registry`

## Non-goals

- **Cross-session LRU policy.** Pools are independent; we don't move sessions between categories.
- **Persistence of the registry itself.** Sessions are re-instantiated lazily from disk storage (`messages.jsonl` / meta.json) when the client reconnects — the registry is a pure in-memory structure.
- **Timer-based idle eviction.** Eviction is triggered only by `put()` pressure. Adding an idle timer is trivial if measurements show value; today there's no evidence it's needed once the bounded pools are in place.
