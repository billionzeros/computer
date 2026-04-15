# Workflows System Spec

> **Status:** Engine, UI, install flow, auto-suggest all implemented. Deployment migrated to repo-clone model.

## Overview

Workflows are **installable, self-contained automation packages** that ship with agent prompts, scripts, templates, and configuration. Each workflow installs as its own project with an interactive bootstrap conversation and a scheduled agent.

**User flow:** Browse workflows → click Install → modal checks connectors → creates new project → bootstrap conversation guides setup → workflow runs on schedule.

---

## Three Capability Layers

- **Connectors** — talk to services (Gmail, Sheets, Slack, Exa). OAuth managed, user connects once.
- **Code** — Anton is a full programmer. Filter, transform, compute, analyze, scrape, generate. Ship starter scripts or write new code on the fly.
- **Agent brain** — scoring, writing, deciding, routing. Guided by templates and rubrics. This is what makes $0.50 of API calls worth $300/mo.

---

## Architecture

Workflows build ON TOP of agents. A workflow installation creates a regular agent with richer context. **Zero changes to AgentManager.**

```
Install clicked → new project created → workflow files copied
→ agent created with workflowId → bootstrap.md saved as project instructions
→ user lands in bootstrap conversation → setup completes
→ scheduled agent activates → runs on cron
```

On each agent run:
```
AgentManager.runAgent() → buildSessionOptions() detects workflowId
→ buildWorkflowAgentContext() assembles: orchestrator.md + sub-agents
  + templates + user config ({{variables}} substituted) + script paths
→ Agent executes with connector tools + shell + full context
→ Memory saved for next run
```

---

## Workflow Directory Structure

```
lead-qualification/
├── workflow.json                    # Manifest
├── installed.json                   # Created on install — links to agent + project
├── agents/
│   ├── bootstrap.md                 # Runs ONCE — interactive setup conversation
│   ├── orchestrator.md              # Runs on schedule — the actual workflow
│   ├── lead-scorer.md               # Sub-agent: scoring logic
│   └── outreach-writer.md           # Sub-agent: personalized emails
├── scripts/
│   ├── enrich-lead.py               # Apollo.io enrichment
│   ├── compute-score.py             # Weighted scoring
│   └── validate-email.py            # MX record validation
├── templates/
│   ├── scoring-rubric.md            # ICP criteria, weights, score ranges
│   ├── email-patterns.md            # 5 proven outreach patterns
│   ├── research-checklist.md        # What to research per lead
│   └── crm-field-mapping.md         # Sheet column mapping
├── config/
│   ├── defaults.json                # Default thresholds
│   └── user-config.json             # User's answers (created on install)
└── state/
    ├── memory.md                    # Persistent across runs
    └── last-run.json                # Latest results
```

---

## workflow.json Manifest

Key fields:

```jsonc
{
  "id": "lead-qualification",
  "name": "LinkedIn Lead Qualification",
  "description": "Score incoming leads...",
  "version": "1.0.0",
  "author": "anton",
  "category": "SMB",

  "whenToUse": "Use when the user mentions: lead qualification, lead scoring, outreach automation...",

  "connectors": {
    "required": ["gmail", "google-sheets"],
    "optional": ["slack", "exa-search"]
  },

  "runtime": { "python": true, "packages": ["requests"] },

  "inputs": [ ... ],           // Setup questions (used by bootstrap or static form)

  "trigger": {
    "type": "schedule",
    "schedule": "0 */2 * * *"
  },

  "bootstrap": {               // Interactive setup agent
    "file": "agents/bootstrap.md",
    "description": "Interactive setup: configure scoring, test connections, dry run"
  },

  "hooks": [ ... ],            // Pre/post automation (implemented in types, execution pending)

  "preferences": [ ... ],      // Taste dimensions to learn during bootstrap

  "agents": { ... },           // Orchestrator (main) + sub-agents
  "resources": [ ... ]         // Template files loaded into context
}
```

---

## Install Flow (Implemented)

### UI Flow

1. User clicks **Workflows** in sidebar → sees 2-column card grid
2. Clicks a workflow card → detail page (title, description, "Try asking...", agents, scripts, connectors)
3. Clicks **Install Workflow** → **modal opens**:
   - "Install {name}" title
   - "What happens next" info box (3 steps)
   - Connection check (✓ gmail, ✓ sheets, ✓ slack, etc.)
   - **Create Project & Start Setup** button (shows spinner when clicked)
   - Cancel button
4. Button clicked → creates new project → installs workflow → navigates to project → opens bootstrap conversation

### Server-Side Flow

```
Client: project_create (name: workflow.name)
Server: project_created → returns projectId

Client: workflow_install (projectId, workflowId, userInputs: {})
Server:
  1. Copies workflow dir to project's workflows/ directory
  2. Creates state/ directory
  3. Saves user-config.json
  4. Creates agent with cron schedule (PAUSED until bootstrap completes)
  5. Sets agent.workflowId on metadata
  6. If bootstrap exists: saves bootstrap.md as project instructions.md
  7. Writes installed.json
  → Returns InstalledWorkflow

Client: receives workflow_installed
  → navigates to new project
  → opens bootstrap conversation (project instructions = bootstrap.md)
```

### Bootstrap Pattern

The bootstrap is NOT a special agent mode. It's the project's `instructions.md` — so the FIRST conversation the user has in the project is guided by the bootstrap prompt. The AI walks them through:

1. Greeting + explaining the workflow
2. Testing connectors live
3. Setting up tracking sheet
4. Learning ICP through questions
5. Learning outreach style (shows samples, asks preferences)
6. Dry run with one real lead
7. Saving config → activating scheduled agent

### Workflow = Project (Decided)

Installing a workflow **always creates a new project**. This gives:
- Isolation (workflow conversations don't mix with other work)
- Custom project instructions (bootstrap.md)
- Clean run history (each agent run = a conversation)
- Workflow status banner in ProjectLanding

---

## Auto-Suggest (Implemented)

Follows Claude Code's pattern: workflow descriptions are injected into every session's system prompt.

**manifest.whenToUse** — trigger phrases written for the AI:
```
"Use when the user mentions: lead qualification, lead scoring, outreach automation..."
```

**Server** loads all builtin manifests on startup → caches as `availableWorkflows` → passes to every `createSession()` call.

**Session** injects as `<system-reminder>` block:
```
The following automation workflows are available. If the user's request
matches, suggest it naturally. Don't force it.

### LinkedIn Lead Qualification
Score incoming leads...
Use when the user mentions: lead qualification...
```

The LLM reads this and naturally suggests workflows when relevant.

---

## UI Components (Implemented)

| Component | File | Purpose |
|-----------|------|---------|
| **WorkflowsPage** | `components/workflows/WorkflowsPage.tsx` | 2-column card grid + placeholder "coming soon" workflows |
| **WorkflowCard** | `components/workflows/WorkflowCard.tsx` | Card: icon + name + author + description + connector chips |
| **WorkflowDetailPage** | `components/workflows/WorkflowDetailPage.tsx` | Detail: title, description, "Try asking...", agents/scripts/connectors chips, Install button |
| **InstallModal** | Inside WorkflowDetailPage.tsx | Modal: info box + connection check + "Create Project & Start Setup" with loading |
| **WorkflowStatusBanner** | `components/workflows/WorkflowStatusBanner.tsx` | ProjectLanding banner: active/paused, last run, next run, Run Now/Pause |

**Sidebar:** Workflows nav item in Computer mode.
**Top bar:** "Workflows" title shown in workspace header (consistent with Memory, Agents, etc.)
**Centering:** Content centered with `max-width: 720px; margin: 0 auto` (matches Memory page pattern).

### UI Details

**Icons:** Hardcoded emoji map (`WORKFLOW_ICONS`) in WorkflowCard and WorkflowDetailPage. Keyed by workflow ID (e.g., `"lead-qualification"` → emoji). Falls back to default icon.

**Placeholder workflows:** WorkflowsPage shows 3 "coming soon" cards alongside real registry entries:
- Content Creation Pipeline
- Workflow Creator
- Customer Support Automation

**WorkflowDetailPage:** Hardcoded `WHAT_IT_DOES`, `AGENTS`, and `SCRIPTS` display mappings per workflow ID. Shows "Try asking..." examples, agent/script/connector chips.

**WorkflowStatusBanner features:**
- "Run Now" button → triggers immediate agent run
- "Pause / Resume" button → toggles scheduled agent status
- Shows schedule as human-readable text ("Runs every 2 hours")
- Shows last run + next run as relative times

**Registry `featured` flag:** `WorkflowRegistryEntry.featured?: boolean` — set to `true` for all builtin workflows. Can be used for sorting/highlighting in UI.

**`InstalledWorkflow.bootstrapped` semantics:** Set to `true` at install time if the workflow has NO bootstrap (ready immediately). Set to `false` if bootstrap exists (agent starts paused until bootstrap conversation completes).

---

## Deployment (Repo-Clone Model)

See `specs/deployment.md` for full details.

**Key point:** Workflows work because the full repo lives on disk at `/opt/anton/`. All `.md` agent prompts, `.py` scripts, `.json` configs are real files. No SEA binary, no embedding needed.

```
make sync   → builds locally → rsyncs to /opt/anton/ → restarts systemd
make deploy → Ansible: clones repo → installs → builds → configures
```

---

## Protocol Messages

| Direction | Type | Purpose |
|-----------|------|---------|
| Client → Server | `workflow_registry_list` | Browse available workflows |
| Server → Client | `workflow_registry_list_response` | Registry entries (includes `featured` flag) |
| Client → Server | `workflow_check_connectors` | Pre-install connector check |
| Server → Client | `workflow_check_connectors_response` | Full manifest + `satisfied` (bool) + `missing` + `optional` connector lists |
| Client → Server | `workflow_install` | Install workflow into project (projectId, workflowId, userInputs) |
| Server → Client | `workflow_installed` | Installation result → triggers navigation |
| Client → Server | `workflows_list` | List installed workflows for a project |
| Server → Client | `workflows_list_response` | Installed workflows |
| Client → Server | `workflow_uninstall` | Remove workflow + agent |
| Server → Client | `workflow_uninstalled` | Uninstall confirmation |

---

## Client State (Desktop Store)

The desktop store (`packages/desktop/src/lib/store.ts`) maintains:

```typescript
workflowRegistry: WorkflowRegistryEntry[]      // All available workflows from registry
projectWorkflows: InstalledWorkflow[]           // Installed workflows for current project
workflowConnectorCheck: {                       // Result of pre-install connector check
  workflowId: string
  satisfied: boolean
  missing: string[]
  optional: string[]
} | null
```

**Auto-fetch:** `ProjectLanding` calls `connection.sendWorkflowsList(projectId)` on mount to populate `projectWorkflows`.

**Connection methods** (`packages/desktop/src/lib/connection.ts`):
- `sendWorkflowRegistryList()` — fetch available workflows
- `sendWorkflowCheckConnectors(workflowId)` — pre-install check
- `sendWorkflowInstall(projectId, workflowId, userInputs)` — install
- `sendWorkflowsList(projectId)` — list installed for project
- `sendWorkflowUninstall(projectId, workflowId)` — uninstall

---

## Implementation Status

### Done

| Component | File |
|-----------|------|
| Workflow types + hooks + preferences | `packages/protocol/src/workflows.ts` |
| AgentMetadata.workflowId | `packages/protocol/src/projects.ts` |
| Protocol messages (10 types) | `packages/protocol/src/messages.ts` |
| Filesystem loader | `packages/agent-config/src/workflows.ts` |
| Context builder (prompt assembly) | `packages/agent-server/src/workflows/workflow-context.ts` |
| Installer (copy + agent + bootstrap) | `packages/agent-server/src/workflows/workflow-installer.ts` |
| Builtin registry (reads from disk) | `packages/agent-server/src/workflows/builtin-registry.ts` |
| Server handlers (5 message handlers) | `packages/agent-server/src/server.ts` |
| Auto-suggest (system prompt injection) | `packages/agent-core/src/session.ts` |
| ConnectorManager.getActiveIds() | `packages/connectors/src/connector-manager.ts` |
| Lead qualification workflow (13 files) | `packages/agent-server/src/workflows/builtin/lead-qualification/` |
| WorkflowsPage (card grid) | `packages/desktop/src/components/workflows/WorkflowsPage.tsx` |
| WorkflowCard | `packages/desktop/src/components/workflows/WorkflowCard.tsx` |
| WorkflowDetailPage + InstallModal | `packages/desktop/src/components/workflows/WorkflowDetailPage.tsx` |
| WorkflowStatusBanner | `packages/desktop/src/components/workflows/WorkflowStatusBanner.tsx` |
| Connection senders (5 methods) | `packages/desktop/src/lib/connection.ts` |
| Store state + message handlers | `packages/desktop/src/lib/store.ts` |
| Sidebar + App.tsx routing | Sidebar.tsx, App.tsx |
| ProjectLanding integration | ProjectLanding.tsx (banner + workflow fetch) |
| Deployment: repo-clone Makefile | `Makefile` (sync target) |
| Deployment: CLI setup (git clone) | `packages/cli/src/commands/computer-setup.ts` |
| Deployment: updater (git pull) | `packages/agent-server/src/updater.ts` |
| Deployment: Ansible role | `deploy/ansible/roles/anton-agent/tasks/main.yml` |
| Deployment spec | `specs/deployment.md` |

### Typed But Not Wired

These features have TypeScript types in `packages/protocol/src/workflows.ts` but **zero runtime implementation**:

| Feature | Types Location | What's Missing |
|---------|---------------|----------------|
| **Workflow inputs** (setup questions) | `WorkflowInput` interface (lines 131-146) | InstallModal doesn't render inputs; installer ignores `userInputs` param |
| **Workflow preferences** (taste learning) | `WorkflowPreference` interface (lines 180-190) | `buildWorkflowAgentContext` doesn't read/inject preferences; not connected to project preferences system |
| **Hooks execution** | `WorkflowHook` interface (lines 113-128) | `buildWorkflowAgentContext` doesn't read hooks; no before/after action handlers |
| **Manual trigger type** | `trigger.type: "schedule" \| "manual"` (line 48) | Only `"schedule"` used in installer; no UI for manual-only workflows |

### Pending

| Feature | Priority | Notes |
|---------|----------|-------|
| **Wire workflow inputs** | High | Render inputs in InstallModal, pass to installer, save to user-config.json |
| **Wire workflow preferences** | Medium | Inject into bootstrap context, connect to project preferences system |
| **Hooks execution** | Medium | Orchestrator checks hooks before/after actions during workflow runs |
| **context:fork sub-agents** | Medium | Run sub-agents as isolated conversations with own token budget |
| **Content Creation Pipeline** | High | Second workflow — validates the system works for non-sales use cases |
| **Workflow Creator** | High | Meta-workflow — flywheel for community growth |
| **Braintrust integration** | Medium | Structured evals on workflow run quality |
| **GitHub registry** | Low | Host workflows externally, fetch on install |
| **Workflow versioning** | Low | Update installed workflows from registry |
| **Event triggers** | Low | "New email arrives" triggers a run (vs cron-only) |

---

## Design Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Workflow = project? | **Yes.** Installing always creates a new project. Isolation, clean history, custom instructions. |
| Bootstrap model? | **Project instructions.** bootstrap.md saved as project's instructions.md. First conversation is guided by it. |
| Agent paused until bootstrap? | **Yes.** Scheduled agent starts paused. Activates after bootstrap completes. |
| Auto-suggest? | **System prompt injection.** `whenToUse` field in manifest, injected into every session as `<system-reminder>`. LLM decides when to suggest. |
| Deployment? | **Repo-clone.** Full repo at `/opt/anton/`. No SEA binary. `make sync` rsyncs built output. All files on disk. |
| Sub-agent model? | **Prompt modules for v1.** Sub-agent .md files loaded into orchestrator context. `context:fork` planned for v2. |
| Install modal? | **Modal with connection check.** Shows "What happens next" info, connector status, "Create Project & Start Setup" button with loading state. |
