# Server-Side Text Buffer + `text_final` Reconciliation

## Problem
First 1-2 text chunks from the AI stream sometimes get dropped on the frontend due to a race condition where `activeConversationId` is null when early chunks arrive. This causes malformed markdown rendering (e.g., `computer](https://...` instead of `1. **[computer](https://...`).

Secondary benefit: reducing WS frame rate by coalescing many small text deltas into fewer, larger updates.

## Architecture

### Server Side: `TextStreamBuffer` (new class)

A per-session buffer in `server.ts` that accumulates text chunks and flushes on an interval.

```
AI generates tokens → buffer.push(text) → timer flushes every 80ms → sendToClient('text', coalesced)
                                         → on turn end: flush remaining + send 'text_final'
```

**Key design:**
- One buffer instance per active turn (keyed by sessionId)
- `push(text)`: appends to internal string buffer, starts flush timer if not running
- `flush()`: if buffer is non-empty, sends coalesced text chunk to client, resets buffer
- `finalize()`: flushes remaining buffer, then sends `text_final` with full `accumulatedText`
- `destroy()`: clears timer, prevents further flushes
- Flush interval: **80ms** (imperceptible latency, ~12 updates/sec max vs current 30-50+)
- Non-text events (tool_call, thinking, artifact, etc.) pass through immediately as before — only `text` events are buffered

### Protocol: New `text_final` message type

Add to `@anton/protocol` messages:
```typescript
{ type: 'text_final', content: string, sessionId?: string }
```

This is the **authoritative** complete text for the turn. Client uses it to reconcile.

### Client Side: Handle `text_final`

In `store.ts` `handleWsMessage`:
- New case `'text_final'`: replaces the current assistant message's content with the full authoritative text
- This means even if early chunks were dropped, the final message is always correct
- Keeps all existing `text` streaming logic as-is (for live typing feel)

## Files Changed

### 1. `packages/agent-server/src/server.ts`
- Add `TextStreamBuffer` class (~40 lines)
- In `handleChatMessage`: create buffer at turn start, use `buffer.push()` instead of direct `sendToClient` for text events, call `buffer.finalize()` after the for-await loop, `buffer.destroy()` in finally block
- Pass `sendToClient` as a callback to the buffer (keeps it decoupled)

### 2. `packages/protocol/src/messages.ts`
- Add `AiTextFinalMessage` type: `{ type: 'text_final', content: string, sessionId?: string }`
- Add to the `AiMessage` union type

### 3. `packages/desktop/src/lib/ws-messages.ts`
- Add `WsTextFinal` interface

### 4. `packages/desktop/src/lib/store.ts`
- Add `'text_final'` case in `handleWsMessage` switch
- Replaces current assistant message content with the authoritative full text
- Routes via session-aware helpers (same pattern as existing `text` case)

### 5. `packages/cli/src/lib/connection.ts` (if CLI handles text rendering)
- Handle `text_final` similarly — replace accumulated text with final version

## What does NOT change
- All non-text events (tool_call, tool_result, thinking, artifact, tasks_update, done, error) still pass through immediately
- The `done` event flow is unchanged
- The `text_replace` mechanism stays as-is
- The sync-first gate logic stays as-is
- WebSocket protocol stays (no SSE switch)
- No changes to `agent-core` or session.ts

## Edge Cases
- **Turn cancelled mid-stream**: `destroy()` in the finally block clears the timer; no `text_final` sent (correct — cancelled turns don't need reconciliation)
- **Error mid-stream**: error path already sends `done`; buffer.finalize() in catch block ensures partial text is reconciled
- **Multiple concurrent sessions**: each gets its own buffer instance (Map<sessionId, TextStreamBuffer>)
- **Empty response**: buffer never has content, `text_final` sends empty string or is skipped
- **`text_replace` after `text_final`**: won't happen — `text_final` is sent after all events are processed
