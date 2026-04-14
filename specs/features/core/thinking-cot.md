# Thinking / Chain-of-Thought (COT) Spec

## Overview

Anton supports model thinking/reasoning as a first-class feature. When a model supports COT (chain-of-thought), its reasoning process is streamed to the user in real-time with a collapsible UI, then collapsed once the response begins.

---

## Backend (agent-core)

### Model Configuration

**File:** `packages/agent-core/src/anton-models.ts`

Each model in the catalog has a `reasoning: boolean` flag:
- `true` — model supports thinking (Claude Opus/Sonnet 4+, Gemini 2.5 Pro/Flash, o3, o4-mini, DeepSeek R1, Grok 3 Mini)
- `false` — model does not support thinking (GPT-4.1, Haiku 4.5, older models)

### Session Initialization

**File:** `packages/agent-core/src/session.ts`

When a session is created, `thinkingLevel` is set based on the model:
```
thinkingLevel = model.reasoning ? (opts.thinkingLevel ?? 'medium') : 'off'
```

Valid levels: `'off' | 'minimal' | 'low' | 'medium' | 'high'`

The level is configurable per-session via the `thinkingLevel` option in the Session constructor. Non-reasoning models always get `'off'` regardless of config.

### Event Translation

**File:** `packages/agent-core/src/session.ts` — `translateEvent()`

The pi-agent SDK emits `message_update` events containing `ThinkingContent` blocks alongside `TextContent` blocks in assistant messages.

`translateEvent()` extracts both:
1. Filters `msg.content` for `type === 'thinking'` blocks
2. Tracks `lastEmittedThinkingLength` for delta streaming (same pattern as text)
3. Emits `{ type: 'thinking', text: delta }` SessionEvent

Thinking deltas are emitted BEFORE text deltas in the same event batch, matching the model's output order (think first, then respond).

### Protocol Message

**File:** `packages/protocol/src/messages.ts`

```typescript
interface AiThinkingMessage {
  type: 'thinking'
  text: string
  sessionId?: string
}
```

Part of the `AiMessage` union, sent over the AI websocket channel.

### Inline `<think>` Tag Handling

Some non-Anthropic models (DeepSeek, QwQ) embed `<think>...</think>` tags directly in their text output instead of using the dedicated thinking content block. These are stripped in the frontend's `MarkdownRenderer` as a safety net:

**File:** `packages/desktop/src/components/chat/MarkdownRenderer.tsx`

```typescript
function stripThinkTags(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  result = result.replace(/<think>[\s\S]*$/g, '')  // unclosed (still streaming)
  return result.trim()
}
```

---

## Frontend State

### Per-Session State

**File:** `packages/desktop/src/lib/store/sessionStore.ts`

Thinking state lives inside `SessionState` (per-session, zero globals):
- `status: 'working'` — set when thinking events arrive
- `agentSteps[]` — tracks tool calls/thinking sequence

### Message Tracking

**File:** `packages/desktop/src/lib/store.ts`

- `_sessionThinkingMsgIds: Map<sessionId, msgId>` — tracks the current thinking message per session for delta appending
- `appendThinkingText(content)` / `appendThinkingTextToSession(sessionId, content)` — appends thinking deltas to the correct message

### ChatMessage Shape

```typescript
interface ChatMessage {
  id: string
  role: 'assistant'
  content: string        // accumulated thinking text
  isThinking: true       // distinguishes from regular assistant messages
  timestamp: number
}
```

### Message Flow

1. `thinking` event arrives via websocket
2. `chatHandler.ts` calls `ctx.appendThinking(thinkContent)`
3. `appendThinking` routes to `appendThinkingText` (active session) or `appendThinkingTextToSession` (background session)
4. Store appends delta to existing thinking message or creates new one
5. When `text` event arrives, `_sessionThinkingMsgIds` is cleared for that session (thinking phase done)
6. On `done` event, both `_sessionAssistantMsgIds` and `_sessionThinkingMsgIds` are cleared

### Session Isolation

- Thinking message IDs are keyed by `sessionId` in `_sessionThinkingMsgIds` Map
- No global state — switching conversations doesn't leak thinking
- Each session independently tracks its thinking message

---

## Frontend UI

### ThinkingBlock Component

**File:** `packages/desktop/src/components/chat/ThinkingBlock.tsx`

Renders thinking content with two states:

**Streaming (actively thinking):**
- Brain icon + "Thinking..." label
- Content expanded and visible
- Text + icon have a CSS glow/pulse animation (`thinking-glow`, `thinking-pulse`)
- Click disabled (always open while streaming)

**Completed (thinking done):**
- Brain icon + "Thought process" label + expand chevron
- Collapsed by default
- Click to expand/collapse
- Dimmed text (`var(--text-subtle)`) to visually distinguish from response

### Integration in MessageBubble

**File:** `packages/desktop/src/components/chat/MessageBubble.tsx`

```tsx
{message.role === 'assistant' && message.isThinking && (
  <ThinkingBlock content={message.content} isStreaming={isLastThinking && isAgentWorking} />
)}
```

### Streaming Detection

**File:** `packages/desktop/src/components/chat/MessageList.tsx`

A thinking block is marked as "streaming" only when it's the very last item in the grouped message list — meaning nothing (no text response, tool calls, or user messages) has appeared after it:

```typescript
const hasAnythingAfter = grouped.slice(idx + 1).length > 0
const isLastThinking = item.message.isThinking && !hasAnythingAfter
```

This prevents completed thinking blocks from reopening when the agent starts a new turn.

### Message Grouping

**File:** `packages/desktop/src/components/chat/groupMessages.ts`

Thinking messages are excluded from step narration detection to prevent them from being incorrectly merged with tool action groups:

```typescript
function isStepNarration(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant' || msg.isThinking) return false
  // ...
}
```

### CSS

**File:** `packages/desktop/src/index.css`

```css
.thinking-block__icon { color: #e8a068; }
.thinking-block--streaming .thinking-block__icon { animation: thinking-pulse 1.5s ease-in-out infinite; }
.thinking-block--streaming .thinking-block__label { animation: thinking-glow 2s ease-in-out infinite; }
.thinking-block--streaming .thinking-block__text { animation: thinking-glow 2s ease-in-out infinite; }
.thinking-block__content { border-left: 2px solid var(--border); margin-left: 7px; }
.thinking-block__text { color: var(--text-subtle); font-size: 13px; }
```

---

## Key Files

| File | Role |
|------|------|
| `agent-core/src/anton-models.ts` | Model reasoning capability flags |
| `agent-core/src/session.ts` | ThinkingLevel config, translateEvent thinking extraction |
| `protocol/src/messages.ts` | AiThinkingMessage type definition |
| `desktop/src/lib/store/sessionStore.ts` | Per-session state (status, steps) |
| `desktop/src/lib/store.ts` | Thinking message tracking maps, append methods |
| `desktop/src/lib/store/handlers/chatHandler.ts` | Thinking event → appendThinking dispatch |
| `desktop/src/lib/store/handlers/shared.ts` | MessageContext with appendThinking |
| `desktop/src/components/chat/ThinkingBlock.tsx` | Collapsible thinking UI component |
| `desktop/src/components/chat/MessageBubble.tsx` | ThinkingBlock integration |
| `desktop/src/components/chat/MessageList.tsx` | Streaming detection logic |
| `desktop/src/components/chat/groupMessages.ts` | Thinking exclusion from step narration |
| `desktop/src/components/chat/MarkdownRenderer.tsx` | `<think>` tag stripping for inline models |
| `desktop/src/index.css` | Thinking block styles + glow animations |
