# Specs

All specification and design documents for anton.computer.

---

## architecture/

Core system architecture, protocols, and data models.

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | System diagram, component map, file locations |
| [SPEC.md](architecture/SPEC.md) | Connection protocol spec (v0.5.0) — ports, auth, message contract |
| [API.md](architecture/API.md) | WebSocket API reference — wire format, channels, all message types |
| [SESSIONS.md](architecture/SESSIONS.md) | Session persistence, JSONL storage, compaction, search |
| [CONCURRENT_CONVERSATIONS.md](architecture/CONCURRENT_CONVERSATIONS.md) | Multi-session architecture, WebSocket routing |
| [PROVIDERS.md](architecture/PROVIDERS.md) | Supported AI providers matrix, auth methods, model lists |
| [deployment.md](architecture/deployment.md) | Repo-clone deployment model, install flow, directory layout |
| [project-context-and-memory.md](architecture/project-context-and-memory.md) | Three-layer context system (Instructions + Knowledge + Memory) |
| [project-scoped-pages.md](architecture/project-scoped-pages.md) | Frontend pages scoped to active project (Tasks, Memory, Agents, Files, etc.) |

## features/

Feature specs for individual capabilities.

| File | Description |
|------|-------------|
| [agents.md](features/agents.md) | Scheduled agents, cron triggers, confirmation flow |
| [workflows.md](features/workflows.md) | Installable automation packages from GitHub registry |
| [workflow-ux.md](features/workflow-ux.md) | Workflow UX — grid, install, bootstrap, sidebar |
| [connectors.md](features/connectors.md) | OAuth/MCP/API connector types, auth flow |
| [browser-automation.md](features/browser-automation.md) | Fetch vs real browser modes, Playwright, live viewer |
| [WORKSPACE_AND_CODE_MODE.md](features/WORKSPACE_AND_CODE_MODE.md) | Workspace root, project elevation, code-aware UI |
| [CONVERSATION_WORKSPACES.md](features/CONVERSATION_WORKSPACES.md) | Per-conversation directories, memory scoping |
| [memory-page.md](features/memory-page.md) | Memory page UI, config_query protocol |
| [project-first-architecture.md](features/project-first-architecture.md) | Vision: projects as core primitive |
| [TASK_TRACKER.md](features/TASK_TRACKER.md) | Task tracking tool (Claude Code style), work plan tracking |
| [TOOL_CALLS_UI.md](features/TOOL_CALLS_UI.md) | Tool call tree visualization, type labels |
| [citations.md](features/citations.md) | Web search result citations, inline numbering |
| [web-search-and-readability.md](features/web-search-and-readability.md) | Exa integration, readability extraction |
| [TOKEN_USAGE.md](features/TOKEN_USAGE.md) | Token tracking, dashboard persistence |
| [ARTIFACT_PUBLISHING.md](features/ARTIFACT_PUBLISHING.md) | Artifact URL scheme, directory layout, Caddy routing |
| [UPDATES.md](features/UPDATES.md) | Version resolution, manifest, self-update protocol |
| [text-stream-buffer.md](features/text-stream-buffer.md) | Server-side text coalescing, 80ms timer |

## reference/

Research, vision, and design inspiration.

| File | Description |
|------|-------------|
| [GOALS.md](reference/GOALS.md) | Strategic vision and north star for anton.computer |
| [AI_AGENT_PLATFORM_RESEARCH.md](reference/AI_AGENT_PLATFORM_RESEARCH.md) | Research on agent platform failures and lessons learned |
| [perplexity-reference.md](reference/perplexity-reference.md) | UI design patterns from Perplexity (colors, typography, spacing) |

## operations/

Production readiness, monitoring, and evaluation.

| File | Description |
|------|-------------|
| [PRODUCTION-AUDIT.md](operations/PRODUCTION-AUDIT.md) | Security gaps, timeline, production readiness (6/10) |
| [EVALS.md](operations/EVALS.md) | Evaluation framework via Braintrust, failure categories |
