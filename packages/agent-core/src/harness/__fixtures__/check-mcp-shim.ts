/**
 * MCP shim integration checks.
 *
 * Run with:  pnpm --filter @anton/agent-core check:mcp-shim
 *
 * The check depends on the compiled shim at `dist/harness/anton-mcp-shim.js`.
 * The npm script runs `tsc` first to guarantee it exists.
 *
 * Covered:
 *   - `buildMcpSpawnConfig()` returns `process.execPath` + an absolute shim
 *     path that exists on disk.
 *   - `probeMcpShim()` round-trips an `initialize` against the real shim
 *     and returns `{ ok: true, version }`.
 *   - Version reported by the shim matches `getExpectedShimVersion()` —
 *     guards against forgetting to bump the constant in sync with the
 *     package version.
 *   - Probe fails cleanly (not hangs) when spawned with a bogus binary.
 *   - Probe fails cleanly when the shim exits without speaking
 *     initialize (here: missing env vars).
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMcpSpawnConfig,
  getExpectedShimVersion,
  probeMcpShim,
  type McpSpawnConfig,
} from '../mcp-spawn-config.js'

// Resolve the compiled shim path from the source location. The probe
// uses `import.meta.url` to locate its shim, but when running through
// tsx the source lives under `src/`, not `dist/`. We override the path
// in the probe-call sites below so we can run this check without
// shipping a .js next to the .ts source.
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const COMPILED_SHIM = join(__dirname, '../../../dist/harness/anton-mcp-shim.js')

if (!existsSync(COMPILED_SHIM)) {
  console.error(`✗ compiled shim missing at ${COMPILED_SHIM}`)
  console.error('  Run `pnpm --filter @anton/agent-core build` first.')
  process.exit(1)
}

const compiledConfig: McpSpawnConfig = {
  command: process.execPath,
  args: [COMPILED_SHIM],
  shimPath: COMPILED_SHIM,
}

interface Case {
  name: string
  run: () => Promise<string | null>
}

const cases: Case[] = [
  {
    name: 'buildMcpSpawnConfig returns absolute command + args',
    run: async () => {
      const cfg = buildMcpSpawnConfig()
      if (cfg.command !== process.execPath) return `command was ${cfg.command}, expected execPath`
      if (cfg.args.length !== 1) return `expected 1 arg, got ${cfg.args.length}`
      if (!cfg.args[0]?.endsWith('anton-mcp-shim.js'))
        return `arg[0] did not end with shim name: ${cfg.args[0]}`
      if (cfg.shimPath !== cfg.args[0])
        return 'shimPath should equal args[0] for diagnostic clarity'
      return null
    },
  },
  {
    name: 'getExpectedShimVersion returns a non-empty string',
    run: async () => {
      const v = getExpectedShimVersion()
      if (typeof v !== 'string') return `type was ${typeof v}`
      if (v.length === 0) return 'version was empty'
      return null
    },
  },
  {
    name: 'probe round-trips initialize against compiled shim',
    run: async () => {
      const result = await probeMcpShim(compiledConfig, 5_000)
      if (!result.ok) {
        return `probe failed: ${result.error}\n  stderrTail: ${result.stderrTail.join('\n  ')}`
      }
      if (!result.version) return 'probe returned ok but no version'
      if (result.serverName !== 'anton-mcp-shim')
        return `unexpected serverName: ${result.serverName}`
      if (!result.protocolVersion) return 'probe returned ok but no protocolVersion'
      return null
    },
  },
  {
    name: 'shim version matches getExpectedShimVersion',
    run: async () => {
      const result = await probeMcpShim(compiledConfig, 5_000)
      if (!result.ok) return `probe failed: ${result.error}`
      const expected = getExpectedShimVersion()
      if (result.version !== expected)
        return `shim reported ${result.version}, expected ${expected}`
      return null
    },
  },
  {
    name: 'probe fails cleanly (not hang) on missing binary',
    run: async () => {
      const result = await probeMcpShim(
        {
          command: '/definitely/not/a/real/node/binary',
          args: [COMPILED_SHIM],
          shimPath: COMPILED_SHIM,
        },
        2_000,
      )
      if (result.ok) return 'probe should have failed'
      if (!/spawn failed|ENOENT/.test(result.error))
        return `expected spawn failure, got: ${result.error}`
      if (result.durationMs > 1_500) return `took too long: ${result.durationMs}ms`
      return null
    },
  },
  {
    name: 'probe fails cleanly on missing shim path',
    run: async () => {
      const result = await probeMcpShim(
        {
          command: process.execPath,
          args: [join(dirname(COMPILED_SHIM), 'does-not-exist.js')],
          shimPath: join(dirname(COMPILED_SHIM), 'does-not-exist.js'),
        },
        2_000,
      )
      if (result.ok) return 'probe should have failed'
      // Node with a missing script exits with a non-zero code and no
      // MCP output, so we expect the "exited before initialize" branch.
      if (!/exited before initialize/.test(result.error))
        return `expected early-exit error, got: ${result.error}`
      return null
    },
  },
]

async function main(): Promise<void> {
  let failed = 0
  for (const c of cases) {
    try {
      const err = await c.run()
      if (err === null) {
        console.log(`✓ mcp-shim: ${c.name}`)
      } else {
        failed++
        console.error(`✗ mcp-shim: ${c.name} — ${err}`)
      }
    } catch (err) {
      failed++
      console.error(`✗ mcp-shim: ${c.name} (threw)`, err)
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}/${cases.length} mcp-shim checks failed`)
    process.exit(1)
  }
  console.log(`\nAll ${cases.length} mcp-shim checks passed`)
}

void main()
