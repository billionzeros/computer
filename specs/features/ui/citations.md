# Citations for Web Search Results

## Problem

When the agent uses web search to answer a question, it returns information but doesn't cite where it came from. Users have no way to verify claims or dig deeper. Perplexity solved this — numbered inline citations `[1]`, `[2]` linked to source cards at the bottom. We need the same.

## Current Flow

```
User asks question
  → Agent calls web_search tool
  → Brave API returns results (title, url, description)
  → Results formatted as plain markdown string
  → Agent reads results, writes answer
  → Answer has no citations
```

## Desired Flow

```
User asks question
  → Agent calls web_search tool
  → Brave API returns results with structured metadata
  → Results passed to agent WITH citation instructions
  → Agent writes answer with inline citations [1], [2], etc.
  → Frontend renders:
    - Inline [1] [2] as clickable pills/badges
    - Source cards at the bottom of the message (favicon + title + domain)
```

## Design

### 1. Structured Search Results (agent-core)

**File: `packages/agent-core/src/tools/web-search.ts`**

Return search results in a structured format that the agent can reference by number:

```
Sources:
[1] Title One (example.com) — https://example.com/article
[2] Title Two (other.com) — https://other.com/post

Search results for "query":

[1] **Title One**
    Description/snippet text here...

[2] **Title Two**
    Description/snippet text here...
```

Add citation instructions to the tool result:

```
IMPORTANT: When using information from these results, cite sources using [1], [2] etc.
Always include a "Sources:" section at the end of your response listing the sources you used.
```

### 2. Source Metadata in Messages (protocol)

**File: `packages/protocol/src/messages.ts`**

Add a `sources` field to assistant messages:

```typescript
export interface SearchSource {
  index: number;       // [1], [2], etc.
  title: string;
  url: string;
  domain: string;      // extracted from url
  favicon?: string;    // https://www.google.com/s2/favicons?domain=example.com
}
```

The server extracts sources from web_search tool results and attaches them to the subsequent assistant message as metadata. This way the frontend has structured data to render source cards without parsing markdown.

### 3. Server-Side Source Tracking (agent-server)

**File: `packages/agent-server/src/server.ts`**

When a `tool_result` event comes in for `web_search`:
- Parse the structured results to extract sources (index, title, url, domain)
- Store them temporarily
- When the next `assistant` message is emitted, attach the sources array

### 4. Frontend Citation Rendering (desktop)

**File: `packages/desktop/src/components/chat/MarkdownRenderer.tsx`**

Transform `[1]`, `[2]` etc. in assistant text into clickable citation pills:
- Small superscript-style numbered badges (like Perplexity)
- On click → open the source URL in a new tab
- On hover → show tooltip with title + domain

**New Component: `packages/desktop/src/components/chat/SourceCards.tsx`**

Render a horizontal scrollable row of source cards below the message:
- Each card: favicon + title + domain
- Clickable → opens URL
- Compact design, similar to Perplexity's source pills

**File: `packages/desktop/src/components/chat/MessageList.tsx`**

After an assistant message that has `sources`, render the `SourceCards` component.

## Implementation Order

1. **Update web search tool output** — structured format with numbered sources + citation instructions in the system prompt
2. **Add SearchSource type to protocol** — source metadata interface
3. **Server-side source extraction** — parse tool results, attach to assistant messages
4. **Citation pills in MarkdownRenderer** — transform `[n]` into clickable badges
5. **Source cards component** — horizontal source row below messages
6. **Wire it all together** — end-to-end flow

## UI Reference (Perplexity Style)

```
┌─────────────────────────────────────────────────┐
│ Reddit has been going through major changes      │
│ in 2025. The platform was fined $20M by the     │
│ UK's ICO [1] and is fighting AI scrapers [2].   │
│ CEO Steve Huffman confirmed paid subreddits [3]. │
│                                                  │
│ ┌──────┐ ┌──────────┐ ┌─────────┐              │
│ │🌐 1  │ │🌐 2      │ │🌐 3     │              │
│ │The   │ │Perplexity│ │Reddit   │              │
│ │Verge │ │lawsuit   │ │CEO...   │              │
│ │verge.│ │reuters.. │ │reddit.. │              │
│ └──────┘ └──────────┘ └─────────┘              │
└─────────────────────────────────────────────────┘
```

## Non-Goals (for now)

- Page content fetching/reading (just search result snippets)
- Citation for non-web-search tools (browser, file reads, etc.)
- Persisting sources across conversation turns
