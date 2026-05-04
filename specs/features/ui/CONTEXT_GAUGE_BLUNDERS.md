# Context Gauge — Known Blunders & Fix Queue

Tracking doc for issues caught during self-review of the initial
`feat/composer-context-gauge` implementation. Delete once every entry
is **Fixed** and verified.

Numbering matches the order they were surfaced.

## Critical

### 1. Calibration is biased low

**Where**: `packages/agent-core/src/session.ts` — `turn_end` handler.

`updateContextEstimateScale(input)` runs after pi-ai has already
appended the assistant's response message to `piAgent.state.messages`.
So `breakdown.messages` (post-turn) is larger than the actual input
that produced `inputTokens` (pre-turn). `actual / rawEstimate < 1` →
scale settles around 0.85–0.95 → gauge under-reports by 5–15% on
every turn forever.

**Fix**: snapshot the raw estimate at `turn_start` and use that for
calibration at `turn_end`, OR exclude the most recently appended
assistant message from the estimate during calibration.

Status: fixed

---

### 2. Fork children show zero breakdown

**Where**: `packages/agent-core/src/session.ts:2480-2482`.

`getSystemPrompt()` returns early when `systemPromptOverride` is set
(sub-agents, fork children) and never populates `_lastLayerSizes`.
The breakdown for those sessions reports `systemPrompt: 0` even when
the override prompt is huge. Tools and messages still report real
numbers, so the gauge looks plausible but the popover lies.

**Fix**: when `systemPromptOverride` is active, populate
`_lastLayerSizes.identity` with `override.length` (everything else
stays 0) so the breakdown reports the override under "System prompt".

Status: fixed

---

### 3. Stale gauge after model switch

**Where**: `packages/agent-core/src/session.ts:1421-1433`
(`switchModel`).

Updates `resolvedModel` and pi-ai's model but does not re-emit
`context_update`. Switching opus (1M) → sonnet (200k) leaves the
popover showing old proportions until the next turn finishes.

**Fix**: queue a `context_update` event from `switchModel` (push onto
the next yielded event batch) using the new `resolvedModel.contextWindow`.
Same emit path used by `setSurface`, `refreshConnectorTools`,
`loadConversationContext`.

Status: fixed

---

### 4. Codex harness `messages` over-reports

**Where**: `packages/agent-core/src/harness/codex-harness-session.ts`
in `onTokenUsageUpdated`.

`total.inputTokens` from codex is *cumulative billed input* across
all turns (counts cached tokens too). On long conversations it
exceeds actual prompt size and can show >100% on the gauge.

**Fix**: prefer `last.inputTokens` (per-turn input) over
`total.inputTokens` for the breakdown's `messages` field; fall back
to `total` only when `last` is absent. Cap the gauge at 100% as a
defensive measure.

Status: fixed

---

### 5. Harness `session_created` has no initial breakdown

**Where**: `packages/agent-server/src/server.ts:2219-2229`.

The initial `context_update` emit only runs on the Pi-SDK
`session_created` branch. Harness sessions show no gauge until the
first turn completes.

**Fix**: emit a synthetic harness breakdown right after the harness
`session_created` send, with `contextWindow` looked up from the
resolved model and all category counters at 0.

Status: fixed

---

### 7. Auto-fix collateral leaked into the diff

**Where**: working tree.

`pnpm check:fix` reformatted unrelated pre-existing files:
`agent-config/package.json`, `tauri.conf.json`, `ProviderSettingsModal.tsx`,
parts of `agent-server/server.ts`, parts of `index.css`. None of these
relate to the gauge.

**Fix**: `git checkout` those files (preserving only the gauge-related
diffs) so the PR stays scoped.

Status: fixed

---

## Medium

### 6. Clicking the gauge while open doesn't close it

**Where**: `packages/desktop/src/components/chat/ContextPopover.tsx`
+ `ContextGauge.tsx`.

Outside-click handler runs on mousedown against `popoverRef`. The
gauge button is outside `popoverRef`, so mousedown closes the popover;
the subsequent click on the gauge fires `setOpen(v => !v)` and reopens
it. The popover can only be closed by clicking elsewhere.

**Fix**: ignore outside-click when the target is the gauge button
(pass `triggerRef` into the popover and check `triggerRef.current.contains(target)`
before calling `onClose`).

Status: fixed

---

### 8. Unnecessary `as never[]` type cast

**Where**: `packages/agent-core/src/session.ts:2664`.

`estimateTokens(this.piAgent.state.messages as never[])` — the cast
silences type checking. `piAgent.state.messages` is already
`AgentMessage[]`, which is what `estimateTokens` accepts.

**Fix**: drop the cast.

Status: fixed

---

## Minor

### 9. Lost entry point to side panel context view

**Where**: removed `ContextIndicator.tsx` (clicked → `openContextPanel()`).

The new gauge opens the popover instead of the side panel. No 1-click
path from composer to the memory list anymore.

**Fix**: add a "View memory details" affordance to the popover footer
that calls `openContextPanel()` and closes the popover.

Status: fixed

---

### 10. `_contextEstimateScale` not persisted

**Where**: `Session.persist()` / `loadSession()`.

Scale resets to 1.0 on every session resume; calibration starts over.

**Fix**: persist scale alongside `compactionState` in
`PersistedSession` and rehydrate in the constructor.

Status: fixed

---

### 11. Magic `anchorRect.left - 80` offset

**Where**: `ContextPopover.tsx`.

Random nudge to "center" the popover near the gauge. Not derived from
the popover width.

**Fix**: align by anchor center: `left = anchorRect.left + anchorRect.width / 2 - ESTIMATED_POPOVER_WIDTH / 2`,
clamped to viewport.

Status: fixed

---

### 12. `setSurface` / `refreshConnectorTools` / `loadConversationContext` don't re-emit

**Where**: same file, three methods.

Each rebuilds the prompt and updates `_lastLayerSizes`, but no
`context_update` event is queued. Popover stays stale until next turn.

**Fix**: same approach as #3 — push a `context_update` onto the next
yielded event batch from each setter.

Status: fixed
