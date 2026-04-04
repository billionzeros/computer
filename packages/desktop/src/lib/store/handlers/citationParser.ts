/**
 * Citation source extraction from web_search tool results.
 */

import type { CitationSource } from '../types.js'

export function parseCitationSources(output: string): CitationSource[] {
  // Primary: extract structured JSON from <!-- citations:[...] --> block
  const marker = '<!-- citations:'
  const start = output.indexOf(marker)
  if (start !== -1) {
    const jsonStart = start + marker.length
    const end = output.indexOf(' -->', jsonStart)
    if (end !== -1) {
      try {
        const raw: Array<{ i: number; t: string; d: string; u: string }> = JSON.parse(
          output.slice(jsonStart, end),
        )
        return raw.map((s) => ({
          index: s.i,
          title: s.t,
          url: s.u,
          domain: s.d,
        }))
      } catch {
        /* fall through to legacy parser */
      }
    }
  }
  // Legacy fallback: regex parse for old session history
  const sources: CitationSource[] = []
  const regex = /\[(\d+)\]\s+(.+?)\s*\|\s*(\S+)\s*—\s*(https?:\/\/\S+)/g
  for (const match of output.matchAll(regex)) {
    sources.push({
      index: Number.parseInt(match[1], 10),
      title: match[2].trim(),
      domain: match[3].trim(),
      url: match[4].trim(),
    })
  }
  return sources
}
