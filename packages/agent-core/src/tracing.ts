/**
 * Braintrust observability — optional tracing for agent sessions.
 *
 * When a BRAINTRUST_API_KEY is available (env var or config), every agent turn
 * is logged as a trace with nested spans for tool calls. When no key is set,
 * everything no-ops with zero overhead.
 */

import { createHash } from 'node:crypto'
import { createLogger } from '@anton/logger'
import type { TokenUsage } from '@anton/protocol'
import { type Span, flush as btFlush, initLogger } from 'braintrust'

const log = createLogger('tracing')

let tracingEnabled = false
let logger: ReturnType<typeof initLogger> | null = null

export type { Span } from 'braintrust'

// ── Initialization ───────────────────────────────────────────────────

export function initTracing(opts?: {
  apiKey?: string
  projectName?: string
  sampleRate?: number
  onlineScoring?: boolean
}) {
  const apiKey = opts?.apiKey || process.env.BRAINTRUST_API_KEY
  if (!apiKey) {
    log.info('no BRAINTRUST_API_KEY — tracing disabled')
    return
  }

  const projectName = opts?.projectName || 'anton-agent'
  logger = initLogger({ apiKey, projectName })
  tracingEnabled = true
  _sampleRate = Math.max(0, Math.min(1, opts?.sampleRate ?? 0.1))
  _onlineScoringEnabled = opts?.onlineScoring ?? false
  log.info({ project: projectName }, 'Braintrust enabled')
}

export function isTracingEnabled(): boolean {
  return tracingEnabled
}

// ── Top-level trace ──────────────────────────────────────────────────

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
 * Start a child span under an existing parent. Used for sub-agent tracing
 * so child agents appear nested under the parent's tool call.
 */
export function startChildTrace(
  parent: Span,
  opts: {
    name: string
    input?: unknown
    metadata?: Record<string, unknown>
  },
): Span {
  return parent.startSpan({
    name: opts.name,
    event: {
      input: opts.input,
      metadata: opts.metadata,
    },
  })
}

// ── Score logging ────────────────────────────────────────────────────

/**
 * Attach a named score to a span. Used by both eval harness and online scoring.
 */
export function logScore(
  span: Span,
  name: string,
  score: number,
  metadata?: Record<string, unknown>,
): void {
  span.log({
    scores: { [name]: score },
    ...(metadata ? { metadata } : {}),
  })
}

/**
 * Log feedback (e.g. thumbs up/down) against a span by its id. Works AFTER
 * the span has been ended — Braintrust treats this as a post-hoc score on
 * the persisted event.
 */
export function logSpanFeedback(
  spanId: string,
  scores: Record<string, number>,
  metadata?: Record<string, unknown>,
): void {
  if (!tracingEnabled || !logger) return
  try {
    logger.logFeedback({
      id: spanId,
      scores,
      ...(metadata ? { metadata } : {}),
      source: 'app',
    })
  } catch (err) {
    log.warn({ err, spanId }, 'logSpanFeedback failed')
  }
}

// ── Cost estimation ──────────────────────────────────────────────────

/** Price per million tokens: { input, output } in USD. */
interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

/**
 * Pricing table for common models. Returns $0 for unknown models —
 * better to under-count than throw.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4 },
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  o3: { inputPerMillion: 10, outputPerMillion: 40 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // Google
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Groq (hosted, approximate)
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
}

/** Look up pricing, falling back to $0 for unknown models. */
function findPricing(model: string): ModelPricing {
  // Exact match first
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]
  // Prefix match (e.g. "claude-sonnet-4-6-20250514" → "claude-sonnet-4-6")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing
  }
  return { inputPerMillion: 0, outputPerMillion: 0 }
}

export interface CostEstimate {
  inputCost: number
  outputCost: number
  totalCost: number
}

/** Estimate USD cost for a turn's token usage. */
export function estimateCost(model: string, usage: TokenUsage): CostEstimate {
  const pricing = findPricing(model)
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  return { inputCost, outputCost, totalCost: inputCost + outputCost }
}

// ── Error categorization ─────────────────────────────────────────────

export type ErrorCategory =
  | 'api_error'
  | 'tool_error'
  | 'rate_limit'
  | 'user_cancel'
  | 'budget_exceeded'
  | 'timeout'
  | 'unknown'

const ERROR_PATTERNS: Array<[RegExp, ErrorCategory]> = [
  [/rate.?limit|429|too many requests/i, 'rate_limit'],
  [/token budget exceeded|max.?tokens/i, 'budget_exceeded'],
  [/timed?\s*out|deadline|ETIMEDOUT/i, 'timeout'],
  [/denied by user|user cancel|user rejected/i, 'user_cancel'],
  [/api.?error|401|403|500|502|503/i, 'api_error'],
  [/tool.?error|tool execution failed/i, 'tool_error'],
]

/** Classify an error message into a category. */
export function categorizeError(message: string): ErrorCategory {
  for (const [pattern, category] of ERROR_PATTERNS) {
    if (pattern.test(message)) return category
  }
  return 'unknown'
}

// ── Heuristic metrics ────────────────────────────────────────────────

export interface TurnMetrics {
  toolSuccessRate: number
  responseLength: number
  cost: number
}

/**
 * Compute zero-cost heuristic scores for a turn.
 * These are logged as span scores on every traced turn.
 */
export function computeHeuristicScores(opts: {
  toolCallCount: number
  toolErrorCount: number
  responseText: string
  cost: number
}): TurnMetrics {
  const { toolCallCount, toolErrorCount, responseText, cost } = opts

  // Tool success rate: 1.0 if no tool calls, otherwise fraction of successes
  const toolSuccessRate =
    toolCallCount === 0 ? 1.0 : (toolCallCount - toolErrorCount) / toolCallCount

  // Response length score: penalize empty or absurdly long
  const len = responseText.length
  let responseLength = 1.0
  if (len === 0) responseLength = 0
  else if (len < 10) responseLength = 0.3
  else if (len > 20_000) responseLength = 0.5

  return { toolSuccessRate, responseLength, cost }
}

// ── Online scoring / sampling ────────────────────────────────────────

let _sampleRate = 0.1
let _onlineScoringEnabled = false

export function isOnlineScoringEnabled(): boolean {
  return tracingEnabled && _onlineScoringEnabled
}

/**
 * Deterministic sampling: hash the session ID and check against the rate.
 * Same session always gets the same decision.
 */
export function shouldSampleForScoring(sessionId: string, sampleRate?: number): boolean {
  if (!tracingEnabled || !_onlineScoringEnabled) return false
  const rate = sampleRate ?? _sampleRate
  if (rate <= 0) return false
  if (rate >= 1) return true
  const hash = createHash('md5').update(sessionId).digest()
  const value = hash.readUInt16BE(0) / 0xffff
  return value < rate
}

// ── Prompt versioning ────────────────────────────────────────────────

/** Hash a system prompt to a short version string for tracking. */
export function hashPromptVersion(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 12)
}

// ── Flush ────────────────────────────────────────────────────────────

/**
 * Flush pending traces to Braintrust. Call on shutdown.
 */
export async function flushTraces(): Promise<void> {
  if (!tracingEnabled) return
  try {
    await btFlush()
  } catch (err) {
    log.error({ err }, 'flush error')
  }
}
