/**
 * Autonomous orchestration scorer.
 *
 * Scores trajectory quality for benchmark-style autonomous tasks.
 */

import type { EvalCase, EvalResult } from '../types.js'

function countToolCalls(result: EvalResult, toolName: string): number {
  return result.toolCalls.filter((call) => call.name === toolName).length
}

function hasQuestionHeavyOutput(output: string): boolean {
  const questionCount = (output.match(/\?/g) || []).length
  return (
    questionCount >= 2 &&
    /(?:what|which|where|how|could you|can you|do you want|would you like|clarif)/i.test(output)
  )
}

export function scoreAutonomousTrajectory(evalCase: EvalCase, result: EvalResult): number {
  const scores: Array<{ score: number; weight: number }> = []
  const toolNames = result.toolCalls.map((call) => call.name)

  if (evalCase.expectedTool) {
    const firstTool = result.firstToolCall
    const firstToolScore =
      firstTool === evalCase.expectedTool
        ? 1.0
        : evalCase.acceptableTools?.includes(firstTool || '')
          ? 0.5
          : 0.0
    scores.push({ score: firstToolScore, weight: 0.25 })
  }

  if (evalCase.requiredTools?.length || evalCase.minToolCallsByName) {
    let checks = 0
    let passed = 0

    for (const tool of evalCase.requiredTools || []) {
      checks++
      if (toolNames.includes(tool)) passed++
    }

    for (const [tool, minCount] of Object.entries(evalCase.minToolCallsByName || {})) {
      checks++
      if (countToolCalls(result, tool) >= minCount) passed++
    }

    scores.push({ score: checks === 0 ? 1.0 : passed / checks, weight: 0.3 })
  }

  if (evalCase.forbiddenTools?.length || evalCase.runtimeProfile === 'autonomous') {
    const forbidden = new Set(evalCase.forbiddenTools || [])
    if (evalCase.runtimeProfile === 'autonomous') {
      forbidden.add('ask_user')
      forbidden.add('plan')
    }

    const blockedByTool = Array.from(forbidden).some((tool) => toolNames.includes(tool))
    const blockedByOutput =
      evalCase.runtimeProfile === 'autonomous' && hasQuestionHeavyOutput(result.output)
    scores.push({ score: blockedByTool || blockedByOutput ? 0.0 : 1.0, weight: 0.25 })
  }

  const runtimeFailure = result.hadError || result.errorMessages.length > 0
  scores.push({ score: runtimeFailure ? 0.0 : 1.0, weight: 0.2 })

  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0)
  const weighted = scores.reduce((sum, item) => sum + item.score * item.weight, 0)
  return totalWeight === 0 ? 1.0 : weighted / totalWeight
}
