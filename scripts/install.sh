#!/usr/bin/env bash
#
# anton.computer CLI installer
#
# Usage:
#   curl -fsSL https://antoncomputer.in/install | bash
#
# What it does:
#   1. Detects your OS and architecture
#   2. Downloads the latest CLI binary from GitHub Releases
#   3. Installs to ~/.anton/bin/anton
#   4. Adds ~/.anton/bin to your PATH (bash, zsh, fish — idempotent)
#
# Environment variables:
#   ANTON_VERSION    Install a specific version (default: latest)
#   ANTON_DIR        Install directory (default: ~/.anton/bin)
#

set -euo pipefail

# ── Formatting ─────────────────────────────────────────────────────

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m'

CHECKMARK="${GREEN}✓${NC}"
ARROW="${BLUE}▸${NC}"

banner() {
  echo ""
  echo -e "${PURPLE}${BOLD}"
  echo "    ┌─────────────────────────────────────────┐"
  echo "    │                                         │"
  echo "    │          anton.computer                  │"
  echo "    │          ──────────────                  │"
  echo "    │          Your personal cloud computer.   │"
  echo "    │                                         │"
  echo "    └─────────────────────────────────────────┘"
  echo -e "${NC}"
}

step()    { echo -e "  ${ARROW} ${BOLD}$1${NC}"; }
ok()      { echo -e "  ${CHECKMARK} $1"; }
info()    { echo -e "  ${DIM}$1${NC}"; }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# ── Detect platform ───────────────────────────────────────────────

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) fail "Windows is not supported yet. Use WSL instead." ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# ── Detect shell ──────────────────────────────────────────────────

detect_shell() {
  local shell_name
  shell_name=$(basename "${SHELL:-/bin/bash}")
  echo "$shell_name"
}

get_shell_rc() {
  local shell="$1"
  case "$shell" in
    bash)
      if [[ -f "$HOME/.bashrc" ]]; then
        echo "$HOME/.bashrc"
      elif [[ -f "$HOME/.bash_profile" ]]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

# ── Add to PATH (idempotent) ─────────────────────────────────────

add_to_path() {
  local install_dir="$1"
  local shell_name
  shell_name=$(detect_shell)
  local rc_file
  rc_file=$(get_shell_rc "$shell_name")

  # Check if already in PATH
  if echo "$PATH" | tr ':' '\n' | grep -qx "$install_dir" 2>/dev/null; then
    ok "Already in PATH"
    return 0
  fi

  # Check if rc file already has the export
  if [[ -f "$rc_file" ]] && grep -q "anton/bin" "$rc_file" 2>/dev/null; then
    ok "PATH entry already in $rc_file"
    return 0
  fi

  # Add to rc file
  local path_line
  if [[ "$shell_name" == "fish" ]]; then
    mkdir -p "$(dirname "$rc_file")"
    path_line="fish_add_path $install_dir"
  else
    path_line="export PATH=\"$install_dir:\$PATH\""
  fi

  echo "" >> "$rc_file"
  echo "# anton.computer CLI" >> "$rc_file"
  echo "$path_line" >> "$rc_file"

  ok "Added to PATH in $(basename "$rc_file")"
}

# ── Fetch latest version ─────────────────────────────────────────

get_latest_version() {
  local manifest_url="https://raw.githubusercontent.com/OmGuptaIND/anton.computer/main/manifest.json"
  local version

  if command -v curl &>/dev/null; then
    version=$(curl -fsSL "$manifest_url" | grep '"version"' | head -1 | sed 's/.*: *"//;s/".*//')
  elif command -v wget &>/dev/null; then
    version=$(wget -qO- "$manifest_url" | grep '"version"' | head -1 | sed 's/.*: *"//;s/".*//')
  else
    fail "Neither curl nor wget found. Install one and try again."
  fi

  if [[ -z "$version" ]]; then
    fail "Could not fetch latest version from manifest."
  fi

  echo "$version"
}

# ── Download binary ───────────────────────────────────────────────

download_binary() {
  local version="$1"
  local platform="$2"
  local dest="$3"

  local url="https://github.com/OmGuptaIND/anton.computer/releases/download/v${version}/anton-cli-${platform}"

  if command -v curl &>/dev/null; then
    curl -fsSL --progress-bar -o "$dest" "$url" || fail "Download failed. Check if v${version} has a binary for ${platform}."
  elif command -v wget &>/dev/null; then
    wget -q --show-progress -O "$dest" "$url" || fail "Download failed."
  fi
}

# ── Main ──────────────────────────────────────────────────────────

main() {
  banner

  local platform
  platform=$(detect_platform)
  local shell_name
  shell_name=$(detect_shell)

  local version="${ANTON_VERSION:-}"
  local install_dir="${ANTON_DIR:-$HOME/.anton/bin}"
  local binary_path="$install_dir/anton"

  # Check if already installed
  local existing_version=""
  if [[ -f "$binary_path" ]]; then
    existing_version=$("$binary_path" --version 2>/dev/null | sed 's/anton v//' || echo "")
  fi

  step "Detecting system"
  ok "Platform: ${platform}"
  ok "Shell: ${shell_name}"
  if [[ -n "$existing_version" ]]; then
    ok "Existing install: v${existing_version}"
  fi

  # Get version
  step "Resolving version"
  if [[ -z "$version" ]]; then
    version=$(get_latest_version)
  fi

  if [[ "$existing_version" == "$version" ]]; then
    echo ""
    echo -e "  ${CHECKMARK} ${BOLD}anton v${version}${NC} is already installed and up to date."
    echo ""
    echo -e "  Run ${BOLD}anton${NC} to get started."
    echo ""
    exit 0
  fi

  if [[ -n "$existing_version" ]]; then
    ok "Updating: v${existing_version} → v${version}"
  else
    ok "Latest: v${version}"
  fi

  # Download
  step "Downloading binary"
  mkdir -p "$install_dir"
  local temp_path="${binary_path}.download-$$"
  download_binary "$version" "$platform" "$temp_path"
  chmod +x "$temp_path"
  mv -f "$temp_path" "$binary_path"
  ok "Installed to ${binary_path}"

  # PATH
  step "Configuring PATH"
  add_to_path "$install_dir"

  # Verify
  step "Verifying"
  if "$binary_path" --version &>/dev/null; then
    local installed_version
    installed_version=$("$binary_path" --version 2>/dev/null)
    ok "${installed_version}"
  else
    warn "Binary installed but could not verify. Try restarting your terminal."
  fi

  # Done
  echo ""
  echo -e "${GREEN}${BOLD}"
  echo "    ┌─────────────────────────────────────────┐"
  echo "    │                                         │"
  echo "    │   Installation complete!                │"
  echo "    │                                         │"
  echo "    │   Get started:                          │"
  echo "    │     1. Restart your terminal             │"
  echo "    │        (or run: source $(basename "$(get_shell_rc "$shell_name")"))"
  printf "    │     %-36s│\n" ""
  echo "    │     2. Connect to your machine:          │"
  echo "    │        anton connect <ip>                │"
  echo "    │                                         │"
  echo "    │   Update later:                         │"
  echo "    │        anton update                     │"
  echo "    │                                         │"
  echo "    └─────────────────────────────────────────┘"
  echo -e "${NC}"
}

main "$@"
