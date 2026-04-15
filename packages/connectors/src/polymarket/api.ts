const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const DATA_BASE = 'https://data-api.polymarket.com'
const CLOB_BASE = 'https://clob.polymarket.com'

export type PolymarketMode = 'read' | 'trade'

export type PolymarketL2Creds = {
  apiKey: string
  secret: string // base64 (or base64url) encoded secret
  passphrase: string
  address: string // signer address associated with the API key
}

export type PolymarketConfig = {
  mode: PolymarketMode
  walletAddress?: string
  apiKey?: string
  l2?: PolymarketL2Creds
  clobBase?: string
  gammaBase?: string
  dataBase?: string
}

function parseMaybeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function normalizeBase64Secret(secret: string): Buffer {
  // Accept base64url and base64. Strip any non-base64 chars for compatibility.
  const sanitized = secret
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')
  return Buffer.from(sanitized, 'base64')
}

function toUrlSafeBase64(b: Buffer): string {
  // Keep '=' padding (Polymarket expects url-safe base64 but keeps suffix)
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

export class PolymarketAPI {
  private config: PolymarketConfig = { mode: 'read' }

  setToken(token: string): void {
    // Supported token formats:
    // - "" / "{}" — no-op so wallet/apiKey applied via metadata (agent-server) are not wiped
    // - "0xabc..." (40 hex) — set default wallet (read mode), merge with existing config
    // - JSON: partial PolymarketConfig merged into existing (does not clear unspecified fields)
    // - any other string — treat as opaque apiKey / secret material
    const trimmed = token.trim()
    if (!trimmed || trimmed === '{}') {
      return
    }

    const maybe = parseMaybeJson<Partial<PolymarketConfig>>(trimmed)
    if (maybe && typeof maybe === 'object' && maybe !== null && !Array.isArray(maybe)) {
      const next: PolymarketConfig = { ...this.config }
      if (maybe.mode === 'trade' || maybe.mode === 'read') next.mode = maybe.mode
      if (maybe.walletAddress !== undefined) next.walletAddress = maybe.walletAddress
      if (maybe.apiKey !== undefined) next.apiKey = maybe.apiKey
      if (maybe.l2 !== undefined) next.l2 = maybe.l2
      if (maybe.clobBase !== undefined) next.clobBase = maybe.clobBase
      if (maybe.gammaBase !== undefined) next.gammaBase = maybe.gammaBase
      if (maybe.dataBase !== undefined) next.dataBase = maybe.dataBase
      this.config = next
      return
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      this.config = { ...this.config, mode: 'read', walletAddress: trimmed }
      return
    }

    this.config = { ...this.config, apiKey: trimmed }
  }

  setWalletAddress(addr: string): void {
    this.config.walletAddress = addr
  }

  setApiKey(key: string | undefined): void {
    this.config.apiKey = key
  }

  setMode(mode: PolymarketMode): void {
    this.config.mode = mode
  }

  setL2Creds(creds: PolymarketL2Creds | undefined): void {
    this.config.l2 = creds
  }

  getConfig(): PolymarketConfig {
    return { ...this.config, l2: this.config.l2 ? { ...this.config.l2 } : undefined }
  }

  private base(which: 'gamma' | 'data' | 'clob'): string {
    if (which === 'gamma') return this.config.gammaBase ?? GAMMA_BASE
    if (which === 'data') return this.config.dataBase ?? DATA_BASE
    return this.config.clobBase ?? CLOB_BASE
  }

  private async getJson<T>(
    which: 'gamma' | 'data' | 'clob',
    path: string,
    qs?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(path, this.base(which))
    if (qs) {
      for (const [k, v] of Object.entries(qs)) {
        if (v === undefined) continue
        url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`${which.toUpperCase()} GET ${path}: ${res.status} ${err}`)
    }
    return res.json() as Promise<T>
  }

  private async clobAuthedJson<T>(
    method: 'GET' | 'POST' | 'DELETE',
    requestPath: string, // must include leading "/"
    body: unknown | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const l2 = this.config.l2
    if (!l2)
      throw new Error('Missing Polymarket CLOB L2 credentials (apiKey/secret/passphrase/address)')
    const ts = Math.floor(Date.now() / 1000)
    const bodyStr = body === undefined ? undefined : JSON.stringify(body)
    const signature = await this.buildL2Signature(l2.secret, ts, method, requestPath, bodyStr)

    const url = new URL(requestPath, this.base('clob'))
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': bodyStr ? 'application/json' : 'application/json',
        POLY_ADDRESS: l2.address,
        POLY_TIMESTAMP: String(ts),
        POLY_API_KEY: l2.apiKey,
        POLY_PASSPHRASE: l2.passphrase,
        POLY_SIGNATURE: signature,
      },
      body: bodyStr,
      signal,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`CLOB ${method} ${requestPath}: ${res.status} ${err}`)
    }
    return res.json() as Promise<T>
  }

  private async buildL2Signature(
    secret: string,
    timestamp: number,
    method: string,
    requestPath: string,
    body?: string,
  ): Promise<string> {
    // Matches Polymarket reference implementation:
    // message = timestamp + method + requestPath + body(optional)
    // signature = HMAC-SHA256(secret(raw bytes), message) base64 url-safe (keep '=')
    const { createHmac } = await import('node:crypto')
    const key = normalizeBase64Secret(secret)
    let msg = `${timestamp}${method}${requestPath}`
    if (body !== undefined) msg += body
    const digest = createHmac('sha256', key).update(msg, 'utf8').digest()
    return toUrlSafeBase64(digest)
  }

  // ── Gamma (market discovery) ─────────────────────────────────────────
  searchPublic(
    q: string,
    opts?: { limit_per_type?: number; page?: number; cache?: boolean },
    signal?: AbortSignal,
  ) {
    return this.getJson('gamma', '/public-search', { q, ...opts }, signal)
  }

  listMarkets(opts?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) {
    return this.getJson('gamma', '/markets', opts, signal)
  }

  getMarketById(id: number, signal?: AbortSignal) {
    return this.getJson('gamma', `/markets/${id}`, undefined, signal)
  }

  getMarketBySlug(slug: string, signal?: AbortSignal) {
    return this.getJson('gamma', `/markets/slug/${encodeURIComponent(slug)}`, undefined, signal)
  }

  // ── Data (portfolio) ────────────────────────────────────────────────
  getPositions(
    user?: string,
    opts?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ) {
    const addr = user ?? this.config.walletAddress
    if (!addr)
      throw new Error(
        'Missing wallet address. Provide `user` or set walletAddress on the connector.',
      )
    return this.getJson('data', '/positions', { user: addr, ...(opts ?? {}) }, signal)
  }

  getPortfolioValue(user?: string, signal?: AbortSignal) {
    const addr = user ?? this.config.walletAddress
    if (!addr)
      throw new Error(
        'Missing wallet address. Provide `user` or set walletAddress on the connector.',
      )
    return this.getJson('data', '/value', { user: addr }, signal)
  }

  // ── CLOB (public read) ──────────────────────────────────────────────
  getOrderBook(tokenId: string, signal?: AbortSignal) {
    return this.getJson('clob', '/book', { token_id: tokenId }, signal)
  }

  getMidpoint(tokenId: string, signal?: AbortSignal) {
    return this.getJson('clob', '/midpoint', { token_id: tokenId }, signal)
  }

  getPrice(tokenId: string, side: 'BUY' | 'SELL', signal?: AbortSignal) {
    return this.getJson('clob', '/price', { token_id: tokenId, side }, signal)
  }

  // ── CLOB (authenticated write) ──────────────────────────────────────
  getUserOrders(
    params?: { id?: string; market?: string; asset_id?: string; next_cursor?: string },
    signal?: AbortSignal,
  ) {
    const qs = new URLSearchParams()
    if (params?.id) qs.set('id', params.id)
    if (params?.market) qs.set('market', params.market)
    if (params?.asset_id) qs.set('asset_id', params.asset_id)
    if (params?.next_cursor) qs.set('next_cursor', params.next_cursor)
    const path = `/data/orders${qs.toString() ? `?${qs.toString()}` : ''}`
    return this.clobAuthedJson('GET', path, undefined, signal)
  }

  postSignedOrder(payload: unknown, signal?: AbortSignal) {
    return this.clobAuthedJson('POST', '/order', payload, signal)
  }

  cancelOrder(orderID: string, signal?: AbortSignal) {
    return this.clobAuthedJson('DELETE', '/order', { orderID }, signal)
  }
}
