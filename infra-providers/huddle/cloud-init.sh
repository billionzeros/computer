#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Huddle Cloud-Init Script for Anton Computer
#
# This script is injected by Huddle when spinning up agent machines.
# It downloads the anton agent binary (latest from manifest), installs
# Caddy, waits for DNS propagation, and configures Caddy to
# reverse-proxy wss:// traffic to the agent.
#
# Required env vars (set in Huddle's infra config):
#   DOMAIN           — e.g. "ac-abc1234.anton.computer"
#   ANTHROPIC_API_KEY
#
# Optional:
#   AGENT_PORT       — override default 9876
#   AGENT_ARCH       — "x64" or "arm64" (default)
#   ANTON_TOKEN      — force a specific auth token
#   CALLBACK_URL     — URL to POST status when init completes
#   USERNAME         — SSH login username to create
#   PASSWORD         — SSH login password for the user
#   EXA_PROXY_TOKEN  — Exa search API proxy token
#   BRAINTRUST_API_KEY — Braintrust observability key
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ──
AGENT_PORT="${AGENT_PORT:-9876}"
AGENT_ARCH="${AGENT_ARCH:-arm64}"
ANTON_DIR="/home/anton/.anton"
MANIFEST_URL="https://raw.githubusercontent.com/billionzeros/computer/main/manifest.json"
INIT_LOG="/var/log/anton-init.log"
INIT_START=$(date +%s)

# ─────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────
log() {
    local elapsed=$(( $(date +%s) - INIT_START ))
    echo "[+${elapsed}s] $1" | tee -a "$INIT_LOG"
}

echo "" > "$INIT_LOG"
log "INIT: started for ${DOMAIN}"
log "INIT: port=${AGENT_PORT} arch=${AGENT_ARCH}"

# ─────────────────────────────────────────────────────────────────
# 1. Wait for network
# ─────────────────────────────────────────────────────────────────
until ping -c1 8.8.8.8 &>/dev/null; do sleep 2; done
log "NETWORK: ready"

# ─────────────────────────────────────────────────────────────────
# 2. System deps
# ─────────────────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq curl jq dnsutils debian-keyring debian-archive-keyring apt-transport-https
log "DEPS: system packages installed"

# ─────────────────────────────────────────────────────────────────
# 3. Create SSH user (if USERNAME + PASSWORD provided)
# ─────────────────────────────────────────────────────────────────
if [ -n "${USERNAME:-}" ] && [ -n "${PASSWORD:-}" ]; then
    if ! id "$USERNAME" &>/dev/null; then
        useradd --create-home --shell /bin/bash "$USERNAME"
        log "USER: created $USERNAME"
    fi
    echo "${USERNAME}:${PASSWORD}" | chpasswd
    # Ensure password auth is enabled for SSH
    mkdir -p /etc/ssh/sshd_config.d
    cat > /etc/ssh/sshd_config.d/99-anton-password.conf <<SSHCFG
PasswordAuthentication yes
SSHCFG
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
    log "USER: password auth configured for $USERNAME"
fi

# ─────────────────────────────────────────────────────────────────
# 4. Create dedicated agent user
# ─────────────────────────────────────────────────────────────────
if ! id anton &>/dev/null; then
    useradd --system --create-home --shell /bin/bash anton
fi
mkdir -p "${ANTON_DIR}"
mkdir -p "${ANTON_DIR}/published"
mkdir -p /home/anton/Anton
# Caddy (running as 'caddy' user) needs to traverse /home/anton to serve
# published artifacts and project files — default 0700 from useradd blocks it.
chmod 755 /home/anton
# Grant passwordless sudo so the agent can install packages, manage services, etc.
echo "anton ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/anton
chmod 0440 /etc/sudoers.d/anton
log "USER: anton system user ready (with sudo)"

# ─────────────────────────────────────────────────────────────────
# 5. Download latest agent binary from manifest
# ─────────────────────────────────────────────────────────────────
log "BINARY: fetching manifest from ${MANIFEST_URL}"
MANIFEST=$(curl -fsSL "$MANIFEST_URL" 2>/dev/null || echo "")

if [ -n "$MANIFEST" ]; then
    BINARY_URL=$(echo "$MANIFEST" | jq -r ".binaries.\"linux-${AGENT_ARCH}\"" 2>/dev/null || echo "")
    AGENT_VERSION=$(echo "$MANIFEST" | jq -r ".version" 2>/dev/null || echo "unknown")
    log "BINARY: manifest version=${AGENT_VERSION}"
fi

# Fallback to latest release URL if manifest parsing fails
if [ -z "${BINARY_URL:-}" ] || [ "$BINARY_URL" = "null" ]; then
    BINARY_URL="https://github.com/billionzeros/computer/releases/latest/download/anton-agent-linux-${AGENT_ARCH}"
    log "BINARY: falling back to latest release URL"
fi

log "BINARY: downloading from ${BINARY_URL}"
curl -fSL -o /usr/local/bin/anton-agent "${BINARY_URL}"
chmod +x /usr/local/bin/anton-agent
log "BINARY: installed to /usr/local/bin/anton-agent"

# ─────────────────────────────────────────────────────────────────
# 5b. Download sidecar binary from manifest
# ─────────────────────────────────────────────────────────────────
SIDECAR_ARCH="${AGENT_ARCH}"
[ "$SIDECAR_ARCH" = "x64" ] && SIDECAR_ARCH="amd64"

if [ -n "$MANIFEST" ]; then
    SIDECAR_URL=$(echo "$MANIFEST" | jq -r ".sidecar.\"linux-${SIDECAR_ARCH}\"" 2>/dev/null || echo "")
fi

if [ -z "${SIDECAR_URL:-}" ] || [ "$SIDECAR_URL" = "null" ]; then
    SIDECAR_URL="https://github.com/billionzeros/computer/releases/latest/download/anton-sidecar-linux-${SIDECAR_ARCH}"
    log "SIDECAR: falling back to latest release URL"
fi

log "SIDECAR: downloading from ${SIDECAR_URL}"
curl -fSL -o /usr/local/bin/anton-sidecar "${SIDECAR_URL}"
chmod +x /usr/local/bin/anton-sidecar
log "SIDECAR: installed to /usr/local/bin/anton-sidecar"

# ─────────────────────────────────────────────────────────────────
# 6. Write agent config
# ─────────────────────────────────────────────────────────────────
cat > "${ANTON_DIR}/config.yaml" <<YAML
port: ${AGENT_PORT}
YAML

# ─────────────────────────────────────────────────────────────────
# 7. Set up environment file (API keys)
# ─────────────────────────────────────────────────────────────────
cat > ${ANTON_DIR}/agent.env <<ENV
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTON_DIR=${ANTON_DIR}
ANTON_HOST=${DOMAIN}
OAUTH_PROXY_URL=https://oauth.antoncomputer.in
OAUTH_CALLBACK_BASE_URL=https://${DOMAIN}
${EXA_PROXY_TOKEN:+EXA_PROXY_TOKEN=${EXA_PROXY_TOKEN}}
${BRAINTRUST_API_KEY:+BRAINTRUST_API_KEY=${BRAINTRUST_API_KEY}}
${ANTON_TOKEN:+ANTON_TOKEN=${ANTON_TOKEN}}
ENV
chmod 600 ${ANTON_DIR}/agent.env
log "CONFIG: agent env + config written"

# ─────────────────────────────────────────────────────────────────
# 8. Create systemd service for the agent
# ─────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/anton-agent.service <<UNIT
[Unit]
Description=Anton Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=anton
Group=anton
EnvironmentFile=${ANTON_DIR}/agent.env
ExecStart=/usr/local/bin/anton-agent --port ${AGENT_PORT}
Restart=always
RestartSec=5

# Hardening
ProtectHome=false
ReadWritePaths=${ANTON_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/anton-sidecar.service <<UNIT
[Unit]
Description=Anton Sidecar (Health & Status)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ANTON_DIR}/agent.env
Environment=SIDECAR_PORT=9878
Environment=AGENT_PORT=${AGENT_PORT}
ExecStart=/usr/local/bin/anton-sidecar
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

chown -R anton:anton "${ANTON_DIR}"
chown -R anton:anton /home/anton/Anton
log "SERVICE: systemd units created (agent + sidecar)"

# ─────────────────────────────────────────────────────────────────
# 9. Install Caddy
# ─────────────────────────────────────────────────────────────────
log "CADDY: installing"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
systemctl stop caddy 2>/dev/null || true
log "CADDY: installed"

# ─────────────────────────────────────────────────────────────────
# 10. Write Caddyfile
# ─────────────────────────────────────────────────────────────────
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    # Published artifacts: /a/{slug} → ~/.anton/published/{slug}/
    handle /a/* {
        uri strip_prefix /a
        root * /home/anton/.anton/published
        file_server
    }

    # Project public files: /p/{project}/* → ~/Anton/{project}/public/
    handle /p/* {
        uri strip_prefix /p
        root * /home/anton/Anton
        file_server
    }

    # Sidecar — only expose /health and /status, NEVER the update endpoints.
    # Listed first so these specific paths win before the agent catch-all.
    #
    # Use `handle` + `uri strip_prefix /_anton` (not `handle_path`). handle_path
    # strips the *entire* matched path, which would turn /_anton/status into
    # "/" upstream — sidecar has no route for /, so it falls through to the
    # BearerAuth group at "/" and returns "missing authorization header".
    handle /_anton/health {
        uri strip_prefix /_anton
        reverse_proxy localhost:9878
    }
    handle /_anton/status {
        uri strip_prefix /_anton
        reverse_proxy localhost:9878
    }

    # Everything else under /_anton/* (oauth, telegram, webhooks/*,
    # proxy/*, and the WebSocket upgrade at /) goes to the agent.
    # Using a single catch-all block instead of enumerating subpaths
    # so new webhook providers don't need a Caddyfile edit per-install.
    reverse_proxy localhost:${AGENT_PORT}
}
CADDY
log "CADDY: Caddyfile written for ${DOMAIN}"

# ─────────────────────────────────────────────────────────────────
# 11. DNS + Caddy + TLS setup (background)
#     Runs in parallel with agent startup to save time.
# ─────────────────────────────────────────────────────────────────
caddy_setup() {
    # Wait for DNS to resolve
    local dns_ok=false
    for i in $(seq 1 120); do
        local result
        result=$(dig +short "$DOMAIN" @8.8.8.8 2>/dev/null || true)
        if echo "$result" | grep -q '[0-9]'; then
            dns_ok=true
            log "DNS: ${DOMAIN} -> ${result} (attempt ${i})"
            break
        fi
        sleep 5
    done

    if [ "$dns_ok" = false ]; then
        log "DNS: FAILED to resolve ${DOMAIN} after 10 minutes"
        return 1
    fi

    # Start Caddy now that DNS is resolving
    systemctl enable --now caddy
    sleep 10
    systemctl reload caddy
    log "CADDY: started + reloaded"

    # Wait for TLS cert provisioning
    local tls_ok=false
    for i in $(seq 1 6); do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>/dev/null || echo "000")
        if [ "$code" != "000" ]; then
            tls_ok=true
            log "CADDY: TLS working (http=${code})"
            break
        fi
        sleep 30
        systemctl reload caddy
    done

    if [ "$tls_ok" = false ]; then
        log "CADDY: TLS FAILED after 3 minutes"
        return 1
    fi

    return 0
}

caddy_setup &
CADDY_PID=$!

# ─────────────────────────────────────────────────────────────────
# 12. Start agent (runs while Caddy provisions TLS)
# ─────────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now anton-agent
systemctl enable --now anton-sidecar
log "AGENT + SIDECAR: start requested"

# Wait for agent healthy
AGENT_HEALTHY=false
for i in $(seq 1 30); do
    if curl -sf http://localhost:${AGENT_PORT}/health > /dev/null 2>&1; then
        AGENT_HEALTHY=true
        log "AGENT: healthy (attempt ${i})"
        break
    fi
    sleep 2
done

if [ "$AGENT_HEALTHY" = false ]; then
    log "AGENT: FAILED health check after 60s"
fi

# ─────────────────────────────────────────────────────────────────
# 13. Wait for Caddy background job
# ─────────────────────────────────────────────────────────────────
wait $CADDY_PID
CADDY_OK=$?

# ─────────────────────────────────────────────────────────────────
# 14. Determine final status
# ─────────────────────────────────────────────────────────────────
if [ "$AGENT_HEALTHY" = true ] && [ "$CADDY_OK" -eq 0 ]; then
    FINAL_STATUS="ready"
    log "STATUS: ready"
else
    FINAL_STATUS="error"
    log "STATUS: error (agent=${AGENT_HEALTHY} caddy_exit=${CADDY_OK})"
fi

# ─────────────────────────────────────────────────────────────────
# 15. Callback to Huddle API (with retry + backoff)
# ─────────────────────────────────────────────────────────────────
if [ -n "${CALLBACK_URL:-}" ]; then
    # Get the machine's public IP
    PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
        || curl -sf https://ifconfig.me 2>/dev/null \
        || echo "")

    CALLBACK_BODY=$(cat <<CBJSON
{"status":"${FINAL_STATUS}","domain":"${DOMAIN}","ip":"${PUBLIC_IP}","agentHealthy":${AGENT_HEALTHY},"caddyOk":$([ "$CADDY_OK" -eq 0 ] && echo true || echo false)}
CBJSON
    )

    CALLBACK_SENT=false
    BACKOFF=5
    for attempt in 1 2 3; do
        HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$CALLBACK_BODY" \
            "$CALLBACK_URL" 2>/dev/null || echo "000")

        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ]; then
            CALLBACK_SENT=true
            log "CALLBACK: sent successfully (attempt ${attempt}, http=${HTTP_CODE})"
            break
        fi

        log "CALLBACK: attempt ${attempt} failed (http=${HTTP_CODE}), retrying in ${BACKOFF}s"
        sleep $BACKOFF
        BACKOFF=$(( BACKOFF * 3 ))
    done

    if [ "$CALLBACK_SENT" = false ]; then
        log "CALLBACK: FAILED after 3 attempts to ${CALLBACK_URL}"
    fi
else
    log "CALLBACK: no CALLBACK_URL set, skipping"
fi

log "INIT: finished for ${DOMAIN} (status=${FINAL_STATUS})"
