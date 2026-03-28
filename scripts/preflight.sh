#!/usr/bin/env bash
#
# Preflight check — run locally before `make release` to catch CI failures.
#
# Mirrors every build step from .github/workflows/release.yml:
#   1. TypeScript build (all packages)
#   2. Typecheck (catches TS errors like missing JSX namespace)
#   3. Agent esbuild bundle
#   4. CLI esbuild bundle
#   5. Desktop build (tsc + vite, skip tauri native)
#
# Usage:
#   make preflight          # run all checks
#   ./scripts/preflight.sh  # same thing
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

FAILED=0
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")

step()  { echo -e "\n${BOLD}[$1/$TOTAL] $2${NC}"; }
pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; FAILED=1; }

TOTAL=5

# ── 1. TypeScript build ─────────────────────────────────────────
step 1 "Building TypeScript packages"

if pnpm --filter @anton/protocol build 2>&1 | tail -1 && \
   pnpm --filter @anton/agent-config build 2>&1 | tail -1 && \
   pnpm --filter @anton/agent-core build 2>&1 | tail -1 && \
   pnpm --filter @anton/agent-server build 2>&1 | tail -1 && \
   pnpm --filter @anton/cli build 2>&1 | tail -1; then
  pass "All packages built"
else
  fail "TypeScript build failed"
fi

# ── 2. Typecheck ────────────────────────────────────────────────
step 2 "Typechecking"

TYPECHECK_FAILED=0
for pkg in protocol agent-config agent-core agent-server cli desktop; do
  if pnpm --filter @anton/$pkg typecheck 2>&1 | tail -1; then
    pass "@anton/$pkg"
  else
    fail "@anton/$pkg typecheck failed"
    TYPECHECK_FAILED=1
  fi
done

# ── 3. Agent esbuild bundle ────────────────────────────────────
step 3 "Bundle agent-server with esbuild"

AGENT_EXTERNALS=$(node "$REPO_ROOT/scripts/esbuild.config.js" agent-externals)

if npx esbuild packages/agent-server/dist/index.js \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=cjs \
    --outfile=/tmp/anton-preflight-agent.js \
    $AGENT_EXTERNALS \
    --define:__AGENT_VERSION__=\""$VERSION"\" 2>&1; then
  SIZE=$(du -h /tmp/anton-preflight-agent.js | cut -f1)
  pass "agent bundle OK ($SIZE)"
  rm -f /tmp/anton-preflight-agent.js
else
  fail "Agent esbuild bundle failed"
fi

# ── 4. CLI esbuild bundle ──────────────────────────────────────
step 4 "Bundle CLI with esbuild"

mkdir -p /tmp/anton-preflight-stubs
echo "export default {};" > /tmp/anton-preflight-stubs/react-devtools-core.mjs

CLI_EXTERNALS=$(node "$REPO_ROOT/scripts/esbuild.config.js" cli-externals)

if npx esbuild packages/cli/dist/index.js \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile=/tmp/anton-preflight-cli.mjs \
    $CLI_EXTERNALS \
    --alias:react-devtools-core=/tmp/anton-preflight-stubs/react-devtools-core.mjs \
    --define:__CLI_VERSION__=\""$VERSION"\" \
    --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" 2>&1; then
  SIZE=$(du -h /tmp/anton-preflight-cli.mjs | cut -f1)
  pass "CLI bundle OK ($SIZE)"
  rm -f /tmp/anton-preflight-cli.mjs
  rm -rf /tmp/anton-preflight-stubs
else
  fail "CLI esbuild bundle failed"
fi

# ── 5. Desktop build (tsc + vite, no tauri native) ─────────────
step 5 "Desktop build (tsc + vite)"

if pnpm --filter @anton/desktop build 2>&1 | tail -3; then
  pass "Desktop build OK"
else
  fail "Desktop build failed"
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  All preflight checks passed — safe to release.${NC}"
else
  echo -e "${RED}${BOLD}  Preflight failed — fix errors above before releasing.${NC}"
fi
echo ""

exit $FAILED
