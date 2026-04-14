# Background Memory Extraction

## Problem

Anton's system prompt told the agent to "use memory proactively" with 4 vague bullet points, but the agent almost never saved memories. Claude Code solves this with a background extraction agent that runs at end-of-turn. We needed the same, but token-efficient — cannot afford to fork the entire conversation or run a multi-turn agentic loop.

## What Was Built

### Two-layer approach

**Layer 1: Enhanced system prompt** (`system.md`)
Replaced 4 vague bullet points with detailed taxonomy — 4 memory types with definitions, when-to-save triggers, when-NOT-to-save exclusions, and structured content format (`**Why:**` / `**How to apply:**`). This improves the main agent's own memory-saving behavior.

**Layer 2: Background extraction** (`memory-extraction.ts`)
After each turn completes, a lightweight background process analyzes recent messages and extracts durable memories the main agent missed.

### Single API call, not an agentic loop

Claude Code forks the entire conversation and runs a multi-turn agent with file read/write tools. That's expensive and complex. Anton uses a single `completeSimple` call that returns structured JSON. The code writes memory files directly — no tool calls, no multi-turn loop.

### Model selection: dynamic per provider

Picks the cheapest non-reasoning model for the user's active provider. Falls back to the conversation model if nothing resolves.

| Provider | Primary | Fallbacks |
|----------|---------|-----------|
| anton (GRU) | `gemini-3.1-flash-lite` | `glm-5-turbo`, `gemini-2.5-flash` |
| anthropic | `claude-haiku-3-5-20241022` | `claude-3-5-haiku-20241022` |
| openai | `gpt-4.1-mini` | `gpt-4o-mini` |
| google | `gemini-2.0-flash-lite` | `gemini-1.5-flash` |
| openrouter | `anthropic/claude-3-5-haiku-20241022` | `google/gemini-2.0-flash-lite-001` |
| any other | — | Main conversation model |

### Throttling

- Runs every **4 user messages** (not every turn)
- Skips if serialized content < **200 chars** (trivial exchanges)
- Skips **ephemeral/sub-agent** sessions
- Skips if main agent already **saved** a memory this turn (mutual exclusion — `recall`/`list`/`forget` don't suppress)
- Skips if an extraction is already **in progress** (overlap guard)
- **30s timeout** on the API call prevents permanent `inProgress` lockout

### Token budget per extraction

| Component | Tokens |
|-----------|--------|
| System prompt | ~280 |
| Serialized messages (capped at 4000 chars) | ~1,200 |
| Existing memory keys (dedup list) | ~100 |
| **Total input** | **~1,580** |
| Output (JSON, max 400 tokens) | ~200 |

Cost per extraction (gemini-3.1-flash-lite): ~$0.0003
20-turn conversation (~5 extractions): ~$0.0015 overhead. Negligible.

### Memory scope

- If `projectId` is set and the project directory exists on disk → `~/.anton/projects/{projectId}/memory/`
- Otherwise → `~/.anton/memory/` (global)
- Will NOT create memory directories for deleted/non-existent projects

### Memory file format

Frontmatter with YAML-safe values:

```markdown
---
name: user-prefers-playwright
description: User prefers Playwright over Puppeteer for browser automation
type: feedback
extracted: 2026-04-09T12:00:00.000Z
---

User prefers Playwright over Puppeteer for browser automation.
**Why:** Better async handling and built-in wait mechanisms.
**How to apply:** Default to Playwright for any new scraping task.
```

### Extraction LLM output format

```json
{"memories":[{"key":"slug-name","type":"feedback","content":"..."}]}
```

Max 3 memories per extraction. Empty array if nothing worth saving.

## Architecture

```
processMessage() yields done event
        │
        ▼
server.ts: after for-await loop completes
        │
        ▼
session.maybeExtractMemories()  ←── fire-and-forget (.catch only)
        │
        ├── skip if ephemeral
        ├── trackUserMessage (increment counter)
        ├── if agentUsedMemoryTool → advance cursor, return
        ├── shouldExtract? (counter >= 4, not inProgress, not agentSaved)
        ├── clamp sinceIndex (compaction may have shrunk messages array)
        │
        ▼
memory-extraction.ts: extractMemories()
        │
        ├── serialize recent messages (since cursor, capped at 4000 chars)
        ├── check min content length (200 chars)
        ├── resolve cheapest model for provider
        ├── list existing memory keys from disk (for dedup)
        ├── call completeSimple with 30s timeout
        ├── strip markdown fences, <think> tags
        ├── parse JSON, validate types
        ├── dedup against existing keys + intra-batch keys
        ├── sanitize YAML frontmatter
        ├── write memory files to disk
        └── advance cursor
```

## Edge cases handled

| Edge case | Solution |
|-----------|----------|
| Compaction shrinks messages array → stale cursor | Clamp `sinceIndex` to `messages.length`, reset to 0 if out of bounds |
| Session resume → cursor at 0 re-scans history | `createResumedExtractionState(messageCount)` sets cursor to existing message count |
| Agent saves memory → background extracts same thing | Advance cursor when skipping due to agent save (mutual exclusion) |
| Agent uses `recall`/`list` → incorrectly suppresses | Only suppress on `operation === 'save'`, not other memory tool ops |
| Two extractions run concurrently | `inProgress` flag checked in `shouldExtract()`, released in `finally` |
| API call hangs forever | `Promise.race` with 30s timeout |
| LLM returns two keys normalizing to same filename | `writtenKeysThisBatch` Set prevents intra-batch overwrites |
| `keyToFile("!!!")` → empty string → hidden `.md` file | Strip leading/trailing dashes, fallback to `'unnamed-memory'` |
| Deleted project → extraction creates ghost directory | Check `existsSync(projectDir)` before writing, return null if missing |
| LLM injects newlines in key → YAML frontmatter corruption | `sanitizeForYaml()` collapses to single line, quotes special characters |
| LLM wraps JSON in markdown fences or `<think>` tags | Strip both before parsing |

## Files changed

| File | Change |
|------|--------|
| `packages/agent-core/src/memory-extraction.ts` | **NEW** — extraction engine, prompt, serialization, model resolution, file writing |
| `packages/agent-core/src/session.ts` | `maybeExtractMemories()`, extraction state, memory-save detection, cursor clamping |
| `packages/agent-config/prompts/system.md` | Enhanced memory guidelines (4 types, triggers, exclusions, format) |
| `packages/agent-server/src/server.ts` | Fire-and-forget call after turn completes |

## What this does NOT do (deferred)

- **No MEMORY.md index file** — memories are standalone `.md` files with frontmatter, not indexed. Can add later.
- **No project-scoped memory tool** — the memory tool still saves to global/conversation scope. Background extraction writes to project scope. Phase 6 in the project-context spec will unify this.
- **No memory updating** — extraction only creates new files. It cannot edit or merge with existing memories. Would need an agentic loop for that.
- **No cross-conversation memory retrieval changes** — context.ts still loads memories the same way. The new frontmatter files are backward-compatible (the `#` heading fallback reads old format too).
