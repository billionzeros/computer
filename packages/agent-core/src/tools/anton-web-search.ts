/**
 * `anton:web_search` — exposes Anton's Exa-backed web search as an
 * AgentTool so it can be registered in `buildAntonCoreTools()` and
 * served over MCP to every harness (Codex, Claude Code, …).
 *
 * Why a separate file from the Pi SDK registration at
 * `agent.ts:1374-1435`:
 *
 *   - The Pi SDK registration builds the tool conditionally against
 *     the Pi SDK agent's `tools[]` array and respects the presence of
 *     an `exa_search` connector MCP tool (which the connector manager
 *     may inject) to avoid a duplicate.
 *   - This factory builds the same tool with the same semantics, but
 *     without that connector-dedup branch — the harness-MCP path
 *     doesn't go through the ConnectorManager MCP plane, so there's
 *     no collision to avoid.
 *
 * Both surfaces call `executeWebSearch` from `./web-search.ts`, so
 * behavior is identical for callers that reach either path.
 */

import { loadConfig } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { type SearchProvider, executeWebSearch } from './web-search.js'

const log = createLogger('anton-web-search')

/**
 * Read the Exa connector from the current config. Returns null if
 * there's no configured / enabled connector so the tool can return
 * a helpful setup message instead of failing opaquely.
 */
function resolveExaProvider(): SearchProvider | null {
  try {
    const config = loadConfig()
    const exa = config.connectors?.find(
      (c) => c.id === 'exa-search' && c.enabled && c.baseUrl && c.apiKey,
    )
    if (!exa?.baseUrl || !exa?.apiKey) return null
    return { baseUrl: exa.baseUrl, token: exa.apiKey }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'failed to load config for web_search')
    return null
  }
}

/**
 * Build the AgentTool. Called by `buildAntonCoreTools()` so the same
 * tool definition goes to Pi SDK (when we migrate) and harness MCP.
 *
 * Name is `web_search` at the Anton level. Codex sees it as
 * `anton:web_search` because Codex prefixes tools by the originating
 * MCP server name when rendering them to the model.
 */
export function buildAntonWebSearchTool(): AgentTool {
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
      const provider = resolveExaProvider()
      if (!provider) {
        return toolResult(
          'Web search is not configured. To enable it:\n\n' +
            '1. Open Anton → Settings → Connectors.\n' +
            '2. Find "Web Search (Exa)" and click Connect.\n' +
            '3. Enter your Exa API key.\n\n' +
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
