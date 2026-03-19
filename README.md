# anton.computer

**Your personal cloud computer. An AI agent that runs on your server, 24/7, and actually does the work.**

> Not a chatbot. Not a wrapper. A real agent with shell access, file management, and autonomous skills — running on YOUR infrastructure.

---

## Current Status (Last verified: 2026-03-19)

### What's working

- **Agent builds and runs** on Ubuntu VM (OrbStack, tested on `arm64`)
- **WebSocket auth works** — desktop sends token, agent responds `auth_ok`
- **pi SDK integrated** — uses `@mariozechner/pi-agent-core@0.60.0` (the engine behind OpenClaw) with TypeBox schemas, `beforeToolCall` for dangerous command confirmation
- **5 tools built** — shell, filesystem, browser, process, network
- **Skills system** — YAML-based skill loader + cron scheduler for 24/7 autonomous work
- **Self-signed TLS** — auto-generated on first run
- **Deploy script** — `deploy/install.sh` handles full VPS setup (Node.js, pnpm, build, systemd)

### Verified test flow

```
1. OrbStack Ubuntu VM "anton" running at anton.orb.local
2. Agent installed at ~/.anton/agent/ on VM
3. Built with: pnpm install && pnpm --filter @anton/protocol build && pnpm --filter @anton/agent build
4. Started: node packages/agent/dist/index.js
5. Agent listens on wss://0.0.0.0:9876
6. WebSocket connection from Mac → VM authenticated successfully
```

### Last known config (on VM)

```
Agent ID: anton-anton-40324587
Token:    ak_3cf9197a3b567a3941ca4edf914e35902c8e3b54a6dd8bf1
Port:     9876
Host:     anton.orb.local (OrbStack) or VM IP for real VPS
Config:   /home/omg/.anton/config.yaml
Certs:    /home/omg/.anton/certs/{cert,key}.pem
```

### What's NOT working yet

- **Desktop app** — code exists but not connected to a running agent yet
- **Terminal pipe** — PTY channel defined in protocol but not wired up in server
- **File sync** — channel defined, not implemented
- **pi SDK session persistence** — agent creates session dir but pi Agent doesn't persist across restarts yet (need to wire state save/load)
- **npm publish** — `@anton/agent` not published, install is from source only

### Dependencies (pinned versions that work)

```
Node.js:                   v22.22.1 (on VM)
pnpm:                      10.32.1
@mariozechner/pi-ai:       0.60.0
@mariozechner/pi-agent-core: 0.60.0
@sinclair/typebox:         0.34.x
ws:                        8.19.0
node-pty:                  1.1.0 (needs make, g++, python3)
```

---

## What is this?

Install an agent on any VPS. Connect from a native desktop app. Give it tasks. It executes them.

```
You: "Deploy nginx, configure SSL for example.com, and set up a cron to renew certs"

Agent: [installs nginx] → [generates certbot config] → [runs certbot] → [adds cron] → "Done.
       Site is live at https://example.com, cert auto-renews monthly."
```

The agent has full access to your server — filesystem, shell, network, processes. It breaks tasks into steps, executes each one, verifies the result, and reports back. If something fails, it tries to fix it before asking you.

## Quick Start

### 1. Install the agent on your server

```bash
# On any Ubuntu/Debian VPS
ssh root@your-vps

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm

# Clone and build
git clone https://github.com/anthropics/anton.computer ~/.anton/agent
cd ~/.anton/agent
pnpm install --no-frozen-lockfile
pnpm --filter @anton/protocol build
pnpm --filter @anton/agent build
```

### 2. Set your AI API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude (default)
# or
export OPENAI_API_KEY=sk-...          # GPT-4o
# or configure Ollama for local models in ~/.anton/config.yaml
```

### 3. Start the agent

```bash
node ~/.anton/agent/packages/agent/dist/index.js
```

```
┌─────────────────────────────────────┐
│  anton.computer agent v0.1.0        │
│  Your personal cloud computer.      │
└─────────────────────────────────────┘

  Config created: ~/.anton/config.yaml
  Token: ak_7f3a2b...

  anton.computer agent running on wss://0.0.0.0:9876
  Agent ID: anton-myserver-a1b2c3d4
  Token: ak_7f3a2b...
```

### 4. Connect from the desktop app

Open the anton.computer desktop app, enter your server IP + token, connected.

### Local dev with OrbStack

```bash
# Create Ubuntu VM
orb create ubuntu anton

# Install inside VM
orb run -m anton bash -c "
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs make g++ python3
  sudo npm install -g pnpm
"

# Copy source to VM (OrbStack mounts Mac FS at /mnt/mac)
orb run -m anton bash -c "
  mkdir -p ~/.anton/agent
  cp -r /mnt/mac/path/to/anton.computer/{package.json,pnpm-workspace.yaml,packages} ~/.anton/agent/
  cd ~/.anton/agent
  pnpm install --no-frozen-lockfile
  pnpm --filter @anton/protocol build
  pnpm --filter @anton/agent build
  node packages/agent/dist/index.js
"

# Connect from Mac at: wss://anton.orb.local:9876
```

## Skills — AI Workers in a YAML File

Skills turn the agent into specialized workers. Drop a file in `~/.anton/skills/`:

```yaml
# ~/.anton/skills/server-monitor.yaml
name: Server Monitor
description: Monitors server health and alerts on issues
schedule: "0 */6 * * *"  # Every 6 hours

prompt: |
  Check disk, memory, CPU, failed services, error logs.
  Report any issues found. If healthy, give brief "all clear".

tools:
  - shell
  - filesystem
```

## Architecture

```
YOUR DESKTOP                              YOUR VPS
┌──────────────────┐    WebSocket (TLS)    ┌──────────────────────┐
│  Desktop App     │◄────────────────────►│  Agent Daemon        │
│  (Tauri v2)      │    Single conn,      │  (Node.js)           │
│                  │    multiplexed       │                      │
│  - Agent chat    │    channels          │  - pi SDK engine     │
│  - Terminal      │                      │  - 5 built-in tools  │
│  - Notifications │                      │  - Skills + scheduler│
└──────────────────┘                      │  - Session persist.  │
                                          └──────────────────────┘
```

**Agent brain:** [pi SDK](https://github.com/badlogic/pi-mono) (`@mariozechner/pi-agent-core`) — the engine inside OpenClaw. Agentic tool-calling loop, context management, multi-model support. We don't reinvent the wheel.

**Protocol:** Single WebSocket, 5 multiplexed channels:

| Channel | ID | Purpose |
|---------|-----|---------|
| CONTROL | 0x00 | Auth, ping/pong, lifecycle |
| TERMINAL | 0x01 | PTY data (shell access) |
| AI | 0x02 | Agent chat, tool calls, confirmations |
| FILESYNC | 0x03 | Bidirectional file sync (v0.2) |
| EVENTS | 0x04 | Status updates, notifications |

## Built-in Tools

| Tool | What it does |
|------|-------------|
| `shell` | Execute any command. Timeout, 10MB buffer. Dangerous patterns need desktop approval. |
| `filesystem` | Read, write, search, list, tree files. 100KB read limit with truncation. |
| `browser` | Fetch web pages via curl, extract content. Playwright for full automation in v0.2. |
| `process` | List (`ps aux`), inspect, kill processes. |
| `network` | Scan ports (`ss`), HTTP requests (`curl`), DNS lookup, ping. |

## Project Structure

```
anton.computer/
├── packages/
│   ├── agent/          # Node.js daemon (runs on VPS)
│   │   ├── src/
│   │   │   ├── agent.ts       # pi SDK agent with custom tools
│   │   │   ├── server.ts      # WebSocket server + auth
│   │   │   ├── config.ts      # YAML config loader
│   │   │   ├── skills.ts      # YAML skill loader
│   │   │   ├── scheduler.ts   # Cron-based skill runner
│   │   │   └── tools/         # shell, filesystem, browser, process, network
│   │   └── package.json
│   ├── desktop/        # Tauri v2 native app (WIP)
│   │   ├── src/
│   │   │   ├── components/    # Connect, AgentChat, Terminal
│   │   │   └── lib/           # WebSocket client, state
│   │   └── src-tauri/         # Rust backend
│   └── protocol/       # Shared types & binary codec
│       └── src/
│           ├── codec.ts       # encodeFrame / decodeFrame
│           ├── messages.ts    # All message types per channel
│           └── pipes.ts       # Channel ID constants
├── deploy/
│   ├── install.sh      # One-command VPS setup
│   └── Dockerfile      # Container deployment
├── SHIPPING.md         # Milestone tracker
├── ARCHITECTURE.md     # System design
└── GOALS.md            # Product vision
```

## Configuration

Agent config at `~/.anton/config.yaml` (auto-generated on first run):

```yaml
agentId: anton-myserver-a1b2c3d4
token: ak_... # random, used by desktop app to authenticate
port: 9876

ai:
  provider: anthropic    # anthropic | openai | ollama | google | bedrock
  model: claude-sonnet-4-6
  apiKey: ""             # or set ANTHROPIC_API_KEY env var

security:
  confirmPatterns:       # commands that need desktop approval
    - rm -rf
    - sudo
    - shutdown
    - reboot
    - mkfs
    - "dd if="
  forbiddenPaths:        # AI can't read these
    - /etc/shadow
    - ~/.ssh/id_*
    - ~/.anton/config.yaml
```

## Security

- **Token auth** — random token generated on install, required for WebSocket connection
- **TLS** — self-signed cert auto-generated, desktop pins fingerprint
- **Dangerous command approval** — configurable patterns trigger desktop confirmation dialog
- **Forbidden paths** — AI cannot read sensitive files (SSH keys, config with token)
- **No root by default** — agent runs as your user

## Roadmap

See [GOALS.md](./GOALS.md) and [SHIPPING.md](./SHIPPING.md).

## License

Apache 2.0
