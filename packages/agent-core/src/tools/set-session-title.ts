/**
 * `set_session_title` — model-invoked, one-shot conversation title.
 *
 * Replaces streaming-based title paths (Codex's `thread/name/updated`
 * partial stream, and Claude's "first text token" heuristic) with an
 * explicit MCP tool call. The harness session exposes it via the Anton
 * MCP shim, and the developer-instructions capability block asks the
 * model to call it once on the first turn.
 *
 * The handler hands the title to the session (`setTitle()`), which
 * emits a single `title_update` SessionEvent.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'

export type SetSessionTitleHandler = (title: string) => void

const TITLE_MAX_LENGTH = 50

export function buildSetSessionTitleTool(handler: SetSessionTitleHandler): AgentTool {
  return defineTool({
    name: 'set_session_title',
    label: 'Set Session Title',
    description:
      'Set the conversation title shown in the Anton sidebar. ' +
      "Call this ONCE on the first turn, before doing substantive work, with a concise sentence-case title summarizing the user's request. " +
      'Rules: 3-7 words, max 50 characters, sentence case (only first word capitalized), no trailing punctuation, no quotes. ' +
      'Good: "Fix login button on mobile". Bad: "Code changes" / "Fix Login Button" / "Investigate and resolve the login issue".',
    parameters: Type.Object({
      title: Type.String({
        description: '3-7 word sentence-case title, max 50 chars.',
        minLength: 1,
        maxLength: 80,
      }),
    }),
    async execute(_toolCallId, params) {
      const raw = (params.title ?? '').trim().replace(/\s+/g, ' ')
      if (!raw) return toolResult('set_session_title requires a non-empty title.', true)
      // Strip wrapping quotes and trailing punctuation the model sometimes adds.
      let title = raw
        .replace(/^["']+|["']+$/g, '')
        .replace(/[.!?]+$/, '')
        .trim()
      if (title.length > TITLE_MAX_LENGTH) {
        const cut = title.slice(0, TITLE_MAX_LENGTH)
        const lastSpace = cut.lastIndexOf(' ')
        title = lastSpace > TITLE_MAX_LENGTH * 0.5 ? cut.slice(0, lastSpace) : cut
      }
      if (!title) return toolResult('set_session_title requires a non-empty title.', true)
      handler(title)
      return toolResult(`Title set to: ${title}`)
    },
  })
}
