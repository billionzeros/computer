/**
 * Outreach Writer scorer.
 *
 * Measures email quality using:
 * 1. LLM-as-judge (via autoevals) for subjective quality — personalization,
 *    relevance, tone
 * 2. Heuristic checks for objective criteria — length, no placeholders,
 *    has CTA, subject line quality
 *
 * The heuristic scorer works without an API key (good for CI).
 * The LLM scorer requires BRAINTRUST_API_KEY or OPENAI_API_KEY.
 */

import type { WorkflowEvalCase, WorkflowEvalResult } from '../types.js'

// ── Heuristic scorer (zero-cost, works in CI) ───────────────────────

const PLACEHOLDER_PATTERNS = [
  /\[.*?\]/g, // [Company Name], [insert here]
  /\{\{.*?\}\}/g, // {{name}}, {{company}}
  /\bXXX\b/gi,
  /\bTBD\b/gi,
  /\bINSERT\b/gi,
  /\bPLACEHOLDER\b/gi,
]

const GENERIC_FILLER = [
  'hope this email finds you well',
  'hope this finds you well',
  'i hope you are doing well',
  'just reaching out',
  'just wanted to reach out',
  'touching base',
  'circling back',
]

const CTA_PATTERNS = [
  /\b(book|schedule|grab|set up)\s+a?\s*(call|meeting|chat|demo|time)\b/i,
  /\b(reply|respond|let me know|interested|open to|happy to)\b/i,
  /\b(click|visit|check out|see|link)\b.*\b(here|below|calendar)\b/i,
  /\bwould you be\b/i,
  /\bfree\s+(to|for)\b/i,
]

/**
 * Heuristic quality checks for outreach emails.
 * Returns a score from 0-1 based on multiple binary checks.
 */
export function scoreOutreachHeuristic(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  const output = result.output
  const lower = output.toLowerCase()
  const checks: boolean[] = []

  // 1. No placeholder text
  const hasPlaceholders = PLACEHOLDER_PATTERNS.some((p) => p.test(output))
  checks.push(!hasPlaceholders)

  // 2. No generic filler
  const hasGenericFiller = GENERIC_FILLER.some((f) => lower.includes(f))
  checks.push(!hasGenericFiller)

  // 3. Has a CTA
  const hasCTA = CTA_PATTERNS.some((p) => p.test(output))
  checks.push(hasCTA)

  // 4. Reasonable length (not too short, not too long)
  const wordCount = output.split(/\s+/).length
  checks.push(wordCount >= 30 && wordCount <= 250)

  // 5. Has subject line (looks for "Subject:" in output)
  const hasSubjectLine = /subject\s*:/i.test(output)
  checks.push(hasSubjectLine)

  // 6. Subject line quality (if present)
  if (hasSubjectLine) {
    const subjectMatch = output.match(/subject\s*:\s*(.+?)(?:\n|$)/i)
    if (subjectMatch) {
      const subject = subjectMatch[1].trim()
      checks.push(subject.length <= 50 && subject.length >= 8)
    }
  }

  // 7. Personalization — mentions something from the lead's context
  if (evalCase.qualityCriteria && evalCase.qualityCriteria.length > 0) {
    // Check if at least half of quality criteria keywords appear
    let criteriaMatched = 0
    for (const criterion of evalCase.qualityCriteria) {
      // Extract key nouns from the criterion for matching
      const keywords = criterion
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
      if (keywords.some((kw) => lower.includes(kw))) {
        criteriaMatched++
      }
    }
    const criteriaScore = criteriaMatched / evalCase.qualityCriteria.length
    checks.push(criteriaScore >= 0.4) // at least 40% of criteria keywords found
  }

  // 8. First sentence is about THEM not us
  const firstSentence = output.split(/[.!?]\s/)[0]?.toLowerCase() || ''
  const startsAboutThem = !(
    firstSentence.startsWith('we ') ||
    firstSentence.startsWith('our ') ||
    firstSentence.startsWith('i wanted to ') ||
    firstSentence.startsWith('i am writing')
  )
  checks.push(startsAboutThem)

  const passed = checks.filter(Boolean).length
  return passed / checks.length
}

// ── LLM-as-judge scorer (requires API key) ──────────────────────────

/**
 * LLM-based quality scorer using autoevals.
 * Evaluates personalization, relevance, and overall quality.
 * Falls back to heuristic scorer if autoevals is unavailable.
 */
export async function scoreOutreachQuality(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): Promise<number> {
  const criteria = evalCase.qualityCriteria
  if (!criteria || criteria.length === 0) {
    return scoreOutreachHeuristic(evalCase, result)
  }

  try {
    const { Factuality } = await import('autoevals')

    // Build expected description from quality criteria
    const expectedDescription = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')

    const score = await Factuality({
      input: evalCase.input,
      output: result.output,
      expected: `A high-quality, personalized outreach email that meets these criteria:\n${expectedDescription}`,
    })

    return score.score ?? 0
  } catch {
    // Fallback to heuristic scoring when no API key available
    return scoreOutreachHeuristic(evalCase, result)
  }
}

/**
 * Combined outreach-writer scorer.
 * Uses heuristic checks only (sync, no API key needed).
 * For LLM-based scoring, use scoreOutreachQuality directly.
 */
export function scoreOutreachWriter(
  evalCase: WorkflowEvalCase,
  result: WorkflowEvalResult,
): number {
  return scoreOutreachHeuristic(evalCase, result)
}
