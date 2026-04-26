export interface WebResearchInput {
  query: string
  numResults?: number
  mode?: 'fast' | 'deep'
  allowDomains?: string[]
  blockDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
}

export interface ResearchProvider {
  baseUrl: string
  token: string
}

interface ParallelProxyResult {
  title: string
  url: string
  text?: string
  highlights?: string[]
  excerpts?: { text: string; score?: number }[]
  publishedDate?: string | null
  author?: string | null
}

interface ParallelProxyResponse {
  results: ParallelProxyResult[]
  error?: string
}

async function searchParallel(
  input: WebResearchInput,
  provider: ResearchProvider,
): Promise<string> {
  const {
    query,
    numResults = 10,
    mode = 'deep',
    allowDomains,
    blockDomains,
    startPublishedDate,
    endPublishedDate,
  } = input

  const base = provider.baseUrl.replace(/\/+$/, '')

  const sourcePolicy =
    allowDomains || blockDomains
      ? {
          ...(allowDomains ? { allowDomains } : {}),
          ...(blockDomains ? { blockDomains } : {}),
        }
      : undefined

  const payload: Record<string, unknown> = {
    query,
    numResults: Math.min(numResults, 20),
    mode,
  }
  if (sourcePolicy) payload.sourcePolicy = sourcePolicy
  if (startPublishedDate) payload.startPublishedDate = startPublishedDate
  if (endPublishedDate) payload.endPublishedDate = endPublishedDate

  const res = await fetch(`${base}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return `Error: Research proxy returned ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`
  }

  const data = (await res.json()) as ParallelProxyResponse
  if (data.error) return `Error: ${data.error}`
  if (!data.results?.length) return `No results found for: "${query}"`

  return formatResults(query, data.results)
}

function formatResults(query: string, results: ParallelProxyResult[]): string {
  if (results.length === 0) {
    return `No results found for: "${query}"`
  }

  const citationData: { i: number; t: string; d: string; u: string }[] = []

  const formatted = results.map((r, i) => {
    const title = r.title || 'Untitled'
    let domain = ''
    try {
      domain = new URL(r.url || '').hostname.replace(/^www\./, '')
    } catch {
      /* ignore */
    }
    citationData.push({ i: i + 1, t: title, d: domain, u: r.url || '' })

    const parts = [`[${i + 1}] ${title} | ${domain} — ${r.url || ''}`]
    if (r.publishedDate) parts.push(`    Published: ${r.publishedDate}`)
    if (r.author) parts.push(`    Author: ${r.author}`)
    if (r.excerpts?.length) {
      parts.push(`    Excerpts:\n${r.excerpts.map((e) => `      - ${e.text}`).join('\n')}`)
    } else if (r.highlights?.length) {
      parts.push(`    Highlights:\n${r.highlights.map((h) => `      - ${h}`).join('\n')}`)
    }
    if (r.text) {
      parts.push(
        `    Content:\n${r.text
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')}`,
      )
    }
    return parts.join('\n')
  })

  const humanText = `Research sources:\n${formatted.join('\n\n')}\n\n---\nWhen using information from these results, cite sources inline using [1], [2], etc.\nAlways include a "Sources:" footer listing the sources you referenced.`
  return `${humanText}\n<!-- citations:${JSON.stringify(citationData)} -->`
}

export async function executeWebResearch(
  input: WebResearchInput,
  provider: ResearchProvider,
): Promise<string> {
  return searchParallel(input, provider)
}
