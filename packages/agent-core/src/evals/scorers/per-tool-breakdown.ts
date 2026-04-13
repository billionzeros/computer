/**
 * Per-tool breakdown reporter.
 *
 * Not a single score — a structured reporter that returns a composite AND
 * logs per-tool stats. For each tool used: call count, error count, success rate.
 * Composite score = weighted average success rate across tools.
 */

import type { EvalCase, EvalResult } from '../types.js'

export interface ToolStats {
  name: string
  calls: number
  errors: number
  successRate: number
}

export interface PerToolBreakdown {
  score: number
  tools: ToolStats[]
}

/**
 * Compute per-tool breakdown and composite score.
 * Also returns the structured stats for logging to Braintrust metadata.
 */
export function computePerToolBreakdown(
  _evalCase: EvalCase,
  result: EvalResult,
): PerToolBreakdown {
  const toolMap = new Map<string, { calls: number; errors: number }>()

  // Count calls per tool
  for (const call of result.toolCalls) {
    const entry = toolMap.get(call.name) || { calls: 0, errors: 0 }
    entry.calls++
    toolMap.set(call.name, entry)
  }

  // Count errors per tool from events
  let toolCallIndex = 0
  for (const event of result.events) {
    if (event.type === 'tool_result') {
      if (toolCallIndex < result.toolCalls.length) {
        const toolName = result.toolCalls[toolCallIndex].name
        if (event.error || event.isError) {
          const entry = toolMap.get(toolName)
          if (entry) entry.errors++
        }
      }
      toolCallIndex++
    }
  }

  const tools: ToolStats[] = Array.from(toolMap.entries()).map(([name, stats]) => ({
    name,
    calls: stats.calls,
    errors: stats.errors,
    successRate: stats.calls === 0 ? 1.0 : (stats.calls - stats.errors) / stats.calls,
  }))

  // Composite score = weighted average success rate (weighted by call count)
  const totalCalls = tools.reduce((sum, t) => sum + t.calls, 0)
  const score =
    totalCalls === 0
      ? 1.0
      : tools.reduce((sum, t) => sum + t.successRate * t.calls, 0) / totalCalls

  return { score, tools }
}

/**
 * Score function compatible with the eval harness.
 * Returns the composite success rate.
 */
export function scorePerToolBreakdown(evalCase: EvalCase, result: EvalResult): number {
  const breakdown = computePerToolBreakdown(evalCase, result)
  return breakdown.score
}
