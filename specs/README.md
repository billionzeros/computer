# Specs

All specification and design documents for anton.computer.

---

## architecture/

Core system architecture, protocols, and data models.

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | System diagram, component map, file locations |
| [SPEC.md](architecture/SPEC.md) | Connection protocol spec — ports, auth, message contract |
| [API.md](architecture/API.md) | WebSocket API reference — wire format, channels, all message types |
| [SESSIONS.md](architecture/SESSIONS.md) | Session persistence, JSONL storage, compaction, search |
| [CONCURRENT_CONVERSATIONS.md](architecture/CONCURRENT_CONVERSATIONS.md) | Multi-session architecture, WebSocket routing |
| [PROVIDERS.md](architecture/PROVIDERS.md) | Supported AI providers matrix, auth methods, model lists |
| [WEBHOOK_ROUTER.md](architecture/WEBHOOK_ROUTER.md) | Unified webhook routing for inbound integrations |
| [deployment.md](architecture/deployment.md) | Repo-clone deployment model, install flow, directory layout |
| [project-context-and-memory.md](architecture/project-context-and-memory.md) | Three-layer context system (Instructions + Knowledge + Memory) |
| [project-scoped-pages.md](architecture/project-scoped-pages.md) | Frontend pages scoped to active project |

## features/

### features/agents/

Routines system, workflows, skills, and automation.

| File | Description |
|------|-------------|
| [agents.md](features/agents/agents.md) | Scheduled agents, cron triggers, confirmation flow |
| [workflows.md](features/agents/workflows.md) | Installable automation packages from GitHub registry |
| [workflow-multi-agent-architecture.md](features/agents/workflow-multi-agent-architecture.md) | Multi-agent coordination via shared state |
| [workflow-ux.md](features/agents/workflow-ux.md) | Workflow UX — grid, install, bootstrap, sidebar |
| [sub-agents.md](features/agents/sub-agents.md) | Child sessions for parallel, focused work |
| [skills.md](features/agents/skills.md) | Directory-based skill packages (SKILL.md system) |
| [SKILLS_AND_SLASH_COMMANDS.md](features/agents/SKILLS_AND_SLASH_COMMANDS.md) | Slash command activation, desktop vs server skill loading |
| [code-review-agent.md](features/agents/code-review-agent.md) | PR review workflow via GitHub webhooks (design) |

### features/connectors/

OAuth connectors, credential management, external integrations.

| File | Description |
|------|-------------|
| [connectors.md](features/connectors/connectors.md) | OAuth/MCP/API connector types, auth flow |
| [connector-credentials.md](features/connectors/connector-credentials.md) | Unified credential store, AES-256-GCM encryption |

### features/messaging/

Slack, Telegram, and webhook-based messaging surfaces.

| File | Description |
|------|-------------|
| [SLACK_BOT.md](features/messaging/SLACK_BOT.md) | Slack integration architecture, dual connectors |
| [SLACK_THREAD_SESSIONS.md](features/messaging/SLACK_THREAD_SESSIONS.md) | Thread-scoped sessions, bot tool surface |
| [slack-telegram-messaging-flow.md](features/messaging/slack-telegram-messaging-flow.md) | End-to-end message journey across Slack and Telegram |
| [webhook-commands-and-project-scoping.md](features/messaging/webhook-commands-and-project-scoping.md) | /project commands, project-aware webhook conversations |

### features/ui/

Desktop UI features, views, and rendering.

| File | Description |
|------|-------------|
| [WORKSPACE_AND_CODE_MODE.md](features/ui/WORKSPACE_AND_CODE_MODE.md) | Workspace root, project elevation, code-aware UI |
| [CONVERSATION_WORKSPACES.md](features/ui/CONVERSATION_WORKSPACES.md) | Per-conversation directories, memory scoping |
| [TOOL_CALLS_UI.md](features/ui/TOOL_CALLS_UI.md) | Tool call tree visualization, type labels |
| [citations.md](features/ui/citations.md) | Web search result citations, inline numbering |
| [memory-page.md](features/ui/memory-page.md) | Memory page UI, config_query protocol |

### features/core/

Core capabilities — search, browser, sessions, streaming, updates.

| File | Description |
|------|-------------|
| [browser-automation.md](features/core/browser-automation.md) | Fetch vs real browser modes, Playwright, live viewer |
| [web-search-and-readability.md](features/core/web-search-and-readability.md) | Exa integration, readability extraction |
| [thinking-cot.md](features/core/thinking-cot.md) | Chain-of-thought streaming, collapsible thinking blocks |
| [background-memory-extraction.md](features/core/background-memory-extraction.md) | Post-turn memory extraction via single API call |
| [session-sync-protocol.md](features/core/session-sync-protocol.md) | Client-server session sync, delta-based updates |
| [TASK_TRACKER.md](features/core/TASK_TRACKER.md) | Task tracking tool, work plan visualization |
| [TOKEN_USAGE.md](features/core/TOKEN_USAGE.md) | Token tracking, dashboard persistence |
| [ARTIFACT_PUBLISHING.md](features/core/ARTIFACT_PUBLISHING.md) | Artifact URL scheme, directory layout, Caddy routing |
| [UPDATES.md](features/core/UPDATES.md) | Version resolution, manifest, self-update protocol |
| [text-stream-buffer.md](features/core/text-stream-buffer.md) | Server-side text coalescing, 80ms timer |

## operations/

Production readiness, monitoring, testing, and evaluation.

| File | Description |
|------|-------------|
| [PRODUCTION-AUDIT.md](operations/PRODUCTION-AUDIT.md) | Security gaps, timeline, production readiness |
| [EVALS.md](operations/EVALS.md) | Evaluation framework via Braintrust, failure categories |
| [LOGGING.md](operations/LOGGING.md) | Structured logging standard via @anton/logger (pino) |
| [anton-test-prompts.md](operations/anton-test-prompts.md) | 30 test prompts for capability testing |

## reference/

Research, vision, and design inspiration.

| File | Description |
|------|-------------|
| [GOALS.md](reference/GOALS.md) | Strategic vision and north star |
| [project-first-architecture.md](reference/project-first-architecture.md) | Vision: projects as core primitive |
| [AI_AGENT_PLATFORM_RESEARCH.md](reference/AI_AGENT_PLATFORM_RESEARCH.md) | Research on agent platform failures and lessons |
| [perplexity-reference.md](reference/perplexity-reference.md) | UI design patterns from Perplexity |
