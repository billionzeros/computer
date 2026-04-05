/**
 * Code Generation scorer.
 *
 * Measures the quality of code Anton produces using:
 * 1. Structural checks — does it look like real code? Has the right pieces?
 * 2. Keyword relevance — does it use the expected patterns/APIs?
 * 3. LLM-as-judge — is it correct and well-written? (optional, needs API key)
 *
 * The structural scorer is zero-cost and works in CI.
 */

import type { EvalCase, EvalResult } from '../types.js'

// ── Code structure detection ────────────────────────────────────────

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const FUNCTION_PATTERN =
  /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|def\s+\w+|(?:export\s+)?(?:async\s+)?function)/
const TYPE_PATTERN = /(?:type\s+\w+|interface\s+\w+|:\s*\w+(?:\[\])?(?:\s*\|)?)/
const IMPORT_PATTERN = /(?:import\s+|from\s+['"]|require\s*\()/
const TEST_PATTERN = /(?:describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert\.)/
const SQL_PATTERN =
  /(?:SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|CREATE\s+|JOIN\s+|GROUP\s+BY|ORDER\s+BY)/i
const ERROR_HANDLING_PATTERN = /(?:try\s*\{|catch\s*\(|\.catch\s*\(|except\s+|throw\s+|raise\s+)/

/**
 * Score code output on structural quality.
 * Checks: has code, has function definition, reasonable length, no obvious errors.
 */
export function scoreCodeStructure(evalCase: EvalCase, result: EvalResult): number {
  const output = result.output
  const tags = evalCase.tags || []
  const checks: boolean[] = []

  // 1. Contains a code block (or looks like code)
  const hasCodeBlock = CODE_BLOCK_PATTERN.test(output)
  const looksLikeCode = FUNCTION_PATTERN.test(output) || SQL_PATTERN.test(output)
  checks.push(hasCodeBlock || looksLikeCode)

  // 2. Has a function/type definition (for function-writing tasks)
  if (tags.some((t) => ['typescript', 'react', 'node', 'python', 'express'].includes(t))) {
    checks.push(FUNCTION_PATTERN.test(output))
  }

  // 3. TypeScript tasks should have type annotations
  if (tags.includes('typescript') || tags.includes('generics') || tags.includes('types')) {
    checks.push(TYPE_PATTERN.test(output))
  }

  // 4. SQL tasks should have SQL keywords
  if (tags.includes('sql')) {
    checks.push(SQL_PATTERN.test(output))
  }

  // 5. Test-writing tasks should have test patterns
  if (tags.includes('testing') || tags.includes('unit-test')) {
    checks.push(TEST_PATTERN.test(output))
  }

  // 6. Error handling tasks should have try/catch or equivalent
  if (tags.includes('error-handling')) {
    checks.push(ERROR_HANDLING_PATTERN.test(output))
  }

  // 7. Async tasks should use async/await or Promise
  if (tags.includes('async')) {
    checks.push(/(?:async\s+|await\s+|Promise|\.then\s*\()/.test(output))
  }

  // 8. Not too short (at least 50 chars of actual content)
  const stripped = output.replace(CODE_BLOCK_PATTERN, '').trim()
  const codeContent = output.match(CODE_BLOCK_PATTERN)?.[0] || output
  checks.push(codeContent.length >= 50)

  // 9. No obvious error patterns
  const hasErrors = /(?:SyntaxError|TypeError|ReferenceError|TODO:|FIXME:|not implemented)/i.test(
    output,
  )
  checks.push(!hasErrors)

  const passed = checks.filter(Boolean).length
  return checks.length > 0 ? passed / checks.length : 0.5
}

/**
 * Score keyword relevance — does the output use expected patterns?
 * Uses the `expected` field from the eval case as a source of keywords.
 */
export function scoreCodeRelevance(evalCase: EvalCase, result: EvalResult): number {
  if (!evalCase.expected) return 1.0

  // Extract significant keywords from the expected description
  const expectedLower = evalCase.expected.toLowerCase()
  const outputLower = result.output.toLowerCase()

  const keywords = expectedLower
    .split(/[\s,.;:()]+/)
    .filter((w) => w.length > 3)
    .filter(
      (w) =>
        ![
          'should',
          'that',
          'with',
          'this',
          'from',
          'have',
          'uses',
          'using',
          'handle',
          'handles',
          'correctly',
          'properly',
          'the',
          'and',
          'for',
          'not',
        ].includes(w),
    )

  if (keywords.length === 0) return 1.0

  // Deduplicate
  const unique = [...new Set(keywords)]
  let matched = 0
  for (const kw of unique) {
    if (outputLower.includes(kw)) matched++
  }

  return matched / unique.length
}

/**
 * LLM-based code quality scorer.
 * Falls back to structural + relevance scoring if no API key.
 */
export async function scoreCodeQuality(evalCase: EvalCase, result: EvalResult): Promise<number> {
  try {
    const { Factuality } = await import('autoevals')
    const score = await Factuality({
      input: evalCase.input,
      output: result.output,
      expected: evalCase.expected || 'Correct, clean, working code that solves the requested task.',
    })
    return score.score ?? 0
  } catch {
    // Fallback to heuristic
    const structure = scoreCodeStructure(evalCase, result)
    const relevance = scoreCodeRelevance(evalCase, result)
    return structure * 0.6 + relevance * 0.4
  }
}

/**
 * Combined code generation scorer (sync, no API key needed).
 * Weighted: 60% structure, 40% relevance.
 */
export function scoreCodeGeneration(evalCase: EvalCase, result: EvalResult): number {
  const structure = scoreCodeStructure(evalCase, result)
  const relevance = scoreCodeRelevance(evalCase, result)
  return structure * 0.6 + relevance * 0.4
}
