# Detached Turns — Survive Client Disconnect

> **Status:** proposal (Apr 2026). Not yet implemented.
> **Companion to:** [SESSION_LIFECYCLE.md](./SESSION_LIFECYCLE.md), [HARNESS_ARCHITECTURE.md](./HARNESS_ARCHITECTURE.md).
> **Scope:** makes user-driven chat turns survive tab close, closing the gap with sub-agents and agent jobs (which already do).

## Problem

Closing the desktop tab today calls `session.cancel()` on every active user turn that isn't blocked on `ask_user` ([`server.ts:787-814`](../../packages/agent-server/src/server.ts)). Sub-agents (`sub_*`), agent jobs (`agent-job-*`, `agent--*`), and pending-prompt turns already survive — the infra exists, it's just not exposed to ordinary conversations.

Consequence:

- Long-running refactors, research, or deep tool chains die mid-flight because the user switched tabs or the laptop slept.
- Deltas emitted between disconnect and turn-end vanish — they stream to a null client and never land anywhere.
- Users learn to not close the tab, which is the wrong affordance.

## Proposal

Every session declares a **disconnect mode**, controlled by the user. Two modes:

| Mode | Default | Behavior on `ws.on('close')` |
|---|---|---|
| `attached` | yes | Cancel the active turn (current behavior). |
| `detached` | opt-in | Keep the turn running; buffer events to the mirror; replay on reconnect. |

Naming alternatives considered: `foreground/background` (clashes with existing "background" for sub-agents), `live/persistent`, `watching/running`. `attached/detached` wins because it matches `tmux`, `screen`, and `docker run -d` — every user who's touched a shell already has the mental model.

### Where the mode lives

- **Source of truth:** a `disconnectMode: 'attached' | 'detached'` field on `SessionMeta` (persisted in `meta.json`) and on the in-memory session object.
- **Default:** `attached`. A fresh session never silently burns tokens.
- **UI control:** a toggle in the session header ("Keep running in background"). Flipping it mid-turn takes effect on the next disconnect.
- **Durability:** the mode persists across restarts so a user who detaches a long refactor, closes the app, and reopens it still finds the turn running.

### Lifecycle

```
┌────────────────────── attached (default) ──────────────────────┐
│ ws.close → session.cancel() → emit 'error' → mirror gets the   │
│ partial turn → next reconnect reads history, sees cancelled.   │
└────────────────────────────────────────────────────────────────┘

┌────────────────────── detached ────────────────────────────────┐
│ ws.close → NO cancel. sendToClient no-ops (already the case).  │
│ Turn runs to natural completion or the detached budget.        │
│ Per-item mirror flushes capture deltas so the disk is current. │
│ On reconnect: client sends last-seen seq; server replays from  │
│ mirror + any in-memory tail buffer still held for the session. │
└────────────────────────────────────────────────────────────────┘
```

### Safeguards (required — not optional)

Detached mode without guards is a money and trust incident waiting to happen.

1. **Hard wall-clock budget.** Every detached turn gets a max duration (default 10 min, configurable). Turn auto-cancels on expiry with a visible `detached_timeout` event in the mirror.
2. **Hard tool-call budget.** Default 50 tool calls per detached turn. Prevents infinite `rg across /` loops that run for hours.
3. **Destructive-tool gate.** Tools that can take irreversible side effects (`shell`, `git push`, any connector write) prompt the user via `ask_user` — which keeps the turn alive (pending-prompt path) but does NOT silently execute. The user must reconnect to approve.
4. **Hard stop from the UI.** On reconnect the UI shows a "turn in progress" banner with a **Stop** button that calls `session.cancel()`. No way to get stuck.
5. **One detached turn per session.** A detached session can't start a second turn until the first completes or is stopped. Rules out "I detached three times and now three models are editing the same file."

### Reconnect protocol

Augments the existing session-history request:

```
client → server (on reconnect):
  {
    type: 'session_resume_request',
    sessionId,
    lastSeenSeq,           ← highest seq the client rendered
  }

server → client:
  a) If the session is idle:
       → ordinary 'session_history_response' (existing flow).
  b) If a detached turn is in progress:
       → 'session_resume_response' with:
           - mirrored events from lastSeenSeq+1 to now (from messages.jsonl)
           - in-memory tail of events emitted since last mirror flush
           - a 'turn_in_progress' marker so the UI shows the banner + stop button
       → Then live events stream normally as the turn continues.
```

No new transport — just new message types on the existing AI channel.

### Mirror guarantee for detached mode

The current mirror only writes at `onTurnEnd` ([`server.ts:2150-2159`](../../packages/agent-server/src/server.ts)). Detached mode needs **per-item flushes** so reconnect sees a reasonably fresh transcript even if the turn is still running.

Proposed write points:

- At every `item/completed` from codex (agent message, tool call end, reasoning complete).
- At every `tool_result` batch boundary.
- Never mid-item — the messages.jsonl stays as whole Pi-SDK-shaped messages.

The flush uses `appendFileSync` on messages.jsonl; it's fast and sequential. Per-item writes add maybe 5–10 syscalls to a turn that already makes dozens; not a perf concern.

### Eviction interaction

`SessionRegistry.pin(sessionId)` today pins for the `activeTurns` duration. For detached mode, **a detached turn keeps the pin even if the client is gone**. The existing `unpin` in the `finally` block of `processMessage` runs when the turn ends, so this is already the desired behavior — we just need to not early-return from `ws.on('close')` in a way that orphans the pin.

### Cost controls

- Log every detached turn's start/end with wall-clock duration, tool calls, and token usage so the user can audit cost.
- Surface detached-turn cost in the session header on reconnect: "Ran for 4m32s, 127K tokens, $0.42."
- Daily hard cap per user (configurable, default $5): further detached starts blocked until next day.

## Non-goals

- Multi-client concurrent attach. Only one socket at a time (unchanged).
- Resumable turns after server restart. If `agent-server` dies, detached turns die with it. The restart story is orthogonal and much harder (needs subprocess rehydration, codex app-server re-attachment) — call it out as a follow-up.
- Attaching from a phone while desktop is disconnected. Feasible long-term; out of scope here.

## Implementation outline

| Step | File | Notes |
|---|---|---|
| 1. Add `disconnectMode` to `SessionMeta` | `packages/agent-config/src/session-meta.ts` | Default `'attached'`. |
| 2. UI toggle + RPC to set mode | desktop session header + `session_set_mode` AI message | Idempotent. |
| 3. Branch `ws.on('close')` on mode | `packages/agent-server/src/server.ts:776-824` | Detached sessions skip cancel; keep pin. |
| 4. Enforce detached budgets | new `DetachedTurnGuard` on the session | Wall-clock timer + tool-call counter; cancel on breach. |
| 5. Per-item mirror flush | `CodexHarnessSession` + `HarnessSession` | Call synth+append at item-completed boundaries. |
| 6. Reconnect protocol | `server.ts` + both client stores | New `session_resume_request/response` pair. |
| 7. Ask-user gate for destructive tools | tool registry metadata | `needsApproval: true` on shell/write tools when `mode === 'detached'`. |
| 8. Daily cost cap | per-user counter | Surface on block. |

Suggested PR sequence: 1+3 (minimum viable detach), then 5 (mid-turn mirror), then 6 (reconnect), then 4+7+8 (safety). Ships incrementally.

---

## Retrospective on the delta-coalescing fix

The [per-token rendering bug](../../packages/agent-core/src/harness/mirror.ts) was fixed by coalescing consecutive `text`/`thinking` events in `synthesizeHarnessTurn`, with a read-side safety net in `readHarnessHistory`. It works and all tests pass, but it's the symptomatic fix — worth naming the deeper issue so it's in the record.

### What's good about it

- **Zero behavior change for live streaming.** Deltas still fan out to the UI in real time.
- **Heals legacy messages.jsonl** files that were already written with 200 per-token blocks.
- **Small surface.** Two functions, one module, additive tests.

### What's structurally weak

1. **Conflates two concerns.** The mirror is the persistence layer AND the implicit deltas-to-canonical-text converter. These are different jobs. Every new streaming adapter we add (say Anthropic's beta, or a new codex item type) now has to rely on coalescing to stay correct. If someone adds a third event type that also streams deltas, they'll hit the same bug unless they remember to make the pattern identical.

2. **The final text already exists — we're ignoring it.** Codex emits `item/completed` with the fully-accumulated `agentMessage` payload. We drop it in `CodexHarnessSession.onItemCompleted` and reconstruct the text by summing deltas. That's backward. The canonical text should come from the completed item; deltas should be for live UI only.

3. **Read-side coalescing has an implicit boundary rule.** `!last.isThinking && !last.toolName` is how we know "don't merge across tool calls." It happens to work because our synthesizer always emits tool_use blocks inline, but it's not enforced — it's pattern-matched. A future synthesizer change could silently break the boundary and glue unrelated turns together.

4. **Unaddressed cousin: `reasoning` / `thinking` deltas.** I coalesced them too, same way. But codex also emits `item/reasoning/textDelta` and `item/reasoning/summaryTextDelta` as separate channels ([`codex-harness-session.ts:745-746`](../../packages/agent-core/src/harness/codex-harness-session.ts)). Both map to the same `thinking` SessionEvent. If a future codex version emits them interleaved with real tokens, the coalesce would merge semantically-different streams.

5. **No relation to the detached-turns path.** When we add mid-turn mirror flushes (Step 5 above), the coalescing has to hold across **multiple flushes** of the same item. Today a second flush of the same message would write a second assistant message, and the read-side would merge them — which is the right answer for text but masks a real problem: we'd have duplicate blocks in the file. Cleanup would need to be message-id-aware, which means item-id tracking, which is the better fix.

### The better fix

Track open items by `itemId` in the harness session. Accumulate deltas into in-memory buffers. Emit one `SessionEvent` per item at `item/completed`, carrying the full text. Deltas still stream to the UI through a separate lightweight `text_delta` event the mirror ignores.

```
before:                             after:
  delta → emit text event           delta → buffer[itemId] += text
                                         → emit text_delta to UI
  delta → emit text event           delta → buffer[itemId] += text
                                         → emit text_delta to UI
  ...                               item/completed → emit ONE text event
  onTurnEnd → synth (coalesces)                      with full buffer[itemId]
                                    onTurnEnd → synth (no coalesce needed)
                                    OR per-item → synth+append
```

Changes required:

| File | Change |
|---|---|
| `session.ts` (SessionEvent type) | Add `text_delta` variant: `{type:'text_delta', itemId, delta}`. |
| `CodexHarnessSession` | New `openItemTextBuffers: Map<string,string>` keyed by `blockId`. `onAgentMessageDelta` appends + emits `text_delta`. `onItemCompleted('agentMessage')` emits `text` with full buffer + clears entry. |
| `mirror.ts` synthesizer | Drop the coalescing branch; add `case 'text_delta': break;`. Assert one-block-per-item in tests. |
| `mirror.ts` readHarnessHistory | Drop the read-side coalescing safety net (once legacy files are healed). |
| Desktop/mobile sessionHandlers | Accumulate `text_delta` into a transient display buffer; finalize on `text`. |
| Claude Code path | `ClaudeAdapter.parseAssistantEvent` — same split: each Claude assistant event's partial text blocks emit `text_delta`; the final event (with `stop_reason`) emits `text`. |

Benefits beyond fixing the original bug:

- Mirror writes are message-id-idempotent → per-item flushes for detached mode don't duplicate blocks. Second flush with the same itemId replaces the first, not appends.
- UI can render `text_delta` as "streaming" (gray, typing cursor) and flip to solid on `text` — natural affordance.
- New streaming adapters get the split for free; no "remember to coalesce" tax.
- SessionEvent log volume during a turn drops from N tokens to N deltas + 1 final (same order of magnitude, but the "for the mirror" path becomes O(items) instead of O(tokens)).

Cost: ~150 lines including tests, touches 4 packages, requires UI change. The current coalesce fix stays in place as a read-side safety net for 1–2 releases, then is removed.

### Recommendation

- **Ship the coalesce fix now** (done). It unblocks users whose sessions render as 200 bubbles today.
- **Gate the structural fix on detached-turns work.** Step 5 of the implementation plan above (per-item mirror flush) is the point where having clean item-keyed events pays off. Doing the structural fix as part of that PR is cheaper than doing it standalone now.
- If detached turns slips by > 2 weeks, do the structural fix anyway — the architectural debt compounds with every new streaming event type.
