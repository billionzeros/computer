/**
 * `clipboard` — read / write the system clipboard, lifted out of
 * agent.ts so the harness MCP shim can hand it to Codex / Claude Code.
 * Trivial wrapper around `executeClipboard`.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { executeClipboard, type ClipboardInput } from './clipboard.js'

export function buildClipboardTool(): AgentTool {
  return defineTool({
    name: 'clipboard',
    label: 'Clipboard',
    description:
      'Read from or write to the system clipboard. ' +
      'Operations: read (get clipboard contents), write (copy text to clipboard). ' +
      'Use when user says "copy this", "paste what I have", or needs clipboard access.',
    parameters: Type.Object({
      operation: Type.Union([Type.Literal('read'), Type.Literal('write')], {
        description: 'Clipboard operation',
      }),
      content: Type.Optional(
        Type.String({ description: 'Text to copy to clipboard (for write)' }),
      ),
    }),
    async execute(_toolCallId, params) {
      const output = executeClipboard(params as ClipboardInput)
      return toolResult(output)
    },
  })
}
