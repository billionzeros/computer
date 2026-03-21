<p align="center">
  <h1 align="center">anton.computer</h1>
  <p align="center">
    <strong>A computer that thinks. Your AI agent, on your server, 24/7.</strong>
  </p>
  <p align="center">
    <a href="https://github.com/OmGuptaIND/anton.computer/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
    <a href="https://github.com/OmGuptaIND/anton.computer/releases"><img src="https://img.shields.io/github/v/release/OmGuptaIND/anton.computer" alt="Release"></a>
    <a href="https://github.com/OmGuptaIND/anton.computer/issues"><img src="https://img.shields.io/github/issues/OmGuptaIND/anton.computer" alt="Issues"></a>
    <a href="https://antoncomputer.in"><img src="https://img.shields.io/badge/website-antoncomputer.in-orange" alt="Website"></a>
  </p>
</p>

---

Anton is an open-source AI agent that lives on your server and does real work autonomously. Not just chat — it executes shell commands, manages files, deploys code, scrapes the web, monitors systems, and remembers everything across sessions. You describe what you need, Anton does it.

**Always on. Never stops. Yours.**

## Why Anton?

Most AI tools give you text. Anton gives you **execution**. It runs on a dedicated machine you control — a VPS, a homelab box, a cloud instance — with full shell access and persistent memory.

- **Autonomous work** — Schedule tasks, run cron jobs, monitor systems. Anton works while you sleep.
- **Real execution** — 17+ tools: shell, filesystem, git, browser, database, networking, and more.
- **Self-hosted** — Your server, your data. Zero vendor lock-in.
- **Multi-provider** — Claude, GPT-4, Gemini, Ollama (local), Groq, Together, Mistral, Bedrock, OpenRouter.
- **Desktop + CLI** — Native Tauri app or terminal client. Your choice.
- **Persistent memory** — Remembers projects, files, and context across sessions.
- **Extensible** — Add custom tools and skills in TypeScript + YAML.

## What can Anton do?

```
"Monitor competitor pricing every 6 hours and alert me when changes happen"
"Set up a Node.js project with Express, write tests, and deploy it"
"Scrape 800 companies, categorize by industry, output a spreadsheet"
"Watch my logs for errors and restart the service if it crashes"
"Build me a landing page with email capture and deploy it"
```

Anton doesn't generate code for you to copy-paste. It runs the commands, creates the files, and deploys the result.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- An AI provider API key (Anthropic, OpenAI, etc.)

### Install & Run

```bash
git clone https://github.com/OmGuptaIND/anton.computer.git
cd anton.computer
pnpm install
pnpm dev          # builds protocol, runs agent + desktop concurrently
```

### Connect

Open the desktop app, enter your agent's host (e.g. `203.0.113.10:9876`) and token to connect.

Or use the CLI:

```bash
pnpm cli:dev -- connect 203.0.113.10 --token ak_your_token_here
```

## Deploy to Your Server

### Option A: Ansible (recommended)

```bash
# 1. Install Ansible
make setup

# 2. Add your VPS to deploy/ansible/inventory.ini
# [anton_agents]
# myserver  ansible_host=203.0.113.10  ansible_user=ubuntu  ansible_ssh_private_key_file=~/.ssh/my_key

# 3. Deploy
make deploy HOST=myserver API_KEY=sk-ant-api03-xxxxx

# 4. Get your connection token
ssh ubuntu@203.0.113.10
cat /home/anton/.anton/config.yaml | grep token
```

Ansible handles everything: Node.js, pnpm, systemd service, firewall, security hardening.

### Option B: Install Script

```bash
ssh ubuntu@your-vps
git clone https://github.com/OmGuptaIND/anton.computer.git ~/.anton/agent
cd ~/.anton/agent && bash deploy/install.sh
export ANTHROPIC_API_KEY=sk-ant-...
~/.anton/start.sh
```

## Architecture

```
anton.computer/
├── packages/
│   ├── agent-server/      # WebSocket server (Node.js daemon)
│   ├── agent-core/        # AI engine, tools, system prompt
│   ├── agent-config/      # Config loading & validation
│   ├── agent/             # Agent entry point
│   ├── cli/               # Terminal client (Ink + WebSocket)
│   ├── desktop/           # Native app (Tauri v2 + React 19)
│   └── protocol/          # Shared types & binary codec
├── deploy/
│   ├── ansible/           # Production deployment playbook
│   └── install.sh         # One-command VPS setup
├── specs/                 # Protocol & architecture specs
└── Makefile               # Deploy, sync, manage commands
```

### Agent Tools

| Category | Tools |
|----------|-------|
| **System** | `shell`, `filesystem`, `process`, `network`, `clipboard`, `notification` |
| **Development** | `git`, `code_search`, `diff`, `http_api` |
| **Data** | `database` (SQLite), `memory` (persistent KV), `todo` |
| **Content** | `browser` (fetch + scrape), `image`, `artifact` (HTML/SVG/Mermaid) |
| **Interaction** | `plan`, `ask_user` |

### Protocol

Single WebSocket connection multiplexed across 5 channels:

| Channel | Purpose |
|---------|---------|
| `CONTROL` | Auth, ping/pong, config, updates |
| `TERMINAL` | Remote PTY access |
| `AI` | Sessions, chat, tool calls |
| `FILESYNC` | Remote filesystem browsing |
| `EVENTS` | Status updates, notifications |

Full spec in [`specs/SPEC.md`](specs/SPEC.md).

## Configuration

Agent config lives at `~/.anton/config.yaml` (auto-generated on first run):

```yaml
agentId: anton-myserver-a1b2c3d4
token: ak_...
port: 9876

ai:
  provider: anthropic    # anthropic | openai | google | ollama | groq | together | openrouter | bedrock | mistral
  model: claude-sonnet-4-6
  apiKey: ""             # or set ANTHROPIC_API_KEY env var
```

## Day-to-Day Commands

```bash
# Development
pnpm dev                      # run everything (agent + desktop)
pnpm agent:dev                # agent server only
pnpm desktop:dev              # desktop app only
pnpm cli:dev                  # CLI interactive REPL

# Deployment
make sync HOST=myserver       # push local code to VPS
make status                   # check service health
make logs HOST=myserver       # tail agent logs
make restart                  # restart agent service
make verify                   # full health check

# Quality
pnpm typecheck                # run type checking
pnpm check                    # lint + format check
pnpm check:fix                # auto-fix lint/format issues
```

## Contributing

We welcome contributions! Anton is open source because we believe AI agents should be owned by the people who use them.

### Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/anton.computer.git`
3. **Install** dependencies: `pnpm install`
4. **Create a branch**: `git checkout -b feat/your-feature`
5. **Make your changes**
6. **Run checks**: `pnpm verify` (typecheck + lint)
7. **Commit** with a descriptive message
8. **Push** and open a Pull Request

### What to Contribute

- **New tools** — Add capabilities to the agent in `packages/agent-core/src/tools/`
- **Skills** — Create reusable YAML-defined automation workflows
- **Desktop UI** — Improve the Tauri app in `packages/desktop/`
- **CLI features** — Enhance the terminal client in `packages/cli/`
- **Deployment** — Better Docker support, new cloud providers, Kubernetes
- **Documentation** — Improve specs, add guides, write tutorials
- **Bug fixes** — Check [open issues](https://github.com/OmGuptaIND/anton.computer/issues)

### Guidelines

- Run `pnpm verify` before submitting a PR
- Keep PRs focused — one feature or fix per PR
- Write descriptive commit messages
- Add types — the codebase uses TypeScript throughout
- Follow existing code style (Biome for linting/formatting)

### Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/OmGuptaIND/anton.computer/issues/new) with:

- A clear description of the problem or feature
- Steps to reproduce (for bugs)
- Your environment (OS, Node.js version, provider)

## Community

- [Website](https://antoncomputer.in)
- [GitHub Issues](https://github.com/OmGuptaIND/anton.computer/issues)
- [Releases](https://github.com/OmGuptaIND/anton.computer/releases)

## License

Anton is licensed under the [Apache License 2.0](LICENSE).

You are free to use, modify, and distribute this software. See the [LICENSE](LICENSE) file for details.
