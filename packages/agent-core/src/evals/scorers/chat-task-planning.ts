/**
 * Task Planning scorer.
 *
 * Measures whether Anton approaches tasks correctly:
 * - Does it plan before acting on complex tasks?
 * - Does it read/search before modifying?
 * - Does it avoid over-planning simple tasks?
 * - Does it ask for clarification on ambiguous input?
 * - Does it use the right tool chain?
 *
 * This tests orchestration judgment, not individual tool correctness.
 */

import type { EvalCase, EvalResult } from '../types.js'

/**
 * Score whether the agent picked the right first tool.
 * Reuses tool-selection logic but in the context of planning.
 */
export function scoreFirstToolChoice(evalCase: EvalCase, result: EvalResult): number {
  if (!evalCase.expectedTool) return 1.0

  const actual = result.firstToolCall
  if (!actual) {
    // No tool called — check if this is a "should clarify" case
    if (evalCase.tags?.includes('should-clarify') || evalCase.tags?.includes('ambiguous')) {
      // For ambiguous tasks, not calling a tool and asking in text is OK
      const askedQuestion =
        /\?/.test(result.output) &&
        /(?:what|which|where|how|could you|can you|do you mean|clarif)/i.test(result.output)
      return askedQuestion ? 1.0 : 0.0
    }
    return 0.0
  }

  if (actual === evalCase.expectedTool) return 1.0
  if (evalCase.acceptableTools?.includes(actual)) return 0.5
  return 0.0
}

/**
 * Score whether the agent demonstrated "read before write" behavior.
 * For debugging/refactoring tasks, the agent should read/search before editing.
 */
export function scoreReadBeforeWrite(evalCase: EvalCase, result: EvalResult): number {
  const tags = evalCase.tags || []

  // Only applies to tasks that require reading first
  if (
    !tags.includes('read-first') &&
    !tags.includes('debugging') &&
    !tags.includes('search-first') &&
    !tags.includes('refactoring')
  ) {
    return 1.0 // not applicable
  }

  const toolNames = result.toolCalls.map((tc) => tc.name)
  if (toolNames.length === 0) return 0.0

  // Check: first tool should be a "read" tool, not a "write" tool
  const readTools = [
    'read',
    'grep',
    'glob',
    'list',
    'filesystem',
    'code_search',
    'shell',
    'browser',
    'web_search',
  ]
  const _writeTools = ['write', 'edit'] // writing first is bad for these tags

  const firstTool = toolNames[0]
  const isReadFirst = readTools.includes(firstTool)

  // For search-first tasks, first tool should specifically be grep
  if (tags.includes('search-first')) {
    return firstTool === 'grep' || firstTool === 'code_search'
      ? 1.0
      : firstTool === 'read' || firstTool === 'filesystem'
        ? 0.5
        : 0.0
  }

  return isReadFirst ? 1.0 : 0.0
}

/**
 * Score whether the agent avoided over-planning simple tasks.
 * Simple tasks should be handled directly without creating plans.
 */
export function scoreAppropriateComplexity(evalCase: EvalCase, result: EvalResult): number {
  const tags = evalCase.tags || []
  const toolNames = result.toolCalls.map((tc) => tc.name)

  // Simple tasks should NOT use plan tool
  if (tags.includes('simple') || tags.includes('no-over-planning') || tags.includes('direct')) {
    const usedPlan = toolNames.includes('plan')
    const usedTaskTracker = toolNames.includes('task_tracker')
    if (usedPlan) return 0.0 // over-planned
    if (usedTaskTracker) return 0.5 // slight over-engineering
    return 1.0
  }

  // Complex tasks SHOULD use plan or describe approach
  if (tags.includes('planning') || tags.includes('complex')) {
    const usedPlan = toolNames.includes('plan')
    const usedTaskTracker = toolNames.includes('task_tracker')
    const describedApproach = /(?:plan|approach|steps|first.*then|strategy|before|let me)/i.test(
      result.output,
    )

    if (usedPlan) return 1.0
    if (describedApproach || usedTaskTracker) return 0.75
    return 0.25 // jumped straight into action on a complex task
  }

  return 1.0
}

/**
 * Score handling of ambiguous input.
 * Agent should ask clarifying questions or state assumptions.
 */
export function scoreAmbiguityHandling(evalCase: EvalCase, result: EvalResult): number {
  const tags = evalCase.tags || []

  if (!tags.includes('ambiguous') && !tags.includes('should-clarify')) {
    return 1.0 // not applicable
  }

  const output = result.output
  const toolNames = result.toolCalls.map((tc) => tc.name)

  // Best: used ask_user tool
  if (toolNames.includes('ask_user')) return 1.0

  // Good: asked questions in text
  const askedQuestions =
    (output.match(/\?/g) || []).length >= 1 &&
    /(?:what|which|where|how|could you|can you|do you mean|clarif|specify|more detail)/i.test(
      output,
    )
  if (askedQuestions) return 0.8

  // OK: stated assumptions
  const statedAssumptions = /(?:assum|I'll|I will|going to|interpret this as)/i.test(output)
  if (statedAssumptions) return 0.5

  // Bad: just guessed and ran commands
  return 0.0
}

/**
 * Combined task planning scorer.
 * Weights depend on which dimensions are applicable to the case.
 */
export function scoreTaskPlanning(evalCase: EvalCase, result: EvalResult): number {
  const tags = evalCase.tags || []

  const scores: Array<{ score: number; weight: number }> = []

  // Always score first tool choice (if expected)
  if (evalCase.expectedTool || tags.includes('ambiguous') || tags.includes('should-clarify')) {
    scores.push({ score: scoreFirstToolChoice(evalCase, result), weight: 0.35 })
  }

  // Score read-before-write for applicable cases
  if (
    tags.includes('read-first') ||
    tags.includes('debugging') ||
    tags.includes('search-first') ||
    tags.includes('refactoring')
  ) {
    scores.push({ score: scoreReadBeforeWrite(evalCase, result), weight: 0.25 })
  }

  // Score complexity appropriateness
  if (
    tags.includes('simple') ||
    tags.includes('complex') ||
    tags.includes('planning') ||
    tags.includes('no-over-planning')
  ) {
    scores.push({ score: scoreAppropriateComplexity(evalCase, result), weight: 0.25 })
  }

  // Score ambiguity handling
  if (tags.includes('ambiguous') || tags.includes('should-clarify')) {
    scores.push({ score: scoreAmbiguityHandling(evalCase, result), weight: 0.35 })
  }

  // Fallback: if no specific dimensions apply, use first tool choice
  if (scores.length === 0) {
    return evalCase.expectedTool ? scoreFirstToolChoice(evalCase, result) : 1.0
  }

  // Weighted average
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0)
  const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0)
  return weightedSum / totalWeight
}
