# Changelog

All notable changes to anton.computer are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Binary distribution for agent updates (download binary instead of git pull + build)
- Changelog tracking for all releases

### Changed
- Self-update system now prefers binary download path, falls back to source build

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

[Unreleased]: https://github.com/OmGuptaIND/anton.computer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/OmGuptaIND/anton.computer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OmGuptaIND/anton.computer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/OmGuptaIND/anton.computer/releases/tag/v0.3.0
