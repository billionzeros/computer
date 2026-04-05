/**
 * Lead Scanner scorer.
 *
 * Measures how well the lead-scanner agent extracts fields from form submissions.
 *
 * Scoring:
 * - Field extraction accuracy: fraction of expected fields found in output
 * - Duplicate detection: 1.0 if duplicate flagged correctly, 0.0 if missed
 * - Noise filtering: 1.0 if non-lead correctly skipped
 */

import type { WorkflowEvalCase, WorkflowEvalResult } from '../types.js'

/**
 * Score field extraction accuracy.
 * Returns the fraction of expected fields whose values appear in the output.
 */
export function scoreFieldExtraction(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  const fields = evalCase.expectedFields
  if (!fields || Object.keys(fields).length === 0) return 1.0

  const outputLower = result.output.toLowerCase()
  let matches = 0
  let total = 0

  for (const [key, value] of Object.entries(fields)) {
    total++
    // Check if the value appears in the output (case-insensitive)
    if (outputLower.includes(value.toLowerCase())) {
      matches++
    }
    // Also check if the key-value pair is structured (e.g. "status: new")
    else if (
      outputLower.includes(`${key.toLowerCase()}: ${value.toLowerCase()}`) ||
      outputLower.includes(`${key.toLowerCase()}=${value.toLowerCase()}`) ||
      outputLower.includes(`"${key.toLowerCase()}": "${value.toLowerCase()}"`)
    ) {
      matches++
    }
  }

  return total > 0 ? matches / total : 1.0
}

/**
 * Score duplicate detection and noise filtering.
 * For cases tagged with "duplicate" or "non-lead", checks if the agent
 * correctly identified and handled the case.
 */
export function scoreDedupAndFiltering(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  const tags = evalCase.tags || []
  const outputLower = result.output.toLowerCase()

  // Duplicate detection
  if (tags.includes('duplicate') || evalCase.expected === 'duplicate') {
    const deduped =
      outputLower.includes('duplicate') ||
      outputLower.includes('already exists') ||
      outputLower.includes('skip') ||
      outputLower.includes('existing')
    return deduped ? 1.0 : 0.0
  }

  // Noise filtering
  if (tags.includes('non-lead') || evalCase.expected === 'skip') {
    const skipped =
      outputLower.includes('skip') ||
      outputLower.includes('not a lead') ||
      outputLower.includes('no lead') ||
      outputLower.includes('ignore') ||
      outputLower.includes('not a submission') ||
      outputLower.includes('analytics report')
    return skipped ? 1.0 : 0.0
  }

  // Standard case — check status is "new"
  const fields = evalCase.expectedFields
  if (fields?.status === 'new') {
    const hasNewStatus =
      outputLower.includes('status: new') ||
      outputLower.includes('status="new"') ||
      outputLower.includes("status='new'") ||
      outputLower.includes('"status": "new"') ||
      outputLower.includes('status: "new"') ||
      outputLower.includes('set status to "new"') ||
      outputLower.includes('status → new')
    return hasNewStatus ? 1.0 : 0.5 // partial credit if fields were extracted but status unclear
  }

  return 1.0
}

/**
 * Combined lead-scanner scorer.
 * Weighted average: 70% field extraction, 30% dedup/filtering.
 */
export function scoreLeadScanner(evalCase: WorkflowEvalCase, result: WorkflowEvalResult): number {
  const fieldScore = scoreFieldExtraction(evalCase, result)
  const dedupScore = scoreDedupAndFiltering(evalCase, result)
  return fieldScore * 0.7 + dedupScore * 0.3
}
