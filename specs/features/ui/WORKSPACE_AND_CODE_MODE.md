# Workspace, Code Mode & Project Elevation Spec

> Anton should never guess where files go. Every piece of work — code, docs, spreadsheets — lives in a predictable, user-visible directory. Anton auto-detects when work should become a project and nudges the user accordingly.

## Problem

1. **Environment restrictions** — The shell tool defaults to `$HOME` as cwd. Conversation workspaces live in `~/.anton/conversations/{id}/workspace/` — hidden, ephemeral, and not user-accessible. This causes npm install failures, missing PATH, and "environment restriction" errors.
2. **No code-aware UI** — The right panel renders artifacts generically. There's no file tree, no terminal output stream, no IDE-like experience for coding tasks.
3. **Chat vs Project confusion** — Extensive coding tasks start in chat and stay in chat. Files get created in hidden dirs. Users can't find them later. Anton doesn't nudge toward Projects.
4. **Artifact sprawl** — Code files, markdown, excel, docs all land in the same flat artifact panel with no structure or organization.
5. **No predictable workspace** — Every conversation creates files in different hidden locations. There's no single canonical place where "Anton's projects" live.

## Design

### 1. The Anton Workspace Root

A single, user-visible directory where all Anton-created projects live:

```
~/Anton/                              # Default workspace root (configurable)
├── my-node-api/                      # Code project (from "set up a Node API")
│   ├── src/
│   ├── package.json
│   └── .anton.json                   # Links back to Anton project ID
├── quarterly-report/                 # Doc project (from "create Q1 report")
│   ├── report.docx
│   ├── data.xlsx
│   └── .anton.json
├── cloned-repo/                      # Git clone (from "git clone X")
│   ├── ... (repo contents)
│   └── .anton.json
└── misc/                             # Catch-all for one-off files
    ├── notes-2026-03-26.md
    └── .anton.json
```

**Configuration** (in `~/.anton/config.yaml`):
```yaml
workspace:
  root: ~/Anton                       # User-configurable, default ~/Anton
  misc: ~/Anton/misc                  # One-off files that don't belong to a project
```

**Rules:**
- `~/Anton/` is created on first project or first file creation
- Every subdirectory that Anton manages gets a `.anton.json` linking it to a project ID
- The user can open `~/Anton/` in Finder/Explorer/their IDE at any time
- Anton never creates files outside `~/Anton/` unless explicitly told to (e.g., "save to ~/Downloads")

### 2. `.anton.json` — The Project Link File

Every Anton-managed directory contains this small file:

```json
{
  "projectId": "proj_abc123",
  "name": "My Node API",
  "createdAt": "2026-03-26T10:00:00Z",
  "type": "code",
  "source": "prompt",
  "conversationId": "conv_xyz789"
}
```

| Field | Purpose |
|-------|---------|
| `projectId` | Links to `~/.anton/projects/{id}/project.json` |
| `name` | Human-readable name |
| `type` | `code`, `document`, `data`, `mixed`, `clone` |
| `source` | How it was created: `prompt`, `git-clone`, `import`, `manual` |
| `conversationId` | The conversation/session that created this project |

**Why:** This is the bridge between the user's filesystem and Anton's internal project tracking. If a user opens `~/Anton/my-node-api/` in VS Code, they can see `.anton.json` and know Anton manages it. If Anton sees `.anton.json` in a directory, it knows it owns that workspace.

### 3. Project Types and Directory Conventions

Anton recognizes different project types and organizes them accordingly:

#### Code Projects (`type: "code"`)
```
~/Anton/my-node-api/
├── .anton.json
├── src/                    # Source code
├── tests/                  # Test files
├── package.json            # Or equivalent manifest
├── ...                     # Standard project files
└── .anton/                 # Anton-specific project metadata (hidden)
    ├── notes.md            # Project notes
    └── history.jsonl       # Session summaries
```

- Shell cwd is set to this directory
- npm/pip/cargo commands run here
- Git init happens here
- Full PATH inherited from user's shell

#### Document Projects (`type: "document"`)
```
~/Anton/quarterly-report/
├── .anton.json
├── report.docx
├── supporting-data.xlsx
├── charts/
│   ├── revenue.svg
│   └── growth.png
└── drafts/
    └── report-v1.docx
```

- Artifacts saved as real files here
- Multiple file types coexist (docx, xlsx, md, svg)
- No terminal/build system needed

#### Data Projects (`type: "data"`)
```
~/Anton/sales-analysis/
├── .anton.json
├── data/
│   ├── raw.csv
│   └── cleaned.xlsx
├── analysis.xlsx
└── summary.md
```

#### Clone Projects (`type: "clone"`)
```
~/Anton/some-repo/
├── .anton.json             # Added after clone
├── ... (repo contents)
```

- Created via `git clone` into `~/Anton/`
- `.anton.json` added post-clone (not committed)
- Added to `.gitignore` automatically

#### Mixed Projects (`type: "mixed"`)
For projects that combine code with docs/data:
```
~/Anton/my-saas-app/
├── .anton.json
├── src/                    # Code
├── docs/                   # Documentation (MD files)
├── assets/                 # Images, SVGs
└── data/                   # Data files, spreadsheets
```

### 4. Project Auto-Detection & Nudging

Anton should detect when a task should become a project and nudge the user **before** creating files.

#### Detection Signals

| Signal | Confidence | Example |
|--------|-----------|---------|
| "set up a project" / "create an app" | High | "Help me set up a React app" |
| "git clone" | High | "Clone this repo and fix the bug" |
| Multiple file creation | Medium | Creating 3+ files in one task |
| Package manager commands | Medium | "Install express and typescript" |
| "create a report" / "make a presentation" | Medium | "Create a quarterly report with charts" |
| Build/compile commands | Medium | "Set up webpack" |
| Single code snippet | Low | "Write a function that sorts arrays" |
| Explanation / Q&A | None | "What does async/await do?" |

#### The Nudge Flow

When Anton detects a project-worthy task in chat:

```
User: "Help me build a REST API with Express and TypeScript"

Anton: "This sounds like a proper project — multiple files,
dependencies, build config. I'll create a project for it so
you get a real file structure, terminal access, and can come
back to it later.

  Project: my-express-api
  Location: ~/Anton/my-express-api/
  Type: Code (Node.js)

  [Create Project]  [Stay in Chat]"
```

**If user picks "Create Project":**
1. Create `~/Anton/my-express-api/` with `.anton.json`
2. Create internal project in `~/.anton/projects/{id}/`
3. Link the current conversation to this project
4. Switch the right panel to Code Mode (file tree + terminal)
5. Set shell cwd to `~/Anton/my-express-api/`
6. Proceed with the task

**If user picks "Stay in Chat":**
1. Use `~/Anton/misc/` as working directory
2. Files still go to a real, findable location
3. No Code Mode UI, just regular artifacts
4. Anton mentions: "Files will be at ~/Anton/misc/ if you need them later"

#### Git Clone Flow

```
User: "git clone https://github.com/user/repo"

Anton: "I'll clone this into your Anton workspace and create
a project for it.

  Project: repo
  Location: ~/Anton/repo/

  [Clone & Create Project]  [Just Clone]"
```

- "Clone & Create Project" → full project with sessions, context, Code Mode
- "Just Clone" → clones to `~/Anton/repo/` with minimal `.anton.json`, stays in chat

### 5. Code Mode UI

When a project of type `code` or `clone` is active, the right panel transforms into a code workspace.

#### Layout (inspired by Replit's progressive disclosure + Lovable's simplicity)

```
┌────────────────────────┬─────────────────────────────────┐
│                        │  [Files] [Terminal] [Preview]   │
│   Chat / Messages      │  ┌─────────────────────────────┐│
│                        │  │ File Tree        [collapse]  ││
│   Anton: Setting up    │  │ ▼ src/                       ││
│   your Express API...  │  │   ├── index.ts  ●            ││
│                        │  │   ├── routes/                ││
│   [Task Progress]      │  │   │   └── api.ts             ││
│   ✓ Scaffold project   │  │   └── middleware/            ││
│   ● Install deps       │  │ ▶ tests/                    ││
│   ○ Configure TS       │  │   package.json               ││
│   ○ Create routes      │  │   tsconfig.json              ││
│   ○ Add tests          │  ├─────────────────────────────┤│
│                        │  │ // src/index.ts              ││
│   $ npm install        │  │ import express from 'express'││
│   added 45 packages    │  │ import { router } from './ro ││
│                        │  │ utes/api'                    ││
│   Creating src/index.ts│  │                              ││
│                        │  │ const app = express()        ││
│                        │  │ app.use('/api', router)      ││
│                        │  ├─────────────────────────────┤│
│                        │  │ Terminal                     ││
│                        │  │ $ npm install                ││
│                        │  │ added 45 packages in 3.2s   ││
│                        │  │ $                            ││
│  [message input]       │  └─────────────────────────────┘│
└────────────────────────┴─────────────────────────────────┘
```

#### Tabs

| Tab | Content | When Shown |
|-----|---------|-----------|
| **Files** | File tree + file viewer (default) | Always in code mode |
| **Terminal** | Live terminal output from shell commands | Always in code mode |
| **Preview** | Live preview iframe (for web projects) | When a dev server is running |

#### File Tree Behavior

- Rooted at the project's workspace directory (`~/Anton/{project}/`)
- Updates live as Anton creates/modifies files
- Click a file → opens in the file viewer panel below the tree
- Modified files show a dot indicator (●)
- Files currently being written by Anton show a spinner
- Collapse/expand directories

#### File Viewer

- Syntax-highlighted code display (reuse existing artifact code renderer)
- Tab bar for multiple open files
- Read-only by default (Anton writes, user reads)
- Future: editable with changes feeding back to Anton

#### Terminal Panel

- Shows live stdout/stderr from Anton's shell commands
- Not a full interactive terminal (that's in Terminal mode)
- Shows command being run, output, exit code
- Errors highlighted in red
- Scrollable history within the session
- Clear distinction between Anton's commands and output

#### How It Activates

Code Mode activates automatically when:
1. A project of type `code` or `clone` is opened/created
2. The first shell command or file write happens in a code project

Code Mode deactivates when:
1. User switches to a different conversation
2. User explicitly closes the right panel

### 6. Shell Environment Fix

The core environment restriction problem needs fixing regardless of UI:

#### Current Problem
```typescript
// shell.ts — current
cwd: working_directory || process.env.HOME
// Agent defaults to $HOME, not the project workspace
```

#### Fix
```typescript
// shell.ts — proposed
cwd: working_directory || projectWorkspace || conversationWorkspace || process.env.HOME
```

Where:
- `projectWorkspace` = `~/Anton/{project-name}/` (from .anton.json link)
- `conversationWorkspace` = fallback to `~/.anton/conversations/{id}/workspace/`

#### Shell Initialization
```typescript
// Inherit user's full shell environment
const shell = process.env.SHELL || '/bin/zsh'
const env = {
  ...process.env,
  // Ensure PATH includes common tool locations
  PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`,
  // Set HOME so ~ resolves correctly
  HOME: process.env.HOME,
  // Project-specific
  ANTON_PROJECT: projectName,
  ANTON_WORKSPACE: projectWorkspace,
}
```

#### Streaming Shell Output

Currently the shell tool waits for completion and returns the full output. For Code Mode, we need streaming:

```typescript
// New: stream shell output via EVENTS channel
interface ShellOutputEvent {
  type: 'shell_output'
  sessionId: string
  command: string
  stream: 'stdout' | 'stderr'
  data: string
  done: boolean
  exitCode?: number
}
```

The frontend subscribes to these events and renders them in the Terminal panel in real-time.

### 7. Artifact Organization Within Projects

Different artifact types get saved to appropriate locations within the project:

#### Routing Rules

| Artifact Type | Location | Example |
|--------------|----------|---------|
| Source code | Project root (standard structure) | `src/index.ts` |
| Markdown / docs | `docs/` or project root | `docs/API.md` or `README.md` |
| Excel / spreadsheets | `data/` or project root | `data/analysis.xlsx` |
| Word / documents | Project root or `docs/` | `report.docx` |
| SVG / images | `assets/` | `assets/logo.svg` |
| Mermaid diagrams | `docs/diagrams/` | `docs/diagrams/architecture.md` |
| HTML previews | `public/` or temp | `public/index.html` |
| Config files | Project root | `.eslintrc.json`, `tsconfig.json` |

#### System Prompt Guidance

Anton's system prompt includes routing instructions based on project type:

```
When working in a code project, follow these file conventions:
- Source code → src/ (or language convention)
- Tests → tests/ or __tests__/
- Config → project root
- Documentation → docs/ or README.md at root
- Assets (images, SVG) → assets/
- Data files → data/

When working in a document project:
- Primary document → project root
- Supporting data → data/
- Charts and images → charts/ or assets/
- Drafts → drafts/

When working in a mixed project:
- Code → src/
- Docs → docs/
- Data → data/
- Assets → assets/
```

### 8. Project Registry & Conversation Linking

#### Updated Project Structure

```
~/.anton/projects/{projectId}/
├── project.json              # Metadata (updated with workspacePath)
├── context/
│   ├── notes.md
│   └── session-history.jsonl
├── conversations/            # Project-scoped sessions
│   └── {convId}/
│       └── ...
└── (no more files/ directory — files live in ~/Anton/{name}/)
```

#### Updated `project.json`

```json
{
  "id": "proj_abc123",
  "name": "My Node API",
  "description": "Express + TypeScript REST API",
  "icon": "code",
  "color": "#6366f1",
  "type": "code",
  "workspacePath": "~/Anton/my-node-api",
  "source": "prompt",
  "sourceConversationId": "conv_xyz789",
  "createdAt": 1711440000000,
  "updatedAt": 1711440000000,
  "context": {
    "summary": "Express API with TypeScript, JWT auth, PostgreSQL",
    "notes": "",
    "stack": ["node", "typescript", "express", "postgresql"]
  },
  "stats": {
    "sessionCount": 3,
    "activeJobs": 0,
    "lastActive": 1711440000000
  }
}
```

New fields:
- `type` — project classification
- `workspacePath` — absolute path to `~/Anton/{name}/`
- `source` — how the project was created
- `sourceConversationId` — the conversation that triggered creation
- `context.stack` — detected tech stack (for code projects)

### 9. Examples for Anton's System Prompt

These examples teach Anton when and how to create projects:

```markdown
## Project Creation Guidelines

You have access to a workspace at ~/Anton/ where all user projects live.
When a user asks you to do something that involves multiple files,
dependencies, or ongoing work, create a project.

### When to Create a Project

CREATE a project when:
- User asks to "build", "set up", "create", "scaffold" an app or service
- User says "git clone" — clone into ~/Anton/{repo-name}/
- User asks to create a report, presentation, or multi-file document
- The task will produce 3+ files
- The task involves installing dependencies (npm, pip, cargo, etc.)
- The task involves a build system or dev server

STAY IN CHAT when:
- User asks a question or wants an explanation
- User wants a single code snippet or function
- User wants to edit a single existing file
- User explicitly says "don't create a project" or "just in chat"

### How to Create a Project

1. Detect the task type (code, document, data, clone, mixed)
2. Suggest a project name (kebab-case, descriptive)
3. Show the user what you'll create and where
4. Wait for confirmation via [Create Project] / [Stay in Chat]
5. On confirmation:
   a. Create ~/Anton/{name}/ directory
   b. Write .anton.json with project metadata
   c. Call project_create tool to register internally
   d. Set shell working directory to ~/Anton/{name}/
   e. Proceed with the task

### File Organization Examples

#### Example: "Build me a React dashboard"
Type: code
```
~/Anton/react-dashboard/
├── .anton.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   └── Chart.tsx
│   └── lib/
│       └── api.ts
└── public/
    └── index.html
```

#### Example: "Create a Q1 sales report with data"
Type: mixed
```
~/Anton/q1-sales-report/
├── .anton.json
├── report.docx
├── data/
│   ├── sales-raw.xlsx
│   └── sales-cleaned.xlsx
├── charts/
│   ├── revenue-by-region.svg
│   └── monthly-trend.svg
└── summary.md
```

#### Example: "git clone https://github.com/user/cool-lib"
Type: clone
```
~/Anton/cool-lib/
├── .anton.json          (added by Anton, gitignored)
├── ... (repo contents)
```

#### Example: "Write me a Python script to process CSV files"
Type: code (small)
```
~/Anton/csv-processor/
├── .anton.json
├── process.py
├── requirements.txt
└── data/
    └── (user's CSV files go here)
```

#### Example: "Create meeting notes from this transcript"
→ STAY IN CHAT (single file, no project needed)
→ If user wants it saved: ~/Anton/misc/meeting-notes-2026-03-26.md
```

### 10. Migration & Backward Compatibility

#### Existing Projects
- Existing `~/.anton/projects/` data stays as-is
- Projects created before this change have no `workspacePath`
- On next open, Anton offers: "This project doesn't have a workspace yet. Create one at ~/Anton/{name}/?"

#### Existing Conversations
- Chat conversations continue to work as before
- Files created in old conversations remain in `~/.anton/conversations/{id}/workspace/`
- No auto-migration of old files

#### Config Migration
- On first startup after update, add `workspace.root: ~/Anton` to config.yaml
- Create `~/Anton/` directory
- Show user a one-time notice: "Anton now saves projects to ~/Anton/. You can change this in settings."

## Implementation Phases

### Phase 1: Workspace Root & Shell Fix
- Add `workspace.root` config
- Fix shell tool to use project workspace as cwd
- Inherit full user PATH in shell
- Create `~/Anton/` on first use
- Add `.anton.json` to new projects

### Phase 2: Project Auto-Detection & Nudging
- Add detection logic to agent system prompt
- Implement the nudge UI (Create Project / Stay in Chat)
- Wire up project creation from chat context
- Link conversations to projects

### Phase 3: Code Mode UI
- File tree component (reuse FileBrowser, point at project workspace)
- File viewer with syntax highlighting and tabs
- Terminal output panel (streaming shell events)
- Tab switching (Files / Terminal / Preview)
- Auto-activate on code project open

### Phase 4: Shell Streaming
- Add `shell_output` event type to protocol
- Stream stdout/stderr via EVENTS channel
- Frontend renders live in Terminal tab
- Show command, output, exit code, errors

### Phase 5: Document & Data Project Support
- Artifact routing rules by project type
- Document preview (docx, xlsx in right panel)
- Mixed project support
- `~/Anton/misc/` for one-off files
