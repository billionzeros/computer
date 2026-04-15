# Workflow Multi-Agent Architecture

## Overview

Workflows are installable automation packages that create multiple independent agents, each handling a focused task. Agents coordinate through a shared SQLite database (not external connectors). Nothing runs until the user fully approves the setup through an iterative plan-review loop.

### Three Layers of Agent Instructions

Each agent has three layers that compose its runtime behavior:

1. **`task.md`** (WHAT) — The primary instruction. Contains `<user_preferences>`, `<task_steps>`, and `<rules>`. Pre-built with sensible defaults, customized by the bootstrap agent based on user's answers. The agent follows this checklist exactly.

2. **Prompt `.md`** (HOW) — The process guide. Explains methodology, scoring rubrics, email patterns. Doesn't change per-user — it's the agent's domain knowledge.

3. **Shared State Rules** (ENFORCED) — Auto-generated from the manifest. Tells the agent which status transitions it's allowed to make. The `shared_state` tool rejects invalid transitions at the system level.

Loading order in context: Metadata → Shared State Rules → Task.md → Prompt.md → Resources

## Core Flow

```
Install → Plan Loop → Configure → Plan Loop → Activate → Agents Run
```

1. **Install** — Creates project + copies workflow files. No agents created.
2. **Plan Loop 1** — Bootstrap AI presents pipeline overview via `plan` tool. User critiques, AI revises. Repeats until approved.
3. **Configure** — Bootstrap AI collects config via `ask_user` (2 rounds: essentials + preferences).
4. **Plan Loop 2** — Bootstrap AI presents final agent configurations. User critiques, AI revises. Repeats until approved.
5. **Activate** — Bootstrap AI calls `activate_workflow` tool → server creates N agents from manifest.
6. **Run** — Each agent runs independently on its own cron schedule.

## Architecture

### Independent Agents (No Orchestrator)

Each agent is small, focused, and cheap. They coordinate through the Google Sheet's status column:

| Agent | Reads Status | Writes Status | Schedule |
|-------|-------------|---------------|----------|
| Lead Scanner | — | "new" | Every 2h at :00 |
| Lead Scorer | "new" | "scored" | Every 2h at :30 |
| Outreach Writer | "scored" (≥ threshold) | "outreach_sent" | Odd hours at :00 |

The sheet is the message bus. No inter-agent communication needed.

### Agent Lifecycle

```
Workflow Installed (no agents)
    ↓
Bootstrap Conversation
    ↓
Plan Review (iterative)
    ↓
Configuration (ask_user)
    ↓
Final Plan Review (iterative)
    ↓
activate_workflow tool called
    ↓
N agents created with:
  - workflowId (groups them)
  - workflowAgentKey (identifies which manifest entry)
  - Per-agent cron schedule
  - Per-agent prompt loaded at runtime
    ↓
Agents run independently on schedule
```

### Per-Agent Context Loading

When an agent runs, `buildWorkflowAgentContext(projectId, workflowId, agentKey)` loads:
- Only that agent's prompt file (not all prompts concatenated)
- Shared user config (merged defaults + user answers)
- That agent's scripts only
- Shared resource/template files
- Workflow memory

This makes each run cheaper than the monolith approach.

## Data Model

### WorkflowManifest (workflow.json)

```json
{
  "agents": {
    "lead-scanner": {
      "file": "agents/lead-scanner.md",
      "role": "main",
      "name": "Lead Scanner",
      "description": "Scans Gmail for new leads",
      "connectors": ["gmail", "google-sheets"],
      "schedule": "0 */2 * * *"
    }
  },
  "pipeline": [
    {
      "id": "lead-scanner",
      "label": "Lead Scanner",
      "description": "Scans Gmail every 2h",
      "icon": "mail",
      "type": "agent",
      "next": ["lead-scorer"]
    }
  ]
}
```

### AgentMetadata (agent.json)

New fields:
- `workflowId?: string` — groups agents by workflow
- `workflowAgentKey?: string` — maps to manifest agent entry

### InstalledWorkflow (installed.json)

New field:
- `agentSessionIds?: string[]` — all agent session IDs (populated after activation)

### Protocol Messages

- `workflow_activate` (client → server) — triggers agent creation
- `workflow_activated` (server → client) — confirms agents created, returns agent list

## Key Implementation Details

### Bootstrap Resilience

- Plan/ask_user prompts have **24-hour timeout** (was 5 minutes)
- Pending prompts persist in `pendingPrompts` map on server
- On client reconnect, server re-sends all pending prompts
- User can close the app mid-setup and resume where they left off

### activate_workflow Tool

- Defined in `agent-core/src/tools/activate-workflow.ts`
- Uses callback pattern: tool runs in agent-core, callback executes in server context
- Server's `buildActivateWorkflowHandler()` calls `WorkflowInstaller.activateWorkflow()`
- Creates N agents, sets workflowId + workflowAgentKey on each
- Sends `workflow_activated` to client with all created agents

### Pipeline Visualization

- `WorkflowPipelineView` component renders pipeline from manifest data
- Pure CSS vertical flow diagram (no external library)
- Each step: icon + label + description + type accent color
- Supports branching (multiple `next` → side-by-side layout)
- Integrated into AgentsView with Flow/Agent tabs

### Uninstall

`WorkflowInstaller.uninstall()` finds all agents with matching `workflowId` and deletes them all.

## Files Changed

### Protocol (3 files)
- `packages/protocol/src/projects.ts` — `workflowAgentKey` on AgentMetadata
- `packages/protocol/src/workflows.ts` — `WorkflowPipelineStep`, `agentSessionIds`, enhanced `WorkflowAgentRef`
- `packages/protocol/src/messages.ts` — `workflow_activate` / `workflow_activated`

### Agent-Core (3 files)
- `packages/agent-core/src/tools/activate-workflow.ts` — new tool handler type
- `packages/agent-core/src/agent.ts` — tool registration + callback
- `packages/agent-core/src/index.ts` — export

### Server (3 files)
- `packages/agent-server/src/workflows/workflow-installer.ts` — install (no agents) + activateWorkflow (N agents) + uninstall (all agents)
- `packages/agent-server/src/workflows/workflow-context.ts` — per-agent context loading
- `packages/agent-server/src/server.ts` — activation handler, tool callback, 24h timeouts

### Desktop (9 files)
- `packages/desktop/src/lib/connection.ts` — sendWorkflowActivate
- `packages/desktop/src/lib/store/projectStore.ts` — activateWorkflow action
- `packages/desktop/src/lib/store/handlers/projectHandler.ts` — workflow_activated + dedup + navigation fixes
- `packages/desktop/src/components/agents/AgentsView.tsx` — Flow/Agent tabs
- `packages/desktop/src/components/agents/AgentListView.tsx` — project name lookup, two-line layout
- `packages/desktop/src/components/workflows/WorkflowPipelineView.tsx` — new pipeline component
- `packages/desktop/src/components/workflows/WorkflowDetailPage.tsx` — duplicate project prevention, agent names
- `packages/desktop/src/components/home/HomeView.tsx` — empty conversation fix
- `packages/desktop/src/components/home/TaskDetailView.tsx` — empty conversation fix

### Workflow Content (2 files)
- `packages/agent-server/src/workflows/builtin/lead-qualification/workflow.json` — 3 independent agents, pipeline
- `packages/agent-server/src/workflows/builtin/lead-qualification/agents/bootstrap.md` — iterative plan loops

---

## Critique

### What's Good

1. **Independent agents are genuinely better.** Each agent has a tiny, focused prompt. Runs are cheap. Users can add/remove/customize individual agents. Debugging is per-agent. This is the right architecture.

2. **Shared state via Google Sheets is elegant.** The sheet is already the user's tracking tool. Using the status column as a coordination mechanism means no inter-agent communication needed. It's simple, debuggable, and the user can see exactly what's happening.

3. **Iterative plan loops reuse existing infrastructure.** The `plan` tool's reject-with-feedback mechanism already supports the critique/revise cycle. No new UI needed — PlanReviewOverlay works as-is.

4. **24-hour timeout + reconnect persistence.** Users can leave and come back. Pending prompts survive reconnects. This solves the abandoned bootstrap problem cleanly.

5. **Pipeline visualization.** Non-technical users immediately understand what the workflow does. The pipeline is defined in the manifest, so new workflows get it for free.

### What's Risky

1. **Bootstrap depends on model following a precise 4-phase prompt.** The model might skip phases, call `activate_workflow` prematurely, forget to call it, or jumble the order. The bootstrap prompt is well-structured but there's no programmatic enforcement. If the model goes off-script, the user gets a broken experience.

   **Mitigations (implemented):**
   - `activateWorkflow()` throws if already activated (prevents double-activation)
   - `activate_workflow` tool only available to human conversations (not agent sessions)
   - Workflow ID is explicitly included in bootstrap instructions (model doesn't have to guess)
   - Plan/ask_user have 24-hour timeout (user can leave and return)

   **Remaining risk:** Model could call `activate_workflow` before collecting config. This is a prompt reliability issue, not a code issue — the server can't know what "complete" means for arbitrary workflows.

2. **~~No "resume incomplete setup" UI.~~** FIXED: A yellow "Setup incomplete" banner now shows in the task list when `bootstrapped: false`. Clicking it starts a new setup conversation.

3. **Agent scheduling relies on staggered cron offsets.** Lead Scanner at :00, Lead Scorer at :30, Outreach Writer at :00 odd hours. If the scanner run takes longer than 30 minutes (slow Gmail API, many leads), the scorer might run before the scanner finishes — picking up stale data or missing new leads. There's no dependency graph enforcement.

   **Mitigation:** The status column protects against processing incomplete data (scorer only picks up "new" status rows). But timing-dependent edge cases exist.

4. **Per-agent context loading loses cross-agent awareness.** The lead-scorer agent doesn't know what the outreach-writer does, and vice versa. If they need to coordinate beyond the status column (e.g., scorer needs to know the outreach threshold to prioritize scoring), that context must be in the shared config or the scorer's own prompt.

   **Current state:** The shared user config (ICP, threshold, etc.) is loaded for all agents, which covers most cross-agent data needs. But if workflows get more complex, this could become a limitation.

### What's Over-Engineered

1. **Pipeline visualization branching support.** The current lead-qualification pipeline is a straight line (scanner → scorer → writer). The fork/branch rendering code handles multiple `next` targets, but no current workflow uses it. It's speculative complexity — but it's only ~15 lines of extra CSS/JSX, so the cost is low.

2. **The `WorkflowAgentRef.role` field is now redundant.** All 3 agents are `role: "main"`. The `"sub"` role was for the old concatenated approach. With independent agents, every agent is "main". The field exists for backward compatibility but adds confusion.

   **Recommendation:** Consider deprecating `role: "sub"` in favor of always independent agents. If an agent truly shouldn't have its own schedule, just omit the `schedule` field.

### What Won't Work As Expected

1. **~~The `activate_workflow` tool is available to ALL project-scoped sessions.~~** FIXED: Tool is now only provided to human conversations (`!isAgent`), not agent runs. Server-side `activateWorkflow()` also throws if already activated.

2. **~~Multiple workflow installs name collision.~~** FIXED: `handleConfirm()` now checks by `workflowId` in `projectWorkflows`, not by project name. Different workflows always get their own project.

3. **~~The bootstrap prompt doesn't know the workflowId.~~** FIXED: The installer now includes `Workflow ID: "lead-qualification"` and explicit activation instructions in the project instructions template.

### What's Missing (Future Work)

1. **No way for users to add/remove agents from the UI yet.** The architecture supports it (each agent is independent), but there's no UI to add a 4th agent or remove the outreach writer.

2. **No dependency graph between agents.** Agents are staggered by cron offset, but there's no guarantee scanner finishes before scorer starts. The status column prevents processing incomplete data, but a proper dependency system (agent B waits for agent A to complete) would be more robust for complex workflows.
