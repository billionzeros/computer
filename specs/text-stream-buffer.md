# Server-Side Text Stream Buffer

## Problem

The AI streams text token-by-token. Each token becomes a separate WebSocket frame sent to the client. This causes two problems:

1. **Dropped chunks**: The frontend store drops early text chunks when `activeConversationId` is momentarily null during session init. This breaks markdown rendering (e.g., `computer](https://...` instead of `1. **[computer](https://...`).

2. **Frame flood**: 30-50+ WS frames/sec for text alone. Unnecessary pressure on the client for what's ultimately just string concatenation.

## Solution: Server-Side Text Buffer

Buffer text events on the server before sending over WebSocket. Coalesce many small token chunks into fewer, larger updates. Flush on a timer (~80ms) and **before any non-text event** to preserve ordering.

## How the Buffer Works

```
LLM token stream          Buffer (server memory)         WebSocket to client
─────────────────          ─────────────────────          ───────────────────

text("Here")         →    pending = "Here"                (nothing yet, timer starts)
text("'s what")      →    pending = "Here's what"         (still waiting...)
text(" I'll do:")    →    pending = "Here's what I'll do:" (still waiting...)
                          ⏰ 80ms timer fires      →      send text("Here's what I'll do:")
                          pending = ""

text("\\n1.")         →    pending = "\\n1."                (timer starts)
text(" Run")          →    pending = "\\n1. Run"            (waiting...)
tool_call(shell)      →    ⚡ FORCE FLUSH              →   send text("\\n1. Run")
                          pending = ""               →   send tool_call(shell)

text("Done!")         →    pending = "Done!"               (timer starts)
                          ⏰ 80ms timer fires      →      send text("Done!")
done                  →    flush (empty, no-op)       →   send done
```

Key behaviors:
- **Timer-based flush**: Every ~80ms, whatever has accumulated gets sent as one coalesced `text` message. ~12 updates/sec max vs current 30-50+.
- **Event-triggered flush**: Before ANY non-text event (tool_call, tool_result, thinking, artifact, text_replace, error, done, etc.), the buffer force-flushes. This guarantees text always arrives before the event that follows it — preserving the ordering the client depends on.
- **Turn-end flush**: After the for-await loop completes, flush any remaining text.

## `TextStreamBuffer` Class

```typescript
class TextStreamBuffer {
  private pending = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly INTERVAL_MS = 80

  constructor(
    private send: (text: string) => void, // callback to sendToClient
  ) {}

  /** Accumulate a text chunk. Starts the flush timer if not already running. */
  push(text: string): void {
    this.pending += text
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.INTERVAL_MS)
    }
  }

  /** Send whatever is buffered now. Safe to call anytime (no-ops if empty). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending) {
      this.send(this.pending)
      this.pending = ''
    }
  }

  /** Clear timer. Flush remaining text. Prevent further use. */
  destroy(): void {
    this.flush()
    this.send = () => {} // prevent accidental use after destroy
  }
}
```

## Integration in `handleChatMessage`

```typescript
// Before the for-await loop:
const textBuffer = new TextStreamBuffer((text) => {
  this.sendToClient(Channel.AI, { type: 'text', content: text, sessionId })
})

let writingStatusSent = false  // deduplicate agent_status

for await (const event of session.processMessage(msg.content, msg.attachments || [])) {
  if (event.type === 'text') {
    accumulatedText += event.content

    // Buffer the text chunk instead of sending immediately
    textBuffer.push(event.content)

    // Send "Writing response..." status only once, not per token
    if (!writingStatusSent) {
      this.sendToClient(Channel.EVENTS, {
        type: 'agent_status', status: 'working',
        detail: 'Writing response...', sessionId,
      })
      writingStatusSent = true
    }
    continue  // Skip the sendToClient at the bottom
  }

  // ── Non-text event: force flush buffer first to preserve ordering ──
  textBuffer.flush()
  writingStatusSent = false  // reset so next text block sends status again

  // ... existing tool_call / thinking / tasks_update status logic ...

  this.sendToClient(Channel.AI, { ...event, sessionId })
}

// After loop: flush any remaining buffered text
textBuffer.destroy()
```

Error path:
```typescript
catch (err) {
  textBuffer.flush()  // Don't lose buffered text on error
  this.sendToClient(Channel.AI, { type: 'error', message: errMsg, sessionId })
  this.sendToClient(Channel.AI, { type: 'done', sessionId })
} finally {
  textBuffer.destroy()
  this.activeTurns.delete(sessionId)
  // ... existing cleanup ...
}
```

## Files Changed

### 1. `packages/agent-server/src/server.ts`
- Add `TextStreamBuffer` class (top of file or separate util, ~30 lines)
- Modify `handleChatMessage` event loop:
  - Create buffer before loop
  - Buffer text events instead of sending directly
  - Force-flush before every non-text event
  - Deduplicate "Writing response..." status with a boolean flag
  - Flush in catch block
  - Destroy in finally block

### 2. Nothing else
- No protocol changes (still sends `type: 'text'` messages, just fewer of them)
- No frontend changes (client already handles `text` concatenation)
- No CLI changes (server-side only)

## What Does NOT Change
- Message format: still `{ type: 'text', content: string, sessionId?: string }`
- All non-text events: tool_call, tool_result, thinking, artifact, done, error — unchanged
- Client-side store logic: appendAssistantText, text_replace, sync-first gate — unchanged
- WebSocket protocol: no switch to SSE
- agent-core / session.ts: unchanged

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Turn cancelled mid-stream | `destroy()` in finally flushes remaining text, clears timer |
| Error mid-stream | `flush()` in catch sends buffered text before error message |
| tool_call right after text | Force-flush ensures text arrives before tool_call — client ordering preserved |
| text_replace while buffer has content | Force-flush before text_replace ensures the replace target is already in the client's message |
| Multiple concurrent sessions | Each `handleChatMessage` call creates its own `TextStreamBuffer` instance — no shared state |
| Empty response (no text events) | Buffer never called, nothing to flush, no-op |
| Very fast LLM (tokens faster than 80ms) | Tokens accumulate, single flush sends large chunk — this is the desired coalescing behavior |
| Very slow LLM (one token per 200ms) | Each token flushes on its own timer — behaves like current unbuffered approach, no regression |
| First text chunk timing | Buffer holds it for up to 80ms — client has time to finish initializing `activeConversationId` before text arrives |
