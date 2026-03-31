/**
 * Tool selection scorer.
 *
 * Compares the agent's first tool call against the expected tool.
 * - 1.0 = exact match
 * - 0.5 = acceptable alternative
 * - 0.0 = wrong tool or no tool called
 */

import type { EvalCase, EvalResult } from '../types.js'

export function scoreToolSelection(evalCase: EvalCase, result: EvalResult): number {
  if (!evalCase.expectedTool) return 1.0 // no expectation = pass

  const actualTool = result.firstToolCall
  if (!actualTool) return 0.0 // agent didn't call any tool

  // Exact match
  if (actualTool === evalCase.expectedTool) return 1.0

  // Acceptable alternative
  if (evalCase.acceptableTools?.includes(actualTool)) return 0.5

  // Wrong tool
  return 0.0
}
