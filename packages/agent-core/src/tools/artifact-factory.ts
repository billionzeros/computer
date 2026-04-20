/**
 * `artifact` — render rich visual content (HTML / code / markdown / SVG /
 * mermaid) in the Anton desktop side panel. Same tool the Pi SDK exposes
 * inline in agent.ts, lifted into a factory so the harness MCP shim can
 * hand it to Codex / Claude Code.
 *
 * The tool itself is intentionally trivial — it just writes to disk if
 * a `filename` is provided and returns a confirmation string. The
 * desktop panel render is driven by an `artifact` SessionEvent emitted
 * when the tool call is detected:
 *   - Pi SDK: Session.detectArtifact (session.ts) sniffs tool_call/result
 *     pairs.
 *   - Harness: per-CLI session detects `mcpToolCall` items named
 *     `anton:artifact` and emits the same shape.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { type ArtifactInput, executeArtifact } from './artifact.js'

export function buildArtifactTool(): AgentTool {
  return defineTool({
    name: 'artifact',
    label: 'Artifact',
    description:
      'Create a visual artifact displayed in the desktop side panel. Use for HTML pages/apps, rendered markdown, code files, SVG graphics, or mermaid diagrams. The content renders live in a preview panel next to the chat. Always use this for visual content the user should see rendered, not as raw text.',
    parameters: Type.Object({
      title: Type.String({ description: 'Display title (e.g. "Landing Page", "README.md")' }),
      type: Type.Union(
        [
          Type.Literal('html'),
          Type.Literal('code'),
          Type.Literal('markdown'),
          Type.Literal('svg'),
          Type.Literal('mermaid'),
        ],
        {
          description:
            'Content type: html for web pages/apps, code for source files, markdown for docs, svg for graphics, mermaid for diagrams',
        },
      ),
      language: Type.Optional(
        Type.String({
          description:
            'Language for syntax highlighting when type=code (e.g. "typescript", "python")',
        }),
      ),
      content: Type.String({ description: 'The full content to render' }),
      filename: Type.Optional(
        Type.String({
          description: 'If provided, also saves the content to this file path on disk',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const output = executeArtifact(params as ArtifactInput)
      return toolResult(output)
    },
  })
}
