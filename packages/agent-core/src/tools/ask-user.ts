/**
 * `ask_user` — interactive multi-choice questionnaire surfaced through
 * the Anton desktop UI. Same shape as the inline Pi SDK version in
 * agent.ts; lifted into a factory so the harness MCP shim can hand the
 * same tool to Codex / Claude Code.
 *
 * The actual round-trip (display → user answers → resolve) lives in the
 * server (`wireAskUserHandler`). This factory just receives the same
 * handler and forwards questions to it.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import type { AskUserQuestion } from '@anton/protocol'
import type { AskUserHandler } from '../agent.js'
import { defineTool, toolResult } from './_helpers.js'

export function buildAskUserTool(handler: AskUserHandler): AgentTool {
  return defineTool({
    name: 'ask_user',
    label: 'Ask User',
    description:
      'Ask the user clarifying questions with optional multiple-choice options. ' +
      'Use when you need specific information before proceeding — e.g., technology choices, preferences, project details. ' +
      'Bundle all related questions into one call (max 6). The UI shows one question at a time with Next/Submit. ' +
      'The user can pick from options or type a free-text answer.',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: 'The question to ask' }),
          description: Type.Optional(
            Type.String({ description: 'Additional context shown below the question' }),
          ),
          options: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Selectable options as short labels (max 6)',
              maxItems: 6,
            }),
          ),
          allowFreeText: Type.Optional(
            Type.Boolean({ description: 'Allow custom text input (default: true)' }),
          ),
          freeTextPlaceholder: Type.Optional(
            Type.String({ description: 'Placeholder text for the free-text input' }),
          ),
        }),
        { description: 'Questions to ask (max 6)', maxItems: 6 },
      ),
    }),
    async execute(_toolCallId, params) {
      if (!params.questions?.length) {
        return toolResult('ask_user requires at least one question.', true)
      }
      const questions: AskUserQuestion[] = params.questions.map((q) => ({
        question: q.question,
        description: q.description,
        options: q.options?.slice(0, 6),
        allowFreeText: q.allowFreeText,
        freeTextPlaceholder: q.freeTextPlaceholder,
      }))
      const answers = await handler(questions)
      return toolResult(JSON.stringify(answers, null, 2))
    },
  })
}
