# anton.computer — Architecture

## One-Liner

A TypeScript agent server on your VPS + Go sidecar for health/status + desktop app + CLI, connected by multiplexed WebSocket. Projects are the core primitive — every task, file, routine, and memory is scoped to a project.

## System Diagram

```
YOUR BROWSER / DESKTOP                                YOUR VPS / CLOUD SERVER
┌────────────────────────────┐                        ┌──────────────────────────────┐
│  Desktop App (Tauri)       │    WebSocket (TLS)     │  Caddy (:443 TLS)            │
│  or CLI (Ink TUI)          │◄─────────────────────►│  ├── /* → Agent (:9876)      │
│                            │  Single multiplexed    │  └── /_anton/* → Sidecar     │
│  ┌──────────────────────┐  │                        │                              │
│  │ Project Selector     │  │                        │  ┌────────────────────────┐  │
│  │ Tasks (project-scoped)│──┼── AI channel ───────►│  │  Agent (Node.js :9876) │  │
│  │ Memory Page          │──┼── AI channel ───────►│  │  ├── WebSocket Server  │  │
│  │ Files Page           │──┼── AI channel ───────►│  │  ├── Session Router    │  │
│  │ Routines Page        │──┼── AI channel ───────►│  │  ├── Project Manager   │  │
│  │ Terminal             │──┼── PTY channel ──────►│  │  └── Tool Execution    │  │
│  │ Agent Chat           │──┼── AI channel ───────►│  │                        │  │
│  └──────────────────────┘  │                        │  └────────────────────────┘  │
│                            │                        │                              │
│  Zustand store             │                        │  ~/.anton/                    │
│  localStorage cache        │                        │  ├── config.yaml             │
│                            │                        │  ├── projects/               │
└────────────────────────────┘                        │  ├── conversations/          │
                                                      │  └── memory/                 │
antoncomputer.in                                      │                              │
┌────────────────────────┐                            │  ~/Anton/                     │
│  Polls sidecar for     │◄─────────────────────────►│  ├── my-computer/  (default) │
│  provisioning status   │                            │  ├── seo-analyser/           │
└────────────────────────┘                            │  └── my-scraper/             │
                                                      └──────────────────────────────┘
```

## Core Concepts

### Projects

Everything lives in a project. Projects are the scope boundary for tasks, files, routines, memory, and context.

```
Project: "SEO Analyser"
├── Tasks        → conversations scoped to this project
├── Memory       → instructions + preferences + auto-memories
├── Files        → workspace files (uploads + AI-created)
├── Routines     → background jobs running on cron
└── Context      → auto-maintained project summary + session history
```

**Default project:** "My Computer" — auto-created on first connect, `isDefault: true`, cannot be deleted. All tasks go here unless user switches to another project.

**Storage (dual):**

| Location | Purpose | Contents |
|----------|---------|----------|
| `~/.anton/projects/{projectId}/` | Internal metadata | project.json, instructions.md, preferences.json, conversations/, context/ |
| `~/Anton/{project-name}/` | Workspace (user-visible) | All files — uploaded by user AND created by AI |

### Sessions

Each task/conversation is a Session on the server. Sessions are scoped to a project.

```
Session "sess_abc123"
├── pi SDK Agent (Claude, GPT-4o, Gemini, etc.)
├── System Prompt: core + project context + instructions + preferences + memory
├── Tools: shell, filesystem, browser, process, network, memory
├── Messages: stored in ~/.anton/projects/{projectId}/conversations/{sessionId}/
└── Compaction Engine (auto-summarizes at 80% context usage)
```

**Every session gets project context injected:**
1. Project name, description, type, workspace path
2. Project instructions (`instructions.md`)
3. User preferences (`preferences.json`)
4. Project summary (auto-maintained by LLM)
5. Recent session history (last 5 sessions)
6. Global + conversation memories

## Storage Layout

```
~/.anton/                                    # Agent configuration root
├── config.yaml                              # Providers, security, workspace root
├── memory/                                  # Global cross-project memories
│   └── *.md                                 # Memory files (saved by LLM)
├── conversations/                           # Legacy global sessions
│   └── {sessionId}/
│       ├── meta.json
│       └── messages.jsonl
└── projects/
    ├── index.json                           # Master index of all projects
    └── {projectId}/
        ├── project.json                     # Metadata + context.summary
        ├── instructions.md                  # User-written project instructions
        ├── preferences.json                 # User preferences (title + content pairs)
        ├── conversations/                   # Project-scoped sessions
        │   └── {sessionId}/
        │       ├── meta.json
        │       ├── messages.jsonl
        │       ├── agent.json               # (if this session is a routine)
        │       └── memory/                  # Session-scoped memories
        ├── context/
        │   ├── session-history.jsonl        # Summaries of completed sessions
        │   └── notes.md                     # Legacy notes (superseded by instructions.md)
        └── jobs/                            # Routine/job definitions

~/Anton/                                     # Default workspace root (configurable)
├── my-computer/                             # Default project workspace
│   ├── .anton.json                          # Links back to project metadata
│   └── (files created by AI + uploaded)
├── seo-analyser/
│   ├── .anton.json
│   ├── scraper.py                           # AI created
│   └── keywords.csv                         # User uploaded
└── my-scraper/
    └── ...
```

## Project-First Architecture

### How projects work

1. **Always in a project** — user is always inside a project (default = "My Computer")
2. **Project selector** — dropdown in sidebar, shows all projects
3. **Everything scoped** — Tasks, Memory, Files, Routines pages show data for the active project only
4. **Context injection** — every session gets project instructions, preferences, and memory
5. **Workspace** — each project has a real directory where files live

### Project creation flow

```
User clicks "+ New project"
  → CreateProjectModal (name, description, optional workspace path)
  → Client sends project_create message
  → Server: createProject() → creates internal dir + workspace dir
  → Default workspace: ~/Anton/{sanitized-name}/
  → Custom workspace: user-provided path (any directory)
  → Returns project to client → appears in dropdown
```

### Default project lifecycle

```
Client connects → sends projects_list
  → Server: ensureDefaultProject() — creates "My Computer" if missing
  → Server returns projects list (always includes default)
  → Client: setProjects() → auto-selects default if activeProjectId is null
  → User always has a project active
```

## Memory Page (3 sections)

### 1. Instructions

Per-project rules that guide AI behavior. Stored as `instructions.md`. Editable textarea in UI. Injected into every session's system prompt as highest-priority project context.

### 2. Preferences

User-defined preferences stored as `preferences.json` (array of `{id, title, content, createdAt}`). Add/delete via UI. Injected into system prompt as bullet points.

### 3. Chat Memories

Auto-generated by the LLM's `memory` tool during conversations. Stored as `.md` files in `~/.anton/memory/` (global) or `~/.anton/conversations/{id}/memory/` (session-scoped). Fetched via `config_query` with `projectId`. Displayed with scope badges (Global / Conversation) and filter tabs.

## Files Page

Visual file grid showing workspace files (`project.workspacePath`). Perplexity-style cards with type icons, color coding, and file type filter.

**Upload flow:**
1. Drag-drop or click Upload
2. Browser reads file as base64 → sends `project_file_upload` over WebSocket
3. Server decodes → writes to `project.workspacePath/`
4. File list refreshes

**AI file access:**
- Shell tool runs with `cwd: project.workspacePath`
- AI can `cat`, `ls`, `python script.py` etc. — all in the workspace
- Uploaded files and AI-created files are in the same directory

## Protocol

### Channels

| Byte | Channel | Purpose |
|------|---------|---------|
| 0x00 | CONTROL | Ping/pong, config queries, updates |
| 0x01 | TERMINAL | PTY spawn/data/resize/close |
| 0x02 | AI | Sessions, messages, projects, routines |
| 0x03 | FILESYNC | Filesystem listing (for FileBrowser) |
| 0x04 | EVENTS | Agent status, update notifications |

### Key Message Types

**Session management:** session_create, session_created, sessions_list, session_destroy, session_history

**Project management:** project_create, projects_list, project_update, project_delete

**Project context:** project_instructions_get/save, project_preferences_get/add/delete, project_context_update

**Project files:** project_file_upload, project_file_text_create, project_file_delete, project_files_list

**Routines:** routine_create, routines_list, routine_action (start/stop/delete/pause/resume)

**Config:** config_query (providers, defaults, security, system_prompt, memories)

## Context Injection (System Prompt Layers)

```
Layer 1: Core system prompt (personality, capabilities, safety)
Layer 2: Workspace rules (user-configured in config.yaml)
Layer 3: Project context (buildProjectContext)
         ├── Project name, description, type, workspace path
         ├── instructions.md content
         ├── preferences (as bullet list)
         ├── Project summary (auto-maintained)
         ├── Legacy notes (if no instructions.md)
         └── Recent session history (last 5)
Layer 4: Memory (global + conversation-scoped memories)
Layer 5: Routine instructions (if routine session)
Layer 6: Project type guidelines (code/data/document prompts)
Layer 7: Current date, model info
```

## Security Model

1. **Auth**: Shared secret token (`ak_<hex>`) generated on Agent Server install
2. **TLS**: Self-signed cert at `~/.anton/certs/`, port 9877
3. **Confirmation**: Dangerous shell patterns require client approval (60s timeout)
4. **Forbidden paths**: Agent Server cannot read/write sensitive files
5. **One client**: Only one active connection at a time
6. **Default project delete protection**: `isDefault` projects cannot be deleted

## Client Architecture

```
React 19 + Zustand + WebSocket

App.tsx
├── Connect screen (if not connected)
│   ├── Username/password auth
│   └── Direct IP connection
│
├── Connected workspace
│   ├── Mode toggle: [Chat] [Computer]
│   │
│   ├── Sidebar (Computer mode)
│   │   ├── Project selector dropdown
│   │   ├── + New task button
│   │   ├── Tasks (project-scoped conversation list)
│   │   ├── Memory (instructions + preferences + memories)
│   │   ├── Routines (project-scoped routine list)
│   │   ├── Files (workspace file grid with upload)
│   │   ├── Terminal (PTY in project workspace)
│   │   ├── Connectors (opens settings)
│   │   └── Skills
│   │
│   ├── Views
│   │   ├── HomeView (TaskListView — project-scoped)
│   │   ├── RoutineChat (conversation with AI)
│   │   ├── MemoryView (instructions + preferences + memories)
│   │   ├── RoutinesView (routine list + detail + run logs)
│   │   ├── ProjectFilesView (visual file grid)
│   │   ├── Terminal + FileBrowser (scoped to workspace)
│   │   └── DeveloperView (system prompt viewer)
│   │
│   └── Store (Zustand)
│       ├── projects, activeProjectId
│       ├── conversations (filtered by project)
│       ├── projectInstructions, projectPreferences
│       ├── memories, memoriesLoading
│       ├── projectFiles, projectFilesLoading
│       ├── projectRoutines, projectRoutinesLoading
│       └── sessions, currentSessionId
```

## Package Structure

```
packages/
├── protocol/          # Shared types, message definitions, codec
├── agent-config/      # Project/session persistence, config loading
├── agent-core/        # Session runtime, tools, context, memory
├── agent-server/      # WebSocket server, message routing, PTY
├── desktop/           # Tauri v2 desktop app (React + Zustand)
└── cli/               # Terminal client (Ink TUI)
```

## Key Files

| Purpose | File |
|---------|------|
| Project types | `packages/protocol/src/projects.ts` |
| Message types | `packages/protocol/src/messages.ts` |
| Project CRUD + instructions + preferences | `packages/agent-config/src/projects.ts` |
| Context injection | `packages/agent-config/src/projects.ts` → `buildProjectContext()` |
| Memory tool | `packages/agent-core/src/tools/memory.ts` |
| System prompt assembly | `packages/agent-core/src/session.ts` → `getSystemPrompt()` |
| Server message routing | `packages/agent-server/src/server.ts` |
| Client store | `packages/desktop/src/lib/store.ts` |
| Connection layer | `packages/desktop/src/lib/connection.ts` |
| Memory page | `packages/desktop/src/components/memory/MemoryView.tsx` |
| Files page | `packages/desktop/src/components/files/ProjectFilesView.tsx` |
| Sidebar + project selector | `packages/desktop/src/components/Sidebar.tsx` |
| Task list (project-scoped) | `packages/desktop/src/components/home/TaskListView.tsx` |
