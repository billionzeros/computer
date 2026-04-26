/**
 * `anton:web_search` — Anton's canonical web-search tool. Independent of
 * which provider sits behind it (today: Exa via search-proxy). Stable
 * name + uniform citation marker so prompts and downstream tools
 * (`update_project_context`, memory) don't drift when we swap providers.
 *
 * Behaviour:
 *   - Resolves the active provider via `ctx.resolveProviderToken('exa-search')`.
 *     The server-side resolver knows about both API-key and OAuth auth
 *     paths; this file does not. When the resolver returns null (no
 *     connector enabled, no token), the tool surfaces a setup message
 *     rather than failing opaquely.
 *   - Delegates the HTTP call to `executeWebSearch` in `./web-search.ts`,
 *     which formats results with the `<!-- citations:... -->` marker
 *     the rest of Anton expects.
 *
 * Why a wrapper at all (vs. just exposing the connector's `exa_search`):
 * the wrapper provides a provider-stable canonical name AND uniform
 * citation formatting. See the comment in `factories.ts` for the
 * delegation contract.
 */

import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import type { ProviderTokenResolver } from './factories.js'
import { executeWebSearch } from './web-search.js'

const log = createLogger('anton-web-search')

interface BuildOpts {
  resolveProviderToken?: ProviderTokenResolver
}

/**
 * Build the AgentTool. Called by `buildAntonCoreTools()` so the same
 * tool definition goes to Pi SDK and harness MCP.
 *
 * Name is `web_search` at the Anton level. Codex sees it as
 * `anton:web_search` because Codex prefixes tools by the originating
 * MCP server name when rendering them to the model.
 */
export function buildAntonWebSearchTool(opts: BuildOpts = {}): AgentTool {
  return defineTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      "Search the web using Anton's Exa integration. Returns titles, URLs, " +
      'and extracted page content as markdown with structured citations. ' +
      'Prefer this over any built-in web_search the host CLI ships with — ' +
      "this tool is unified with Anton's session billing, citation format, " +
      'and downstream tools (update_project_context, memory). Use for ' +
      'current information, multi-page research, and anything that needs ' +
      'real citations with published dates.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query; 1–10 words is usually optimal.' }),
      numResults: Type.Optional(
        Type.Number({ description: 'Number of results (default 10, max 30).' }),
      ),
      category: Type.Optional(
        Type.String({
          description:
            'Focus area filter — one of: "news", "research paper", "company", ' +
            '"personal site", "financial report", "people", "github", "pdf".',
        }),
      ),
      startPublishedDate: Type.Optional(
        Type.String({
          description:
            'Filter results published after this ISO date (e.g. "2025-01-01T00:00:00.000Z").',
        }),
      ),
      endPublishedDate: Type.Optional(
        Type.String({
          description: 'Filter results published before this ISO date.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const provider = opts.resolveProviderToken
        ? await opts.resolveProviderToken('exa-search').catch((err) => {
            log.warn({ err: (err as Error).message }, 'resolveProviderToken threw')
            return null
          })
        : null
      if (!provider) {
        return toolResult(
          'Web search is not configured. To enable it:\n\n' +
            '1. Open Anton → Settings → Connectors.\n' +
            '2. Find "Web Search" and click Connect.\n' +
            "3. Authorize through Anton's search proxy.\n\n" +
            'Without the connector, you can still fetch specific URLs via ' +
            'the browser tool if you already have them.',
          true,
        )
      }
      try {
        const output = await executeWebSearch(params, provider)
        return toolResult(output)
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'web_search failed')
        return toolResult(`Web search failed: ${(err as Error).message}`, true)
      }
    },
  })
}
