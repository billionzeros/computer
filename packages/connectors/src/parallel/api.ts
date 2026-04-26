/**
 * Parallel Search API client — calls through Anton's research-proxy.
 * The proxy holds the real Parallel API key; the agent authenticates
 * with a per-machine bearer token issued by the proxy admin.
 */

export interface ParallelExcerpt {
  text: string
  score?: number
}

export interface ParallelResult {
  url: string
  title: string
  text?: string
  excerpts?: ParallelExcerpt[]
  highlights?: string[]
  publishedDate?: string | null
  author?: string | null
  score?: number
}

export class ParallelAPI {
  private proxyUrl = ''
  private proxyToken = ''
  private tokenProvider?: () => Promise<string>

  setToken(token: string): void {
    // Token format: "proxyUrl|proxyToken"
    // e.g. "https://research.antoncomputer.in|abc123"
    const sep = token.indexOf('|')
    if (sep > 0) {
      this.proxyUrl = token.slice(0, sep)
      this.proxyToken = token.slice(sep + 1)
    } else {
      this.proxyToken = token
      this.proxyUrl = 'https://research.antoncomputer.in'
    }
  }

  setTokenProvider(fn: () => Promise<string>): void {
    this.tokenProvider = fn
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let proxyUrl = this.proxyUrl
    let proxyToken = this.proxyToken
    if (this.tokenProvider) {
      const raw = await this.tokenProvider()
      const sep = raw.indexOf('|')
      if (sep > 0) {
        proxyUrl = raw.slice(0, sep)
        proxyToken = raw.slice(sep + 1)
      } else {
        proxyToken = raw
        if (!proxyUrl) proxyUrl = 'https://research.antoncomputer.in'
      }
    }
    const res = await fetch(`${proxyUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${proxyToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Parallel proxy ${path}: ${res.status} ${err}`)
    }

    return res.json() as Promise<T>
  }

  async search(
    query: string,
    opts: {
      numResults?: number
      mode?: 'fast' | 'deep'
      sourcePolicy?: { allowDomains?: string[]; blockDomains?: string[] }
      startPublishedDate?: string
      endPublishedDate?: string
    } = {},
  ): Promise<{ results: ParallelResult[] }> {
    return this.request('/search', {
      query,
      numResults: opts.numResults ?? 10,
      mode: opts.mode ?? 'deep',
      ...(opts.sourcePolicy ? { sourcePolicy: opts.sourcePolicy } : {}),
      ...(opts.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
      ...(opts.endPublishedDate ? { endPublishedDate: opts.endPublishedDate } : {}),
    })
  }
}
