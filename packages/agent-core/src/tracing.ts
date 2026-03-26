/**
 * Braintrust observability — optional tracing for agent sessions.
 *
 * When a BRAINTRUST_API_KEY is available (env var or config), every agent turn
 * is logged as a trace with nested spans for tool calls. When no key is set,
 * everything no-ops with zero overhead.
 */

import { initLogger, flush as btFlush, type Span } from 'braintrust'

let tracingEnabled = false
let logger: ReturnType<typeof initLogger> | null = null

export type { Span } from 'braintrust'

export function initTracing(opts?: { apiKey?: string; projectName?: string }) {
  const apiKey = opts?.apiKey || process.env.BRAINTRUST_API_KEY
  if (!apiKey) {
    console.log('[tracing] No BRAINTRUST_API_KEY — tracing disabled')
    return
  }

  const projectName = opts?.projectName || 'anton-agent'
  logger = initLogger({ apiKey, projectName })
  tracingEnabled = true
  console.log(`[tracing] Braintrust enabled for project "${projectName}"`)
}

export function isTracingEnabled(): boolean {
  return tracingEnabled
}

/**
 * Start a top-level trace span. Returns null when tracing is off.
 * Caller is responsible for calling span.end() when done.
 */
export function startTrace(opts: {
  name: string
  input?: unknown
  metadata?: Record<string, unknown>
}): Span | null {
  if (!tracingEnabled || !logger) return null
  return logger.startSpan({
    name: opts.name,
    event: {
      input: opts.input,
      metadata: opts.metadata,
    },
  })
}

/**
 * Flush pending traces to Braintrust. Call on shutdown.
 */
export async function flushTraces(): Promise<void> {
  if (!tracingEnabled) return
  try {
    await btFlush()
  } catch (err) {
    console.error('[tracing] flush error:', err)
  }
}
