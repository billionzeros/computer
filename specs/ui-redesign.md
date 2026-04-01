# UI Redesign: From Chat Wrapper to Living Computer

## The Problem
Anton feels like Claude with extra steps. The chat-first layout makes it indistinguishable from every AI chatbot. But the actual product is far more powerful — it executes, runs 24/7, remembers, and works autonomously. The UI doesn't communicate any of this.

## The Constraint
We still want users to **type and go**. No passive dashboard they stare at. The input should always be front and center. But everything *around* that input should scream: "this is not a chatbot."

## The Design Principle
**Chat is the input method, not the identity.**

Think of it like Spotlight on Mac — the text input is central, but you're clearly interacting with your *computer*, not a chat app. The context around the input tells you what your computer is doing.

---

## The New Home: "Living Home"

When you open Anton, you see one screen that combines three things:
1. **What Anton is doing** (alive indicators)
2. **What you can do** (input + suggestions)
3. **What Anton has done** (recent results)

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  anton                                          [⚙] [≡]     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ ⚡ 2 agents working · Last active 3 min ago         │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│                                                              │
│            ┌───────────────────────────────────┐             │
│            │                                   │             │
│            │  What should I work on?           │             │
│            │                                   │             │
│            │                              [⏎]  │             │
│            └───────────────────────────────────┘             │
│                                                              │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│   │ Scrape       │ │ Deploy my    │ │ Write a      │        │
│   │ competitors  │ │ latest code  │ │ blog post    │        │
│   └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
│   ─────────────────────────────────────────────              │
│                                                              │
│   Recent work                                                │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐    │
│   │ 🟢 Competitor Monitor          completed · 3h ago   │    │
│   │    Checked 12 sites. No price changes found.        │    │
│   ├─────────────────────────────────────────────────────┤    │
│   │ 🟢 Blog Deployer               completed · 11pm    │    │
│   │    Published "Why We Built Anton" to blog.          │    │
│   ├─────────────────────────────────────────────────────┤    │
│   │ 💬 "Fix the login redirect"     you · yesterday     │    │
│   │    Fixed redirect loop in auth middleware.           │    │
│   └─────────────────────────────────────────────────────┘    │
│                                                              │
│   ┌──────────────────────┐                                   │
│   │ ⚡ Agents (2 active)  │                                   │
│   │                      │                                   │
│   │ 🟢 Competitor Mon.   │   ← click opens agent detail     │
│   │    Next run: 6:00pm  │                                   │
│   │                      │                                   │
│   │ 🟢 Blog Deployer     │                                   │
│   │    Next run: tomorrow│                                   │
│   │                      │                                   │
│   │ [+ New Agent]        │                                   │
│   └──────────────────────┘                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

**The input is always visible and central.**
- Big, prominent input — not a sidebar chat input
- Placeholder: "What should I work on?" (not "Send a message" — that's chat language)
- Typing immediately transitions into full chat view (like Spotlight → full app)
- Feels like commanding your computer, not starting a conversation

**The status strip is subtle but alive.**
- One line at the top: "⚡ 2 agents working · Last active 3 min ago"
- Not server stats. Not CPU/RAM. Just: "Anton is alive and busy"
- Non-technical users understand "2 agents working"
- Technical users can click through to see details

**Suggestion chips are contextual, not generic.**
- Based on user's role (from onboarding), installed connectors, and recent work
- Not "How can I help you?" energy. More "Here's what you usually do" energy
- Clicking a chip fills the input and starts a chat

**Recent work is a unified feed — agents AND conversations.**
- Agent runs and user chats are interleaved chronologically
- Each entry: icon + name + result summary + timestamp
- Agent results show as "completed" cards (not chat bubbles)
- User conversations show as "you asked" entries
- Clicking any entry opens the full chat/agent detail
- This is the "Anton has been busy" proof that no chatbot shows

**Agents section is always visible on home.**
- Shows active agents with next run time
- "+ New Agent" button is prominent
- This is what makes Anton unique — show it on the home screen
- Non-technical: "agents working for you"
- Technical: quick access to cron-scheduled work

---

## Navigation Restructure

### Current (Chat-First)
```
Sidebar: [New Chat] [Chat History] [Projects] [Terminal] [Settings]
```

### New (Work-First)
```
Sidebar:
  [Home]                      ← the living home above

  Agents                      ← promoted to top-level
    🟢 Competitor Monitor
    🟢 Blog Deployer
    [+ New Agent]

  Projects                    ← stays
    Blog
    Sales Dashboard

  ─────────

  Recent Chats                ← demoted but still accessible
    Fix the login bug
    Deploy landing page
    ...

  ─────────

  [Terminal]
  [Connectors]
  [Settings]
```

### Why This Order
1. **Home** — what's happening now
2. **Agents** — what's working for you 24/7 (the differentiator)
3. **Projects** — organized workspaces
4. **Recent Chats** — ad-hoc conversations (still easy to access)
5. **Utilities** — terminal, connectors, settings

Chat history moves down because it's the thing that makes Anton look like Claude. It still exists, still works the same way, but it's not the first thing you see.

---

## The Chat View: Enhanced, Not Replaced

When user types in the home input, they transition to chat. Chat itself gets upgrades:

### 1. Tool Results Get Custom Renderers

**Before (current):**
```
▶ shell: apt install nginx     [expand]
  Exit code: 0
  stdout: Reading package lists... Done...
```

**After:**
```
┌─────────────────────────────────────────┐
│ $ apt install nginx                  ✓  │
│ ─────────────────────────────────────── │
│ Reading package lists... Done           │
│ Setting up nginx (1.24.0) ...           │
│ nginx is running on port 80             │
│                                   3.2s  │
└─────────────────────────────────────────┘
```

Tool-specific renderers:
- **Shell** → terminal-style card with command, output, exit code, duration
- **Filesystem** → file card with name, size, preview snippet
- **Browser** → screenshot thumbnail + URL + action taken
- **Git** → commit card with hash, message, files changed
- **Database** → table preview of query results
- **Memory** → key-value display
- **Publish** → live link card with preview

### 2. Agent Results in Chat Are Special

When viewing an agent's chat history, results from automated runs look different:

```
┌─────────────────────────────────────────────┐
│ ⚡ Automated run · Mar 31, 3:00 AM          │
│                                             │
│ Checked 12 competitor sites.                │
│ Found 1 price change:                       │
│   Acme Corp: Widget Pro $49 → $39 (-20%)   │
│                                             │
│ No action taken (threshold: >25%).          │
│                                         12s │
└─────────────────────────────────────────────┘
```

Not chat bubbles. **Result cards.** This visually separates "Anton worked autonomously" from "you had a conversation."

### 3. Turn Summary Bar

After each assistant turn, instead of just token count:

```
──── Completed in 8.3s · 4 tools used · 1,200 tokens ────
```

Shows Anton as a worker, not a talker.

---

## The Agent Detail View

Clicking an agent from sidebar or home opens a dedicated view:

```
┌──────────────────────────────────────────────────────────┐
│  ← Back                                                  │
│                                                          │
│  Competitor Monitor                          [Edit] [⏸]  │
│  Runs every 6 hours · Next: 6:00 PM                     │
│                                                          │
│  ─────────────────────────────────────────────           │
│                                                          │
│  Run History                                             │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🟢 Mar 31, 3:00 PM    12s    No changes           │  │
│  │ 🟢 Mar 31, 9:00 AM    14s    1 price change       │  │
│  │ 🟢 Mar 30, 3:00 PM    11s    No changes           │  │
│  │ 🔴 Mar 30, 9:00 AM    45s    Timeout on acme.com  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  [Run Now]   [View Logs]   [Chat with Agent]             │
│                                                          │
│  ─────────────────────────────────────────────           │
│                                                          │
│  Agent Memory                                            │
│  Last known prices: { "acme": "$39", "beta": "$59" }    │
│                                                          │
│  Instructions                                            │
│  "Check competitor pricing on these 12 sites..."         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

This view makes agents feel like **real workers** you manage, not chat threads. You see their schedule, history, success rate, memory, and can interact.

---

## Onboarding Redesign

### Current: 5 slides of text explaining features
### New: Watch Anton work

**Step 1: Connect**
- Same as now (enter host + token)

**Step 2: "Let's set up your workspace" (live)**
- Anton runs commands on the server in real-time
- User watches: creating ~/Anton/, checking system, installing dependencies
- Shows the terminal output styled as the new tool result cards
- "Your computer: Ubuntu 22.04 · 2 CPU · 4GB RAM · 40GB disk"
- This is the "holy shit it's a real computer" moment

**Step 3: "What do you do?"**
- Same role selection (Founder, Marketing, Developer, etc.)
- But instead of explaining features, it says: "Here are agents that work for people like you"

**Step 4: "Pick a starter agent"**
- Shows 3-4 role-specific agent templates:
  - Founder: "Monitor my competitors" / "Daily news briefing"
  - Marketing: "Track social mentions" / "Generate weekly report"
  - Developer: "Monitor server health" / "Auto-deploy on push"
- User picks one, Anton creates and runs it immediately
- User sees the result card appear on the home screen

**Step 5: "Add your AI provider"**
- Same model setup
- But now the user has already seen Anton execute something
- The value is proven, not promised

Total onboarding time: ~2 minutes. But the user has already watched Anton DO something.

---

## Language & Copy Changes

### Kill Chat Language

| Current (chatbot vibe) | New (computer vibe) |
|------------------------|---------------------|
| "Send a message" | "What should I work on?" |
| "New Chat" | "New Task" (or keep but deprioritize) |
| "Conversations" | "Recent Work" |
| "Assistant" | "Anton" |
| "Chat History" | "History" |
| "Message" | "Task" or "Request" |

### Add Computer Language

- "Anton is working..." (not "Generating response...")
- "Completed in 8.3s" (not "Done")
- "2 agents active" (not hidden)
- "Next run: 6:00 PM" (makes 24/7 tangible)
- "Your computer" (in settings, connection screen)

Small copy changes have outsized impact on perceived identity.

---

## Progressive Disclosure for Both Audiences

### Non-technical users see:
- "2 agents working for you"
- Result cards with plain English summaries
- Suggestion chips based on their role
- "Monitor competitors" (not "cron job running scraper.yaml")

### Technical users can access:
- Click agent → see cron expression, raw logs, token usage
- Terminal always available in sidebar
- Tool results expandable to see full stdout/stderr
- Dev mode toggle shows system prompt, memories, raw messages

### The rule:
**Surface = outcome-focused (what happened)**
**One click deeper = technical detail (how it happened)**

---

## Summary: What Changes

| Area | Before | After |
|------|--------|-------|
| Home screen | Chat input + history | Living home: status + input + feed + agents |
| Navigation | Chat-first sidebar | Work-first: Home → Agents → Projects → Chats |
| Tool results | Generic expandable blocks | Custom renderers per tool type |
| Agent results | Chat bubbles | Result cards (visually distinct) |
| Onboarding | 5 text slides | Watch Anton execute + pick starter agent |
| Copy/language | "Send message", "Conversation" | "Work on", "Recent work", "Agent" |
| Identity | "Another AI chat" | "My AI computer that works 24/7" |

## What Stays The Same

- Chat still works exactly as before (just accessed differently)
- All existing features preserved
- Same protocol, same architecture
- Terminal, projects, connectors all stay
- The Zustand store structure mostly stays (add agents list, home feed)

## Implementation Priority

1. **Living Home view** — new default screen (biggest identity shift)
2. **Agent sidebar section** — promote agents to top-level nav
3. **Custom tool result renderers** — shell, git, browser, filesystem
4. **Copy changes** — "What should I work on?", "Recent Work", etc.
5. **Agent detail view** — dedicated page for managing agents
6. **Onboarding v2** — live setup + starter agent
7. **Result cards for autonomous runs** — visual distinction from chat

Each can ship independently. #1 alone changes the entire first impression.
