/**
 * Trajectory quality scorer.
 *
 * Four sub-scores combined:
 *   - Ordering (0.35): LCS ratio of actual tool sequence vs expectedTrajectory
 *   - Redundancy penalty (0.25): penalizes consecutive duplicate tool+input calls
 *   - Dead-end penalty (0.20): penalizes error-then-identical-retry patterns
 *   - Planning behavior (0.20): checks task_tracker usage for multi-step cases
 */

import type { EvalCase, EvalResult } from '../types.js'

/**
 * Longest common subsequence length between two string arrays.
 */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length
  // Use a 1D DP array for space efficiency
  const prev = new Array<number>(n + 1).fill(0)
  const curr = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j]
      curr[j] = 0
    }
  }
  return prev[n]
}

/**
 * Score ordering: LCS ratio of actual tool names vs expected trajectory.
 */
function scoreOrdering(toolNames: string[], expectedTrajectory: string[]): number {
  if (expectedTrajectory.length === 0) return 1.0
  const lcs = lcsLength(toolNames, expectedTrajectory)
  return lcs / expectedTrajectory.length
}

/**
 * Score redundancy: penalize consecutive identical tool calls (same name + same input).
 */
function scoreRedundancy(toolCalls: EvalResult['toolCalls']): number {
  if (toolCalls.length <= 1) return 1.0

  let duplicates = 0
  for (let i = 1; i < toolCalls.length; i++) {
    const prev = toolCalls[i - 1]
    const curr = toolCalls[i]
    if (prev.name === curr.name && JSON.stringify(prev.input) === JSON.stringify(curr.input)) {
      duplicates++
    }
  }
  return 1.0 - duplicates / toolCalls.length
}

/**
 * Score dead-ends: tool calls that error then retry with identical input.
 */
function scoreDeadEnds(
  toolCalls: EvalResult['toolCalls'],
  events: EvalResult['events'],
): number {
  if (toolCalls.length <= 1) return 1.0

  // Build a set of tool call indices that produced errors
  const errorIndices = new Set<number>()
  let toolCallIndex = 0
  for (const event of events) {
    if (event.type === 'tool_result') {
      if (event.error || event.isError) {
        errorIndices.add(toolCallIndex)
      }
      toolCallIndex++
    }
  }

  let deadEnds = 0
  for (let i = 0; i < toolCalls.length - 1; i++) {
    if (!errorIndices.has(i)) continue
    const curr = toolCalls[i]
    const next = toolCalls[i + 1]
    if (curr.name === next.name && JSON.stringify(curr.input) === JSON.stringify(next.input)) {
      deadEnds++
    }
  }

  return 1.0 - deadEnds / toolCalls.length
}

/**
 * Score planning behavior: whether task_tracker is used appropriately.
 * - For multi-step tagged cases: task_tracker in first 2 calls = 1.0, later = 0.5, never = 0.0
 * - For simple cases: penalize task_tracker usage (unnecessary overhead)
 */
function scorePlanning(toolNames: string[], tags: string[]): number {
  const isMultiStep = tags.includes('multi-step')
  const trackerIndex = toolNames.indexOf('task_tracker')

  if (isMultiStep) {
    if (trackerIndex === -1) return 0.0
    if (trackerIndex < 2) return 1.0
    return 0.5
  }

  // Simple case: penalize task_tracker usage
  return trackerIndex === -1 ? 1.0 : 0.7
}

export function scoreTrajectory(evalCase: EvalCase, result: EvalResult): number {
  const toolNames = result.toolCalls.map((c) => c.name)
  const tags = evalCase.tags || []
  const scores: Array<{ score: number; weight: number }> = []

  // Ordering — only scored if expectedTrajectory is provided
  if (evalCase.expectedTrajectory?.length) {
    scores.push({
      score: scoreOrdering(toolNames, evalCase.expectedTrajectory),
      weight: 0.35,
    })
  }

  // Redundancy penalty — always scored
  scores.push({
    score: scoreRedundancy(result.toolCalls),
    weight: 0.25,
  })

  // Dead-end penalty — always scored
  scores.push({
    score: scoreDeadEnds(result.toolCalls, result.events),
    weight: 0.2,
  })

  // Planning behavior — always scored
  scores.push({
    score: scorePlanning(toolNames, tags),
    weight: 0.2,
  })

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0)
  const weighted = scores.reduce((sum, s) => sum + s.score * s.weight, 0)
  return totalWeight === 0 ? 1.0 : weighted / totalWeight
}
