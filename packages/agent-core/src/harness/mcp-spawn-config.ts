/**
 * MCP shim spawn config — single source of truth for how to launch
 * `anton-mcp-shim.js` as a subprocess of `codex app-server`.
 *
 * The shim path is resolved from this module's own `import.meta.url`,
 * so it stays correct regardless of where the host process was started
 * or how `@anton/agent-core` is installed (monorepo workspace, `pnpm
 * deploy`, `rsync` to `/opt/anton`, etc.). The previous implementation
 * composed the path from `homedir() + '../node_modules/...'`, which
 * broke on VPS deployments where the server runs as user `anton` and
 * HOME resolves to `/home/anton` but the actual install sits at
 * `/opt/anton`.
 *
 * We also prefer `process.execPath` over the literal `'node'` — systemd
 * services don't inherit PATH reliably, and `execPath` is guaranteed to
 * be the node binary currently running the server.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@anton/logger'

const log = createLogger('mcp-spawn')

/** Absolute path to `anton-mcp-shim.js` next to this module on disk. */
const SHIM_PATH = fileURLToPath(new URL('./anton-mcp-shim.js', import.meta.url))

/**
 * Version of `@anton/agent-core` this shim ships with. Read once at module
 * load from the nearest `package.json`; used in the initialize handshake
 * so the server can log version skew on startup (e.g. if the shim on disk
 * is older than the host binary because `make sync` raced a partial
 * deploy).
 */
const PACKAGE_VERSION = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const raw = readFileSync(pkgPath, 'utf8')
    const { version } = JSON.parse(raw) as { version?: string }
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

export interface McpSpawnConfig {
  /** Absolute path to the node binary to invoke. */
  command: string
  /** Argv after the command — shim path only; callers pass env separately. */
  args: string[]
  /**
   * Absolute path to the shim on disk. Included for diagnostics — callers
   * shouldn't need to touch it. Useful when surfacing "shim not found"
   * errors or when printing the effective config.
   */
  shimPath: string
}

/**
 * Build the spawn config. Cheap and stateless — call per-session or cache
 * at the server level, behavior is identical either way.
 */
export function buildMcpSpawnConfig(): McpSpawnConfig {
  return {
    command: process.execPath,
    args: [SHIM_PATH],
    shimPath: SHIM_PATH,
  }
}

/** Expected version reported by `anton-mcp-shim` during `initialize`. */
export function getExpectedShimVersion(): string {
  return PACKAGE_VERSION
}

export type ShimProbeOk = {
  ok: true
  version: string
  protocolVersion: string
  serverName: string
  durationMs: number
}
export type ShimProbeErr = {
  ok: false
  error: string
  stderrTail: string[]
  durationMs: number
}
export type ShimProbeResult = ShimProbeOk | ShimProbeErr

/**
 * Health probe: spawn the shim in isolation, complete one `initialize`
 * round-trip, tear it down. Returns within `timeoutMs` either way.
 *
 * This is the gate the server uses on boot (and every 60s) to decide
 * whether to advertise MCP connectors to harness sessions. If the probe
 * fails, we log the stderr tail and *omit* the capability block —
 * harness CLIs won't hallucinate a connector that the shim can't reach.
 *
 * The probe uses ephemeral `ANTON_SESSION` / `ANTON_AUTH` values that
 * aren't registered with the IPC server. The shim is permitted to reach
 * `initialize` before it attempts to connect to the IPC socket, so the
 * probe confirms:
 *   1. The shim binary exists at the expected path.
 *   2. Node can load it without syntax errors or missing imports.
 *   3. JSON-RPC framing works end to end.
 *   4. Reported version matches the one we shipped.
 *
 * It does NOT verify the IPC auth path — that's exercised by every live
 * session as soon as a tool is called.
 */
export async function probeMcpShim(
  spawnConfig: McpSpawnConfig = buildMcpSpawnConfig(),
  timeoutMs = 5_000,
): Promise<ShimProbeResult> {
  const start = Date.now()
  const stderrTail: string[] = []
  const STDERR_TAIL_MAX = 20

  return new Promise<ShimProbeResult>((resolve) => {
    let settled = false
    const done = (result: ShimProbeResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn(spawnConfig.command, spawnConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Deliberate dummy values — enough to pass the shim's env check.
        // The probe completes before the shim tries to connect to the
        // socket, so these never hit the wire.
        ANTON_SOCK: process.env.ANTON_SOCK ?? '/tmp/anton-shim-probe.invalid',
        ANTON_SESSION: '__probe__',
        ANTON_AUTH: '__probe__',
      },
    })

    child.on('error', (err) => {
      done({
        ok: false,
        error: `spawn failed: ${err.message}`,
        stderrTail: [],
        durationMs: Date.now() - start,
      })
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean)
      for (const line of lines) {
        stderrTail.push(line)
        if (stderrTail.length > STDERR_TAIL_MAX) stderrTail.shift()
      }
    })

    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        newlineIdx = buffer.indexOf('\n')
        if (!line) continue

        try {
          const msg = JSON.parse(line) as {
            id?: number
            result?: {
              serverInfo?: { name?: string; version?: string }
              protocolVersion?: string
            }
          }
          if (msg.id === 1 && msg.result) {
            const serverInfo = msg.result.serverInfo ?? {}
            done({
              ok: true,
              version: serverInfo.version ?? 'unknown',
              protocolVersion: msg.result.protocolVersion ?? 'unknown',
              serverName: serverInfo.name ?? 'unknown',
              durationMs: Date.now() - start,
            })
            try {
              child.kill('SIGTERM')
            } catch {
              /* best-effort */
            }
            return
          }
        } catch {
          // Non-JSON stdout is a real problem for MCP — servers that log
          // to stdout corrupt the frame. We don't fail the probe on it,
          // but it surfaces in stderrTail on mismatch.
        }
      }
    })

    const timer = setTimeout(() => {
      done({
        ok: false,
        error: `probe timed out after ${timeoutMs}ms`,
        stderrTail: [...stderrTail],
        durationMs: Date.now() - start,
      })
      try {
        child.kill('SIGKILL')
      } catch {
        /* best-effort */
      }
    }, timeoutMs)

    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (!settled) {
        done({
          ok: false,
          error: `shim exited before initialize completed (code=${code}, signal=${signal})`,
          stderrTail: [...stderrTail],
          durationMs: Date.now() - start,
        })
      }
    })

    // Fire the initialize request.
    const initMsg = `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'anton-probe', version: PACKAGE_VERSION },
      },
    })}\n`
    try {
      child.stdin?.write(initMsg)
    } catch (err) {
      done({
        ok: false,
        error: `stdin write failed: ${(err as Error).message}`,
        stderrTail: [...stderrTail],
        durationMs: Date.now() - start,
      })
    }
  }).then((result) => {
    if (result.ok) {
      log.info(
        {
          shimPath: spawnConfig.shimPath,
          version: result.version,
          protocolVersion: result.protocolVersion,
          durationMs: result.durationMs,
        },
        'MCP shim probe ok',
      )
      if (result.version !== PACKAGE_VERSION) {
        log.warn(
          { expected: PACKAGE_VERSION, got: result.version },
          'MCP shim version mismatch — likely a partial deploy',
        )
      }
    } else {
      log.error(
        {
          shimPath: spawnConfig.shimPath,
          error: result.error,
          stderrTail: result.stderrTail,
          durationMs: result.durationMs,
          shimDir: dirname(spawnConfig.shimPath),
        },
        'MCP shim probe failed',
      )
    }
    return result
  })
}
