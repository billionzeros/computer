# Conversation Workspaces Spec

> Each conversation gets its own self-contained directory with workspace, scoped memory, and context transparency.

## Problem

1. **Memory is global** — `~/.anton/memory/` is flat, no way to scope memory to a conversation
2. **No workspace** — sessions are bare (meta + messages), no scratch space for agent files
3. **No transparency** — the agent can't show the user what context/memory it's drawing on
4. **Sub-agents are isolated** — no shared workspace with parent conversation

## Design

### Directory Structure

```
~/.anton/
├── config.yaml
├── memory/                          # Global memory (cross-conversation)
│   └── *.md
│
├── conversations/                   # Per-conversation workspaces
│   ├── index.json                   # Lightweight index (same format as sessions/index.json)
│   └── {convId}/
│       ├── meta.json                # Conversation metadata
│       ├── messages.jsonl           # Message history
│       ├── images/                  # Image attachments
│       ├── compaction.json          # Compaction state
│       ├── workspace/               # Scratch space (agent-created files, artifacts)
│       ├── memory/                  # Conversation-scoped memory
│       │   └── *.md                 # Memory files
│       └── context.json             # What context was loaded for this conversation
│
├── projects/{projectId}/
│   ├── project.json
│   ├── context/
│   └── conversations/               # Project conversations (same workspace structure)
│       └── {convId}/
│           └── ...
```

### Migration

One-time migration on agent startup:
- `~/.anton/sessions/data/{id}/` → `~/.anton/conversations/{id}/`
- `~/.anton/sessions/index.json` → `~/.anton/conversations/index.json`
- Remove empty `~/.anton/sessions/` after migration
- Wire protocol messages (`session_create`, etc.) remain unchanged for backward compat

### Memory Scoping

The memory tool gains a `scope` parameter:

```typescript
interface MemoryInput {
  operation: 'save' | 'recall' | 'list' | 'forget'
  key?: string
  content?: string
  query?: string
  scope?: 'global' | 'conversation'  // default: 'conversation'
}
```

- `scope: 'conversation'` → `~/.anton/conversations/{convId}/memory/{key}.md`
- `scope: 'global'` → `~/.anton/memory/{key}.md`

The agent decides scope: conversation-specific facts stay local, broadly useful info goes global.

The memory tool needs the current `conversationId` injected — session passes it when building tools.

### Context Assembly

When a conversation starts or resumes, anton assembles context from multiple layers:

```
1. Base system prompt
2. Global memories (from ~/.anton/memory/)
3. Project context (if conversation belongs to a project)
4. Conversation memory (from conversation's own memory/ dir)
5. Cross-conversation memories (keyword match on title/keys)
6. Skills
```

**Cross-conversation matching (Layer 5):**
- On first message, extract keywords from the user's text and the conversation title
- Scan other conversations' `memory/` directories for matching keys
- Match: case-insensitive substring match of keywords against memory filenames and first-line headers
- Inject up to 5 most relevant matches into the Memory `<system-reminder>` block under "## Relevant Context (from other conversations)"
- Only runs on conversation start (not every message)

### context.json

Records what context was loaded for transparency:

```json
{
  "loadedAt": 1711234567000,
  "globalMemories": ["server-setup", "user-preferences"],
  "projectId": "proj_abc123",
  "conversationMemories": ["nginx-config-notes"],
  "crossConversationMemories": [
    {
      "fromConversation": "conv_abc123",
      "conversationTitle": "Set up nginx",
      "memoryKey": "nginx-ssl-setup"
    }
  ]
}
```

Sent to client as `context_info` message after session creation so UI can display it.

### Workspace

Each conversation gets `workspace/` — a scratch directory where the agent stores:
- Intermediate files during multi-step work
- Artifacts and generated content
- Tool outputs too large for message stream

The workspace path is available in the system prompt:
```
Your workspace for this conversation is: ~/.anton/conversations/{convId}/workspace/
```

Sub-agents share the parent conversation's workspace path.

### Protocol

New server→client message:

```typescript
interface ContextInfoMessage {
  type: 'context_info'
  sessionId: string
  globalMemories: string[]           // keys loaded from global memory
  conversationMemories: string[]     // keys loaded from conversation memory
  crossConversationMemories: Array<{
    fromConversation: string
    conversationTitle: string
    memoryKey: string
  }>
  projectId?: string
}
```

Sent after `session_created`.

### Desktop UI

Chat header gets a context indicator:
- Shows memory count badge (e.g. "3 memories loaded")
- Click to expand panel showing:
  - Global memories (list of keys)
  - Conversation memories (list of keys)
  - Cross-conversation memories (key + source conversation title)
  - Project context (if applicable)

## Implementation Order

1. Storage layout: add conversation dir helpers to `agent-config/src/config.ts`
2. Migration: `sessions/` → `conversations/` on startup
3. Memory tool: add `scope` + `conversationId` parameters
4. Context assembly: load memories + cross-conversation matching
5. context.json: write on session start, send as `context_info` message
6. Workspace: create dir on session start, inject path into system prompt
7. Protocol: add `context_info` message type
8. Desktop UI: context indicator component
9. Sub-agent workspace sharing

## Files to Modify

| File | Change |
|------|--------|
| `packages/agent-config/src/config.ts` | New conversation dir helpers, migration fn, update session paths |
| `packages/agent-core/src/tools/memory.ts` | Add scope + conversationId, route to correct dir |
| `packages/agent-core/src/agent.ts` | Pass conversationId to memory tool, context assembly |
| `packages/agent-core/src/session.ts` | Inject workspace path, pass conversationId, write context.json |
| `packages/agent-server/src/server.ts` | Send context_info message after session create/resume |
| `packages/protocol/src/messages.ts` | Add ContextInfoMessage type |
| `packages/desktop/src/lib/store.ts` | Store context info per conversation |
| `packages/desktop/src/components/AgentChat.tsx` | Handle context_info message |
| `packages/desktop/src/components/chat/ContextPanel.tsx` | New: context transparency panel |
