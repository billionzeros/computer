#!/usr/bin/env bash
#
# Build the CLI into a single distributable .mjs file.
#
# Usage:
#   ./scripts/build-cli.sh                # Build for all platforms
#
# Output:
#   dist/anton-cli.mjs    — Single-file CLI (requires Node.js 22+)
#
# The install script downloads this file and creates a wrapper at
# ~/.anton/bin/anton that invokes it with node.
#
# Why not SEA? ink and yoga-layout use top-level await (ESM-only),
# and Node.js SEA only supports CJS. We ship the ESM bundle directly
# since users have Node.js installed (it's a dev tool).
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CLI_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('packages/cli/package.json','utf8')).version)")

echo "  Building anton-cli v${CLI_VERSION}..."
echo ""

# ── 1. Build TypeScript ────────────────────────────────────────────

echo "  [1/2] Building TypeScript..."
pnpm --filter @anton/protocol build 2>&1 | tail -1
pnpm --filter @anton/cli build 2>&1 | tail -1

# ── 2. Bundle with esbuild ─────────────────────────────────────────

echo "  [2/2] Bundling with esbuild..."
mkdir -p dist

# Create a stub for react-devtools-core (ink imports it but it's optional/dev-only)
mkdir -p dist/.stubs
echo "export default {};" > dist/.stubs/react-devtools-core.mjs

npx esbuild packages/cli/dist/index.js \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/anton-cli.mjs \
  --external:node-pty \
  --alias:react-devtools-core=./dist/.stubs/react-devtools-core.mjs \
  --define:__CLI_VERSION__=\"${CLI_VERSION}\" \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

chmod +x dist/anton-cli.mjs

SIZE=$(du -h dist/anton-cli.mjs | cut -f1)
echo ""
echo "  Built: dist/anton-cli.mjs (${SIZE})"
echo ""
echo "  Test: node dist/anton-cli.mjs version"
echo "  Upload: gh release upload v${CLI_VERSION} dist/anton-cli.mjs"
