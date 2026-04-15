# Logging Standard

Structured logging across the anton agent stack via `@anton/logger` (pino).

## Package

`packages/logger/` — leaf dependency, no `@anton/*` deps. Every package that needs logging adds `"@anton/logger": "workspace:*"`.

## API (4 functions)

```typescript
import { initLogger, createLogger, withContext, getRootLogger } from '@anton/logger'

// 1. Call once at startup (agent-server/src/index.ts)
initLogger()

// 2. Per-module logger — replaces [bracket-prefix] convention
const log = createLogger('mcp-manager')
log.info({ count: 3 }, 'starting connectors')
log.error({ connector: 'github', err }, 'failed to start')

// 3. Bind session/agent context — returns new child, never mutates
const sessionLog = withContext(log, { sessionId: 'abc', agentName: 'research' })
sessionLog.info('turn started')
// → { module: "session", sessionId: "abc", msg: "turn started" }

// 4. Escape hatch (auto-inits if called before initLogger)
getRootLogger()
```

## Log Levels

| Level | When to use |
|-------|-------------|
| `debug` | Per-event traces, API key resolution, individual pi SDK events |
| `info` | Startup, shutdown, connector lifecycle, job runs, session milestones |
| `warn` | Recoverable issues: health check failures, invalid schedules, retries |
| `error` | Failures: LLM errors, connector crashes, missing API keys |
| `fatal` | Process-ending errors (only in main catch) |

## Output Formats

**Dev (TTY):** Pretty-printed via pino-pretty (worker thread, non-blocking)
```
[19:56:32] INFO (mcp-manager): starting connectors { count: 3 }
[19:56:33] INFO (connector-manager): activated { connector: "GitHub", toolCount: 16 }
[19:56:33] ERROR (session): LLM error { sessionId: "abc", error: "rate limited" }
```

**Prod (JSON):** Machine-parseable, pipe-friendly
```json
{"level":"info","time":1712345678,"module":"mcp-manager","msg":"starting connectors","count":3}
{"level":"error","time":1712345679,"module":"session","sessionId":"abc","msg":"LLM error","error":"rate limited"}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum level: `debug`, `info`, `warn`, `error` |
| `ANTON_JSON_LOGS` | unset | Set to `1` to force JSON output (overrides TTY detection) |

## Module Names

Each file gets a named logger. These are the standard module names:

### agent-core
| Module | File |
|--------|------|
| `session` | session.ts — uses `withContext` to bind sessionId |
| `mcp-manager` | mcp/mcp-manager.ts |
| `mcp-client` | mcp/mcp-client.ts — child logger per connector ID |
| `compaction` | compaction.ts |
| `browser` | tools/browser.ts |
| `tools` | agent.ts (buildTools) |
| `tracing` | tracing.ts |

### agent-server
| Module | File |
|--------|------|
| `server` | server.ts, index.ts |
| `scheduler` | scheduler.ts |
| `updater` | updater.ts |
| `telegram` | telegram-bot.ts |
| `agent-manager` | agents/agent-manager.ts |
| `credential-store` | credential-store.ts |

### connectors
| Module | File |
|--------|------|
| `connector-manager` | connector-manager.ts |

## Conventions

### Do

```typescript
// Structured data in first arg, message in second
log.info({ sessionId, eventCount: 42 }, 'processMessage complete')

// Errors go in { err } for pino's serializer
log.error({ err, connector: 'github' }, 'failed to start')

// Use debug for high-frequency events
log.debug({ event: event.type }, 'pi event')

// Use withContext for session-scoped logging
this.log = withContext(baseLog, { sessionId: this.id })
```

### Don't

```typescript
// DON'T use console.log — biome will reject it
console.log('[server] something happened')  // ← lint error

// DON'T interpolate data into message strings
log.info(`Session ${id} produced ${count} events`)  // ← bad
log.info({ sessionId: id, count }, 'events produced')  // ← good

// DON'T use bracket prefixes — the module name replaces them
log.info('[mcp-manager] starting...')  // ← redundant
log.info('starting...')  // ← good, module name is automatic
```

## Lint Enforcement

`biome.json` has `noConsole: "error"` globally. Exemptions:

| Scope | Rule | Reason |
|-------|------|--------|
| `packages/cli/**` | off | Terminal UI, user-facing output |
| `packages/desktop/**` | off | Browser dev console |
| `packages/agent-config/**` | off | Config loading utilities |
| `packages/agent-core/src/evals/**` | off | Dev-only eval harness |
| `packages/agent-server/src/index.ts` | warn | Startup ASCII banner only |

## Relationship to Braintrust Tracing

Braintrust tracing (`agent-core/src/tracing.ts`) is for **AI observability** — per-turn traces with token costs, tool success rates, and scoring. It is a separate concern from operational logging.

| Concern | Tool | Output |
|---------|------|--------|
| Operational logs | `@anton/logger` (pino) | stdout (JSON/pretty) |
| AI turn traces | Braintrust SDK | Braintrust dashboard |
| Skill audit trail | `appendFileSync` | `~/.anton/scheduler.log` |

All three coexist. Operational log calls in `tracing.ts` use `@anton/logger`. The Braintrust SDK calls are untouched.

## Adding Logging to a New File

```typescript
// 1. Import
import { createLogger } from '@anton/logger'

// 2. Create module logger (top of file, after imports)
const log = createLogger('my-module')

// 3. Use it
log.info({ key: 'value' }, 'something happened')
```

If the file needs session context, use `withContext`:

```typescript
import { createLogger, withContext } from '@anton/logger'

const baseLog = createLogger('my-module')

class MyThing {
  private log
  constructor(sessionId: string) {
    this.log = withContext(baseLog, { sessionId })
  }
}
```
