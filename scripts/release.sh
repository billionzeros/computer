#!/usr/bin/env bash
#
# Release script for anton.computer
#
# Usage:
#   ./scripts/release.sh 0.6.0          # Prepare release locally
#   ./scripts/release.sh 0.6.0 --push   # Prepare + push (triggers CI)
#
# What it does:
#   1. Validates the version format
#   2. Updates package.json + tauri.conf.json versions across the monorepo
#   3. Moves [Unreleased] changelog entries under the new version heading
#   4. Updates manifest.json with the new version + binary URLs
#   5. Commits and tags
#   6. If --push: pushes to origin (triggers CI build + GitHub Release)
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Colors ─────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BLUE}▸${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }

# ── Validate args ──────────────────────────────────────────────────

NEW_VERSION="${1:-}"
AUTO_PUSH="${2:-}"

if [[ -z "$NEW_VERSION" ]]; then
  echo -e "${RED}Error:${NC} No version specified."
  echo ""
  echo "Usage: ./scripts/release.sh <version> [--push]"
  echo "Example: ./scripts/release.sh 0.6.0 --push"
  exit 1
fi

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  err "Version must be semver (e.g. 0.6.0), got: $NEW_VERSION"
  exit 1
fi

# Get current version
CURRENT_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")

echo ""
echo -e "${BOLD}  anton.computer release${NC}"
echo -e "  ────────────────────────"
echo -e "  ${CURRENT_VERSION} → ${GREEN}${NEW_VERSION}${NC}"
echo ""

# Check for clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree is not clean. Commit or stash changes first."
  git status --short
  exit 1
fi

# Auto-generate changelog from commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [[ -n "$LAST_TAG" ]]; then
  COMMIT_RANGE="${LAST_TAG}..HEAD"
else
  COMMIT_RANGE="HEAD"
fi

# Generate grouped changelog from commit messages
AUTO_CHANGELOG=$(node -e "
  const { execSync } = require('child_process');
  const log = execSync('git log ${COMMIT_RANGE} --pretty=format:%s --no-merges', { encoding: 'utf8' });
  const lines = log.trim().split('\n').filter(Boolean);

  const groups = { feat: [], fix: [], add: [], chore: [], other: [] };
  const labels = { feat: 'Features', fix: 'Fixes', add: 'Added', chore: 'Chores', other: 'Other' };

  for (const msg of lines) {
    // Skip release commits
    if (msg.startsWith('release:') || msg.startsWith('ci:')) continue;

    const match = msg.match(/^(\w+):\s*(.+)/);
    if (match && groups[match[1]]) {
      groups[match[1]].push(match[2].trim());
    } else if (match) {
      groups.other.push(msg);
    } else {
      groups.other.push(msg);
    }
  }

  const parts = [];
  for (const [key, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    parts.push('### ' + labels[key]);
    for (const item of items) parts.push('- ' + item);
    parts.push('');
  }

  console.log(parts.join('\n').trim() || 'Maintenance release.');
")

# Write auto-generated changelog into [Unreleased] section
AUTO_CHANGELOG="$AUTO_CHANGELOG" node -e "
  const fs = require('fs');
  let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const match = changelog.match(/(## \\[Unreleased\\]\\n)([\\s\\S]*?)(\\n---)/);
  if (match) {
    const autoChangelog = process.env.AUTO_CHANGELOG;
    changelog = changelog.replace(match[0], match[1] + '\n' + autoChangelog + match[3]);
    fs.writeFileSync('CHANGELOG.md', changelog);
  }
"

step "Auto-generated changelog from ${LAST_TAG:-'initial'}..HEAD"
echo "$AUTO_CHANGELOG" | sed 's/^/    /'
echo ""

# ── 1. Update package versions ─────────────────────────────────────

step "Updating versions across monorepo"

# Root package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
ok "package.json → ${NEW_VERSION}"

# All workspace package.json files
for pkg_json in packages/*/package.json; do
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${pkg_json}', 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync('${pkg_json}', JSON.stringify(pkg, null, 2) + '\n');
  "
done
ok "All workspace packages → ${NEW_VERSION}"

# Tauri config version
TAURI_CONF="packages/desktop/src-tauri/tauri.conf.json"
if [[ -f "$TAURI_CONF" ]]; then
  node -e "
    const fs = require('fs');
    const conf = JSON.parse(fs.readFileSync('${TAURI_CONF}', 'utf8'));
    conf.version = '${NEW_VERSION}';
    fs.writeFileSync('${TAURI_CONF}', JSON.stringify(conf, null, 2) + '\n');
  "
  ok "tauri.conf.json → ${NEW_VERSION}"
fi

# Cargo.toml version
CARGO_TOML="packages/desktop/src-tauri/Cargo.toml"
if [[ -f "$CARGO_TOML" ]]; then
  sed -i.bak "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" "$CARGO_TOML"
  rm -f "${CARGO_TOML}.bak"
  ok "Cargo.toml → ${NEW_VERSION}"
fi

# ── 2. Update changelog ───────────────────────────────────────────

step "Updating CHANGELOG.md"

TODAY=$(date +%Y-%m-%d)

# Extract the [Unreleased] section content
CHANGELOG_BODY=$(node -e "
  const fs = require('fs');
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const match = changelog.match(/## \\[Unreleased\\]\\n([\\s\\S]*?)\\n---/);
  if (match) {
    console.log(match[1].trim());
  } else {
    console.log('No unreleased changes found.');
  }
")

# Replace [Unreleased] heading, insert new version section
node -e "
  const fs = require('fs');
  let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

  const unreleasedMatch = changelog.match(/(## \\[Unreleased\\]\\n)([\\s\\S]*?)(\\n---)/);
  if (!unreleasedMatch) {
    console.error('Could not find [Unreleased] section in CHANGELOG.md');
    process.exit(1);
  }

  const unreleasedContent = unreleasedMatch[2];
  const newSection = '## [Unreleased]\n\n---\n\n## [${NEW_VERSION}] - ${TODAY}\n' + unreleasedContent + '\n---';
  changelog = changelog.replace(unreleasedMatch[0], newSection);

  const oldUnreleasedLink = /\\[Unreleased\\]: .*/;
  changelog = changelog.replace(
    oldUnreleasedLink,
    '[Unreleased]: https://github.com/OmGuptaIND/computer/compare/v${NEW_VERSION}...HEAD\n[${NEW_VERSION}]: https://github.com/OmGuptaIND/computer/compare/v\$(changelog.match(/## \\[(\\d+\\.\\d+\\.\\d+)\\]/g)[1].match(/\\d+\\.\\d+\\.\\d+/)[0])...v${NEW_VERSION}'
  );

  fs.writeFileSync('CHANGELOG.md', changelog);
"

echo "$CHANGELOG_BODY" > /tmp/anton-release-notes.md
ok "Changelog moved to [${NEW_VERSION}] - ${TODAY}"

# Show what's in this release
echo ""
echo -e "  ${BOLD}Release notes:${NC}"
echo "$CHANGELOG_BODY" | sed 's/^/    /'
echo ""

# ── 3. Update manifest.json ────────────────────────────────────────

step "Updating manifest.json"

GITHUB_BASE="https://github.com/OmGuptaIND/computer/releases/download/v${NEW_VERSION}"

node -e "
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.version = '${NEW_VERSION}';
  manifest.gitHash = '';
  manifest.changelog = $(echo "$CHANGELOG_BODY" | node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n');
    const compact = lines
      .filter(l => l.startsWith('- ') || l.startsWith('### '))
      .map(l => l.startsWith('### ') ? '\n' + l.replace('### ', '') + ':' : l)
      .join('\n')
      .trim();
    console.log(JSON.stringify(compact));
  ");
  manifest.publishedAt = new Date().toISOString();
  manifest.binaries = {
    'linux-x64': '${GITHUB_BASE}/anton-agent-linux-x64',
    'linux-arm64': '${GITHUB_BASE}/anton-agent-linux-arm64'
  };
  manifest.sidecar_binaries = {
    'linux-x64': '${GITHUB_BASE}/anton-sidecar-linux-amd64',
    'linux-arm64': '${GITHUB_BASE}/anton-sidecar-linux-arm64'
  };
  manifest.cli = '${GITHUB_BASE}/anton-cli.mjs';
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
"

ok "manifest.json → v${NEW_VERSION}"

# ── 4. Commit + tag ───────────────────────────────────────────────

step "Committing and tagging"

git add -A
git commit -m "release: v${NEW_VERSION}

$(cat /tmp/anton-release-notes.md)"

if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
  echo ""
  warn "Tag v${NEW_VERSION} already exists."
  echo ""
  read -p "  Delete existing tag and re-create? [y/N]: " CONFIRM
  if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    git tag -d "v${NEW_VERSION}" >/dev/null 2>&1
    # Also delete remote tag if it exists
    git push origin ":refs/tags/v${NEW_VERSION}" 2>/dev/null || true
    ok "Deleted old tag v${NEW_VERSION}"
  else
    err "Aborted. Pick a different version or delete the tag manually."
    exit 1
  fi
fi

git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"

ok "Committed and tagged v${NEW_VERSION}"

# ── 5. Push (if --push) ───────────────────────────────────────────

if [[ "$AUTO_PUSH" == "--push" ]]; then
  step "Pushing to origin"
  git push origin main "v${NEW_VERSION}"
  ok "Pushed to origin — CI will build agent binaries + desktop app"
  echo ""
  echo -e "  ${BOLD}CI will:${NC}"
  echo "    1. Build agent SEA binaries (linux-x64, linux-arm64)"
  echo "    2. Build desktop app (.dmg, .msi, .AppImage, .deb)"
  echo "    3. Create GitHub Release with all artifacts + changelog"
  echo "    4. Update manifest.json with git hash"
  echo ""
  echo -e "  Track progress: ${BLUE}https://github.com/OmGuptaIND/computer/actions${NC}"
else
  echo ""
  echo -e "  ${BOLD}Release v${NEW_VERSION} ready locally.${NC}"
  echo ""
  echo "  To publish:  git push origin main "v${NEW_VERSION}""
  echo "  Or run:      make release  (will push automatically)"
fi

echo ""
