# Memory Page Spec

## Overview

The Memory page lets users view and manage AI context, scoped to the active project:
1. **Project Context** — auto-maintained summary and notes for the active project
2. **Chat Memories** — persistent facts stored as `.md` files by the LLM's `memory` tool

## Current Implementation

### How It Works

The Memory page is wired to the server via the `config_query` protocol message with `key: 'memories'`.

```
MemoryView mount (or project switch)
  → sends config_query('memories', undefined, activeProjectId)
  → server reads:
    1. Global memories from ~/.anton/memory/*.md
    2. Conversation-scoped memories (if sessionId provided)
    3. Project context (notes + summary) from project.json (if projectId provided)
  → returns array of { name, content, scope } objects
  → store.setMemories(memories)
  → MemoryView renders with real data
```

### Store Shape

```ts
// In store.ts
memories: { name: string; content: string; scope: 'global' | 'conversation' | 'project' }[]
memoriesLoading: boolean
setMemories: (memories) => void
```

### Memory File Format

Memories are `.md` files saved by the LLM's `memory` tool (`agent-core/tools/memory.ts`):

```markdown
# Memory Key

_Saved: 2026-04-03T12:00:00.000Z_

The actual memory content goes here.
```

**Scopes:**
- `global` — stored in `~/.anton/memory/`, visible from any project
- `conversation` — stored in `~/.anton/conversations/{sessionId}/memory/`, tied to one session

### Protocol

**Request:** `ConfigQueryMessage` (CONTROL channel)
```ts
{ type: 'config_query', key: 'memories', sessionId?: string, projectId?: string }
```

**Response:** `ConfigQueryResponse` with value as array:
```ts
{ name: string; content: string; scope: 'global' | 'conversation' | 'project' }[]
```

## Page Sections

### 1. Project Context Section

Shows the active project's auto-maintained context. Only visible when a project is active.

- **Project Summary** — auto-updated by LLM via `update_project_context` tool
- **Project Notes** — user-editable notes stored in `context/notes.md`
- Expandable cards with chevron toggles
- Empty state: "No project context yet — it builds as you work."

### 2. Chat Memories Section

Shows all memory files from the server with scope badges.

- **Filter tabs:** All / Global / Conversation — with counts
- **Each memory card:**
  - Chevron toggle (expand/collapse)
  - Scope badge with icon (Globe for global, MessageSquare for conversation)
  - Title (extracted from `# heading` in markdown)
  - Expandable body with content
  - Saved timestamp (extracted from `_Saved:` line)
- **Loading state:** Spinner while fetching
- **Empty state:** BookOpen icon + "No memories yet"

## How Memories Are Created

Memories are created **during chat** by the LLM, not on the Memory page:

1. LLM calls the `memory` tool with `operation: 'save'`, `key`, `content`, `scope`
2. Tool writes a `.md` file to the appropriate directory
3. On next Memory page visit, `config_query` fetches all files

## Data Flow on Project Switch

```
User switches project (dropdown)
  → store.setActiveProjectId(newId)
  → MemoryView useEffect fires (dependency: activeProjectId)
  → sends config_query('memories', undefined, newProjectId)
  → server returns memories for new project context
  → UI re-renders with new project's data
```

## Remaining Work

- **Preferences CRUD** — User-defined rules that guide AI behavior (not yet implemented)
- **Memory deletion from UI** — Allow users to delete individual memories
- **Search/filter by type** — Filter memories by content or type
- **Memory types** — Currently memories don't have typed categories (user/feedback/project/reference); this could be added as frontmatter
