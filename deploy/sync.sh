#!/usr/bin/env bash
#
# Sync local code to VPS, rebuild, and restart.
# No git push needed — rsyncs your working directory directly.
#
# Usage:
#   pnpm deploy              # sync to all hosts in inventory
#   pnpm deploy agent1       # sync to specific host
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v ansible-playbook &> /dev/null; then
  echo "Ansible not installed. Run: make setup"
  exit 1
fi

cd "$REPO_ROOT"

if [ -n "${1:-}" ]; then
  make sync HOST="$1"
else
  make sync
fi
