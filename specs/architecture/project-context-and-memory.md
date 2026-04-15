# Project Context & Memory System

## The Insight

Every good AI workspace separates three things:

| Layer | What | Who writes it | Example |
|-------|------|---------------|---------|
| **Instructions** | How the AI should behave | User | "Always output CSV. Use Python 3.12. Be concise." |
| **Knowledge** | Reference material the AI can use | User | Design docs, API specs, CSV data files, URLs |
| **Memory** | Learned facts from conversations | AI (auto) | "User prefers Playwright over Puppeteer", "Auth uses JWT" |

Claude Projects does this. Perplexity Spaces does this. Claude Code does this (CLAUDE.md + auto-memory + files). Anton should do it better because Anton is project-scoped with 24/7 routines.

---

## Architecture

### Per-Project Context

Every project (including "My Computer") has:

```
~/.anton/projects/{projectId}/
├── project.json              # Metadata + context.summary
├── instructions.md           # User-written project instructions (injected into every session)
├── knowledge/                # User-uploaded reference materials
│   ├── index.json            # Manifest of all knowledge items
│   ├── api-spec.md           # Text snippet
│   ├── design-doc.pdf        # Uploaded file
│   └── data.csv              # Uploaded file
├── memory/                   # AI auto-generated memories (project-scoped)
│   ├── user-preferences.md   # Auto-extracted memory (frontmatter format)
│   └── tech-stack.md         # Auto-extracted memory (frontmatter format)
├── conversations/            # Project-scoped sessions
├── context/
│   ├── session-history.jsonl # Summaries of completed sessions
│   └── notes.md              # (legacy, migrated to instructions.md)
├── jobs/                     # Routine definitions
└── files/                    # Project workspace files
```

### What Changed From Current System

| Before | After |
|--------|-------|
| `context.notes` — single text field in project.json | `instructions.md` — dedicated file, shown prominently in UI |
| `context.summary` — auto-updated by LLM | `memory/` — multiple auto-extracted memory files |
| No knowledge base | Knowledge = workspace files. Uploads go to `workspacePath/`. Shown on Files page. |
| Global memory in `~/.anton/memory/` | Still exists; background extraction writes to project-scoped `~/.anton/projects/{id}/memory/` when projectId is set |
| Memory tool saves flat .md files | Memory tool still uses old format (global/conversation); background extraction uses frontmatter format (project-scoped) |
| 4-line "use memory proactively" prompt | Detailed 4-type taxonomy with when-to-save triggers, exclusions, and structured format |
| No automatic memory extraction | Background extraction runs every 4 user messages via cheap LLM, fire-and-forget |

---

## The Three Layers

### 1. Instructions (`instructions.md`)

**What:** User-written rules that tell the AI how to behave for this project. Injected into every session's system prompt.

**Examples:**
- "You are a Python scraper. Always use Playwright with BrightData proxies."
- "Output data as CSV with columns: name, title, company, linkedin_url"
- "Never use async/await — this project uses callbacks only"
- "Design system uses Tailwind with custom color tokens from design-tokens.json"

**Storage:** `~/.anton/projects/{projectId}/instructions.md` — plain markdown file.

**UI:** Editable text area on the project settings or Memory page. Prominent placement — this is the most important context a user sets.

**Injection:** Prepended to the system prompt as a `<project-instructions>` block for every session in this project. Higher priority than auto-memories.

**Inspiration:**
- Claude Projects: "Set project instructions" — separate from knowledge
- Claude Code: CLAUDE.md files — hierarchical, always loaded
- Perplexity: "Custom instructions" text field per Space

### 2. Knowledge = Workspace Files

**What:** Reference materials the user uploads, plus files the AI creates during tasks. All live in the same place.

**Storage:** `project.workspacePath/` (e.g. `~/Anton/my-scraper/`). No separate knowledge directory.

**How it works:**
- User uploads files via the Files page → saved to `workspacePath/`
- AI creates files during tasks → also saved to `workspacePath/`
- Both appear on the Files page as a unified visual grid
- AI can read all files in the workspace during tasks (shell tool runs there)

**Upload flow:**
1. User drags files onto Files page (or clicks Upload button)
2. Browser reads file as base64, sends `project_file_upload` over WebSocket
3. Server decodes and writes to `workspacePath/`
4. File list auto-refreshes

**UI:** The Files page (`ProjectFilesView`) — Perplexity-style visual card grid with:
- Type icons (Code/Data/Documents/Images) with color coding
- File type filter dropdown
- Drag-and-drop upload
- Delete with confirmation

**Why not a separate `knowledge/` directory:**
- Simpler — one directory, no dual-location confusion
- AI can access everything because shell tool runs in `workspacePath/`
- Like Claude Code — the working directory IS the project

**How the AI accesses uploaded files:**

```
1. User uploads data.csv → saved to ~/Anton/my-scraper/data.csv
2. User starts task: "Analyze the CSV"
3. Server creates session with:
   - projectWorkspacePath = ~/Anton/my-scraper/
   - projectContext includes: "Project workspace: ~/Anton/my-scraper/"
4. System prompt tells AI: "Use ~/Anton/my-scraper/ as working directory"
5. AI calls shell tool: `cat data.csv` (cwd = ~/Anton/my-scraper/)
6. Shell output (file contents) → goes into conversation as tool result
7. Model sees the file contents and can analyze them

Files are NOT "uploaded to the model" — the model reads them via tools
during the conversation, like a developer using the terminal.
```

**How the AI creates files:**

```
1. User asks: "Write a Python scraper"
2. AI calls shell tool: writes scraper.py (cwd = ~/Anton/my-scraper/)
3. File appears in ~/Anton/my-scraper/scraper.py
4. File shows up on the Files page (same grid as uploaded files)
5. User can download, delete, or reference it in future tasks
```

### 3. Memory (`memory/`)

**What:** AI auto-generated facts learned from conversations. The AI decides what's worth remembering.

**Two mechanisms (dual-layer):**

1. **Memory tool** (agent-initiated) — the `memory` tool with save/recall/list/forget. The agent can explicitly save memories during a conversation based on enhanced system prompt instructions (4 types, when-to-save triggers, structured format). Saves to `~/.anton/memory/` (global) or `~/.anton/conversations/{convId}/memory/` (conversation-scoped).

2. **Background extraction** (automatic) — after each turn completes, a lightweight background process serializes recent messages and calls a cheap LLM (e.g., `gemini-3.1-flash-lite`) to extract durable memories the agent missed. Runs every 4 user messages, fire-and-forget, ~$0.0003 per extraction. Writes directly to project-scoped directory when `projectId` exists. See `specs/features/background-memory-extraction.md` for full details.

**Mutual exclusion:** If the agent already saved a memory via the memory tool during a turn, background extraction skips that turn and advances its cursor (prevents duplicates).

**Memory file format (background extraction):**

```markdown
---
name: user-prefers-playwright
description: User prefers Playwright over Puppeteer for browser automation
type: feedback
extracted: 2026-04-09T12:00:00.000Z
---

User prefers Playwright over Puppeteer for browser automation.
**Why:** Better async handling and built-in wait mechanisms.
**How to apply:** Default to Playwright for any new scraping task in this project.
```

**Memory file format (memory tool — legacy):**

```markdown
# User prefers Playwright

_Saved: 2026-04-09T12:00:00.000Z_

User prefers Playwright over Puppeteer for browser automation.
```

Both formats coexist in the same directory. The dedup logic reads both (tries frontmatter `name:` first, falls back to `#` heading, falls back to filename).

**Memory types (4 categories):**
- `user` — role, expertise, preferences
- `feedback` — corrections/confirmations on approach (includes Why)
- `project` — tech decisions, architecture, goals, deadlines
- `reference` — pointers to external systems (URLs, project names)

**Memory scope:**
- **Background extraction:** project-scoped (`~/.anton/projects/{projectId}/memory/`) when projectId exists, else global (`~/.anton/memory/`)
- **Memory tool:** global or conversation-scoped (project scope not yet wired — see Phase 6b below)

**Injection priority (highest to lowest):**
1. Project instructions (`instructions.md`)
2. Project memory (`~/.anton/projects/{projectId}/memory/`)
3. Global memory (`~/.anton/memory/`)
4. Session history (last 5 sessions)
5. Knowledge items (listed as available, inlined if small)

**Inspiration:**
- Claude Code: Auto-memory with background extraction, frontmatter types
- The current Anton memory tool (save/recall/list/forget) — enhanced with detailed system prompt instructions

---

## UI: Memory Page Redesign

The Memory page becomes the **project context hub** with three sections:

```
Memory                                                    [Project: Twitter Scraper v]

INSTRUCTIONS
Edit the rules that guide the AI in this project.
┌──────────────────────────────────────────────────────────────────────────┐
│ You are a Python scraper. Always use Playwright with BrightData proxies.│
│ Output data as CSV with columns: name, title, company, linkedin_url.   │
│ Save results to the project's files/ directory.                         │
│                                                                         │
│                                                          [Save] [Cancel]│
└──────────────────────────────────────────────────────────────────────────┘

KNOWLEDGE                                                          [+ Add]
Reference materials the AI can use in this project.

  📄 API Authentication          Text snippet       1.2 KB    ×
  📎 product-spec.pdf            PDF                56 KB     ×
  📎 leads-template.csv          CSV                3.4 KB    ×
  🔗 docs.brightdata.com/...     URL (cached)       12 KB     ×

MEMORIES                                                              12
Auto-learned from your conversations.

  [All] [Global (3)] [Project (9)]

  > 🔵 Global   User prefers concise responses
  > 🟢 Project  Auth uses BrightData residential proxies on port 22225
  > 🟢 Project  LinkedIn scraping requires 3s delay between requests
  > 🟠 Feedback Never use headless mode — LinkedIn detects it
  ...
```

---

## Protocol Changes

### New Messages

```typescript
// Instructions
interface ProjectInstructionsGetMessage {
  type: 'project_instructions_get'
  projectId: string
}

interface ProjectInstructionsGetResponse {
  type: 'project_instructions_response'
  projectId: string
  content: string  // markdown content of instructions.md
}

interface ProjectInstructionsSaveMessage {
  type: 'project_instructions_save'
  projectId: string
  content: string
}

// Knowledge
interface ProjectKnowledgeListMessage {
  type: 'project_knowledge_list'
  projectId: string
}

interface ProjectKnowledgeListResponse {
  type: 'project_knowledge_list_response'
  projectId: string
  items: KnowledgeItem[]
}

interface ProjectKnowledgeAddTextMessage {
  type: 'project_knowledge_add_text'
  projectId: string
  name: string
  content: string
}

interface ProjectKnowledgeDeleteMessage {
  type: 'project_knowledge_delete'
  projectId: string
  itemId: string
}

// Memory (enhanced — now includes projectId)
// Reuse existing config_query with key: 'memories' + projectId
// Already implemented in current changes
```

### Knowledge Item Type

```typescript
interface KnowledgeItem {
  id: string
  type: 'text' | 'file' | 'url'
  name: string
  filename: string
  mimeType?: string
  addedAt: number
  sizeBytes: number
}
```

---

## System Prompt Injection

When a session is created with a `projectId`, the system prompt includes:

```
<project-instructions>
{contents of instructions.md}
</project-instructions>

<project-knowledge>
The following reference materials are available for this project:
- API Authentication (text, 1.2 KB) — [inlined below]
- product-spec.pdf (PDF, 56 KB) — use the read_knowledge tool to access
- leads-template.csv (CSV, 3.4 KB) — [inlined below]

### API Authentication
{content of api-auth.md}

### leads-template.csv
{content of leads-template.csv}
</project-knowledge>

<system-reminder name="Memory">
## Global Memory
### User prefers Playwright
User prefers Playwright over Puppeteer for browser automation.

## Conversation Memory
### Auth config
Auth uses BrightData residential proxies on port 22225.

## Relevant Context (from other conversations)
### LinkedIn rate limits (from: scraper-v2-session)
LinkedIn scraping requires 3s delay between requests.
</system-reminder>

<recent-sessions>
- Set up initial scraper: Wrote Python script with Playwright...
- Configure output format: Added CSV export with headers...
</recent-sessions>
```

**Note:** Project-scoped memories (from background extraction) are not yet loaded into the system prompt — that's Phase 6d. Currently, only global and conversation-scoped memories (from the memory tool) are injected via `session.ts` Layer 4.

---

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1: Instructions** | `instructions.md` per project, protocol messages, server handlers, `buildProjectContext()` injection, Memory page UI section | Done |
| **Phase 2: Preferences** | `preferences.json` per project, add/delete CRUD, injected into system prompt as bullet list | Done |
| **Phase 3: Knowledge = Workspace Files** | Uploads go to `workspacePath/`, Files page redesigned as visual grid with drag-drop, AI creates files in same directory | Done |
| **Phase 4: Unified Workspace** | FileBrowser scoped to workspace, Terminal spawns in workspace, custom workspacePath on project creation | Done |
| **Phase 5: Files Page Redesign** | `ProjectFilesView` replaces Terminal+FileBrowser, Perplexity-style cards, type filtering, upload | Done |
| **Phase 6a: Background Memory Extraction** | Automatic end-of-turn extraction via cheap LLM, frontmatter format, project-scoped writes, enhanced system prompt with 4-type taxonomy | Done |
| **Phase 6b: Memory Tool Project Scope** | Wire the memory tool's save/recall to use project-scoped directory when `projectId` is set (currently still global/conversation) | Not yet |
| **Phase 6c: MEMORY.md Index** | Add an index file per project listing all memories (like Claude Code). Not strictly needed — memories work without it. | Not yet |
| **Phase 6d: Memory Loading** | Update `context.ts` / `session.ts` to load project-scoped memories (from background extraction) into the system prompt alongside global memories | Not yet |

---

## Reference Implementations

| Feature | Reference | Location |
|---------|-----------|----------|
| CLAUDE.md hierarchy | Claude Code | `/Users/omg/Desktop/01/claude-code/src/utils/claudemd.ts` |
| Auto-memory extraction | Claude Code | `/Users/omg/Desktop/01/claude-code/src/services/extractMemories/` |
| Memory types + frontmatter | Claude Code | `/Users/omg/Desktop/01/claude-code/src/memdir/memoryTypes.ts` |
| MEMORY.md index pattern | Claude Code | `/Users/omg/Desktop/01/claude-code/src/memdir/` |
| Extraction prompts | Claude Code | `/Users/omg/Desktop/01/claude-code/src/services/extractMemories/prompts.ts` |
| Project instructions UI | Claude Projects | claude.ai — "Set project instructions" |
| Knowledge add menu | Claude Projects | claude.ai — "+ Add Content" (text, file, Google Doc) |
| Space instructions + files | Perplexity | perplexity.ai — Space settings |

## Anton Implementation

| Feature | File |
|---------|------|
| Background extraction engine | `packages/agent-core/src/memory-extraction.ts` |
| Session integration (hooks, state) | `packages/agent-core/src/session.ts` |
| Server-side trigger (fire-and-forget) | `packages/agent-server/src/server.ts` |
| Enhanced system prompt (memory guidelines) | `packages/agent-config/prompts/system.md` |
| Memory tool (save/recall/list/forget) | `packages/agent-core/src/tools/memory.ts` |
| Memory loading into context | `packages/agent-core/src/context.ts` |
| Model catalog (extraction model resolution) | `packages/agent-core/src/anton-models.ts` |
