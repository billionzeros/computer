# Task Tracker — Claude Code–style Work Plan

## Overview

The task tracker gives the agent a dedicated tool to break complex work into visible steps and show real-time progress to the user. Instead of relying on heuristic detection of "step narrations" (the current `isStepNarration` approach in `groupMessages.ts`), the agent **explicitly declares** its work plan and updates it as it works.

This mirrors Claude Code's `TodoWrite` tool — the single most effective pattern for making agentic work iterative, transparent, and recoverable.

## Why This Matters

Without explicit task tracking, the agent:
- Loses track of multi-step work across long tool-calling chains
- Can't show the user what's planned vs. what's done
- Has no checkpoints for error recovery
- Relies on fragile heuristics to display progress

With task tracking:
- Agent declares all steps upfront → forces better planning
- User sees a live checklist → knows exactly what's happening
- Each step is a checkpoint → errors are recoverable
- `activeForm` drives the status bar → richer status updates

## Architecture

### Data Flow

```
User sends message
    ↓
Server routes to Session.processMessage()
    ↓
Pi SDK calls LLM with [system prompt + tools + message history]
    ↓
LLM decides to call task_tracker tool with planned steps
    ↓
executeTaskTracker() validates input, calls onTasksUpdate callback
    ↓
Session.emitTasksUpdate() pushes tasks_update into live event stream
    ↓
Server forwards event to client, updates agent_status with activeForm
    ↓
Frontend store sets currentTasks
    ↓
TaskChecklist component renders live checklist in message stream
    ↓
LLM continues work, calling task_tracker again to update status
    ↓
(repeat until all tasks completed)
```

### Component Diagram

```
┌─────────────────────────────────────────────────────┐
│ Frontend (desktop)                                   │
│                                                      │
│  store.currentTasks ──→ TaskChecklist component      │
│       ↑                    ├─ Collapsible header     │
│       │                    ├─ ✓ completed items      │
│       │                    ├─ ▸ in_progress item     │
│       │                    └─ ○ pending items        │
│       │                                              │
│  WebSocket ←── tasks_update message                  │
└───────────────────────────┬──────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────┐
│ Server (agent-server)                                │
│                                                      │
│  for await (event of session.processMessage(...))    │
│    if event.type === 'tasks_update':                 │
│      → send agent_status with activeForm of          │
│        current in_progress task                      │
│      → forward event to client                      │
└───────────────────────────┬──────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────┐
│ Session (agent-core)                                 │
│                                                      │
│  processMessage() sets up pushEvent callback         │
│  emitTasksUpdate(tasks) → pushEvent(tasks_update)    │
│       ↑                                              │
│  onTasksUpdate callback in ToolCallbacks             │
│       ↑                                              │
│  task_tracker tool execute() calls callback          │
└──────────────────────────────────────────────────────┘
```

## Protocol

### Message Type

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'completed'

interface TaskItem {
  content: string    // imperative: "Run tests"
  activeForm: string // present-continuous: "Running tests"
  status: TaskStatus
}

interface AiTasksUpdateMessage {
  type: 'tasks_update'
  tasks: TaskItem[]
  sessionId?: string
}
```

### Session Event

```typescript
| { type: 'tasks_update'; tasks: TaskItem[] }
```

Added to the `SessionEvent` union in `session.ts`.

## Tool Definition

```typescript
{
  name: 'task_tracker',
  label: 'Task Tracker',
  description: 'Track your work plan as a checklist...',
  parameters: {
    tasks: Array<{
      content: string,     // "Run tests"
      activeForm: string,  // "Running tests"
      status: 'pending' | 'in_progress' | 'completed'
    }>
  }
}
```

### Key Design Decisions

1. **Full-list replacement** — each call replaces the entire task list. No incremental add/remove operations. This prevents desync between agent and UI.

2. **Session-scoped** — tasks live only during the current session turn. Not persisted to disk (unlike the `todo` tool). Fresh start each conversation.

3. **Two-form text** — `content` (static label) and `activeForm` (shown as live status). This mirrors how real work is described ("Run tests" vs "Running tests...").

4. **Single in_progress** — only one task should be `in_progress` at a time. Enforces sequential focus.

5. **Hidden from action timeline** — `task_tracker` calls are hidden in `groupMessages.ts` (same as `ask_user`, `plan_confirm`). The checklist UI replaces the need to show the tool call.

## Agent Behavior (System Prompt)

The agent is instructed to use `task_tracker` when:
- Task requires 3+ distinct steps
- Building anything with multiple components
- Multi-step research, analysis, or creative work
- User provides multiple tasks

The agent skips `task_tracker` for:
- Simple single-step tasks
- Quick lookups, small edits, greetings

### Expected Iteration Pattern

```
1. Agent receives complex request
2. Agent calls task_tracker with ALL steps (first = in_progress, rest = pending)
3. Agent executes first step (tool calls)
4. Agent calls task_tracker (first = completed, second = in_progress)
5. Agent executes second step
6. ... repeat until all completed
7. Agent responds with summary
```

## Frontend Component

`TaskChecklist.tsx` renders inline in the message list (before `ThinkingIndicator`):

- Collapsible card with animated expand/collapse
- Header shows "Working" / "Completed" + count (e.g., "3/5")
- Each item shows status icon:
  - `✓` green check for completed
  - Spinner for in_progress
  - `○` gray circle for pending
- In-progress items show `activeForm`, others show `content`

## File Inventory

| File | Role |
|------|------|
| `packages/protocol/src/messages.ts` | `TaskItem`, `TaskStatus`, `AiTasksUpdateMessage` types |
| `packages/agent-core/src/tools/task-tracker.ts` | Tool implementation with callback |
| `packages/agent-core/src/agent.ts` | Tool registration, `onTasksUpdate` callback |
| `packages/agent-core/src/session.ts` | `tasks_update` event, `emitTasksUpdate()`, `pushEvent` wiring |
| `packages/agent-server/src/server.ts` | Forward events, use `activeForm` as status detail |
| `packages/desktop/src/lib/store.ts` | `currentTasks` state, handle `tasks_update` |
| `packages/desktop/src/components/chat/TaskChecklist.tsx` | Checklist UI component |
| `packages/desktop/src/components/chat/MessageList.tsx` | Renders `TaskChecklist` inline |
| `packages/desktop/src/components/chat/groupMessages.ts` | Hides `task_tracker` from action timeline |
| `packages/desktop/src/index.css` | `.task-checklist` styles |
| `packages/agent-config/prompts/system.md` | Agent instructions for when/how to use |

## How This Differs From Existing Step Narration

The existing system in `groupMessages.ts` uses `isStepNarration()` to heuristically detect short assistant messages followed by tool calls and groups them into `task_section` items. This is:

- **Implicit** — agent doesn't know the UI is grouping its messages
- **Fragile** — depends on message length, format, and ordering heuristics
- **Retrospective** — only works after the fact, can't show a plan upfront
- **No progress** — can't show "3/7 done" because the agent never declared the full plan

The task tracker is:

- **Explicit** — agent consciously declares and updates its work plan
- **Reliable** — structured data, no heuristics needed
- **Prospective** — shows the full plan before work begins
- **Progressive** — shows real-time completion status

Both systems coexist. The step narration grouping continues to work for cases where the agent doesn't use `task_tracker` (simple tasks, sub-agents, etc.).

## Query Processing Flow (Context)

For reference, here's how a user query flows through the system:

```
1. User types in ChatInput → onSend(text, attachments)
2. AgentChat calls connection.sendAiMessageToSession()
3. WebSocket frame: [Channel.AI][{type:'message', content, sessionId}]
4. Server.handleChatMessage() gets/creates session
5. On first message: session.loadConversationContext() injects memories
6. session.processMessage(text, attachments):
   a. Sets up piAgent event subscription
   b. Calls piAgent.prompt(text, images)
   c. Pi SDK sends to LLM: system prompt + tools + message history
   d. LLM responds with text and/or tool calls
   e. Pi SDK executes tools via execute() handlers
   f. Tool results fed back to LLM
   g. Repeat d-f until LLM stops calling tools
   h. Each step emits events via subscribe()
7. Session translates pi events → SessionEvent via translateEvent()
8. Server forwards events to client via sendToClient(Channel.AI, event)
9. Client store processes events, updates UI state
10. Components re-render with streaming text, tool actions, task checklist
```

The system prompt seen by the LLM is assembled in layers, each wrapped in `<system-reminder>` tags:
- Core: `CORE_SYSTEM_PROMPT` (embedded, identical for all deployments)
- Workspace rules (`.anton.md` from workspace directory)
- User rules (`~/.anton/prompts/append.md` + `rules/*.md`)
- Current context (workspace path, project info, date)
- Memory (global + conversation-scoped + cross-conversation keyword matches)
- Project memory instructions (if session is scoped to a project)
- Agent context (scheduled agents: standing instructions + run history)
- Project type guidelines (code.md, document.md, etc.)
- Reference knowledge (auto-selected coding guides)
- Active skills
