# Web Search & Smart Content Extraction

## Overview

Two capabilities that bring Anton closer to parity with Claude Code's web features:

1. **Web Search** — Semantic web search via Exa, proxied through a Cloudflare Worker
2. **Smart Content Extraction** — Browser tool upgraded with Readability + Turndown for clean markdown output instead of raw HTML

## Web Search (`web_search` tool)

### How it works

- The `web_search` tool is **always registered** in every session
- When the Exa search connector is configured, it performs real web searches via the CF worker proxy
- When not configured, it returns a helpful error guiding the user to Settings → Connectors
- This means Anton always *knows* it can search — it just might need the user to enable it first

### Architecture

```
Agent → CF Worker (anton-search-proxy) → Exa API (api.exa.ai)
```

The CF worker:
- Holds the `EXA_API_KEY` secret — the agent never sees the Exa key directly
- Authenticates requests via `PROXY_TOKEN` bearer auth
- Proxies to `POST https://api.exa.ai/search` with content extraction enabled
- Returns clean results with full page content as markdown

### Why Exa over SearXNG / Brave

- **Semantic search** — uses embeddings-based neural search, not just keyword matching
- **Full content extraction** — returns page content as clean markdown, not just snippets
- **Highlights & summaries** — LLM-identified relevant excerpts per result
- **Categories** — can focus on news, research papers, companies, people, etc.
- **Consistent results** — unlike SearXNG which aggregates unreliably from multiple engines
- **No self-hosting** — no Docker container to maintain

### Tool parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Search query |
| `numResults` | number | 10 | Number of results (max 30) |
| `category` | string | — | Focus: "news", "research paper", "company", "personal site", "financial report", "people" |
| `startPublishedDate` | string | — | ISO date filter (after) |
| `endPublishedDate` | string | — | ISO date filter (before) |

### Connector setup

Exa Search appears in the **Connectors** registry (Settings → Connectors → Apps tab):
- Type: `api`
- Required: `EXA_SEARCH_URL` (proxy URL) and `EXA_SEARCH_TOKEN` (proxy bearer token)
- When the user enters the URL and token and clicks Connect, it's stored in `~/.anton/config.yaml` under `connectors`
- The connector shows as "Connected — 1 tool available" in the UI

### Config format

```yaml
# ~/.anton/config.yaml
connectors:
  - id: exa-search
    name: Web Search (Exa)
    type: api
    baseUrl: "https://anton-search-proxy.your-worker.workers.dev"
    apiKey: "your-proxy-token"
    enabled: true
```

### CF Worker deployment

The search proxy worker lives in the `anton` repo at `search-proxy/`:

```bash
cd search-proxy
npm install
wrangler secret put EXA_API_KEY      # your Exa API key
wrangler secret put PROXY_TOKEN      # token the agent uses to authenticate
wrangler deploy
```

## Smart Content Extraction (upgraded `browser` tool)

### Before

The browser tool used raw `curl` output — the model received full HTML including nav bars, footers, scripts, and styling. Unusable for most pages.

### After

The browser tool now uses a three-stage pipeline:

1. **Fetch**: `curl` downloads the HTML (unchanged)
2. **Parse**: `linkedom` creates a DOM from the HTML string (no browser needed)
3. **Extract**: `@mozilla/readability` extracts the article content, stripping navigation, ads, footers
4. **Convert**: `turndown` converts the clean HTML to markdown

### Why these libraries

- **linkedom** — Lightweight DOM implementation in pure JS. Unlike jsdom, it's fast and doesn't pull in a full browser engine. Readability needs a `document` object to work with, and linkedom provides exactly that.
- **@mozilla/readability** — The same algorithm Firefox Reader View uses. Scores DOM nodes to find the "article" content and strips everything else. Handles blogs, news sites, docs, etc.
- **turndown** — HTML→markdown converter. Configured with ATX headings, fenced code blocks, and removal of script/style/nav/footer/header/noscript/iframe tags.

### Fallback chain

1. Readability extracts article → Turndown converts to markdown *(best case)*
2. Readability fails → Turndown converts full `<body>` to markdown *(fallback)*
3. No body found → Return truncated raw HTML *(last resort)*

### Extract operation

The `extract` operation now uses linkedom for proper CSS selector support:
```
browser({ operation: 'extract', url: '...', selector: '.article-content' })
```
Each matched element is converted to markdown individually.

## Files changed

| File | Change |
|------|--------|
| `packages/agent-core/src/tools/web-search.ts` | Rewritten — Exa search via CF worker proxy |
| `packages/agent-core/src/tools/browser.ts` | Rewritten — Readability + Turndown pipeline |
| `packages/agent-core/src/agent.ts` | Always-register web_search tool with Exa connector |
| `packages/agent-config/src/config.ts` | Exa Search in connector registry + network allowlist |
| `packages/cli/src/commands/connector.ts` | CLI examples for exa-search connector |
| `packages/desktop/src/components/connectors/ConnectorIcons.tsx` | Exa search icon |

## Dependencies added

| Package | Version | Purpose |
|---------|---------|---------|
| `@mozilla/readability` | latest | Article content extraction (Firefox Reader View algorithm) |
| `turndown` | latest | HTML to markdown conversion |
| `linkedom` | latest | Lightweight DOM implementation for server-side HTML parsing |
| `@types/turndown` | latest (dev) | TypeScript types for turndown |
