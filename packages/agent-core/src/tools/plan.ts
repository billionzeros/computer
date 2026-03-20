/**
 * Plan tool — submits an implementation plan for user review.
 * The real execution gate is in session.ts beforeToolCall;
 * this execute function only runs after approval.
 */

export interface PlanInput {
  title: string
  content: string // markdown
}

export function executePlan(input: PlanInput): string {
  return `Plan "${input.title}" has been approved. Proceed with implementation.`
}
