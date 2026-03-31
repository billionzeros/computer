/**
 * Factuality scorer — wraps Braintrust's autoevals Factuality scorer.
 *
 * Dynamically imports autoevals to avoid loading it when not needed.
 * Falls back to a simple keyword overlap scorer if autoevals is unavailable.
 */

import type { EvalCase, EvalResult } from '../types.js'

/**
 * Score response factuality using LLM-based evaluation.
 * Requires OPENAI_API_KEY or BRAINTRUST_API_KEY to be set.
 */
export async function scoreFactuality(evalCase: EvalCase, result: EvalResult): Promise<number> {
  if (!evalCase.expected) return 1.0 // no expected output = pass

  try {
    const { Factuality } = await import('autoevals')
    const score = await Factuality({
      input: evalCase.input,
      output: result.output,
      expected: evalCase.expected,
    })
    return score.score ?? 0
  } catch {
    // Fallback: simple keyword overlap
    return scoreKeywordOverlap(evalCase.expected, result.output)
  }
}

/**
 * Lightweight fallback: fraction of expected keywords found in the output.
 * No LLM call needed — good for CI/offline use.
 */
export function scoreKeywordOverlap(expected: string, output: string): number {
  const expectedWords = new Set(
    expected
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  )
  if (expectedWords.size === 0) return 1.0

  const outputLower = output.toLowerCase()
  let matches = 0
  for (const word of expectedWords) {
    if (outputLower.includes(word)) matches++
  }

  return matches / expectedWords.size
}
