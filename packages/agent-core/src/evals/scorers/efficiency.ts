/**
 * Efficiency scorer.
 *
 * Measures token usage, tool call count, and wall-clock time against baselines.
 * Three axes, each 0.0-1.0, combined with weights:
 *   - Token efficiency (0.40)
 *   - Tool call count (0.35)
 *   - Wall-clock time (0.25)
 *
 * If no baseline is provided for an axis, that axis scores 1.0 (first run
 * establishes the baseline).
 */

import type { EvalCase, EvalResult } from '../types.js'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function efficiencyRatio(actual: number, baseline: number): number {
  if (baseline <= 0) return 1.0
  return clamp(1.0 - (actual - baseline) / baseline, 0, 1)
}

/**
 * Extract total token count from session events.
 * Looks for `done` events that carry token usage metadata.
 */
function extractTokenCount(events: EvalResult['events']): number {
  let total = 0
  for (const event of events) {
    if (event.type === 'done' && typeof event.totalTokens === 'number') {
      total += event.totalTokens
    }
    // Also check nested usage objects
    if (event.type === 'done' && event.usage && typeof event.usage === 'object') {
      const usage = event.usage as Record<string, unknown>
      if (typeof usage.total_tokens === 'number') {
        total += usage.total_tokens
      }
    }
  }
  return total
}

export function scoreEfficiency(evalCase: EvalCase, result: EvalResult): number {
  const baseline = evalCase.baseline
  const scores: Array<{ score: number; weight: number }> = []

  // Token efficiency
  const tokenBaseline = baseline?.tokens
  if (tokenBaseline != null) {
    const actualTokens = extractTokenCount(result.events)
    scores.push({ score: efficiencyRatio(actualTokens, tokenBaseline), weight: 0.4 })
  }

  // Tool call count
  const toolCallBaseline = baseline?.toolCalls
  if (toolCallBaseline != null) {
    scores.push({ score: efficiencyRatio(result.toolCalls.length, toolCallBaseline), weight: 0.35 })
  }

  // Wall-clock time
  const durationBaseline = baseline?.durationMs
  if (durationBaseline != null) {
    scores.push({ score: efficiencyRatio(result.durationMs, durationBaseline), weight: 0.25 })
  }

  // No baselines → score 1.0 (first run establishes baseline)
  if (scores.length === 0) return 1.0

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0)
  const weighted = scores.reduce((sum, s) => sum + s.score * s.weight, 0)
  return totalWeight === 0 ? 1.0 : weighted / totalWeight
}
