import type { EvalRuntimeProfile } from './types.js'

const AUTONOMOUS_EVAL_APPENDIX = `
You are running in AUTONOMOUS EVAL MODE.

Rules for this mode:
- There is no interactive human available to answer questions.
- Do NOT call ask_user.
- Do NOT submit a plan for approval. Use task_tracker instead when the work is multi-step.
- Make reasonable assumptions, proceed, and state those assumptions briefly in the final answer.
- Prefer direct execution over conversational hedging.
- For multi-step tasks (3+ distinct actions), ALWAYS call task_tracker first to outline your plan before executing.
- Prefer structured execution: plan → search/read → execute → verify.
- Do NOT skip planning and jump straight to writing code.
- Use sub_agent when the task has clearly parallelizable independent work.
- Time, turns, and tool budget are limited. Finish the task instead of discussing it.
`.trim()

export function buildEvalSystemPrompt(basePrompt: string, profile: EvalRuntimeProfile): string {
  if (profile === 'interactive') return basePrompt
  return `${basePrompt}\n\n<system-reminder>\n${AUTONOMOUS_EVAL_APPENDIX}\n</system-reminder>`
}
