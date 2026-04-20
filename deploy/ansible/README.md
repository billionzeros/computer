# Anton Agent - Ansible Deployment

Deploy the Anton agent to any Linux VPS. This Ansible playbook handles the full setup: system dependencies, Node.js, building the agent from source, systemd service, and firewall configuration.

## Prerequisites

**On your local machine (the machine you run the deploy from):**

- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) installed (or run `make setup`)
- SSH access to the target VPS (IP address + private key)

**On the target VPS:**

- A fresh Linux server (Ubuntu 20.04+, Debian 11+, Fedora 38+, RHEL 8+, Rocky/Alma 8+)
- Root or sudo access
- Outbound internet access (to pull packages and clone the repo)

## Quick Start

```bash
cd deploy/ansible

# 1. Install Ansible (if you don't have it)
make setup

# 2. Edit inventory.ini — add your VPS IPs and SSH key
vim inventory.ini

# 3. Deploy
make deploy
```

That's it. Every host in your inventory gets the agent installed and running.

## Inventory Setup

Edit `inventory.ini` to define your servers. The shared SSH key and user go in `[anton_agents:vars]`, and each host just needs a name and IP:

```ini
[anton_agents]
agent1  ansible_host=203.0.113.10
agent2  ansible_host=203.0.113.20
agent3  ansible_host=10.0.0.5  ansible_user=ubuntu  # per-host override

[anton_agents:vars]
ansible_user=root
ansible_ssh_private_key_file=~/.ssh/id_rsa
# anthropic_api_key=sk-ant-api03-xxxxx
```

- Add one line per server under `[anton_agents]`
- Set `ansible_user` and `ansible_ssh_private_key_file` once in `[anton_agents:vars]`
- Override per host inline if a specific server has a different user or key
- Uncomment `anthropic_api_key` to bake the API key into all hosts

## Makefile Commands

```
make deploy                              # Deploy to all hosts in inventory
make deploy HOST=agent1                  # Deploy to one specific host
make deploy API_KEY=sk-ant-api03-xxxxx   # Deploy with API key
make deploy BRANCH=staging               # Deploy a specific git branch

make update                              # Pull latest code and rebuild on all hosts
make status                              # Check service status on all hosts
make logs                                # View last 50 log lines from all hosts
make logs HOST=agent2                    # View logs from a specific host
make restart                             # Restart agent on all hosts
make stop                                # Stop agent on all hosts
make ping                                # Test SSH connectivity to all hosts
make check                               # Dry-run (no changes, just show what would happen)
make setup                               # Install Ansible on this machine
make help                                # Show all available commands
```

## Alternative: deploy.sh (no inventory)

If you want to deploy to a single host without editing `inventory.ini`:

```bash
./deploy.sh 203.0.113.10 ~/.ssh/id_rsa
./deploy.sh 203.0.113.10 ~/.ssh/id_rsa ubuntu
./deploy.sh 203.0.113.10 ~/.ssh/id_rsa root sk-ant-api03-xxxxx
```

## Environment Variables

These variables end up on the VPS in the agent's environment file (`~/.anton/agent.env`, mode `0600`):

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for AI features) | Your Anthropic API key. The agent reads this at runtime to call Claude. |
| `HOME` | Set automatically | Home directory of the `anton` user. |
| `NODE_ENV` | Set automatically | Always `production`. |

**How to provide the API key:**

```bash
# Option 1: In inventory.ini (applies to all hosts)
# Uncomment the anthropic_api_key line in [anton_agents:vars]

# Option 2: Via make
make deploy API_KEY=sk-ant-api03-xxxxx

# Option 3: Set on the server after deploy
sudo -u anton bash -c 'echo "ANTHROPIC_API_KEY=sk-ant-api03-xxxxx" >> ~/.anton/agent.env'
sudo systemctl restart anton-agent
```

## Ansible Variables

All variables have sensible defaults and can be overridden in `inventory.ini`, via `make deploy`, or with `--extra-vars`.

| Variable | Default | Description |
|---|---|---|
| `anton_user` | `anton` | Linux user created on the VPS to run the agent. |
| `anton_install_dir` | `/home/anton/.anton` | Root directory for config, certs, sessions, and skills. |
| `anton_repo_dir` | `/home/anton/.anton/agent` | Where the repo is cloned and built. |
| `anton_repo_url` | `https://github.com/billionzeros/computer.git` | Git repository URL. |
| `anton_branch` | `main` | Git branch to deploy. |
| `node_major_version` | `22` | Node.js major version to install. |
| `anton_port` | `9876` | Port the agent WebSocket server listens on. |
| `anthropic_api_key` | `""` (empty) | Anthropic API key. Written to env file if provided. |
| `anton_start_on_deploy` | `true` | Start the agent immediately after deploy. |
| `anton_configure_firewall` | `true` | Open `anton_port` in UFW/firewalld. |

## What the Playbook Does (Step by Step)

The exact sequence of operations run on each target host:

### 1. Install system packages

Installs base dependencies needed to build and run the agent.

- **Debian/Ubuntu:** `curl`, `git`, `openssl`, `build-essential`, `python3`, `ufw`
- **RHEL/Fedora:** `curl`, `git`, `openssl`, `gcc`, `gcc-c++`, `make`, `python3`, `firewalld`

`build-essential` / `gcc` are required because the agent depends on `node-pty`, a native C++ addon that compiles during `pnpm install`.

### 2. Install Node.js 22

- Checks if Node.js is already installed and at version 22+.
- If not, adds the [NodeSource](https://github.com/nodesource/distributions) repository and installs Node.js 22.
- Skips entirely if the right version is already present.

### 3. Install pnpm

- Checks if `pnpm` is available globally.
- If not, installs it via `npm install -g pnpm`.

### 4. Create the `anton` user

- Creates a dedicated Linux user (default: `anton`) with a home directory and bash shell.
- The agent process runs as this user, not as root.

### 5. Clone the repository

- Creates the install directory (`/home/anton/.anton/`).
- Clones `https://github.com/billionzeros/computer.git` (shallow, depth 1) into `/home/anton/.anton/agent/`.
- On re-runs, pulls the latest commit from the configured branch.

### 6. Build the agent

Three commands run in sequence as the `anton` user:

```bash
pnpm install --no-frozen-lockfile    # Install all Node.js dependencies
pnpm --filter @anton/protocol build  # Build the shared protocol package first
pnpm --filter @anton/agent build     # Build the agent (TypeScript -> dist/)
```

### 7. Write the environment file

Renders `/home/anton/.anton/agent.env` with:

```
HOME=/home/anton
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-...   # only if provided
```

File permissions are `0600` (readable only by the `anton` user) to protect the API key.

### 8. Install and enable the systemd service

Creates `/etc/systemd/system/anton-agent.service` with:

- Runs as the `anton` user
- Loads env vars from `agent.env`
- Auto-restarts on crash (5 second delay, max 5 restarts per 60 seconds)
- Logs to journald
- **Hardening flags:**
  - `NoNewPrivileges=true` — prevents privilege escalation
  - `ProtectSystem=strict` — mounts `/` read-only except allowed paths
  - `ProtectHome=false` — allows write access to home directory for workspace/project files
  - `ReadWritePaths=/home/anton/.anton` — writable config path
  - `PrivateTmp=true` — isolated `/tmp`

Enables the service to start on boot and starts it immediately (if `anton_start_on_deploy` is true).

### 9. Configure firewall

- **Debian/Ubuntu:** Opens `anton_port` (default 9876) via UFW.
- **RHEL/Fedora:** Opens `anton_port` via firewalld.
- Skipped if `anton_configure_firewall` is set to `false`.

### 10. Print connection info

Reads the agent's auth token from `~/.anton/config.yaml` (generated on first run) and prints:

- Host and port to connect to
- The auth token for the desktop app
- Useful `systemctl` / `journalctl` commands

## Post-Deploy: Managing the Agent

Use the Makefile from your local machine:

```bash
make status                   # Service status across all hosts
make logs                     # Last 50 log lines from all hosts
make logs HOST=agent1         # Logs from one host
make restart                  # Restart on all hosts
make stop                     # Stop on all hosts
```

Or SSH into the server directly:

```bash
sudo systemctl status anton-agent
sudo journalctl -u anton-agent -f
sudo -u anton cat ~/.anton/config.yaml | grep token
sudo -u anton nano ~/.anton/config.yaml
```

## Updating the Agent

Re-run deploy. The playbook is idempotent — it pulls the latest code, rebuilds, and restarts:

```bash
make deploy

# Or update only (skip system deps, just rebuild)
make update

# Deploy a different branch
make deploy BRANCH=dev
```

## File Layout on the VPS

```
/home/anton/.anton/
  agent.env                          # Environment variables (API keys, mode 0600)
  config.yaml                        # Agent config (auto-generated on first run)
  certs/                             # Self-signed TLS certs (auto-generated)
  sessions/                          # AI session persistence
  skills/                            # YAML skill definitions
  scheduler.log                      # Skill execution logs
  agent/                             # Cloned repo
    packages/
      protocol/dist/                 # Built protocol package
      agent/dist/                    # Built agent (entry: dist/index.js)

/etc/systemd/system/
  anton-agent.service                # systemd unit file
```

## Directory Structure (This Repo)

```
deploy/ansible/
  Makefile             # All deploy/manage commands
  ansible.cfg          # Ansible settings (SSH pipelining, no host-key checking)
  deploy.sh            # Alternative: one-command deploy without inventory
  inventory.ini        # Your VPS hosts (edit this)
  playbook.yml         # Main playbook
  roles/
    anton-agent/
      defaults/
        main.yml       # All configurable variables with defaults
      handlers/
        main.yml       # systemd reload and restart handlers
      tasks/
        main.yml       # The full deployment pipeline
      templates/
        anton-agent.env.j2       # Environment file template
        anton-agent.service.j2   # systemd service template
```

## Supported Operating Systems

| OS | Versions | Package Manager |
|---|---|---|
| Ubuntu | 20.04, 22.04, 24.04 | apt |
| Debian | 11, 12 | apt |
| Fedora | 38+ | dnf |
| RHEL / CentOS | 8, 9 | dnf |
| Rocky Linux | 8, 9 | dnf |
| Alma Linux | 8, 9 | dnf |

## Troubleshooting

**"Permission denied" during SSH:**
- Ensure your SSH key has the right permissions: `chmod 600 ~/.ssh/your_key`
- Verify the user has sudo access on the VPS

**`node-pty` build fails:**
- The playbook installs `build-essential` (Debian) or `gcc`/`make` (RHEL), which are required. If it still fails, SSH in and run `sudo apt install python3 make g++` manually.

**Agent won't start:**
- Check logs: `make logs` or `sudo journalctl -u anton-agent -f`
- Verify the config: `sudo -u anton cat ~/.anton/config.yaml`
- Make sure port 9876 isn't already in use: `ss -tlnp | grep 9876`

**Can't connect from desktop app:**
- Verify the firewall allows port 9876: `sudo ufw status` or `sudo firewall-cmd --list-ports`
- Check if the agent is running: `make status`
- Test connectivity: `make ping`
