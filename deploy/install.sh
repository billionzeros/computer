#!/bin/bash
# Install anton.computer agent on any Linux VPS
# Usage: curl -fsSL https://get.anton.computer | bash
#   or:  bash install.sh

set -euo pipefail

REPO_URL="https://github.com/OmGuptaIND/computer.git"
BRANCH="${ANTON_BRANCH:-main}"
INSTALL_DIR="${ANTON_DIR:-$HOME/.anton}"
AGENT_DIR="$INSTALL_DIR/agent"

echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │  Installing anton.computer agent     │"
echo "  │  Your personal cloud computer.       │"
echo "  └─────────────────────────────────────┘"
echo ""

# ── Detect OS ──────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "$ID"
  elif [ "$(uname)" = "Darwin" ]; then
    echo "macos"
  else
    echo "unknown"
  fi
}

OS=$(detect_os)
echo "==> Detected OS: $OS"

# ── Install Node.js 22+ if missing ────────────────────────────────
install_node() {
  if command -v node &> /dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -ge 22 ]; then
      echo "==> Node.js $(node -v) ✓"
      return
    fi
    echo "==> Node.js $(node -v) is too old, need 22+. Upgrading..."
  else
    echo "==> Node.js not found. Installing..."
  fi

  case "$OS" in
    ubuntu|debian|pop)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;
    fedora|rhel|centos|rocky|alma)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs || sudo yum install -y nodejs
      ;;
    macos)
      if command -v brew &> /dev/null; then
        brew install node@22
      else
        echo "ERROR: Install Homebrew first: https://brew.sh"
        exit 1
      fi
      ;;
    *)
      echo "ERROR: Could not auto-install Node.js. Please install Node.js 22+ manually."
      exit 1
      ;;
  esac

  echo "==> Node.js $(node -v) installed ✓"
}

# ── Install pnpm if missing ───────────────────────────────────────
install_pnpm() {
  if command -v pnpm &> /dev/null; then
    echo "==> pnpm $(pnpm -v) ✓"
    return
  fi

  echo "==> Installing pnpm..."
  sudo npm install -g pnpm
  echo "==> pnpm $(pnpm -v) installed ✓"
}

# ── Install system deps ───────────────────────────────────────────
install_deps() {
  echo "==> Installing system dependencies..."
  case "$OS" in
    ubuntu|debian|pop)
      sudo apt-get install -y git openssl curl 2>/dev/null || true
      ;;
    fedora|rhel|centos|rocky|alma)
      sudo dnf install -y git openssl curl 2>/dev/null || sudo yum install -y git openssl curl 2>/dev/null || true
      ;;
  esac
}

# ── Clone or update repo ──────────────────────────────────────────
setup_repo() {
  mkdir -p "$INSTALL_DIR"

  if [ -d "$AGENT_DIR/.git" ]; then
    echo "==> Updating existing installation..."
    cd "$AGENT_DIR"
    git fetch origin
    git reset --hard "origin/$BRANCH"
  elif [ -d "$AGENT_DIR/package.json" ] 2>/dev/null; then
    echo "==> Agent directory exists (local install), skipping git clone"
  else
    echo "==> Cloning anton.computer..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$AGENT_DIR" 2>/dev/null || {
      # If repo doesn't exist yet (pre-launch), copy from local if available
      echo "==> Git clone failed. Checking for local source..."
      if [ -d "/mnt/mac" ]; then
        # OrbStack: Mac filesystem is mounted
        LOCAL_SRC=$(find /mnt/mac -path "*/01/computer/package.json" -maxdepth 6 2>/dev/null | head -1 | xargs dirname 2>/dev/null || true)
        if [ -n "$LOCAL_SRC" ]; then
          echo "==> Found local source at $LOCAL_SRC"
          cp -r "$LOCAL_SRC/." "$AGENT_DIR/"
          # Clean up desktop app (not needed on server)
          rm -rf "$AGENT_DIR/packages/desktop"
        else
          echo "ERROR: Could not find source code. Clone manually:"
          echo "  git clone $REPO_URL $AGENT_DIR"
          exit 1
        fi
      else
        echo "ERROR: Could not clone repo. Clone manually:"
        echo "  git clone $REPO_URL $AGENT_DIR"
        exit 1
      fi
    }
  fi
}

# ── Build ─────────────────────────────────────────────────────────
build_agent() {
  cd "$AGENT_DIR"

  echo "==> Installing dependencies..."
  pnpm install --no-frozen-lockfile 2>&1 | tail -5

  echo "==> Building protocol..."
  pnpm --filter @anton/protocol build

  echo "==> Building agent..."
  pnpm --filter @anton/agent build

  echo "==> Build complete ✓"
}

# ── Generate config ───────────────────────────────────────────────
setup_config() {
  # Running the agent once with --init will create the config
  # But we can also create it manually for non-interactive installs
  if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
    echo "==> Config will be created on first run at $INSTALL_DIR/config.yaml"
  else
    echo "==> Config exists at $INSTALL_DIR/config.yaml ✓"
  fi
}

# ── Create systemd service ────────────────────────────────────────
setup_systemd() {
  if ! command -v systemctl &> /dev/null; then
    echo "==> No systemd found. Start manually:"
    echo "    cd $AGENT_DIR && node packages/agent/dist/index.js"
    return
  fi

  local AGENT_BIN="$AGENT_DIR/packages/agent/dist/index.js"

  sudo tee /etc/systemd/system/anton-agent.service > /dev/null << EOF
[Unit]
Description=anton.computer agent
After=network.target

[Service]
Type=simple
User=$USER
Environment=HOME=$HOME
Environment=PATH=$PATH:/usr/bin:/usr/local/bin
WorkingDirectory=$AGENT_DIR
ExecStart=$(which node) $AGENT_BIN
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable anton-agent
  echo "==> Systemd service created ✓"
  echo "    Start:  sudo systemctl start anton-agent"
  echo "    Status: sudo systemctl status anton-agent"
  echo "    Logs:   sudo journalctl -u anton-agent -f"
}

# ── Create start script ──────────────────────────────────────────
create_start_script() {
  cat > "$INSTALL_DIR/start.sh" << EOF
#!/bin/bash
cd "$AGENT_DIR"
exec node packages/agent/dist/index.js "\$@"
EOF
  chmod +x "$INSTALL_DIR/start.sh"
  echo "==> Start script: $INSTALL_DIR/start.sh"
}

# ── Main ──────────────────────────────────────────────────────────
install_deps
install_node
install_pnpm
setup_repo
build_agent
setup_config
create_start_script

echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  anton.computer agent installed!                         │"
echo "  │                                                          │"
echo "  │  Set your AI API key:                                    │"
echo "  │    export ANTHROPIC_API_KEY=sk-ant-...                   │"
echo "  │                                                          │"
echo "  │  Start the agent:                                        │"
echo "  │    ~/.anton/start.sh                                     │"
echo "  │                                                          │"
echo "  │  Or set up as system service:                            │"
echo "  │    sudo systemctl start anton-agent                      │"
echo "  │                                                          │"
echo "  │  Then connect from the desktop app with your token.      │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

# Offer to set up systemd service
if command -v systemctl &> /dev/null; then
  read -p "  Set up as systemd service (auto-start on boot)? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    setup_systemd
  fi
fi
