# Deployment Spec — Repo-Clone Model

> **Status:** Migrating from SEA binary to repo-clone. `deploy/install.sh` already uses the new model.

## Overview

Anton runs directly from a git clone of the repo. No SEA binary, no Docker container, no bundling. The same code path runs everywhere: developer laptop, personal VPS, customer machines.

```
git clone → pnpm install → pnpm build → node dist/index.js
```

## Why Repo-Clone

| | SEA Binary (old) | Repo Clone (new) |
|---|---|---|
| Workflow files (.md, .py) | Can't access — not in binary | All present on disk |
| import.meta.url | Breaks in CJS bundle | Works normally |
| Debug on server | Minified single file | Full source + dist |
| Dev/prod parity | Different code paths | Identical |
| Updates | Download new binary | `git pull && pnpm build` |
| Anton self-modification | Impossible | Can read/modify own code |
| Build complexity | esbuild → Docker → SEA → postject | `pnpm build` |
| Python scripts | Would need embedding | Just files on disk |
| Customer install | Download 80MB binary | Clone + build (~2 min) |

## Directory Layout on Server

```
/home/anton/
├── computer/                        ← git clone of the repo
│   ├── packages/
│   │   ├── agent-server/
│   │   │   ├── src/                 ← TypeScript source (for inspection)
│   │   │   ├── dist/                ← compiled JS (what runs)
│   │   │   │   └── index.js         ← ExecStart points here
│   │   │   └── src/workflows/builtin/  ← workflow files (agents, scripts, templates)
│   │   ├── agent-core/dist/
│   │   ├── agent-config/dist/
│   │   ├── connectors/dist/
│   │   └── protocol/dist/
│   ├── node_modules/                ← dependencies
│   ├── package.json
│   └── pnpm-lock.yaml
│
├── .anton/                          ← runtime data (unchanged)
│   ├── config.yaml
│   ├── agent.env
│   ├── tokens/
│   ├── projects/
│   └── version.json
```

## Constants

```typescript
// OLD
export const AGENT_BIN = '/usr/local/bin/anton-agent'

// NEW
export const REPO_DIR = '/opt/anton'
export const AGENT_ENTRY = `${REPO_DIR}/packages/agent-server/dist/index.js`
```

## Systemd Service

```ini
[Unit]
Description=Anton Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=anton
Group=anton
EnvironmentFile=/home/anton/.anton/agent.env
WorkingDirectory=/opt/anton
ExecStart=/usr/bin/node /opt/anton/packages/agent-server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Key changes from old service:
- `ExecStart` → `node dist/index.js` instead of `/usr/local/bin/anton-agent`
- `WorkingDirectory` → repo root (so relative paths work)
- No `ProtectSystem=strict` (Anton needs full server access)

## Install Flow (Customer)

```bash
curl -fsSL https://antoncomputer.in/install.sh | bash
```

The install script:
1. Creates `anton` user (if not exists)
2. Installs Node.js 22 + pnpm
3. `git clone https://github.com/billionzeros/computer.git /opt/anton`
4. `cd /opt/anton && pnpm install && pnpm -r build`
5. Runs `anton computer setup` (creates systemd, env file, config)
6. Starts the service

## Update Flow

```bash
anton computer update    # from VM or remote
```

Updates are orchestrated by the **sidecar** (a stable Go binary), not the agent.
The agent never updates its own running code.

```
CLI / Desktop
    │
    ▼
Sidecar (HTTP)            ← stable Go binary, never restarts during update
    │
    ├─ GET  /update/check  → fetch manifest, compare versions
    └─ POST /update/start  → execute update, stream progress (NDJSON)
         │
         ├─ 1. Stop agent service
         ├─ 2. git fetch + reset --hard origin/main
         ├─ 3. pnpm install (CI=true, non-interactive)
         ├─ 4. pnpm -r build
         ├─ 5. Start agent service
         ├─ 6. Poll /health until healthy (30s timeout)
         └─ 7. On failure: rollback (restart agent with previous code)
```

**Desktop flow:** Agent receives `update_start` via WebSocket → proxies to sidecar
HTTP endpoint → relays streamed progress back to client.

**CLI flow (on VM):** Calls sidecar directly at `http://localhost:9878/update/*`.

**CLI flow (remote):** Calls sidecar via Caddy at `https://{domain}/_anton/update/*`.

Both endpoints require `Authorization: Bearer {ANTON_TOKEN}`.

## Dev Deploy (make sync)

```bash
make sync              # sync to all hosts
make sync HOST=agent1  # sync to one host
```

What it does:
1. `git push origin main` (push your latest code)
2. SSH into VPS: `git pull && pnpm install && pnpm -r build`
3. Restart systemd service
4. Health check

Alternative for unpushed code: rsync the local tree directly.

## Files to Update

| File | Change |
|------|--------|
| `packages/cli/src/commands/computer-common.ts` | `AGENT_BIN` → `AGENT_ENTRY`, add `REPO_DIR` |
| `packages/cli/src/commands/computer-setup.ts` | Clone repo instead of downloading binary |
| `packages/cli/src/commands/computer-lifecycle.ts` | Update uninstall to remove repo dir |
| `packages/agent-server/src/updater.ts` | Thin proxy — delegates to sidecar HTTP endpoints |
| `sidecar/internal/update/update.go` | Core update logic (stop → pull → build → start → verify) |
| `sidecar/internal/handlers/update.go` | HTTP handlers for `/update/check` and `/update/start` |
| `packages/agent-server/src/workflows/builtin-registry.ts` | Simplify — just read from disk, no SEA fallback |
| `Makefile` sync target | `git push + ssh git pull + build + restart` |
| `infra-providers/huddle/cloud-init.sh` | Clone repo instead of downloading binary |
| `deploy/install.sh` | Already uses repo-clone (verify it's current) |

## Migration for Existing Customers

Existing customers running the SEA binary at `/usr/local/bin/anton-agent`:
1. Next `anton update` (or manual update) switches to repo-clone
2. The updater detects it's running as SEA, clones the repo, rewrites systemd, restarts
3. Old binary at `/usr/local/bin/anton-agent` can be cleaned up

This is a one-time migration. After that, all updates are `git pull`.
