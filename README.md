# anton.computer

Your personal cloud computer. An AI agent that runs on your server, 24/7, with shell access, file management, and autonomous skills.

## Quick Start

```bash
pnpm install
pnpm dev          # builds protocol, runs agent + desktop concurrently
```

## Running the App

All commands run from the repo root.

### Desktop App (Tauri)

```bash
pnpm desktop:dev              # run in dev mode (hot reload)
pnpm desktop:build            # build the native app
```

Opens a native window — enter your agent's host (e.g. `203.0.113.10:9876`) and token to connect.

### CLI

```bash
pnpm cli:build                # build the CLI once

# Connect to an agent (interactive prompts for host/token)
pnpm cli:dev -- connect

# Connect with flags
pnpm cli:dev -- connect 203.0.113.10 --token ak_your_token_here

# Connect with TLS (port 9877)
pnpm cli:dev -- connect 203.0.113.10 --token ak_your_token_here --tls

# One-shot chat
pnpm cli:dev -- chat "check disk usage"

# Interactive REPL (uses saved default machine)
pnpm cli:dev

# Other commands
pnpm cli:dev -- machines              # list saved machines
pnpm cli:dev -- shell                 # remote shell
pnpm cli:dev -- skills list           # list skills
pnpm cli:dev -- status                # check agent status
pnpm cli:dev -- help                  # show all commands
```

### Agent Only

```bash
pnpm agent:dev                # run the agent server in dev mode
pnpm agent:build              # build for production
```

### All at Once

```bash
pnpm dev                      # builds protocol, runs agent + desktop together
```

## Deploy to a VPS

### Option A: Ansible (recommended)

```bash
# 1. Install Ansible
make setup

# 2. Add your VPS to deploy/ansible/inventory.ini
[anton_agents]
myserver  ansible_host=203.0.113.10  ansible_user=ubuntu  ansible_ssh_private_key_file=~/.ssh/my_key

# 3. Deploy
make deploy HOST=myserver API_KEY=sk-ant-api03-xxxxx

# 4. Get your connection token
ssh ubuntu@203.0.113.10
cat /home/anton/.anton/config.yaml | grep token
```

### Option B: Install Script

```bash
ssh ubuntu@your-vps
git clone https://github.com/OmGuptaIND/computer.git ~/.anton/agent
cd ~/.anton/agent && bash deploy/install.sh
export ANTHROPIC_API_KEY=sk-ant-...
~/.anton/start.sh
```

## Day-to-Day Commands

All commands run from the repo root:

```bash
# Sync local code to VPS (no git push needed)
make sync                     # all hosts
make sync HOST=myserver       # one host
pnpm deploy                   # alias for make sync
pnpm deploy myserver          # alias for make sync HOST=myserver

# Management
make status                   # check service status
make logs                     # tail agent logs
make logs HOST=myserver       # logs for one host
make restart                  # restart agent
make stop                     # stop agent
make verify                   # full health check
make ping                     # test SSH connectivity
make help                     # show all commands
```

## Project Structure

```
anton.computer/
├── packages/
│   ├── agent/          # Node.js daemon (runs on VPS)
│   ├── cli/            # Terminal client (ink + WebSocket)
│   ├── desktop/        # Tauri v2 native app
│   └── protocol/       # Shared types & binary codec
├── deploy/
│   ├── ansible/        # Playbook, inventory, roles
│   └── install.sh      # One-command VPS setup
├── Makefile            # Deploy/sync/manage commands
├── sync.sh             # pnpm deploy wrapper
└── SPEC.md             # Connection protocol spec
```

## Configuration

Agent config at `~/.anton/config.yaml` (auto-generated on first run):

```yaml
agentId: anton-myserver-a1b2c3d4
token: ak_...
port: 9876

ai:
  provider: anthropic    # anthropic | openai | ollama
  model: claude-sonnet-4-6
  apiKey: ""             # or set ANTHROPIC_API_KEY env var
```

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 9876 | `ws://`  | Primary WebSocket (default) |
| 9877 | `wss://` | TLS WebSocket |

## License

Apache 2.0
