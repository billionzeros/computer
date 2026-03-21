#!/usr/bin/env bash
#
# Release script for anton.computer
#
# Usage:
#   ./scripts/release.sh 0.6.0
#
# What it does:
#   1. Validates the version format
#   2. Updates package.json versions across the monorepo
#   3. Moves [Unreleased] changelog entries under the new version heading
#   4. Updates manifest.json with the new version + binary URLs
#   5. Commits, tags, and pushes — triggering the CI binary build
#
# The CI workflow (.github/workflows/release.yml) then:
#   - Builds the agent binary for linux-x64 and linux-arm64
#   - Creates a GitHub Release with binaries + changelog
#   - Updates manifest.json with the git hash
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Validate args ──────────────────────────────────────────────────

NEW_VERSION="${1:-}"

if [[ -z "$NEW_VERSION" ]]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.6.0"
  exit 1
fi

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be semver (e.g. 0.6.0), got: $NEW_VERSION"
  exit 1
fi

# Check for clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: Working tree is not clean. Commit or stash your changes first."
  exit 1
fi

echo "Releasing v${NEW_VERSION}..."

# ── 1. Update package versions ─────────────────────────────────────

echo "  Updating package versions..."

# Root package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# All workspace packages
for pkg_json in packages/*/package.json; do
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${pkg_json}', 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync('${pkg_json}', JSON.stringify(pkg, null, 2) + '\n');
  "
done

# ── 2. Update changelog ───────────────────────────────────────────

echo "  Updating CHANGELOG.md..."

TODAY=$(date +%Y-%m-%d)

# Extract the [Unreleased] section content for the GitHub Release body
CHANGELOG_BODY=$(node -e "
  const fs = require('fs');
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const match = changelog.match(/## \\[Unreleased\\]\\n([\\s\\S]*?)\\n---/);
  if (match) {
    // Trim leading/trailing whitespace
    console.log(match[1].trim());
  } else {
    console.log('No unreleased changes found.');
  }
")

# Replace [Unreleased] heading, keep an empty Unreleased section, insert new version
node -e "
  const fs = require('fs');
  let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

  // Find the Unreleased section and its content
  const unreleasedMatch = changelog.match(/(## \\[Unreleased\\]\\n)([\\s\\S]*?)(\\n---)/);
  if (!unreleasedMatch) {
    console.error('Could not find [Unreleased] section in CHANGELOG.md');
    process.exit(1);
  }

  const unreleasedContent = unreleasedMatch[2];

  // Build new changelog content
  const newSection = '## [Unreleased]\n\n---\n\n## [${NEW_VERSION}] - ${TODAY}\n' + unreleasedContent + '\n---';
  changelog = changelog.replace(unreleasedMatch[0], newSection);

  // Update comparison links at the bottom
  const oldUnreleasedLink = /\\[Unreleased\\]: .*/;
  changelog = changelog.replace(
    oldUnreleasedLink,
    '[Unreleased]: https://github.com/OmGuptaIND/anton.computer/compare/v${NEW_VERSION}...HEAD\n[${NEW_VERSION}]: https://github.com/OmGuptaIND/anton.computer/compare/v\$(changelog.match(/## \\[(\\d+\\.\\d+\\.\\d+)\\]/g)[1].match(/\\d+\\.\\d+\\.\\d+/)[0])...v${NEW_VERSION}'
  );

  fs.writeFileSync('CHANGELOG.md', changelog);
"

# Save changelog body for CI to use in the GitHub Release
echo "$CHANGELOG_BODY" > /tmp/anton-release-notes.md
echo "  Release notes saved to /tmp/anton-release-notes.md"

# ── 3. Update manifest.json ────────────────────────────────────────

echo "  Updating manifest.json..."

GITHUB_BASE="https://github.com/OmGuptaIND/anton.computer/releases/download/v${NEW_VERSION}"

node -e "
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.version = '${NEW_VERSION}';
  manifest.gitHash = '';  // CI fills this in after build
  manifest.changelog = $(echo "$CHANGELOG_BODY" | node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n');
    // Convert changelog sections to a compact string
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
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
"

# ── 4. Commit, tag, push ──────────────────────────────────────────

echo "  Committing and tagging..."

git add -A
git commit -m "release: v${NEW_VERSION}

$(cat /tmp/anton-release-notes.md)"

git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"

echo ""
echo "Release v${NEW_VERSION} is ready locally."
echo ""
echo "Options:"
echo ""
echo "  A) Let CI build the binaries (costs GitHub Actions minutes):"
echo "     git push origin main --tags"
echo ""
echo "  B) Build locally and upload yourself (free, faster):"
echo "     ./scripts/build-binary.sh"
echo "     git push origin main --tags"
echo "     gh release create v${NEW_VERSION} --title 'v${NEW_VERSION}' --notes-file /tmp/anton-release-notes.md dist/anton-agent-*"
echo ""
echo "  Option B skips CI entirely — you build the binary on your machine"
echo "  and upload it directly to the GitHub Release."
