/**
 * Eval runner — executes eval datasets through real agent sessions
 * and logs results to Braintrust.
 *
 * Each eval case creates a lightweight ephemeral session, sends the input,
 * collects events, and extracts the result for scoring.
 */

import { loadCoreSystemPrompt } from '@anton/agent-config'
import type { AgentConfig } from '@anton/agent-config'
import type { SessionEvent } from '../session.js'
import { buildEvalSystemPrompt } from './runtime-profile.js'
import type { EvalCase, EvalResult } from './types.js'

/**
 * Run a single eval case through the agent and collect the result.
 *
 * Creates an ephemeral session with tight safety limits to keep
 * eval runs fast and cheap.
 */
export async function runEvalCase(evalCase: EvalCase, config: AgentConfig): Promise<EvalResult> {
  // Lazy import to avoid circular dependency and heavy startup cost
  const { Session } = await import('../session.js')
  const { buildTools } = await import('../agent.js')

  const tools = buildTools(config)
  const runtimeProfile = evalCase.runtimeProfile ?? 'interactive'
  const startedAt = Date.now()

  const session = new Session({
    id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: config.defaults.provider,
    model: config.defaults.model,
    config,
    tools,
    ephemeral: true,
    // Interactive suites stay cheap and shallow; autonomous evals get enough room
    // to expose trajectory failures instead of failing on the harness itself.
    maxTokenBudget: runtimeProfile === 'autonomous' ? 60_000 : 20_000,
    maxDurationMs: runtimeProfile === 'autonomous' ? 180_000 : 60_000,
    maxTurns: runtimeProfile === 'autonomous' ? 12 : 3,
    systemPromptOverride:
      runtimeProfile === 'autonomous'
        ? buildEvalSystemPrompt(loadCoreSystemPrompt(), runtimeProfile)
        : undefined,
  })

  const events: SessionEvent[] = []
  let output = ''
  let firstToolCall: string | undefined
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = []
  let hadError = false
  const errorMessages: string[] = []

  if (runtimeProfile === 'interactive') {
    session.setPlanConfirmHandler(async () => ({ approved: true }))
    session.setAskUserHandler(async (questions) =>
      Object.fromEntries(questions.map((question, index) => [`q${index + 1}`, question.question])),
    )
  }

  try {
    for await (const event of session.processMessage(evalCase.input)) {
      events.push(event)

      if (event.type === 'text') {
        output += event.content
      }
      if (event.type === 'tool_call') {
        if (!firstToolCall) firstToolCall = event.name
        toolCalls.push({ name: event.name, input: event.input })
      }
      if (event.type === 'error') {
        hadError = true
        errorMessages.push(event.message)
      }
    }
  } catch (err) {
    hadError = true
    output = `Eval error: ${(err as Error).message}`
    errorMessages.push((err as Error).message)
  }

  return {
    input: evalCase.input,
    output,
    firstToolCall,
    toolCalls,
    hadError,
    errorMessages,
    turnCount: events.filter((event) => event.type === 'done').length,
    durationMs: Date.now() - startedAt,
    events: events as Array<{ type: string; [key: string]: unknown }>,
  }
}

/**
 * Run a full eval suite using Braintrust's Eval() function.
 *
 * This creates an experiment in Braintrust and logs all results
 * with scores for analysis.
 */
export async function runBraintrustEval(opts: {
  name: string
  dataset: { cases: EvalCase[] }
  config: AgentConfig
  scorers: Array<{
    name: string
    fn: (evalCase: EvalCase, result: EvalResult) => number | Promise<number>
  }>
  dryRun?: boolean
}) {
  const { Eval } = await import('braintrust')

  if (opts.dryRun) {
    console.log(`[eval] Dry run: ${opts.name}`)
    console.log(`[eval] ${opts.dataset.cases.length} cases, ${opts.scorers.length} scorers`)
    for (const c of opts.dataset.cases) {
      console.log(
        `  - "${c.input.slice(0, 60)}..." → expected: ${c.expectedTool || c.expected?.slice(0, 30) || `refusal=${c.expectedRefusal}`}`,
      )
    }
    return
  }

  return Eval('anton-agent', {
    experimentName: opts.name,
    data: () =>
      opts.dataset.cases.map((c) => ({
        input: c,
        expected: c.expectedTool || c.expected || String(c.expectedRefusal),
        metadata: { tags: c.tags, ...c.metadata },
      })),
    task: async (input: EvalCase) => {
      const result = await runEvalCase(input, opts.config)
      return result
    },
    scores: opts.scorers.map((scorer) => {
      const scoreFn = async (args: {
        input: EvalCase
        output: EvalResult
        expected?: string
      }) => {
        const score = await scorer.fn(args.input, args.output)
        return { name: scorer.name, score }
      }
      // Braintrust expects scorer functions with a _name property
      Object.defineProperty(scoreFn, 'name', { value: scorer.name })
      return scoreFn
    }) as never[],
  })
}
