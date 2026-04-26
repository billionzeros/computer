/**
 * `anton:web_research` — Anton's canonical deep-research tool. Today
 * backed by Parallel via research-proxy; the wrapper exists so the
 * canonical name + citation format are stable across providers.
 *
 * Resolves the active provider via `opts.resolveProviderToken('parallel-research')`.
 * Server-side resolver handles API-key and OAuth uniformly; this file
 * doesn't know which path produced the token. See `anton-web-search.ts`
 * for the full rationale.
 */

import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import type { ProviderTokenResolver } from './factories.js'
import { executeWebResearch } from './web-research.js'

const log = createLogger('anton-web-research')

interface BuildOpts {
  resolveProviderToken?: ProviderTokenResolver
}

export function buildAntonWebResearchTool(opts: BuildOpts = {}): AgentTool {
  return defineTool({
    name: 'web_research',
    label: 'Deep Web Research',
    description:
      "Deep multi-hop web research using Anton's Parallel integration — runs " +
      'several queries in parallel, fetches and synthesises page-level excerpts, ' +
      'and returns research-grade results with citations and published dates. ' +
      'PREFER THIS over `web_search` whenever the user asks for a brief, ' +
      'overview, background, due-diligence, competitive scan, market read, ' +
      'investigation, "what is the latest on X", "compare X and Y", "find me ' +
      'reliable sources on X", "give me a writeup of X", or any question that ' +
      'would otherwise require 3+ back-to-back web_search calls. One ' +
      'web_research call replaces an entire research loop. Use `web_search` ' +
      'only for single-fact lookups, finding a specific URL, or quick ' +
      'time-sensitive checks.',
    parameters: Type.Object({
      query: Type.String({
        description:
          'Research objective. A full sentence or question is fine — the proxy ' +
          'expands it into sub-queries before searching.',
      }),
      numResults: Type.Optional(
        Type.Number({ description: 'Number of results to return (default 10, max 20).' }),
      ),
      mode: Type.Optional(
        Type.Union([Type.Literal('fast'), Type.Literal('deep')], {
          description: '"deep" (default) runs multi-hop research; "fast" runs a single pass.',
        }),
      ),
      allowDomains: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Restrict results to these domains.',
        }),
      ),
      blockDomains: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Exclude these domains from results.',
        }),
      ),
      startPublishedDate: Type.Optional(
        Type.String({
          description: 'Only return results published on or after this ISO date (e.g. 2025-01-01).',
        }),
      ),
      endPublishedDate: Type.Optional(
        Type.String({
          description: 'Only return results published on or before this ISO date.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const provider = opts.resolveProviderToken
        ? await opts.resolveProviderToken('parallel-research').catch((err) => {
            log.warn({ err: (err as Error).message }, 'resolveProviderToken threw')
            return null
          })
        : null
      if (!provider) {
        return toolResult(
          'Deep web research is not configured. To enable it:\n\n' +
            '1. Open Anton → Settings → Connectors.\n' +
            '2. Find "Deep Research" and click Connect.\n' +
            "3. Authorize through Anton's research proxy.\n\n" +
            'For quick fact lookups you can still use web_search instead.',
          true,
        )
      }
      try {
        const output = await executeWebResearch(params, provider)
        return toolResult(output)
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'web_research failed')
        return toolResult(`Web research failed: ${(err as Error).message}`, true)
      }
    },
  })
}
