#!/usr/bin/env bash
#
# Build the CLI binary (Node.js SEA) for the current platform.
#
# Usage:
#   ./scripts/build-cli.sh                # Build for current platform
#   ./scripts/build-cli.sh linux-x64      # Build for specific target
#
# Output:
#   dist/anton-cli-{platform}-{arch}
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Determine target ──────────────────────────────────────────────

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

TARGET="${1:-${PLATFORM}-${ARCH}}"
CLI_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('packages/cli/package.json','utf8')).version)")

echo "  Building anton-cli v${CLI_VERSION} for ${TARGET}..."
echo ""

# ── 1. Build TypeScript ────────────────────────────────────────────

echo "  [1/4] Building TypeScript..."
pnpm --filter @anton/protocol build 2>&1 | tail -1
pnpm --filter @anton/cli build 2>&1 | tail -1

# ── 2. Bundle with esbuild ─────────────────────────────────────────

echo "  [2/4] Bundling with esbuild..."
mkdir -p dist

npx esbuild packages/cli/dist/index.js \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/cli-bundle.mjs \
  --external:node-pty \
  --define:__CLI_VERSION__=\"${CLI_VERSION}\" \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ── 3. Create SEA ─────────────────────────────────────────────────

echo "  [3/4] Creating SEA binary..."

cat > dist/cli-sea-config.json << 'EOF'
{
  "main": "cli-bundle.mjs",
  "output": "cli-sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
EOF

cd dist
node --experimental-sea-config cli-sea-config.json
cd ..

BINARY_NAME="anton-cli-${TARGET}"
cp "$(which node)" "dist/${BINARY_NAME}"

# Remove code signature on macOS (required before injection)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --remove-signature "dist/${BINARY_NAME}" 2>/dev/null || true
fi

npx postject "dist/${BINARY_NAME}" NODE_SEA_BLOB dist/cli-sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Re-sign on macOS
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --sign - "dist/${BINARY_NAME}" 2>/dev/null || true
fi

chmod +x "dist/${BINARY_NAME}"

# ── 4. Clean up ────────────────────────────────────────────────────

echo "  [4/4] Cleaning up..."
rm -f dist/cli-bundle.mjs dist/cli-sea-config.json dist/cli-sea-prep.blob

SIZE=$(du -h "dist/${BINARY_NAME}" | cut -f1)
echo ""
echo "  Built: dist/${BINARY_NAME} (${SIZE})"
echo ""
echo "  Test: ./dist/${BINARY_NAME} version"
echo "  Upload: gh release upload v${CLI_VERSION} dist/${BINARY_NAME}"
