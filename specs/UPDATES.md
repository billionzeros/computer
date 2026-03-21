# anton.computer — Update System Design

> How versioning, compatibility, and self-updates work across the desktop app, the agent VM, and the wire protocol.

---

## The Problem

Anton Computer has three moving parts that version independently:

1. **Desktop app** — Tauri native app on the user's machine
2. **Agent** — Node.js daemon running on the user's VM
3. **Wire protocol** — The spec both sides speak over WebSocket

When you ship a new feature, you might update the agent but the user's desktop is old. Or vice versa. Or the protocol changes and one side doesn't understand the other. You need:

- A way to know what version each side is running
- A way to know if they're compatible
- A way to update the agent without SSH
- A way to tell the user "hey, update available"

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────────┐
│  Desktop    │◄──ws──► │  Agent (VM)  │◄──http──►│  GitHub manifest │
│  (Tauri)    │         │  (Node.js)   │          │  manifest.json   │
│             │         │              │          └──────────────────┘
│ MIN_AGENT_  │         │ MIN_CLIENT_  │
│ SPEC=0.4.0  │         │ SPEC=0.3.0   │
└─────────────┘         └──────────────┘
```

### Three Version Numbers

| Version | Where it lives | What it means |
|---------|---------------|---------------|
| **Package version** (e.g. `0.5.0`) | `package.json` | The release version. Bumped every release. |
| **Spec version** (e.g. `0.5.0`) | `SPEC.md` + `version.ts` | Wire protocol version. Bumped when message formats change. |
| **Git hash** (e.g. `a1b2c3d`) | Runtime via `git rev-parse` | Exact build. Useful for debugging. |

The desktop has its own version in `tauri.conf.json`, but for compatibility what matters is the **spec version** — that's the contract between client and agent.

## Compatibility Model

### How it works

Each side declares the **minimum spec version** it needs from the other:

```typescript
// Agent side (agent-config/src/version.ts)
SPEC_VERSION = '0.5.0'      // What I speak
MIN_CLIENT_SPEC = '0.3.0'   // Oldest client I support

// Desktop side
MIN_AGENT_SPEC = '0.4.0'    // Oldest agent I can talk to
```

### During handshake

The agent sends all of this in `auth_ok`:

```json
{
  "type": "auth_ok",
  "agentId": "anton-vm1-abc123",
  "version": "0.5.0",
  "gitHash": "a1b2c3d",
  "specVersion": "0.5.0",
  "minClientSpec": "0.3.0",
  "updateAvailable": {
    "version": "0.6.0",
    "specVersion": "0.6.0",
    "changelog": "- New feature X\n- Fixed bug Y",
    "releaseUrl": "https://github.com/OmGuptaIND/anton.computer/releases"
  }
}
```

The desktop checks:
1. Is `specVersion >= MIN_AGENT_SPEC`? If no → show "Agent outdated, please update" banner
2. Is `updateAvailable` present? If yes → show "Update available" banner
3. Is `minClientSpec` newer than my own spec? If yes → show "Desktop outdated" warning

### Backward compatibility rules

- Unknown fields are ignored (old clients won't break on new fields)
- Unknown message types are dropped (old agents ignore `update_check`)
- New features degrade gracefully (no update UI on old agents, that's fine)

This means you can **always connect**. The worst case is missing features, never a crash.

## Self-Update System

### The manifest

A single JSON file at the repo root (`manifest.json`), also served via GitHub raw URL:

```json
{
  "version": "0.5.0",
  "specVersion": "0.5.0",
  "gitHash": "a1b2c3d",
  "releaseUrl": "https://github.com/OmGuptaIND/anton.computer/releases",
  "changelog": "- Added self-update system\n- Version compatibility checks",
  "publishedAt": "2026-03-21T00:00:00Z",
  "binaries": {
    "linux-x64": "https://github.com/OmGuptaIND/anton.computer/releases/download/v0.5.0/anton-agent-linux-x64",
    "linux-arm64": "https://github.com/OmGuptaIND/anton.computer/releases/download/v0.5.0/anton-agent-linux-arm64"
  }
}
```

This is the **single source of truth** for "what's the latest version". Update this file when you push a release.

The `binaries` field maps `{platform}-{arch}` keys to download URLs for pre-compiled agent binaries. When present, the agent downloads the binary directly instead of pulling source and building. When absent, the agent falls back to the legacy source-based update.

### How the agent checks

The `Updater` service (`packages/agent-server/src/updater.ts`) runs on the VM:

1. **On startup** — fetch manifest, compare versions
2. **Every hour** — fetch again (configurable via `UPDATE_CHECK_INTERVAL`)
3. **On demand** — client sends `update_check` message
4. **Cache** — result saved to `~/.anton/update-manifest.json` (survives restarts)

If a newer version exists, the agent:
- Caches the manifest
- Includes `updateAvailable` in the next `auth_ok` handshake
- Emits `update_available` event to any connected client

### How self-update works

The agent supports two update paths. It automatically picks the right one based on whether the manifest includes binary URLs.

#### Binary update (default for production VMs)

When `manifest.binaries` has a URL for the current platform+arch:

```
User clicks "Update"
        │
        ▼
Desktop sends: { type: "update_start" }
        │
        ▼
Agent runs binary update pipeline:
        │
        ├── 1. Download binary from release URL
        │      → { stage: "downloading", message: "..." }
        │
        ├── 2. Atomic replace: backup current → rename new → chmod +x
        │      → { stage: "replacing", message: "..." }
        │      (rolls back to backup on failure)
        │
        ├── 3. Write ~/.anton/version.json
        │
        ├── 4. systemctl restart anton-agent
        │      → { stage: "restarting", message: "..." }
        │
        └── 5. Done (or error)
               → { stage: "done", message: "Updated to v0.6.0 (abc1234)" }
```

This path is fast (10-30 seconds) because there is no build step. The VM only needs the binary — no git, pnpm, or Node.js build toolchain required.

#### Source update (fallback for dev / pre-binary releases)

When `manifest.binaries` is absent or has no entry for the current platform:

```
Agent runs source update pipeline:
        │
        ├── 1. git pull --ff-only
        │      → { stage: "pulling", message: "..." }
        │
        ├── 2. pnpm install --no-frozen-lockfile
        │      → { stage: "installing", message: "..." }
        │
        ├── 3. pnpm build (all packages in order)
        │      → { stage: "building", message: "..." }
        │
        ├── 4. Write ~/.anton/version.json
        │
        ├── 5. systemctl restart anton-agent
        │      → { stage: "restarting", message: "..." }
        │
        └── 6. Done (or error)
               → { stage: "done", message: "Updated to v0.6.0 (abc1234)" }
```

This path is slower (2-5 minutes) but works for development and when running from source.

Each step streams `update_progress` messages back to the client so you can show a progress indicator.

After restart, the desktop auto-reconnects (it already has 3-second reconnect logic) and gets the new version in `auth_ok`.

### Binary distribution

The agent is compiled into a standalone executable using Node.js Single Executable Application (SEA). This bundles the V8 runtime + all application code into one file with zero runtime dependencies.

#### How the binary is built

A GitHub Actions workflow runs on every tagged release:

1. `git tag v0.6.0 && git push --tags` triggers the workflow
2. CI builds all TypeScript packages (`pnpm build`)
3. Bundles the agent-server entry point into a single JS blob (using esbuild or similar)
4. Injects the blob into a Node.js SEA binary for each target: `linux-x64`, `linux-arm64`
5. Uploads binaries as GitHub Release assets
6. Updates `manifest.json` with the new version + binary URLs
7. Pushes the updated `manifest.json` to `main`

#### What's on the VM

For binary-deployed VMs, the filesystem is minimal:

```
~/.anton/
├── anton-agent              ← The single binary (self-contained)
├── config.yaml              ← User config
├── version.json             ← Current version metadata
├── update-manifest.json     ← Cached latest manifest
├── sessions/                ← Session data
└── certs/                   ← TLS certs
```

No `node_modules/`, no `.git/`, no source code. The binary is the entire agent.

#### Platform key format

Binary URLs in the manifest are keyed by `{platform}-{arch}`:

| Key | Target |
|-----|--------|
| `linux-x64` | Linux x86_64 (most Huddle01 / cloud VMs) |
| `linux-arm64` | Linux ARM64 (Graviton, Ampere) |

Only linux binaries are built. The agent binary runs on VMs — macOS users run from source during development.

### Where the agent finds itself

For **binary mode**: the binary runs from `~/.anton/anton-agent`. The updater replaces this file in-place.

For **source mode** (fallback), the updater checks these locations in order:

1. **Git root** — if running from source (`git rev-parse --show-toplevel`)
2. **`~/.anton/agent/`** — deployed via `make sync`
3. **`/opt/anton/`** — system install

## Protocol Messages

All update messages use the **CONTROL channel** (0x00):

| Direction | Message | Purpose |
|-----------|---------|---------|
| Client → Agent | `update_check` | "Check for updates now" |
| Agent → Client | `update_check_response` | Current + latest versions, changelog |
| Client → Agent | `update_start` | "Go ahead and update yourself" |
| Agent → Client | `update_progress` | Stage-by-stage progress |

Plus one **EVENTS channel** (0x04) message:

| Direction | Message | Purpose |
|-----------|---------|---------|
| Agent → Client | `update_available` | Proactive notification when periodic check finds a new version |

## Desktop Store

The Zustand store tracks update state:

```typescript
// Version info (set on auth_ok)
agentVersion: string | null
agentSpecVersion: string | null
agentGitHash: string | null

// Update state
updateInfo: UpdateInfo | null     // latest version details
updateStage: UpdateStage          // current self-update progress
updateMessage: string | null      // progress message
updateDismissed: boolean          // user dismissed the banner
```

The `Connection` class exposes:
- `connection.sendUpdateCheck()` — trigger a manual check
- `connection.sendUpdateStart()` — start self-update

## Changelog

All releases are documented in `CHANGELOG.md` at the repo root using the [Keep a Changelog](https://keepachangelog.com/) format.

### Format

```markdown
## [Unreleased]

### Added
- New feature description

### Changed
- What was modified

### Removed
- What was taken out

---

## [0.6.0] - 2026-03-25

### Added
- ...
```

Categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.

### How it flows into releases

1. As you develop, add entries under `## [Unreleased]` in `CHANGELOG.md`
2. When you run `./scripts/release.sh 0.6.0`, the script:
   - Moves all `[Unreleased]` entries under a new `## [0.6.0] - {date}` heading
   - Leaves `[Unreleased]` empty for the next cycle
   - Extracts the changelog body into `manifest.json` so agents can show it
   - Saves release notes to `/tmp/anton-release-notes.md` for the GitHub Release
3. The changelog body is included in the GitHub Release and shown in the desktop app when the user clicks "What's new?"

## Release Workflow

### The release script

All releases go through `./scripts/release.sh`:

```bash
./scripts/release.sh 0.6.0
```

This automates:
1. Updates `package.json` versions across the entire monorepo
2. Moves `[Unreleased]` changelog entries under the new version heading
3. Updates `manifest.json` with new version + binary download URLs
4. Commits everything and creates a git tag

After the script runs, you choose how to build:

### Option A: CI builds the binary (hands-off, costs GitHub Actions minutes)

```bash
git push origin main --tags
```

The GitHub Actions workflow (`.github/workflows/release.yml`) runs **only on version tags** (`v*`), not on every push to main. It:
1. Builds TypeScript packages
2. Bundles with esbuild into a single JS file
3. Creates Node.js SEA binaries for `linux-x64` and `linux-arm64`
4. Creates a GitHub Release with binaries + changelog
5. Updates `manifest.json` with the git hash

### Option B: Build locally and upload (free, faster)

```bash
./scripts/build-binary.sh                    # Build binary for your platform
git push origin main --tags                  # Push the tag
gh release create v0.6.0 \                   # Create release manually
  --title "v0.6.0" \
  --notes-file /tmp/anton-release-notes.md \
  dist/anton-agent-*
```

This skips CI entirely. You build on your machine and upload directly.

For cross-platform builds (e.g. building linux-x64 on a Mac), you can use Docker or a remote linux machine:
```bash
ssh your-linux-vm "cd /path/to/repo && ./scripts/build-binary.sh linux-x64"
```

### Shipping a dev/test update (no binary)

1. Make your changes, push to `main`
2. Update `manifest.json` manually (without `binaries` field):
   ```json
   {
     "version": "0.6.0",
     "specVersion": "0.5.0",
     "gitHash": "",
     "releaseUrl": "https://github.com/OmGuptaIND/anton.computer/releases",
     "changelog": "- What changed",
     "publishedAt": "2026-03-22T00:00:00Z"
   }
   ```
3. Agents fall back to source update: git pull → pnpm install → build → restart

### When to bump what

| Change | Bump package version | Bump spec version |
|--------|---------------------|-------------------|
| Bug fix (no protocol change) | Yes | No |
| New feature (new messages) | Yes | Yes |
| Breaking protocol change | Yes | Yes + update `MIN_CLIENT_SPEC` / `MIN_AGENT_SPEC` |
| Desktop-only change | Desktop version only | No |

### What happens if versions mismatch

| Scenario | What happens |
|----------|-------------|
| Old desktop, new agent | Works fine. Desktop ignores unknown fields/messages. Missing new UI features. |
| New desktop, old agent | Works fine. Agent ignores unknown messages. Desktop shows "Agent outdated" banner. |
| Desktop spec < agent's `minClientSpec` | Desktop shows "Please update your desktop app" warning. Still connects. |
| Agent spec < desktop's `MIN_AGENT_SPEC` | Desktop shows "Agent outdated — please update" banner. Still connects. |

**Nothing ever breaks.** The worst case is degraded features with a banner telling you what to do.

## File Map

```
packages/agent-config/src/version.ts    ← Version constants, semver utils, manifest types
packages/protocol/src/messages.ts        ← Update protocol message types
packages/agent-server/src/updater.ts     ← Updater service (binary + source self-update)
packages/agent-server/src/server.ts      ← Wired into handshake + control channel
packages/desktop/src/lib/connection.ts   ← sendUpdateCheck(), sendUpdateStart()
packages/desktop/src/lib/store.ts        ← Update state in Zustand store
manifest.json                            ← Release manifest (source of truth)
CHANGELOG.md                             ← Version history (Keep a Changelog format)
scripts/release.sh                       ← Release automation (version bump + changelog + tag)
scripts/build-binary.sh                  ← Local binary build (avoids CI costs)
.github/workflows/release.yml            ← CI binary build + GitHub Release (on tag push)
SPEC.md                                  ← Wire protocol spec (v0.5.0 section)
```
