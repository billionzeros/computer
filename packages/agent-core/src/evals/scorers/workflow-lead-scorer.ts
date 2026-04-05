/**
 * Lead Scorer scorer.
 *
 * Measures how accurately the lead-scorer agent assigns scores and tiers.
 *
 * Scoring dimensions:
 * - Score accuracy: 1.0 if within ±10, 0.5 if within ±20, 0.0 otherwise
 * - Tier correctness: 1.0 exact match, 0.5 adjacent tier, 0.0 wrong
 * - Research completeness: checks if output mentions key research dimensions
 */

import type { WorkflowEvalCase, WorkflowEvalResult } from '../types.js'

const TIER_ORDER = ['skip', 'cool', 'warm', 'hot']

/**
 * Extract a numeric score from agent output.
 * Looks for patterns like "Score: 85", "total: 78", "85/100", etc.
 */
function extractScore(output: string): number | null {
  // Try common patterns
  const patterns = [
    /(?:total|score|overall)[:\s]*(\d{1,3})/i,
    /(\d{1,3})\s*(?:\/\s*100|out of 100|points)/i,
    /(?:total|score|overall)\s*[:=]\s*(\d{1,3})/i,
  ]

  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match) {
      const num = Number.parseInt(match[1], 10)
      if (num >= 0 && num <= 100) return num
    }
  }
  return null
}

/**
 * Extract tier classification from agent output.
 * Looks for "hot", "warm", "cool", "skip" labels.
 */
function extractTier(output: string): string | null {
  const lower = output.toLowerCase()
  // Look for explicit tier labels
  for (const tier of ['hot', 'warm', 'cool', 'skip']) {
    if (
      lower.includes(`tier: ${tier}`) ||
      lower.includes(`tier=${tier}`) ||
      lower.includes(`classification: ${tier}`) ||
      lower.includes(`label: ${tier}`) ||
      lower.includes(`"${tier}"`) ||
      lower.includes(`→ ${tier}`) ||
      lower.includes(`classified as ${tier}`) ||
      lower.includes(`category: ${tier}`)
    ) {
      return tier
    }
  }
  // Fallback: last mention of a tier word
  const tierMentions: Array<{ tier: string; index: number }> = []
  for (const tier of ['hot', 'warm', 'cool', 'skip']) {
    const regex = new RegExp(`\\b${tier}\\b`, 'gi')
    let match: RegExpExecArray | null = regex.exec(lower)
    while (match !== null) {
      tierMentions.push({ tier, index: match.index })
      match = regex.exec(lower)
    }
  }
  if (tierMentions.length > 0) {
    tierMentions.sort((a, b) => b.index - a.index)
    return tierMentions[0].tier
  }
  return null
}

/**
 * Score accuracy: how close is the predicted score to the expected range.
 */
export function scoreAccuracy(evalCase: WorkflowEvalCase, result: WorkflowEvalResult): number {
  if (!evalCase.expectedScoreRange) return 1.0

  const predicted = extractScore(result.output)
  if (predicted === null) return 0.0 // couldn't find a score at all

  const [min, max] = evalCase.expectedScoreRange
  const midpoint = (min + max) / 2

  // Within expected range
  if (predicted >= min && predicted <= max) return 1.0

  // Within ±10 of the range
  if (predicted >= min - 10 && predicted <= max + 10) return 0.75

  // Within ±20 of the midpoint
  const distance = Math.abs(predicted - midpoint)
  if (distance <= 20) return 0.5

  return 0.0
}

/**
 * Tier correctness: does the predicted tier match?
 */
export function scoreTierCorrectness(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  if (!evalCase.expectedTier) return 1.0

  const predicted = extractTier(result.output)
  if (!predicted) return 0.0

  // Exact match
  if (predicted === evalCase.expectedTier) return 1.0

  // Adjacent tier (one step away)
  const expectedIdx = TIER_ORDER.indexOf(evalCase.expectedTier)
  const predictedIdx = TIER_ORDER.indexOf(predicted)
  if (expectedIdx >= 0 && predictedIdx >= 0 && Math.abs(expectedIdx - predictedIdx) === 1) {
    return 0.5
  }

  return 0.0
}

/**
 * Research completeness: does the output demonstrate proper research analysis?
 * Checks for mentions of key scoring dimensions from the rubric.
 */
export function scoreResearchCompleteness(
  _evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  const lower = result.output.toLowerCase()

  const dimensions = [
    // Company fit
    ['industry', 'sector', 'market', 'vertical'],
    // Size match
    ['employee', 'headcount', 'team size', 'company size', 'people'],
    // Contact fit
    ['decision', 'title', 'role', 'seniority', 'c-level', 'vp', 'director', 'manager'],
    // Intent signals
    ['inbound', 'source', 'demo', 'form', 'intent', 'interest', 'engagement'],
  ]

  let matched = 0
  for (const keywords of dimensions) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched++
    }
  }

  return matched / dimensions.length
}

/**
 * Combined lead-scorer scorer.
 * Weighted: 40% score accuracy, 35% tier correctness, 25% research completeness.
 */
export function scoreLeadScorer(evalCase: WorkflowEvalCase, result: WorkflowEvalResult): number {
  const accuracy = scoreAccuracy(evalCase, result)
  const tier = scoreTierCorrectness(evalCase, result)
  const research = scoreResearchCompleteness(evalCase, result)
  return accuracy * 0.4 + tier * 0.35 + research * 0.25
}
