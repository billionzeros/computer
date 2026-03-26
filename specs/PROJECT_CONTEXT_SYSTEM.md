# Project Context System — Phase 2 Spec

## What We Learned from Research

### Claude Code
- **CLAUDE.md** files: project-level instructions loaded into system prompt
- **Auto-memory**: categorized (user, feedback, project, reference) with frontmatter
- **MEMORY.md** index: lightweight pointer file, actual content in separate files
- **Compaction**: summarizes old messages when context window fills up
- Hierarchy: global → project → conversation

### OpenAI Codex
- **AGENTS.md** files: directory-scoped, hierarchical (root-to-leaf injection)
- Override system: AGENTS.override.md takes precedence
- 32KB default limit for combined instruction size
- Simple markdown format, no special syntax

### Windsurf
- **Rules** (manual) + **Memories** (auto-generated) — two distinct systems
- Assembly pipeline: Rules → Memories → Open files → Codebase retrieval → Recent actions
- Memories auto-generated when AI identifies useful context to persist

### CrewAI
- 4 memory types: Short-term (session), Long-term (cross-session), Entity (people/places), External
- Short-term uses RAG/ChromaDB, Long-term uses SQLite
- Unified Memory API that routes to the right type

## Our Design

### Context Layers (injected into every project session)

```
System prompt assembly for a project session:

1. Base system prompt (unchanged)
2. Project context (from project.json → context.summary)
3. Project notes (from context/notes.md — user-editable)
4. Active jobs summary (what's running, last results)
5. Recent session summaries (last 3-5 sessions, one-liner each)
```

### Auto-Context Update (after each session)

When a project session ends (`done` message received), the agent:
1. Summarizes what was discussed/accomplished in this session (1-2 sentences)
2. Extracts any new facts about the project (new services, credentials, config changes)
3. Appends the session summary to the project's session history
4. Updates `context.summary` if significant new information was learned

This is NOT a separate LLM call — it's a final instruction in the session's system prompt:
"When the conversation ends, output a [PROJECT_CONTEXT_UPDATE] block with..."

### What Gets Stored

```
~/.anton/projects/{projectId}/
├── project.json              # Metadata + context.summary (agent-updated)
├── context/
│   ├── notes.md              # User-editable project notes
│   └── session-history.jsonl # One-line summaries of past sessions
├── sessions/
│   └── {sessionId}/
│       ├── meta.json
│       └── messages.jsonl
```

**session-history.jsonl** (one entry per completed session):
```json
{"sessionId": "...", "title": "Set up initial scraper", "summary": "Wrote Python script to scrape LinkedIn profiles using browser automation. Added proxy rotation.", "ts": 1711234567}
```

**context.summary** (in project.json):
Auto-maintained field. Example:
"Scrapes VP-level SaaS leads from LinkedIn. Uses Playwright for browser automation with BrightData proxies (10 residential IPs). Output goes to Airtable base 'Lead Pipeline', table 'Raw Leads'. Two daily runs (8am, 2pm). Known issue: CAPTCHA triggers after ~50 requests, mitigated by splitting runs."

### How Context Gets Into Sessions

On `session_create` with a `projectId`:
1. Server loads the project
2. Builds a context block from project.json + notes.md + session-history
3. Prepends to the session's system prompt as a `[PROJECT CONTEXT]` section
4. Creates the session under `projects/{projectId}/sessions/`

### Session Scoping on the Server

The `session_create` message gains an optional `projectId` field:
```typescript
{ type: 'session_create', id: string, projectId?: string, provider?, model? }
```

If `projectId` is present:
- Session persisted under `projects/{projectId}/sessions/{id}/`
- Context injected from project
- Session tagged with `projectId` in meta.json

### Desktop Flow

When user opens a project session:
1. Click project → ProjectView opens
2. Click "New Session" or existing session in Sessions tab
3. **View switches to Chat mode** with the session active
4. Sidebar shows project sessions (not general conversations)
5. A small badge/indicator shows which project this session belongs to
6. When done, user can navigate back to project view

## Implementation Order

1. Add `projectId` to `SessionCreateMessage` and server session handling
2. Build context assembly on server (load project context → inject into prompt)
3. Project session creation from desktop (opens chat with project context)
4. Session-to-project linking (sidebar shows project sessions when in project)
5. Context update extraction (parse [PROJECT_CONTEXT_UPDATE] from session output)
6. Session history tracking (append summaries to session-history.jsonl)
7. User-editable project notes (context/notes.md via the UI)
