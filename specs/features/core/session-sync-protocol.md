# Session Sync Protocol

How the desktop client keeps its conversation list in sync with the server.

---

## The Problem We Solved

Anton has two places that know about conversations:

1. **Server disk** (`~/.anton/conversations/`) — the real data. Session directories with `meta.json` and `messages.jsonl`. An `index.json` lists them all.
2. **Client localStorage** (`anton.conversations`) — what the sidebar renders. Used to be a completely independent copy.

These two were never synced. If a session was created from the CLI, it wouldn't show in the UI. If the server restarted during an app update, the client would get `session_not_found` errors and **auto-delete** the user's conversations. Messages were duplicated in both places.

## How It Works Now

**Server disk is the single source of truth.** The client caches metadata in localStorage for fast sidebar rendering, but never stores messages. On connect, the client syncs with the server. While connected, the server pushes changes in real-time.

```
                    +--------------------------+
                    |     Server (disk)        |
                    |  index.json              |
                    |    syncVersion: 47       |
                    |    sessions: [...]       |
                    |    deltas: [...last 200] |
                    +-----------+--------------+
                                |
                    WebSocket   |   (push on every change)
                                |
                    +-----------v--------------+
                    |     Desktop Client       |
                    |                          |
                    |  localStorage:           |
                    |    sessionCache          |
                    |      (metadata only)     |
                    |                          |
                    |  zustand (in-memory):    |
                    |    conversations[]       |
                    |    messages per session   |
                    +--------------------------+
```

## Key Concepts

### syncVersion

A number that starts at 0 and goes up by 1 every time a session is created, updated, or deleted on the server. The client remembers the last syncVersion it saw. On reconnect, it tells the server "give me everything after version X."

### Deltas

Each change to the session index produces a delta:

```typescript
interface SyncDelta {
  action: 'I' | 'U' | 'D'   // Insert, Update, Delete
  syncVersion: number         // version number of this change
  sessionId: string
  session?: SessionMeta       // the session data (absent for Delete)
  timestamp: number
}
```

The server keeps the last 200 deltas in a ring buffer. If the client's version is within that range, it gets just the deltas it missed. If not, it gets the full session list.

### Session Cache

The client stores lightweight metadata in localStorage so the sidebar loads instantly before the WebSocket connects:

```typescript
// localStorage key: "anton.sessionCache"
interface SessionCache {
  syncVersion: number
  entries: SessionCacheMeta[]   // ~200 bytes per entry, no messages
}
```

## Lifecycle: What Happens When

### 1. App Opens

```
1. Run migration (first time only — converts old conv_xxx IDs to sessionId format)
2. Load conversations from localStorage cache
3. Restore activeConversationId from localStorage (if the conversation still exists)
4. Render sidebar immediately from cache (no skeletons if cache exists)
5. Connect WebSocket
```

### 2. WebSocket Connects

```
Client sends:  { type: 'sessions_sync', lastSyncVersion: 47 }

Server checks:
  Can I serve deltas since version 47?
    YES → { type: 'sessions_sync_response', full: false, deltas: [...] }
    NO  → { type: 'sessions_sync_response', full: true, sessions: [...] }
```

**When does the server say NO?**
- Client's version is 0 (first boot, no cache)
- Client's version is too old (fell off the 200-entry ring buffer)
- Server restarted and syncVersion reset to 0

### 2b. Init-Ready Conversation Restoration

When `initPhase` transitions to `ready`, the app restores the user's active conversation:

```
1. If in Home view (computer mode) → skip (no auto-navigation)
2. If activeConversationId was restored from localStorage:
   → switchConversation(restoredId) — restores sessionStore, provider, model
3. Otherwise (no saved active conversation):
   → find an empty chat conversation, or the most recent one
   → switchConversation(found.id)
4. Fetch history for the active conversation
```

**Why this order matters:** All persisted conversations have `messages: []` (messages are fetched from server on demand). If the init handler searched for "empty" conversations first, every restored conversation would match, and the app would jump to the wrong one. By checking `activeConversationId` first, we preserve the user's last position.

**Home→Chat transition:** When the user switches from Home view to Chat, `setActiveView('chat')` checks if `sessionStore.currentSessionId` is null. If so, it calls `switchConversation()` to initialize the session state that was skipped during the Home view early-return. This prevents stale provider/model state and broken `useActiveSessionState` consumers.

### 3. Client Applies a Full Bootstrap

When the server sends the complete session list:

```
For each conversation the client has:
  If server has it  → update title, timestamps, provider, model
  If server doesn't → remove it (unless it has pendingCreation flag)

For each server session the client doesn't have:
  If it's a sess_* session with messages → add it

Save updated list to cache and zustand.
```

### 4. Client Applies Deltas

When the server sends just the changes (or pushes a real-time event):

```
For each delta:
  'I' (Insert) → add conversation if it's sess_* with messages
  'U' (Update) → update metadata (title, timestamps, model)
  'D' (Delete) → remove conversation

Update syncVersion in cache.
```

### 5. While Connected

The server pushes `session_sync` events whenever anything changes:
- A session is created, deleted, or archived
- A title is updated by the LLM
- A turn completes (message count changes)

The client applies each push as a single delta — same logic as step 4.

### 6. Reconnection

- In-memory messages for the active conversation are preserved
- Client sends its cached `syncVersion` again
- Quick reconnect (server didn't restart) → gets just the gap as deltas
- Server restarted → gets a full bootstrap

### 7. Messages

Messages are **never cached in localStorage**. They're fetched from the server on demand:

```
User clicks a conversation
  → client sends session_history request
  → server responds with messages from disk
  → client stores them in zustand (in-memory only)
```

When `saveConversations()` is called, it always strips messages:

```typescript
// Only metadata is persisted — messages: [] always in storage
const metadataOnly = conversations.map(({ messages, contextInfo, ...rest }) => ({
  ...rest,
  messages: [],
}))
```

## Protocol Messages

Three new message types on the AI channel:

| Direction | Type | Purpose |
|-----------|------|---------|
| Client -> Server | `sessions_sync` | Request sync with `lastSyncVersion` |
| Server -> Client | `sessions_sync_response` | Full session list OR deltas only |
| Server -> Client | `session_sync` | Real-time push when a session changes |

The legacy `sessions_list` / `sessions_list_response` messages have been removed. The sync protocol is the sole mechanism for session list management.

## Conversation Identity

Every conversation has a single ID: its `sessionId`. The old system generated a separate `conv_xxx` client-side ID — that's gone now.

```typescript
// Before (broken):
{ id: "conv_1712345_abc123", sessionId: "sess_abc123" }

// After (simple):
{ id: "sess_abc123", sessionId: "sess_abc123" }
```

`createConversation()` sets `id = sessionId`. All lookups, React keys, and `activeConversationId` use this single identity.

### Optimistic Creation

When the user creates a new conversation, we can't wait for the server to confirm. So:

1. `createConversation()` sets `pendingCreation: true`
2. The conversation appears in the sidebar immediately
3. When `session_created` comes back from the server, `pendingCreation` is cleared
4. If a full bootstrap arrives before the server confirms, conversations with `pendingCreation: true` are kept (not deleted)

## Session Type Filtering

Only `sess_*` sessions appear in the chat sidebar. Other prefixes have their own UIs:

| Prefix | Where it shows |
|--------|---------------|
| `sess_*` | Chat sidebar |
| `proj_*` | Project view |
| `agent-run--*` | Inside parent conversation |
| `agent--*` | Project agents list |
| `slack:*` | Connectors |
| `telegram-*` | Connectors |

## Server Implementation

### index.json

```json
{
  "version": 1,
  "syncVersion": 47,
  "sessions": [ ... ],
  "deltas": [ ... ]
}
```

`syncVersion` increments on every `updateIndex()` or `removeFromIndex()` call. The delta is recorded and all connected WebSocket clients are notified via `onSyncChange()`.

### Ring Buffer

```typescript
const DELTA_BUFFER_SIZE = 200

// On every mutation:
index.syncVersion++
index.deltas.push(delta)
if (index.deltas.length > DELTA_BUFFER_SIZE) {
  index.deltas = index.deltas.slice(-DELTA_BUFFER_SIZE)
}
```

### getDeltasSince(sinceVersion)

```
If sinceVersion >= current    → return [] (already in sync)
If sinceVersion === 0         → return null (force full bootstrap)
If oldest delta > sinceVersion + 1 → return null (gap, need full bootstrap)
Otherwise                     → return deltas newer than sinceVersion
```

## Migration

On first load, `migrateFromLegacyConversations()` runs:

1. Checks if `anton.sessionCache` already exists (skip if so — idempotent)
2. Reads old `anton.conversations` from localStorage
3. For each conversation:
   - Extracts metadata into a `SessionCacheMeta` entry
   - Rewrites `id` from `conv_xxx` to `sessionId`
   - Strips messages
4. Saves new `anton.sessionCache` with `syncVersion: 0` (forces full bootstrap)
5. Rewrites `anton.conversations` with migrated data
6. Updates `anton.activeConversationId` if it was a `conv_xxx` value

## What We Chose Not To Do

| Approach | Why we skipped it |
|----------|------------------|
| CRDTs / OT | Single user, server always wins. No concurrent edits. |
| IndexedDB | Metadata fits in localStorage (~200 bytes per session). |
| Offline editing | Server is local. If it's down, the app can't work anyway. |
| Partial bootstrap | Full bootstrap over local WebSocket is sub-millisecond. |
| ETags / hashes | syncVersion counter is simpler and sufficient. |

## File Map

Where to find the implementation:

| What | Where |
|------|-------|
| SyncDelta type, ring buffer, version counter | `packages/agent-config/src/config.ts` |
| Protocol message types | `packages/protocol/src/messages.ts` |
| Server sync handler + real-time push | `packages/agent-server/src/server.ts` |
| Client session cache module | `packages/desktop/src/lib/conversationCache.ts` |
| Client sync handlers (apply deltas, reconcile) | `packages/desktop/src/lib/store/handlers/sessionHandler.ts` |
| Cache updates on title/done events | `packages/desktop/src/lib/store/handlers/interactionHandler.ts` |
| session_not_found fix (no auto-delete) | `packages/desktop/src/lib/store/handlers/interactionHandler.ts` |
| localStorage preservation on connect | `packages/desktop/src/lib/connection.ts` |
| Sync request on connect | `packages/desktop/src/lib/store/connectionStore.ts` |
| Sidebar instant render from cache | `packages/desktop/src/components/Sidebar.tsx` |
| Migration from old format | `packages/desktop/src/lib/conversationCache.ts` |
| Conversation creation (id = sessionId) | `packages/desktop/src/lib/conversations.ts` |
| Store init (calls migration) | `packages/desktop/src/lib/store.ts` |
