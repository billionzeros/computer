# Changelog

All notable changes to anton.computer are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [1.0.44] - 2026-04-08

### Fixes
- remove changelog from update modal so update button is visible
- stop dropping Slack app_mention events in active threads
- show connected email for Google OAuth connectors
---

## [1.0.43] - 2026-04-08

### Features
- wire projectId and agent tool into webhook sessions
- unify file storage, image preview, and agent file guidance
- auto-inject thread context when Anton first joins a Slack thread
- redesign skills UI with tree view, file viewer, and actions menu
- add image preview in file sidecar and center file list
- multi-account connector support
- interactive messaging flow for Slack & Telegram webhooks
- add fs_write, fs_mkdir, fs_delete to FILESYNC channel
- agent activity detection — optimistic UI, ping/pong, reconnect recovery
- project-aware webhook sessions + slash command system
- redesign skills as directory-based packages with Connectors-style UI
- split-panel file viewer — file tree left, content right
- add working file interactions (new folder, delete, view, context menu)
- simplify file explorer to match reference design
- split-panel file viewer — file tree left, content right
- add working file interactions (new folder, delete, view, context menu)
- simplify file explorer to match reference design
- redesign file explorer with Apple Finder quality
- replace flat file list with Finder-like file explorer
- working slack experience

### Fixes
- redesign image attachments as inline chips, prevent steering with images
- improve Skills page spacing, font sizes, and padding for professional look
- skip web_search stub when exa_search MCP connector is available
- remove raw cron expression from agent create dialog
- backfill account email for existing OAuth connectors on startup
- render ask-user Q&A as structured cards instead of raw markdown
- narrow thread_ts type to fix tsc build error
- lazy-init dir constants to break circular dependency TDZ crash
- rebuild connectors UI with multi-account support and inline OAuth
- escape cron/glob asterisks in Slack and Telegram message formatting
- fallback to plain text when Telegram rejects Markdown entities
- drop duplicate app_mention in active Slack threads
- handle Telegram photo messages instead of dropping them
- skills not loading + two-pane skills UI
- resolve merge type errors — duplicate variable and missing sendSkillList
- missing closing brace in connection.ts and implicit any types across desktop package
- add missing sendFilesystemWrite and onFilesystemWriteResponse to Connection
- types issue
- update GLM model IDs to match supported models
- add convertEol to prevent terminal staircase effect
- make node-pty optional with child_process fallback
- replace child_process.spawn with node-pty for real terminal support
- include session status in sessions_list_response so task list shows correct status on load
- only send final agent response to Slack, not intermediate steps
- UI issue
- make sidebar the only connector flow, remove settings modal connector page
- auto-merge new default models into saved provider config
- group Anton models by provider (OpenAI, Anthropic, Google, etc.)
- add missing provider icons for OpenAI, Groq, and Anton
- openrouter model resolution, add GLM models, redesign AI models UI

### Other
- docs: add skills and slash commands spec
- improve: collapse API key input when already configured
- improve: polished provider detail view with model cards and grouping
- Add: slack
---

## [1.0.42] - 2026-04-07

### Fixes
- update CLI updater
---

## [1.0.41] - 2026-04-07

Maintenance release.
---

## [1.0.40] - 2026-04-07

### Fixes
- update issue:
---

## [1.0.39] - 2026-04-07

### Features
- auto-elevate to root via sudo in computer commands instead of exiting
---

## [1.0.38] - 2026-04-07

### Fixes
- token issue
---

## [1.0.37] - 2026-04-07

### Fixes
- doctor commands
---

## [1.0.36] - 2026-04-07

### Fixes
- anton doctor
---

## [1.0.35] - 2026-04-07

Maintenance release.
---

## [1.0.34] - 2026-04-07

### Fixes
- issues

### Other
- rm: useless readme
---

## [1.0.34] - 2026-04-07

### Fixes
- merge conflicts
---

## [1.0.34] - 2026-04-07

Maintenance release.
---

## [1.0.33] - 2026-04-07

### Features
- make release a little faster

### Fixes
- CLI issues
---

## [1.0.33] - 2026-04-06

### Fixes
- everything is fine
---

## [1.0.33] - 2026-04-06

### Fixes
- updater
---

## [1.0.32] - 2026-04-06

### Fixes
- manifest
---

## [1.0.32] - 2026-04-06

### Features
- add image attachment support to steering messages and implement a lightbox image viewer in the desktop UI.
---

## [1.0.31] - 2026-04-06

### Other
- refactor: remove agent and sidecar binary builds from release workflow and manifest
---

## [1.0.31] - 2026-04-06

### Features
- persist thinking
- sanitize conversation titles by stripping <think> tags and optimize store updates and UI spacing
- evals
- allow agents to have shared state using sqllite
- group sidebar conversations by date, update web search to use OAuth, and add connector build step to release workflow

### Fixes
- modals
- bugs
- view
- issues
- linting issues
- global states blunder
- logging
- logging
- linting issues
- protocol duplication issue
- linting issues
- agent arch v2
- major arch change

### Added
- more robust code
- anton test prompts
- logging specs

### Other
- docs: rewrite README with architecture diagrams and full system overview
- docs: rewrite README with improved branding, story, and clarity
- Add: sginificant changes
---

## [1.0.30] - 2026-03-31

### Fixes
- linting
---

## [1.0.29] - 2026-03-31

### Fixes
- linkedin connector:
---

## [1.0.29] - 2026-03-31

### Added
- onboarding flow
- LinkedIn connector and then more changes
---

## [1.0.28] - 2026-03-31

### Fixes
- tool calling issues
---

## [1.0.27] - 2026-03-30

### Features
- add Google Search Console connector, implement WebSocket message handling, and refactor desktop UI components

### Other
- refactor: unify connector management logic, deduplicate tools, and improve GitHub API authentication fallback
---

## [1.0.27] - 2026-03-30

### Features
- implement agent memory persistence and refactor cron execution to use ephemeral sessions per run
- implement OAuth connector framework with provider support and session history pagination

### Other
- refactor: improve OAuth flow for shared providers, add environment management utilities, and update UI styling and connector toolbar logic.
- refactor: replace title attributes with data-tooltip, implement system theme switching, and add Google Sheets connector and plan review overlay.
- docs: fix stale README
---

## [1.0.26] - 2026-03-29

### Features
- quality of life additions
---

## [1.0.26] - 2026-03-29

### Fixes
- makefile
- CI issues
---

## [1.0.26] - 2026-03-29

### Fixes
- CI issues
---

## [1.0.26] - 2026-03-29

### Features
- introduce code mode UI, enhance agent prompts with project types and references, and improve agent shell execution context.

### Fixes
- some serious bugs

### Other
- refactor: replace job management system with a new agent-based architecture and update UI navigation
- Agent Sessions and much more
- Add: multiple features include agent and conversation interrupts
- Add system prompts for coding agent.
---

## [1.0.25] - 2026-03-26

### Features
- redesign AskUserDialog with multi-step navigation, updated option selection, and explicit submit/skip actions.

### Other
- add projects thing
---

## [1.0.24] - 2026-03-25

### Fixes
- computer dashboard
- desktop redirect
---

## [1.0.23] - 2026-03-25

### Features
- Implement `computer logs` command for viewing service and deployment logs, and refine `computer version` to prioritize local agent connections.
---

## [1.0.22] - 2026-03-25

### Features
- Introduce new `computer` subcommands for setup and lifecycle management, leveraging shared utilities and improving version detection.

### Fixes
- pass AUTO_CHANGELOG via env var to avoid JS template literal syntax error
---

## [1.0.21] - 2026-03-25

### Other
- refactor: Implement robust configuration merging with defaults and defensive logging for optional config fields.
---

## [1.0.2] - 2026-03-25

### Chores
- Update GitHub repository URL references and integrate Go sidecar binary build and release into CI.
---

## [1.0.1] - 2026-03-25

### Features
- Introduce a new Go sidecar service for agent health, status, and system checks, removing agent spec version tracking from clients.
---

## [1.0.0] - 2026-03-23

### Fixes
- tls issue
- liniting issue

### Added
- init for provider
- init for provider
---

## [0.9.0] - 2026-03-23

---

## [0.8.0] - 2026-03-23

---

## [0.7.0] - 2026-03-23

---

## [0.6.0] - 2026-03-23

---

## [0.6.0] - 2026-03-21

### Added
- Binary distribution for agent updates (download binary instead of git pull + build)
- Changelog tracking for all releases
- `make release` — single command to ship a new version (interactive version prompt)
- `make push` — fast dev deployment via esbuild bundle + scp (~5 seconds)
- CLI binary distribution with self-update (`anton update`)
- CLI install script: `curl -fsSL https://antoncomputer.in/install | bash`
- CLI version compatibility check on connect (`MIN_AGENT_SPEC`)
- CLI commands: `anton computer version`, `anton computer update` (manage agent from CLI)
- Desktop app auto-updater (Tauri updater plugin)
- Desktop app builds in CI (macOS .dmg, Windows .msi, Linux .AppImage/.deb)
- System prompt embedded at build time (no fallback needed in binary mode)
- GitHub Actions workflow builds agent + CLI + desktop on version tags
- Install endpoint at `antoncomputer.in/install`

### Changed
- Self-update system now prefers binary download path, falls back to source build
- Manifest now includes `cli` section with per-platform binary URLs
- Release script updates all versions (package.json, tauri.conf.json, Cargo.toml)

---

## [0.5.0] - 2026-03-21

### Added
- Self-update system with version compatibility checks
- Agent checks for updates automatically (hourly)
- Desktop shows update notifications with one-click update
- Wire protocol v0.5.0 with update messages on CONTROL channel
- Spec version compatibility model (MIN_CLIENT_SPEC / MIN_AGENT_SPEC)

### Changed
- Handshake (`auth_ok`) now includes version info and update availability

---

## [0.4.0] - 2026-03-18

### Added
- Artifact panel for viewing agent-generated files
- 11 new agent tools
- Personalized suggestions based on server context
- Ansible deployment playbook
- Docker deployment support
- Systemd service with security hardening

---

## [0.3.0] - 2026-03-14

### Added
- Protocol messages for setting provider models
- Session persistence with append-only JSONL storage
- Terminal multiplexing over WebSocket

---

[Unreleased]: https://github.com/OmGuptaIND/computer/compare/v1.0.44...HEAD
[1.0.44]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.44
[1.0.43]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.43
[1.0.42]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.42
[1.0.41]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.41
[1.0.40]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.40
[1.0.39]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.39
[1.0.38]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.38
[1.0.37]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.37
[1.0.36]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.36
[1.0.35]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.35
[1.0.34]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.34
[1.0.34]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.34
[1.0.34]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.34
[1.0.33]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.33
[1.0.33]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.33
[1.0.33]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.33
[1.0.32]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.32
[1.0.32]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.32
[1.0.31]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.31
[1.0.31]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.31
[1.0.30]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.30
[1.0.29]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.29
[1.0.29]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.29
[1.0.28]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.28
[1.0.27]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.27
[1.0.27]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.27
[1.0.26]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.26
[1.0.26]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.26
[1.0.26]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.26
[1.0.26]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.26
[1.0.25]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.25
[1.0.24]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.24
[1.0.23]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.23
[1.0.22]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.22
[1.0.21]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.21
[1.0.2]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.2
[1.0.1]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.1
[1.0.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v1.0.0
[0.9.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v0.9.0
[0.8.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v0.8.0
[0.7.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v0.7.0
[0.6.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v0.6.0
[0.6.0]: https://github.com/OmGuptaIND/computer/compare/v$(changelog.match(/## [(d+.d+.d+)]/g)[1].match(/d+.d+.d+/)[0])...v0.6.0
[0.5.0]: https://github.com/OmGuptaIND/computer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OmGuptaIND/computer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/OmGuptaIND/computer/releases/tag/v0.3.0
