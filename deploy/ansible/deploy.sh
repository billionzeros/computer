#!/bin/bash
# Deploy anton agent to a VPS in one command.
#
# Usage:
#   ./deploy.sh <ip> <ssh_key_path> [user] [api_key]
#
# Examples:
#   ./deploy.sh 203.0.113.10 ~/.ssh/id_rsa
#   ./deploy.sh 203.0.113.10 ~/.ssh/id_rsa root
#   ./deploy.sh 203.0.113.10 ~/.ssh/id_rsa root sk-ant-api03-...
#
# Or deploy to all hosts in inventory.ini:
#   ./deploy.sh --inventory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check ansible is installed
if ! command -v ansible-playbook &> /dev/null; then
  echo -e "${RED}Error: ansible is not installed.${NC}"
  echo ""
  echo "Install it:"
  echo "  macOS:  brew install ansible"
  echo "  Linux:  pip install ansible"
  echo "  Linux:  sudo apt install ansible"
  exit 1
fi

# Deploy to inventory
if [ "${1:-}" = "--inventory" ]; then
  echo -e "${GREEN}Deploying to all hosts in inventory.ini...${NC}"
  EXTRA_VARS=""
  if [ -n "${2:-}" ]; then
    EXTRA_VARS="-e anthropic_api_key=$2"
  fi
  ansible-playbook playbook.yml $EXTRA_VARS
  exit 0
fi

# Quick deploy to a single host
if [ $# -lt 2 ]; then
  echo "Usage: $0 <ip> <ssh_key_path> [user] [api_key]"
  echo ""
  echo "  ip            VPS IP address or hostname"
  echo "  ssh_key_path  Path to SSH private key"
  echo "  user          SSH user (default: root)"
  echo "  api_key       Anthropic API key (optional, can set later)"
  echo ""
  echo "Or deploy to inventory:"
  echo "  $0 --inventory [api_key]"
  exit 1
fi

HOST="$1"
SSH_KEY="$2"
SSH_USER="${3:-root}"
API_KEY="${4:-}"

# Validate SSH key exists
if [ ! -f "$SSH_KEY" ]; then
  echo -e "${RED}Error: SSH key not found at $SSH_KEY${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│  Deploying Anton Agent                  │${NC}"
echo -e "${GREEN}│  Host: $HOST${NC}"
echo -e "${GREEN}│  User: $SSH_USER${NC}"
echo -e "${GREEN}└─────────────────────────────────────────┘${NC}"
echo ""

EXTRA_VARS="ansible_user=$SSH_USER ansible_ssh_private_key_file=$SSH_KEY"
if [ -n "$API_KEY" ]; then
  EXTRA_VARS="$EXTRA_VARS anthropic_api_key=$API_KEY"
fi

ansible-playbook playbook.yml \
  -i "$HOST," \
  -e "$EXTRA_VARS" \
  -v

echo ""
echo -e "${GREEN}Done! Connect to your agent at $HOST:9876${NC}"
