/**
 * `image` — screenshot / resize / convert / crop / info, lifted out of
 * agent.ts so the harness MCP shim can hand it to Codex / Claude Code.
 *
 * The tool returns a text description of the operation result (path on
 * disk, or info dump). It does NOT inline binary image data — Codex's
 * MCP client doesn't reliably re-render image content frames, so the
 * model picks the file back up via its native `read` / `attach` flow
 * when it needs to reason about the pixels.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { type ImageInput, executeImage } from './image.js'

export function buildImageTool(): AgentTool {
  return defineTool({
    name: 'image',
    label: 'Image',
    description:
      'Image operations: take screenshots, resize, convert formats, get info, crop. ' +
      'Use for capturing screen state, preparing images, or analyzing image files.',
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal('screenshot'),
          Type.Literal('resize'),
          Type.Literal('convert'),
          Type.Literal('info'),
          Type.Literal('crop'),
        ],
        { description: 'Image operation' },
      ),
      path: Type.Optional(Type.String({ description: 'Input image file path' })),
      output: Type.Optional(Type.String({ description: 'Output file path' })),
      width: Type.Optional(Type.Number({ description: 'Target width in pixels' })),
      height: Type.Optional(Type.Number({ description: 'Target height in pixels' })),
      format: Type.Optional(Type.String({ description: 'Output format: png, jpg, webp' })),
      region: Type.Optional(
        Type.Object(
          {
            x: Type.Number({ description: 'X coordinate' }),
            y: Type.Number({ description: 'Y coordinate' }),
            w: Type.Number({ description: 'Width' }),
            h: Type.Number({ description: 'Height' }),
          },
          { description: 'Region for screenshot or crop' },
        ),
      ),
    }),
    async execute(_toolCallId, params) {
      const output = executeImage(params as ImageInput)
      return toolResult(output)
    },
  })
}
