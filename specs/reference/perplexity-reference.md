# Perplexity Computer UI Reference Guide

All design patterns observed from user's Perplexity screenshots, organized by component.

---

## 1. Sidebar Navigation

```
┌─────────────────────┐
│ ⚡ Search            │  ← mode switcher (pill buttons, rounded)
│ 🖥 Computer          │
│                     │
│ + New task          │  ← always visible
│                     │
│ ☑ Tasks             │  ← nav items with icons
│ 📁 Files             │
│ 🔗 Connectors        │
│ 🧩 Skills            │
│ 📖 Use cases         │
│                     │
│ ─────────────────── │
│ 👤 username         │
│ ⚡ Perplexity AI     │
└─────────────────────┘
```

**Details:**
- Mode switcher at very top (Search / Computer) — rounded pill buttons
- Nav items are full-width buttons with icon + label
- Active item has subtle highlight background
- User profile at bottom left
- Clean, minimal — no conversation history in sidebar

---

## 2. Task List (Main View)

```
Tasks                                                    [🔍 filter]

┌──────────────────────────────────────────────────────────────────┐
│ Start a task                                              ⌘K    │
└──────────────────────────────────────────────────────────────────┘

Status      Task                                    Files    Updated
─────────────────────────────────────────────────────────────────────
● Working   Scrape competitor prices                —        just now
✓ Completed AI Influencer Research and Outreach     —        4h ago
✓ Completed Tool for Automated Product Demo Videos  STYLE..  4h ago
✓ Completed Request for Influencer Email Addresses  email..  23h ago
✓ Completed Build Personal Hacker News Clone        Camer..  yesterday
```

**Details:**
- "Start a task" input is CLEAN — just text + ⌘K hint. No model selector, no connector pills, no extras
- Status column: green check circle + "Completed" text, or orange dot + "Working"
- Task column: task title (the first user message text)
- Files column: shows file names if task produced files, "—" otherwise
- Updated column: relative time
- Rows are clickable — navigate to task detail
- Filter icon top-right for searching

---

## 3. Task Detail (Split Pane)

```
← All tasks                   Task Name                 ... 📄4 📊Usage ☑Todo 🔗Share

┌──────────────────────┬────────────────────────────────────────────────┐
│                      │                                                │
│ [Big prompt text     │  User message (right-aligned bubble)           │
│  area showing the    │  "Build me a personal CRM to track..."        │
│  original task       │                                                │
│  description]        │  Agent response text                           │
│                      │  "I have a few questions to make sure..."      │
│ ┌──────────────────┐ │                                                │
│ │ + attach         │ │  [Ask-user card inline]                        │
│ │            [→]   │ │                                                │
│ └──────────────────┘ │  User answer (right-aligned)                   │
│                      │                                                │
│ ─────────────────── │  -< Running tasks in parallel ›                │
│                      │     ├── Reading file1.md ›                     │
│ ● Working            │     └── Reading file2.md ›                     │
│   Personal CRM...    │                                                │
│   5d ago         ... │  Agent text continues...                       │
│                      │                                                │
│                      │  ┌──────────────────────────────────────────┐  │
│                      │  │ Type a command...              + ⚙ [→]  │  │
│                      │  └──────────────────────────────────────────┘  │
└──────────────────────┴────────────────────────────────────────────────┘
```

**Left pane:**
- Original task prompt (big text, the first user message)
- Input for creating new task (with + attachment, send button)
- Below: previous tasks list (compact, with status + title + time + ...)

**Right pane:**
- Full agent work stream (messages, tool calls, results)
- Chat input at BOTTOM of right pane ("Type a command..." with + and send)
- This is where follow-up messages go

**Top bar:**
- "← All tasks" back button (left)
- Task name (center)
- "..." menu, Files badge (📄 4), Usage button, Todo button, Share button (right)

---

## 4. Tool Calls (Inline Actions)

### Single action:
```
📋 Reading skills/website-building/shared/05-taste.md  ›
```
- Icon specific to the action type (not just tool type)
- Descriptive label with file path
- Chevron `›` to expand and see result
- When expanded: shows result content below

### Grouped actions (parallel):
```
-< Running tasks in parallel  ˅                    Mar 26, 11:02 PM · 1s
   │
   ├── 📋 Reading skills/shared/05-taste.md  ›
   │
   ├── 📋 Reading skills/shared/08-standards.md  ›
   │
   └── 📋 Reading webapp/references/sidebar_rules.md  ˅    Mar 26, 11:02 PM · 1s
            skills/website-building/webapp/references/sidebar_rules.md
```

**Details:**
- Parent: branch icon `-<` + "Running tasks in parallel" + collapse chevron
- Children connected with tree branch lines (│ ├── └──)
- Each child has its own icon + label + expand chevron
- Timestamp + duration shown on the right ("Mar 26, 11:02 PM · 1s")
- Collapsed parent: single line with `›`
- Expanded child: shows result content indented below

### Action icons per type:
- `📋` (clipboard) — Reading files
- `☁↑` (cloud upload) — Writing files
- `🔧` (settings) — Setting up / configuring
- `</>`  (code brackets) — Copying/installing dependencies
- `📊` (list) — Creating task list
- `🧩` (puzzle) — Loading skill
- `-<` (branch) — Running in parallel

---

## 5. Todo (Task Checklist)

### Inline in chat (as tool call result):
```
📊 Creating task list for personal CRM build  ˅         Mar 26, 11:03 PM · 1s

   Personal CRM Web App

   ○  Set up project from webapp template and install dependencies
   ○  Design data schema (contacts, interactions, tags)
   ○  Build backend API routes
   ○  Build frontend: sidebar, contacts list, contact detail, add/edit forms
   ○  Style with light theme, replace red placeholders in index.css
   +2 more
```

### With progress (later in stream):
```
📊 Setting up the project  ˅

   Personal CRM Web App

   ✓  Set up project from webapp template and install dependencies
   ✓  Design data schema (contacts, interactions, tags)
   ✓  Build backend API routes
   ◎  Build frontend: sidebar, contacts list, contact detail, add/edit forms
   ◎  Style with light theme, replace red placeholders in index.css
   ○  Start dev server and run Playwright QA
   ○  Deploy and share
```

### Top bar dropdown:
```
                                    ┌──────────────────────────────┐
[... 📄4 📊Usage ☑Todo 🔗Share]  →  │ Personal CRM Web App         │
                                    │                              │
                                    │ ✓ Set up project...          │
                                    │ ✓ Design data schema...      │
                                    │ ✓ Build backend API routes   │
                                    │ ◎ Build frontend...          │
                                    │ ◎ Style with light theme...  │
                                    │ ○ Start dev server...        │
                                    │ ○ Deploy and share           │
                                    └──────────────────────────────┘
```

**States:**
- `○` — pending (empty circle)
- `◎` — in progress (circle with dot, or spinner animation)
- `✓` — completed (checkmark, slightly faded/strikethrough text)

**Details:**
- "+N more" to truncate when >5 items
- Title shown above checklist ("Personal CRM Web App")
- Inline version is expandable like any tool call
- Top bar version is a popover dropdown from the Todo button

---

## 6. File Artifacts (Inline)

```
☁↑ Writing to personal-crm/shared/schema.ts  ˅         Mar 26, 11:04 PM · 6s

   ┌──────────────────────┐
   │ 📄 schema.ts          │
   │    TypeScript         │
   └──────────────────────┘
```

**Details:**
- Shows as expanded tool call result
- File card: icon (language-specific: TS icon for TypeScript, CSS icon for CSS, etc.)
- File name bold, file type below in muted text
- Card has subtle border, rounded corners
- Each file write gets its own card

---

## 7. Ask-User (Inline Card)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Let me nail down the details for your personal CRM                  │
│                                                                     │
│ ❶  What kind of contacts do you want to track?                      │
│    [Professional network] [Personal contacts] [Clients & customers] │
│    [Community & events] [Other]                                     │
│                                                                     │
│ ❷  How should follow-up reminders work?                             │
│    [Visual indicators] [Category-based cadence]                     │
│    [Both combined (Recommended)] [Other]                            │
│                                                                     │
│ ❸  What interaction details do you want to log for each contact?    │
│    [Date & channel] [Notes & context] [Tags & categories]           │
│    [Relationship strength] [Other]                                  │
│                                                                     │
│ ❹  Any design or tech preferences?                                  │
│    [Dark mode, minimal] [Light & professional]                      │
│    [Dark with accent colors] [Other]                                │
└─────────────────────────────────────────────────────────────────────┘
```

**After answering, user message shows:**
```
┌─────────────────────────────────────────────────────┐
│ What kind of contacts do you want to track?:        │
│   Personal contacts                                 │
│ How should follow-up reminders work?:               │
│   Visual indicators                                 │
│ What interaction details...?:                       │
│   Tags & categories                                 │
│ Any design or tech preferences?:                    │
│   Light & professional                              │
└─────────────────────────────────────────────────────┘
```

**Details:**
- Inline card in chat (NOT a modal dialog)
- Numbered questions with badge (❶ ❷ ❸ ❹)
- Options as pill buttons with border, rounded
- "Other" always included
- "(Recommended)" label on suggested option
- Card has border, subtle background, rounded corners
- After selection: user response rendered as a regular user message with Q&A pairs

---

## 8. Connectors Page (Full Page)

```
                    Connectors                     🔍 Search all connectors

Connect your apps and services so Computer can access and act on your data.

[All] [Connected] [Available]                    All categories ˅  + Custom connector

┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 📧 Gmail      │ │ 📋 Linear     │ │ 💬 Slack      │ │ 📁 Google     │
│ Calendar ✓   │ │              ✓│ │           ✓  │ │    Drive      │
│ omgupta@...  │ │ Plan and track│ │ omgupta@...  │ │ Get in-depth  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 📁 OneDrive   │ │ 📄 Sharepoint │ │ 📝 Notion     │ │ 📋 Asana      │
│ Get in-depth │ │ Get in-depth │ │ Search and   │ │ Manage tasks │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Connector detail modal:**
```
┌──────────────────────────────────────────────────────────┐
│ 📁 Google Drive                         [Add connector]  │
│ Get in-depth answers from your Google Drive content       │
│                                                          │
│ Features                                                 │
│ ┌────────────────────────────────────────────────────┐   │
│ │ 🔍 Standard Search                            ✓   │   │
│ │ Search your entire drive. Files retrieved at       │   │
│ │ query time.                                        │   │
│ ├────────────────────────────────────────────────────┤   │
│ │ 🎯 High-Precision Search                      🔒  │   │
│ │ Select up to 5,000 files to catalog and sync.      │   │
│ │ Available with Enterprise Pro and Max.             │   │
│ │                         [See plans]                │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ Overview                                                 │
│ • Attach files from Google Drive to your query           │
│                                                          │
│ Links                    Developed by                    │
│ 🔗 Website               Google                         │
│ 🔗 Support                                              │
└──────────────────────────────────────────────────────────┘
```

**Details:**
- FULL PAGE view (not settings modal tab)
- Search bar at top
- Tabs: All / Connected / Available
- Category filter dropdown + "Custom connector" button
- Grid of connector cards (4-column)
- Each card: icon, name, description, checkmark if connected
- Click card → detail modal with features, overview, links
- "Add connector" button in detail modal

---

## Design Constants

- **Colors:** Dark background (#1a1a1a-ish), muted text for labels, white for primary text
- **Typography:** Sans-serif UI, monospace for file paths/code
- **Icons:** Consistent 15-16px, strokeWidth 1.5
- **Borders:** Subtle rgba borders (0.07-0.12 opacity)
- **Radius:** 8-12px for cards, 6px for pills/buttons
- **Spacing:** Generous padding, clean visual hierarchy
- **Animations:** Smooth expand/collapse, no jarring transitions
