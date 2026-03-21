#!/usr/bin/env bash
#
# Bundle the agent into a single .mjs file for fast dev deployment.
# No SEA, no Node.js binary copying — just one JS file (~1MB).
#
# Usage:
#   ./scripts/bundle.sh           # Build + bundle
#   ./scripts/bundle.sh --skip-ts # Bundle only (skip TypeScript build, for speed)
#
# Output:
#   dist/anton-agent.mjs
#
# On the VPS, run with:
#   node dist/anton-agent.mjs
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_TS="${1:-}"

if [[ "$SKIP_TS" != "--skip-ts" ]]; then
  echo "  Building TypeScript..."
  pnpm --filter @anton/agent-config build 2>&1 | tail -1
  pnpm --filter @anton/protocol build 2>&1 | tail -1
  pnpm --filter @anton/agent-core build 2>&1 | tail -1
  pnpm --filter @anton/agent-server build 2>&1 | tail -1
fi

echo "  Bundling with esbuild..."
mkdir -p dist

npx esbuild packages/agent-server/dist/index.js \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/anton-agent.mjs \
  --external:node-pty \
  --external:chokidar \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

chmod +x dist/anton-agent.mjs

SIZE=$(du -h dist/anton-agent.mjs | cut -f1)
echo "  Built: dist/anton-agent.mjs (${SIZE})"
