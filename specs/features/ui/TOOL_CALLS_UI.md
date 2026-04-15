# Tool Calls UI Spec

## Overview

Tool calls are displayed in a **tree layout** inspired by Claude Code's CLI interface. Instead of generic pill badges, each tool call shows a **bold type label** (Read, Shell, Fetch) with a **code-styled target** and **brief metadata**.

## Visual Design

### Tree Layout

```
▸ Read config.ts                              ← collapsible header
  │
  ├─ Read    /src/config.ts                   ← type label + target in code pill
  │          Read 261 lines                   ← metadata
  │
  ├─ Shell   npm run build                    ← type label + command
  │          exit 0                           ← result summary
  │
  └─ Fetch   api.weather.com                  ← last item (no continuing line)
             1.2kb response
```

### Key Elements

1. **Header**: Minimal, no background. Shows chevron + status icon + descriptive text.
   - Single action: "Read config.ts"
   - Multiple: "Read · 3 tool calls, Shell"
   - Collapsed by default when complete, expanded while running.

2. **Tool Type Label**: Bold, 13px, `var(--text-muted)`. One word: Read, Write, Shell, Fetch, Search, Git, Browser, Agent, etc.

3. **Target**: Monospace, slightly darker background, rounded 4px pill. Shows file path, command, hostname, query, etc.

4. **Metadata**: 11px, `var(--text-subtle)`. Shows brief result info: "Read 261 lines", "exit 0", "3 results", "1.2kb response".

5. **Tree Lines**: Vertical `border-left` + horizontal `::before` pseudo-elements connecting items.

6. **Show More**: For long results (>6 lines), show truncated + "Show more" toggle.

7. **Errors**: Type label turns red. Error message shown in metadata.

### Tool Type Label Mapping

| Tool Name    | Label     | Target Shows                    |
|-------------|-----------|----------------------------------|
| shell       | Shell     | Command (truncated to 80 chars)  |
| filesystem  | Read/Write/Edit/Delete | File path          |
| browser     | Browser   | Operation + URL/selector         |
| network     | Fetch     | Hostname                         |
| code_search | Search    | Query string                     |
| git         | Git       | Operation + path                 |
| http_api    | HTTP      | METHOD hostname                  |
| sub_agent   | Routine   | Task description                 |
| artifact    | Artifact  | Title                            |
| database    | Database  | Operation                        |
| memory      | Memory    | Key                              |
| (unknown)   | Capitalized tool name | —                  |

## Streaming Token Updates

### Protocol

New message type `token_update` streams cumulative token usage during agent work:

```typescript
interface AiTokenUpdateMessage {
  type: 'token_update'
  usage: TokenUsage  // cumulative for current turn
  sessionId?: string
}
```

Emitted on each agentic loop `turn_end` event, so the frontend can show a **live token counter** in the ThinkingIndicator.

### Display

While agent is working:
```
● Thinking...                          0:32 · ↓140 tokens
```

After turn completes:
```
2s · ↓1.2k tokens
```

### Data Flow

1. `session.ts` → emits `token_update` on each `turn_end` with cumulative usage
2. `server.ts` → forwards to client via AI channel
3. `store.ts` → updates `turnUsage` in real-time
4. `ThinkingIndicator` → reads `turnUsage.totalTokens` and displays live

## Agent Status Detail

Enhanced to include richer context about what's running:

| Event Type  | Detail Format                        |
|------------|--------------------------------------|
| tool_call  | "Running: npm test" / "Reading config.ts" / "Fetching api.com" |
| thinking   | "Thinking..."                        |
| text       | "Writing response..."                |

## Components

### ActionsGroup (`ActionsGroup.tsx`)
Main tree container. Renders inline `ArtifactCard` components for artifacts matching tool call IDs. Exports shared helpers: `getToolTypeLabel`, `getToolTarget`, `getToolMeta`, `getGroupHeader`, `ToolTreeItem`.

### TaskSection (`TaskSection.tsx`)
Step narration header + nested ToolTreeItem list. Renders inline `ArtifactCard` components for matching artifacts (same pattern as ActionsGroup).

### SubAgentGroup (`SubAgentGroup.tsx`)
Sub-agent header with task description + nested ToolTreeItem list. Renders inline `ArtifactCard` components for matching artifacts (same pattern as ActionsGroup).

### ThinkingIndicator (`ThinkingIndicator.tsx`)
Shows status text + elapsed time + live token counter while agent is working.

## CSS Classes

All styles use `.tool-tree` prefix:
- `.tool-tree` — container
- `.tool-tree__header` — collapsible header
- `.tool-tree__items` — tree items container (has `border-left`)
- `.tool-tree__item` — individual item (has `::before` branch connector)
- `.tool-tree__type` — bold type label
- `.tool-tree__target` — code-styled target
- `.tool-tree__meta` — metadata line
- `.tool-tree__result` — expanded result pre block
- `.tool-tree__show-more` — show more/less toggle
- `.tool-tree__spinner` — animated loader
- `.tool-tree__status--done` / `--error` — status colors
