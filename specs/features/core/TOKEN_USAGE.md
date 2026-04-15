# Anton — Token Usage Tracking & Dashboard Spec

> How Anton tracks, persists, and displays token consumption across sessions, models, and time periods.

## Problem

Token usage is tracked in-memory during active sessions but lost when sessions end or the server restarts. There's no way to see historical usage — making it impossible to understand API costs, compare model efficiency, or monitor consumption patterns.

## Design Principles

1. **Server-computed** — All aggregation happens on the Anton backend. The frontend only renders pre-computed stats.
2. **Zero new storage** — Usage data piggybacks on existing session metadata (`meta.json`), not a separate database.
3. **Backward-compatible** — Old sessions without usage data are simply excluded from stats (no migration needed).

## Data Model

### Token Usage (per session)

Stored in `meta.json` alongside existing session metadata:

```json
{
  "id": "sess_abc123",
  "title": "Fix auth middleware",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "createdAt": 1711500000000,
  "lastActiveAt": 1711503600000,
  "messageCount": 42,
  "usage": {
    "inputTokens": 125000,
    "outputTokens": 8500,
    "totalTokens": 133500,
    "cacheReadTokens": 95000,
    "cacheWriteTokens": 12000
  }
}
```

Usage is the cumulative total for the entire session lifetime. It's updated every time the session is persisted to disk (after each turn).

### Protocol Messages

**Request** — Client sends:
```json
{ "type": "usage_stats" }
```

**Response** — Server computes and returns:
```json
{
  "type": "usage_stats_response",
  "totals": { "inputTokens": ..., "outputTokens": ..., "totalTokens": ..., "cacheReadTokens": ..., "cacheWriteTokens": ... },
  "byModel": [
    { "model": "claude-sonnet-4-6", "provider": "anthropic", "inputTokens": ..., "outputTokens": ..., "totalTokens": ..., "cacheReadTokens": ..., "cacheWriteTokens": ..., "sessionCount": 15 }
  ],
  "byDay": [
    { "date": "2025-03-27", "inputTokens": ..., "outputTokens": ..., "totalTokens": ..., "sessionCount": 5 }
  ],
  "sessions": [
    { "id": "sess_abc123", "title": "Fix auth", "provider": "anthropic", "model": "claude-sonnet-4-6", "createdAt": ..., "totalTokens": ..., "inputTokens": ..., "outputTokens": ... }
  ]
}
```

The server reads all session metadata, filters to those with usage data, and aggregates:
- **totals** — Sum across all sessions
- **byModel** — Grouped by model name, sorted by total tokens descending
- **byDay** — Grouped by session creation date (YYYY-MM-DD), sorted by date descending
- **sessions** — Individual sessions with usage, sorted by most recent

## UI — Usage Tab in Settings

The Usage page lives as a new tab in the Settings modal (alongside General, AI Models, Connectors).

### Layout

```
┌─────────────────────────────────────────────────┐
│  Settings  │  AI Models  │  Connectors  │ Usage │
├─────────────────────────────────────────────────┤
│                                                  │
│  TOTAL USAGE                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 2.4M     │ │ 1.8M     │ │ 580K     │        │
│  │ Total    │ │ Input    │ │ Output   │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                  │
│  BY MODEL                                        │
│  claude-sonnet-4-6      1.2M tokens  12 sessions│
│  claude-haiku-4-5       800K tokens   8 sessions│
│  gpt-4o                 400K tokens   3 sessions│
│                                                  │
│  BY DAY                                          │
│  2025-03-27             450K tokens   5 sessions│
│  2025-03-26             320K tokens   4 sessions│
│  2025-03-25             280K tokens   3 sessions│
│                                                  │
│  RECENT SESSIONS                                 │
│  Fix auth middleware     sonnet-4-6    133K      │
│  Refactor DB layer       sonnet-4-6     85K      │
│  Debug CSS issue         haiku-4-5      12K      │
└─────────────────────────────────────────────────┘
```

### Access

- Settings modal → "Usage" tab
- Sidebar bottom bar → Dashboard icon (BarChart3) opens Settings directly on Usage tab

### Data Flow

1. User opens Usage tab → frontend calls `requestUsageStats()` → sends `usage_stats` message to server
2. Server reads all `meta.json` files (via existing `listSessionMetas()`), aggregates, returns `usage_stats_response`
3. Frontend stores result in zustand and renders

## Token Formatting

Reuse existing `formatTokens()` utility:
- `< 1000` → show raw number (e.g., `847`)
- `1K–999K` → show with K suffix (e.g., `125K`)
- `≥ 1M` → show with M suffix (e.g., `2.4M`)

## Future Considerations

- **Cost estimation** — Map model + token counts to approximate USD cost per provider pricing
- **Time-range filtering** — "Last 7 days", "Last 30 days", "All time" toggles
- **Export** — Download usage as CSV for expense reporting
- **Per-project usage** — Aggregate by project when project sessions have usage data
