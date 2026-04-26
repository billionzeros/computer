import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { ParallelAPI, ParallelResult } from './api.js'

function toolResult(output: string, isError = false) {
  return { content: [{ type: 'text' as const, text: output }], details: { raw: output, isError } }
}

function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      id: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}

function formatResult(r: ParallelResult): string {
  const parts: string[] = [`**${r.title}**`, `URL: ${r.url}`]
  if (r.publishedDate) parts.push(`Published: ${r.publishedDate}`)
  if (r.author) parts.push(`Author: ${r.author}`)
  if (r.excerpts?.length)
    parts.push(`Excerpts:\n${r.excerpts.map((e) => `- ${e.text}`).join('\n')}`)
  if (r.highlights?.length)
    parts.push(`Highlights:\n${r.highlights.map((h) => `- ${h}`).join('\n')}`)
  if (r.text) parts.push(`Content:\n${r.text}`)
  return parts.join('\n')
}

export function createParallelTools(api: ParallelAPI): AgentTool[] {
  return [
    defineTool({
      name: 'parallel_research',
      label: 'Deep Web Research',
      description:
        '[Parallel] Deep multi-hop web research — runs several queries in parallel, fetches and ' +
        'synthesises page-level excerpts into a single research-grade result set with citations. ' +
        'PREFER THIS over `web_search` / `exa_search` whenever the user asks for a brief, overview, ' +
        'background, due-diligence, competitive scan, market read, investigation, "what is the ' +
        'latest on X", "compare X and Y", "find me reliable sources on X", "give me a writeup of ' +
        'X", or any question that would otherwise require 3+ back-to-back search calls. One call ' +
        'replaces an entire research loop. Use a basic search only for single-fact lookups, ' +
        'finding a specific URL, or quick time-sensitive checks.',
      parameters: Type.Object({
        query: Type.String({
          description:
            'Research objective. A full sentence or question is fine — the proxy expands it into ' +
            'sub-queries before searching.',
        }),
        num_results: Type.Optional(
          Type.Number({ description: 'Number of results to return (default: 10, max: 20)' }),
        ),
        mode: Type.Optional(
          Type.Union([Type.Literal('fast'), Type.Literal('deep')], {
            description:
              'Research depth. "deep" (default) runs multi-hop research; "fast" runs a single pass.',
          }),
        ),
        allow_domains: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Restrict results to these domains.',
          }),
        ),
        block_domains: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Exclude these domains from results.',
          }),
        ),
        start_published_date: Type.Optional(
          Type.String({
            description:
              'Only return results published on or after this ISO date (e.g. 2025-01-01).',
          }),
        ),
        end_published_date: Type.Optional(
          Type.String({
            description: 'Only return results published on or before this ISO date.',
          }),
        ),
      }),
      async execute(_id, params) {
        try {
          const sourcePolicy =
            params.allow_domains || params.block_domains
              ? {
                  ...(params.allow_domains ? { allowDomains: params.allow_domains } : {}),
                  ...(params.block_domains ? { blockDomains: params.block_domains } : {}),
                }
              : undefined
          const { results } = await api.search(params.query, {
            numResults: Math.min(params.num_results ?? 10, 20),
            mode: params.mode,
            sourcePolicy,
            startPublishedDate: params.start_published_date,
            endPublishedDate: params.end_published_date,
          })
          if (!results.length) return toolResult('No results found.')
          const formatted = results
            .map((r, i) => `### Result ${i + 1}\n${formatResult(r)}`)
            .join('\n\n---\n\n')
          return toolResult(`Found ${results.length} results:\n\n${formatted}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),
  ]
}
