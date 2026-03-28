# Changelog

All notable changes to anton.computer are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

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

[Unreleased]: https://github.com/OmGuptaIND/computer/compare/v1.0.26...HEAD
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
