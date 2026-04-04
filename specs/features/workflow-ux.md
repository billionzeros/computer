# Workflow UX & Product Flow

> **Status:** Implemented. Grid, detail page, install modal, sidebar, auto-suggest all working.

## User Flow

```
Sidebar: ⚡ Workflows → Card Grid → Click Card → Detail Page → Install Workflow
→ Modal (connection check) → Create Project & Start Setup → Bootstrap Conversation
→ Workflow Runs on Schedule → Project shows run history + status banner
```

## Sidebar

```
PROJECT
📁 My Computer ▾
+ New task
┄┄┄┄┄┄┄┄┄┄┄┄┄
☑ Tasks
🧠 Memory
🤖 Agents
📄 Files
⌨️  Terminal
🔌 Connectors
🧩 Skills
⚡ Workflows        ← opens workflow grid
```

Title "Workflows" shows in workspace top bar (consistent with Memory, Agents, etc.).

## Grid Page

- Centered content (`max-width: 720px; margin: 0 auto`)
- 2-column grid of workflow cards
- Subtitle: "Automation that runs on your computer"
- Real workflows from registry + placeholder "Coming soon" cards (dimmed, not clickable)

**Card design:** Icon (emoji in rounded box) + Name + Author + Description (2-line clamp) + hover border highlight. Coming soon cards show `· Coming soon` next to author.

## Detail Page

Centered content (`max-width: 640px`). Modeled after Claude Code's project detail page:

1. **← Back** button
2. **Title** (28px, bold)
3. **by author** subtitle
4. **Description** paragraph
5. **Try asking...** section — example prompts with subtle dividers
6. **Agents** section — count badge + pill chips
7. **Scripts** section — count badge + mono pill chips
8. **Connectors** section — count badge + description + pill chips
9. **Install Workflow** button (white bg, dark text)
10. **Installed** badge (green, if already installed)

## Install Modal

Opens when user clicks "Install Workflow". Dark modal overlay.

**Content:**
- Title: "Install {workflow name}"
- Subtitle: "This will create a new project and start an interactive setup."
- **What happens next** box:
  1. A new project is created for this workflow
  2. An AI assistant guides you through setup (~5 min)
  3. The workflow starts running on schedule automatically
- **Connection check** — shows each connector with ✓/✗ status
- **Create Project & Start Setup** button:
  - Normal: white bg, dark text
  - Loading: dimmed bg + spinner + "Setting up..."
  - Missing connectors: shows "Connect missing services in Settings first"
- **Cancel** button

**Flow after clicking "Create Project & Start Setup":**
1. Button shows loading spinner
2. Client sends `project_create` → new project created
3. Client sends `workflow_install` → workflow installed + bootstrap instructions set
4. Store navigates to new project + opens bootstrap conversation
5. User is now in the bootstrap — AI guides them through setup

## Workflow Project (After Install)

Appears in sidebar as a regular project. ProjectLanding shows:

**WorkflowStatusBanner** at top:
- Status indicator (⚡ Active / Paused / Error / Running)
- Schedule info (Runs every 2 hours)
- Last run time + total run count
- Next run time
- **Run Now** button
- **Pause/Resume** button

Below the banner: normal ProjectLanding (chat input, conversations list with run history).

## Auto-Suggest

When user chats about something that matches a workflow's `whenToUse` field, the AI naturally suggests it:

> "Sounds like you want lead qualification! There's a workflow that does exactly this — scores leads, researches prospects, and auto-sends personalized outreach. Check it out in the Workflows section."

This works because `whenToUse` is injected into every session's system prompt as a `<system-reminder>` block.
