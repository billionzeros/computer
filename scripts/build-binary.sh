#!/usr/bin/env bash
#
# Build the agent binary locally — same steps as CI but on your machine.
#
# Usage:
#   ./scripts/build-binary.sh              # Build for current platform
#   ./scripts/build-binary.sh linux-x64    # Build for specific target (requires cross-compilation setup)
#
# Output:
#   dist/anton-agent-{platform}-{arch}
#
# This avoids GitHub Actions costs. You can then manually upload
# the binary to a GitHub Release or distribute it directly.
#
# Requirements:
#   - Node.js 22+
#   - pnpm
#   - postject (installed automatically via npx)
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Determine target ──────────────────────────────────────────────

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Normalize arch
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

TARGET="${1:-${PLATFORM}-${ARCH}}"

echo "Building anton-agent binary for ${TARGET}..."
echo ""

# ── 1. Build TypeScript ────────────────────────────────────────────

echo "  [1/5] Building TypeScript packages..."
pnpm --filter @anton/protocol build
pnpm --filter @anton/agent-config build
pnpm --filter @anton/agent-core build
pnpm --filter @anton/agent-server build

# ── 2. Bundle with esbuild ─────────────────────────────────────────

echo "  [2/5] Bundling with esbuild..."
mkdir -p dist

npx esbuild packages/agent-server/dist/index.js \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --outfile=dist/agent-bundle.js \
  --external:node-pty \
  --external:chokidar

# ── 3. Create SEA config ──────────────────────────────────────────

echo "  [3/5] Creating SEA blob..."
cat > dist/sea-config.json << 'EOF'
{
  "main": "agent-bundle.js",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
EOF

cd dist
node --experimental-sea-config sea-config.json
cd ..

# ── 4. Create executable ──────────────────────────────────────────

echo "  [4/5] Injecting blob into Node.js binary..."

BINARY_NAME="anton-agent-${TARGET}"
cp "$(which node)" "dist/${BINARY_NAME}"

# Remove code signature on macOS (required before injection)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --remove-signature "dist/${BINARY_NAME}" 2>/dev/null || true
fi

npx postject "dist/${BINARY_NAME}" NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Re-sign on macOS
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --sign - "dist/${BINARY_NAME}" 2>/dev/null || true
fi

chmod +x "dist/${BINARY_NAME}"

# ── 5. Clean up intermediate files ─────────────────────────────────

echo "  [5/5] Cleaning up..."
rm -f dist/agent-bundle.js dist/sea-config.json dist/sea-prep.blob

# ── Done ───────────────────────────────────────────────────────────

SIZE=$(du -h "dist/${BINARY_NAME}" | cut -f1)
echo ""
echo "  Built: dist/${BINARY_NAME} (${SIZE})"
echo ""
echo "To test locally:"
echo "  ./dist/${BINARY_NAME} --port 9876"
echo ""
echo "To upload to an existing GitHub Release:"
echo "  gh release upload v<version> dist/${BINARY_NAME}"
