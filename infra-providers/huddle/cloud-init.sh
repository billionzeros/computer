#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Huddle Cloud-Init Script
#
# This script is injected by Huddle when spinning up agent machines.
# It downloads the anton agent binary, installs Caddy, and configures
# Caddy to reverse-proxy wss:// traffic to the agent.
#
# Usage:  Paste into your cloud provider's user-data / cloud-init field,
#         or run manually on a fresh Ubuntu 22.04+ / Debian 12+ machine.
#
# Required env vars (set in Huddle's infra config):
#   DOMAIN           — e.g. "agent-42.huddle.computer"
#   ANTHROPIC_API_KEY
#
# Optional:
#   AGENT_PORT       — override default 9876
#   AGENT_ARCH       — "x64" (default) or "arm64"
#   ANTON_TOKEN      — force a specific auth token (skips random generation)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ──
AGENT_PORT="${AGENT_PORT:-9876}"
AGENT_ARCH="${AGENT_ARCH:-arm64}"
ANTON_DIR="/home/anton/.anton"
BINARY_URL="https://github.com/OmGuptaIND/anton.computer/releases/latest/download/anton-agent-linux-${AGENT_ARCH}"

echo ">>> Huddle agent provisioner"
echo "    Domain  : ${DOMAIN}"
echo "    Port    : ${AGENT_PORT}"
echo "    Arch    : ${AGENT_ARCH}"

# ── 1. System deps ──
apt-get update -qq
apt-get install -y -qq curl debian-keyring debian-archive-keyring apt-transport-https

# ── 2. Create dedicated user ──
if ! id anton &>/dev/null; then
    useradd --system --create-home --shell /usr/sbin/nologin anton
fi
mkdir -p "${ANTON_DIR}"

# ── 3. Download agent binary ──
echo ">>> Downloading agent binary from ${BINARY_URL}"
curl -fSL -o /usr/local/bin/anton-agent "${BINARY_URL}"
chmod +x /usr/local/bin/anton-agent

# ── 4. Write agent config ──
cat > "${ANTON_DIR}/config.yaml" <<YAML
port: ${AGENT_PORT}
YAML

# ── 5. Set up environment file (API keys) ──
cat > /etc/anton-agent.env <<ENV
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTON_DIR=${ANTON_DIR}
${ANTON_TOKEN:+ANTON_TOKEN=${ANTON_TOKEN}}
ENV
chmod 600 /etc/anton-agent.env

# ── 6. Create systemd service for the agent ──
cat > /etc/systemd/system/anton-agent.service <<UNIT
[Unit]
Description=Anton Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=anton
Group=anton
EnvironmentFile=/etc/anton-agent.env
ExecStart=/usr/local/bin/anton-agent --port ${AGENT_PORT}
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${ANTON_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# Fix ownership
chown -R anton:anton "${ANTON_DIR}"

# Start the agent
systemctl daemon-reload
systemctl enable --now anton-agent

echo ">>> Agent running on ws://127.0.0.1:${AGENT_PORT}"

# ── 7. Install Caddy ──
echo ">>> Installing Caddy"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy

# ── 8. Configure Caddy as reverse proxy ──
#
# Caddy auto-provisions TLS via Let's Encrypt — no cert management needed.
# It terminates wss:// and proxies plain ws:// to the agent on localhost.
#
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    # Reverse proxy WebSocket traffic to the agent
    reverse_proxy localhost:${AGENT_PORT}

    # Optional: restrict to WebSocket upgrades only
    # @websocket {
    #     header Connection *Upgrade*
    #     header Upgrade    websocket
    # }
    # reverse_proxy @websocket localhost:${AGENT_PORT}
}
CADDY

# Restart Caddy to pick up the new config
systemctl restart caddy

echo ">>> Caddy configured: https://${DOMAIN} → http://127.0.0.1:${AGENT_PORT}"
echo ">>> Done! Agent is live at https://${DOMAIN} (wss:// also supported)"
