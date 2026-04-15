# Project-First Architecture: Everything Lives in a Project

## The Insight

When you work on a real computer, you're always inside a folder. There's no "homeless" state. Your Desktop is the default — you create folders for specific work.

Anton should work the same way:
- You're **always inside a project**
- There's a **default project** (your "Desktop") for quick tasks
- You create **specific projects** for specific work areas
- Every task inherits the project's context automatically
- Projects are the reason Anton is better than Perplexity (which is stateless)

## Why This Wins

| Perplexity | Anton |
|-----------|-------|
| Tasks are stateless | Tasks inherit project context |
| Every task starts from zero | "Scrape @elonmusk" just works because the Twitter Scraper project remembers everything |
| No persistent memory | Project memory grows with every task |
| No files stay | Files live in the project folder |
| No routines | Projects can have routines running 24/7 |

**"Train Anton once, use forever"** — that's the pitch. That's why projects are the hero.

## The Flow

### 1. You're Always in a Project

```
┌─────────────────────┐
│ 🖥 anton             │
│                     │
│ [Chat] [Computer]   │
│                     │
│ + New task          │
│                     │
│ CURRENT PROJECT     │
│ ┌─────────────────┐ │
│ │ 📂 My Computer   │ │  ← default project (always exists)
│ │    ˅             │ │
│ │ 📂 Twitter Scraper│ │  ← user-created projects
│ │ 📂 Sales Pipeline │ │
│ │ 📂 Blog Engine    │ │
│ │ + New project    │ │
│ └─────────────────┘ │
│                     │
│ ☑ Tasks             │  ← tasks for CURRENT project
│ 📁 Files             │  ← files in CURRENT project
│ 🔗 Connectors        │
│ 🧩 Skills            │
│                     │
│ ⚙ Settings          │
└─────────────────────┘
```

### 2. The Default Project: "My Computer"

- Created automatically on first connect
- All quick tasks go here unless you specify a project
- Like your Desktop — the catch-all workspace
- Has its own memory, files, routines (like any project)
- Name options: "My Computer", "Workspace", "Home", "General"

Better name ideas:
- **"Workspace"** — neutral, familiar
- **"Home"** — like ~/home, everyone understands it
- **"My Computer"** — nostalgic, maps to the product name "anton.computer"

### 3. Project Switcher in Sidebar

The sidebar has a project dropdown/selector. Switching projects changes:
- Which tasks you see
- Which files you see
- What context gets injected into new tasks
- Which routines are shown

```
┌─────────────────────────────────┐
│ 📂 Twitter Scraper          ˅  │
│                                 │
│ Tasks (12)  Files (8)  Routines (2)│
└─────────────────────────────────┘
```

### 4. Creating a Task Always Has Project Context

When you type "Start a task" in the input:
- The task is automatically scoped to the current project
- The AI receives the project's instructions, memory, and file context
- No need to re-explain anything

```
Current project: Twitter Scraper

User: "Scrape the latest tweets from @elonmusk"

→ Anton already knows:
  - How to authenticate (from project memory)
  - What format to save results in (from project instructions)
  - Where to put the output (from project files)
  - What tools to use (from project connectors)
```

### 5. Project Structure

Each project has:

```
📂 Twitter Scraper
├── 📝 Instructions    "Scrape Twitter using the Apify connector..."
├── 🧠 Memory          { "auth_token": "...", "last_scrape": "2026-03-31" }
├── 📁 Files           scraped_data/, templates/, config.yaml
├── 🤖 Routines        "Daily scraper" (runs every 6h)
├── ☑ Tasks            all tasks done in this project
└── 🔗 Connectors      Twitter API, Google Sheets (project-specific)
```

### 6. Task List is Project-Scoped

The task list shows tasks for the **current project** by default.

```
Twitter Scraper / Tasks                                    [All projects ˅]

┌──────────────────────────────────────────────────────────────────┐
│ Start a task                                              ⌘K    │
└──────────────────────────────────────────────────────────────────┘

Status      Task                                           Updated
───────────────────────────────────────────────────────────────────
● Working   Scrape @elonmusk latest                        just now
✓ Completed Set up Apify connector                         2h ago
✓ Completed Configure output format                        yesterday
✓ Completed Initial project setup                          3 days
```

You can switch to "All projects" to see everything (like Perplexity's flat list).

### 7. Navigation Between Projects

Quick project switching:
- Dropdown in sidebar (shown above)
- Or: ⌘P to open project switcher (like VS Code's workspace switcher)
- Recent projects shown first

### 8. Cross-Project View

"All projects" view shows the flat task list (like current Perplexity view) with a Project column.
This is for overview/dashboard purposes.

---

## What Changes From Current Design

### Sidebar Redesign

**Before (current):**
```
[Chat] [Computer]
+ New task
Tasks | Projects | Files | Connectors | Skills
```

**After (project-first):**
```
[Chat] [Computer]
+ New task
─────────────────
📂 [Project Selector ˅]
─────────────────
Tasks | Files | Routines
─────────────────
Connectors | Skills | Settings
```

Key change: **Projects move from a nav item to a first-class selector**. You're always "in" a project. Tasks, Files, and Routines are scoped to that project.

### Task Creation

**Before:** Tasks are standalone or optionally linked to a project
**After:** Tasks always belong to a project. Default = "My Computer" (the home project)

### Context Injection

**Before:** Project context injected only for project-scoped sessions
**After:** Every task gets project context because every task has a project

### "My Computer" Default Project

- Auto-created on first `projects_list` request via `ensureDefaultProject()` in `agent-config/projects.ts`
- Marked with `isDefault: true` on the `Project` interface (in `protocol/projects.ts`)
- Cannot be deleted — `deleteProject()` returns `false` for default projects, UI hides delete button
- Gets a workspace at `~/Anton/my-computer/` like any other project
- All tasks go here unless user switches to another project
- `store.setProjects()` auto-selects it when `activeProjectId` is null
- When user creates a task without picking a project, it goes to "My Computer"

---

## Implementation Status

| Step | Description | Status |
|------|-------------|--------|
| 1 | **Create default project on connect** — `ensureDefaultProject()` auto-creates "My Computer" with `isDefault: true` on first `projects_list` request | Done |
| 2 | **Project selector in sidebar** — dropdown showing real projects (default uses Monitor icon, others use FolderOpen) | Done |
| 3 | **Scope task list to current project** — `TaskListView` filters conversations by `activeProjectId` | Done |
| 4 | **Always pass projectId on session creation** — all `sendSessionCreate` calls (Sidebar, TaskListView, RoutineChat, RoutineListView) now pass `activeProjectId` | Done |
| 5 | **Always inject project context** — every task gets project context because every task has a project | Done |
| 6 | **Prevent default project deletion** — `deleteProject()` rejects if `isDefault === true`, UI hides delete button | Done |
| 7 | **Auto-select default project** — `setProjects()` auto-selects default project when `activeProjectId` is null | Done |
| 8 | **Memory page wired to server** — `MemoryView` fetches real data via `config_query` with `projectId`, shows project context + chat memories with scope badges | Done |
| 9 | **Scope files to current project** — file browser by project | Already existed |
| 10 | **"All projects" toggle** — switch between project-scoped and all-projects task list | Not yet |
| 11 | **⌘P project switcher** — quick keyboard shortcut | Not yet |

---

## Why This Is Stronger Than Everyone

1. **Perplexity:** Stateless tasks. No memory. No files. No agents. Every task starts from zero.
2. **Claude:** Chat-only. No execution. No project system. No 24/7.
3. **Cursor:** Code-only. No general tasks. No agents. No connectors.
4. **n8n/Zapier:** Workflow-only. No AI reasoning. No natural language.

**Anton:** Project-scoped AI computer with persistent context, 24/7 agents, real execution, and "train once, use forever" knowledge.

The project system is the moat. Everyone can build a chat interface. No one else has project-scoped persistent AI execution.
