# Composer Context Gauge + Popover

A circular gauge in the chat composer toolbar shows context-window
utilisation at a glance. Clicking the gauge opens a popover with a
per-category breakdown of where the prompt budget is going (messages,
system prompt, tools, skills, memory, autocompact reserve, free space).

The feature replaces the previous `ContextIndicator` (memory-count
badge) — the memory count is still surfaced inside the side panel's
Context view.

## Categories

| Category | Source | Pi SDK | Harness |
|---|---|:-:|:-:|
| Messages | `estimateTokens(piAgent.state.messages)` | ✓ | ✓ (= `total inputTokens`) |
| System prompt | identity + workspace/user rules + current context + surface + agent context + connectors + project type + reference knowledge + workflows + project memory instructions | ✓ | ✗ |
| System tools | built-in `AgentTool` schemas (names in `BUILT_IN_TOOL_NAMES`) | ✓ | ✗ |
| MCP tools | tools from `mcpManager` + direct OAuth connector tools | ✓ | ✗ |
| Skills | `buildActiveSkillsLayer` output | ✓ | ✗ |
| Memory files | `buildMemoryLayer` output | ✓ | ✗ |
| Autocompact buffer | `contextWindow * (1 − threshold)` (default `0.20 × window`) | ✓ | ✗ |
| Free space | `contextWindow − Σ(used) − autocompactBuffer` (derived client-side) | ✓ | ✓ |

Categories matching Claude Code's UI but **omitted** in v1:

- **System tools (deferred)** / **MCP tools (deferred)** — Anton has no
  lazy-tool-loading mechanism today; every tool's schema is live in
  every prompt. We can re-add these rows when ToolSearch-style deferral
  ships.
- **Custom agents** — Anton's agents are reachable via `delegate_to_agent`
  rather than injected into the prompt, so the row would always read
  `0.0%`. Add when an agent flow injects content (e.g. agent identity
  prompts) into the prompt.

## Token estimation

Two-tier:

1. **Estimate (sync, cheap)** — char-count per layer / 4. Same heuristic
   `estimateMessageTokens` already uses for compaction. Computed inside
   `Session.getSystemPrompt` (caches sizes onto `_lastLayerSizes`) and
   `categorizeTools` (sums `name + description + JSON.stringify(parameters)`
   per tool, classified by `BUILT_IN_TOOL_NAMES`).
2. **Calibration (per-turn)** — after a turn finishes, compare the
   model's reported `input_tokens` against our pre-turn estimate. The
   ratio updates `_contextEstimateScale`, clamped to `[0.5, 2.0]`, and
   gets applied to subsequent breakdowns. Drifts toward reality across
   the first 1–2 turns without paying tokenizer cost.

Real tokenisers (`tiktoken`, `@anthropic-ai/tokenizer`) were
deliberately deferred — the calibration loop is "good enough" for a
gauge and avoids per-prompt CPU cost on every turn.

## Protocol

```ts
// packages/protocol/src/messages.ts
export interface ContextBreakdown {
  contextWindow: number
  systemPrompt: number
  systemTools: number
  mcpTools: number
  skills: number
  memoryFiles: number
  messages: number
  autocompactBuffer: number
  source: 'pi-sdk' | 'harness'
}

export interface AiContextUpdateMessage {
  type: 'context_update'
  sessionId?: string
  breakdown: ContextBreakdown
}
```

Server emits `context_update` at:

- `session_created` (initial breakdown so the popover never shows a
  loading state on Pi SDK sessions).
- After every `turn_end` event from the Pi SDK loop (`Session` already
  emits `token_update` at the same site).
- After every codex-harness `tokenUsageUpdated` notification (harness
  variant: `messages` + `contextWindow` only).

## Gauge color states

The autocompaction threshold (default `0.80`) drives the warning band:

- `< 70%` → `idle` — muted ring (`var(--text-3)`)
- `70–80%` → `warning` — `var(--warning)` amber
- `≥ 80%` → `critical` — `var(--accent)` (compaction will fire on the
  next turn)

## Files touched

| File | Change |
|---|---|
| `packages/protocol/src/messages.ts` | + `ContextBreakdown`, + `AiContextUpdateMessage`, union extension |
| `packages/agent-core/src/agent.ts` | + `BUILT_IN_TOOL_NAMES`, + `categorizeTools` |
| `packages/agent-core/src/prompt-layers.ts` | + `SessionPromptLayerSizes`, + `emptyPromptLayerSizes` |
| `packages/agent-core/src/session.ts` | layer-size capture in `getSystemPrompt`, + `getContextBreakdown`, + `updateContextEstimateScale`, emit `context_update` post-turn |
| `packages/agent-core/src/harness/codex-harness-session.ts` | emit harness-variant `context_update` from `onTokenUsageUpdated` |
| `packages/agent-server/src/server.ts` | emit initial `context_update` after `session_created` |
| `packages/desktop/src/lib/store/sessionStore.ts` | + `contextBreakdown` field on `SessionState` |
| `packages/desktop/src/lib/store/handlers/interactionHandler.ts` | handle `context_update` |
| `packages/desktop/src/components/chat/ContextGauge.tsx` | new |
| `packages/desktop/src/components/chat/ContextPopover.tsx` | new |
| `packages/desktop/src/components/chat/ChatInput.tsx` | slot gauge into `composer__toolbar-right` |
| `packages/desktop/src/components/chat/ContextIndicator.tsx` | **deleted** |
| `packages/desktop/src/components/RoutineChat.tsx` | drop `ContextIndicator` import + render |
| `packages/desktop/src/index.css` | + gauge + popover styles, − stale `.context-indicator` rules |
