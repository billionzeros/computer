import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import type { ExaAPI, ExaResult } from './api.js'

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

function formatResult(r: ExaResult): string {
  const parts: string[] = [`**${r.title}**`, `URL: ${r.url}`]
  if (r.publishedDate) parts.push(`Published: ${r.publishedDate}`)
  if (r.summary) parts.push(`Summary: ${r.summary}`)
  if (r.highlights?.length)
    parts.push(`Highlights:\n${r.highlights.map((h) => `- ${h}`).join('\n')}`)
  if (r.text) parts.push(`Content:\n${r.text}`)
  return parts.join('\n')
}

export function createExaTools(api: ExaAPI): AgentTool[] {
  return [
    defineTool({
      name: 'exa_search',
      label: 'Web Search',
      description:
        '[Exa] Semantic web search. Returns full page summaries, highlights, and content. Use for research, fact-checking, and finding up-to-date information.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query' }),
        num_results: Type.Optional(
          Type.Number({ description: 'Number of results (default: 5, max: 10)' }),
        ),
        type: Type.Optional(
          Type.Union([Type.Literal('auto'), Type.Literal('neural'), Type.Literal('keyword')], {
            description: 'Search type: auto (default), neural (semantic), or keyword',
          }),
        ),
        include_domains: Type.Optional(
          Type.Array(Type.String(), { description: 'Only return results from these domains' }),
        ),
        start_published_date: Type.Optional(
          Type.String({
            description:
              'Only return results published after this date (ISO format, e.g. 2024-01-01)',
          }),
        ),
      }),
      async execute(_id, params) {
        try {
          const { results } = await api.search(params.query, {
            numResults: Math.min(params.num_results ?? 5, 10),
            type: params.type,
            includeDomains: params.include_domains,
            startPublishedDate: params.start_published_date,
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

    defineTool({
      name: 'exa_get_contents',
      label: 'Get Page Contents',
      description:
        '[Exa] Get clean, parsed content from one or more URLs. Use to read full page text, summaries, or highlights from URLs found via search.',
      parameters: Type.Object({
        urls: Type.Array(Type.String(), { description: 'URLs to get content from (max 10)' }),
        text: Type.Optional(
          Type.Boolean({ description: 'Include full page text (default: true)' }),
        ),
        highlights: Type.Optional(
          Type.Boolean({ description: 'Include key highlights (default: false)' }),
        ),
        summary: Type.Optional(
          Type.Boolean({ description: 'Include AI summary (default: false)' }),
        ),
      }),
      async execute(_id, params) {
        try {
          const { results } = await api.getContents(params.urls, {
            text: params.text,
            highlights: params.highlights,
            summary: params.summary,
          })
          if (!results.length) return toolResult('No content returned.')
          const formatted = results
            .map((r, i) => `### Page ${i + 1}\n${formatResult(r)}`)
            .join('\n\n---\n\n')
          return toolResult(`Content from ${results.length} page(s):\n\n${formatted}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'exa_answer',
      label: 'Answer Question',
      description:
        '[Exa] Get a direct LLM-generated answer to a question, backed by real-time web search. Returns an answer with citations. Use for quick factual questions.',
      parameters: Type.Object({
        query: Type.String({ description: 'The question to answer' }),
      }),
      async execute(_id, params) {
        try {
          const data = await api.answer(params.query)
          const citations = data.citations?.length
            ? `\n\n**Sources:**\n${data.citations.map((c) => `- [${c.title}](${c.url})`).join('\n')}`
            : ''
          return toolResult(`${data.answer}${citations}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),

    defineTool({
      name: 'exa_find_similar',
      label: 'Find Similar Pages',
      description: '[Exa] Find web pages similar to a given URL.',
      parameters: Type.Object({
        url: Type.String({ description: 'URL to find similar pages for' }),
        num_results: Type.Optional(Type.Number({ description: 'Number of results (default: 5)' })),
      }),
      async execute(_id, params) {
        try {
          const { results } = await api.findSimilar(params.url, {
            numResults: Math.min(params.num_results ?? 5, 10),
          })
          if (!results.length) return toolResult('No similar pages found.')
          const formatted = results
            .map((r, i) => `### Result ${i + 1}\n${formatResult(r)}`)
            .join('\n\n---\n\n')
          return toolResult(`Found ${results.length} similar pages:\n\n${formatted}`)
        } catch (err) {
          return toolResult(`Error: ${(err as Error).message}`, true)
        }
      },
    }),
  ]
}
