/**
 * Shared esbuild config — single source of truth for all bundle steps.
 *
 * Used by:
 *   - scripts/bundle.sh        (local dev deploy)
 *   - scripts/preflight.sh     (local CI check)
 *   - .github/workflows/release.yml  (CI release)
 *
 * Usage from shell:
 *   node scripts/esbuild.config.js agent-externals   → prints --external:x flags
 *   node scripts/esbuild.config.js cli-externals     → prints --external:x flags
 */

const config = {
  agent: {
    externals: [
      'node-pty',
      'chokidar',
      'playwright-core',
      'playwright',
      'chromium-bidi',
    ],
  },
  cli: {
    externals: [
      'node-pty',
    ],
  },
};

// CLI interface — print flags for shell scripts
const cmd = process.argv[2];
if (cmd === 'agent-externals') {
  console.log(config.agent.externals.map(e => `--external:${e}`).join(' '));
} else if (cmd === 'cli-externals') {
  console.log(config.cli.externals.map(e => `--external:${e}`).join(' '));
} else if (cmd) {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: node scripts/esbuild.config.js [agent-externals|cli-externals]');
  process.exit(1);
}

module.exports = config;
