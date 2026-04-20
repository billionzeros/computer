#!/usr/bin/env bash
# Regenerate the vendored Codex app-server TypeScript bindings.
#
# Run this whenever we bump the pinned codex CLI version
# (packages/agent-core/src/harness/codex-version.ts). The generated
# files are checked into git so schema drift surfaces as a reviewable
# diff, not a runtime mystery.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/agent-core/src/harness/codex-proto"

if ! command -v codex >/dev/null 2>&1; then
  echo "error: codex CLI not on PATH" >&2
  exit 1
fi

CLI_VERSION="$(codex --version 2>/dev/null | awk '{print $NF}')"
echo "regenerating codex-proto bindings from codex-cli $CLI_VERSION"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
codex app-server generate-ts --out "$OUT_DIR"

COUNT=$(find "$OUT_DIR" -name '*.ts' | wc -l | tr -d ' ')
echo "wrote $COUNT .ts files to $OUT_DIR"
echo
echo "next steps:"
echo "  1. update SUPPORTED_CLI_VERSIONS in packages/agent-core/src/harness/codex-version.ts"
echo "  2. run the probe at .context/codex-probe/ to catch protocol changes"
echo "  3. commit the diff"
