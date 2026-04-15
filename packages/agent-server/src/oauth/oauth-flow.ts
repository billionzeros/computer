/**
 * OAuth flow manager for the agent server.
 *
 * Handles:
 * 1. Starting OAuth flows (generate auth URL for desktop to open)
 * 2. Receiving tokens from the OAuth proxy callback
 * 3. Token refresh via the proxy
 */

import { randomBytes } from 'node:crypto'
import { type AgentConfig, CONNECTOR_REGISTRY } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { CredentialStore, StoredCredentials } from '../credential-store.js'

const log = createLogger('oauth-flow')

/** Hard ceiling on a single proxy refresh round-trip. Long enough to absorb
 *  one slow proxy hop, short enough that a wedged proxy doesn't permanently
 *  jam the dedup Map (and therefore every future getToken call). */
const REFRESH_TIMEOUT_MS = 20_000

interface PendingFlow {
  nonce: string
  connectorId: string // the registry ID (e.g. 'google-calendar')
  oauthProvider: string // the proxy provider (e.g. 'google')
  createdAt: number
}

export class OAuthFlow {
  private pending = new Map<string, PendingFlow>()
  private refreshing = new Map<string, Promise<string>>()
  private tokenStore: CredentialStore
  private config: AgentConfig

  constructor(config: AgentConfig, tokenStore: CredentialStore) {
    this.config = config
    this.tokenStore = tokenStore
  }

  /**
   * Start an OAuth flow. Returns the URL to open in the browser.
   * Returns null if the proxy URL is not configured.
   *
   * @param connectorId  - The registry connector ID (e.g. 'google-calendar')
   * @param scopes       - OAuth scopes to request
   * @param oauthProvider - The OAuth proxy provider key (e.g. 'google'). Defaults to connectorId.
   */
  startFlow(
    connectorId: string,
    scopes?: string[],
    oauthProvider?: string,
    extraParams?: Record<string, string>,
  ): string | null {
    const proxyUrl = this.getProxyUrl()
    if (!proxyUrl) {
      log.warn({ connectorId }, 'startFlow: no proxy URL configured, cannot start OAuth')
      return null
    }

    const callbackBaseUrl = this.getCallbackBaseUrl()
    if (!callbackBaseUrl) {
      log.warn(
        { connectorId },
        'startFlow: no callback base URL configured (set OAUTH_CALLBACK_BASE_URL or oauth.callbackBaseUrl in config)',
      )
      return null
    }

    // Use the explicit oauthProvider for the proxy URL (e.g. 'google' for all Google services),
    // but track connectorId internally so the callback activates the right connector.
    const effectiveProvider = oauthProvider ?? connectorId

    const nonce = randomBytes(32).toString('hex')
    this.pending.set(nonce, {
      nonce,
      connectorId,
      oauthProvider: effectiveProvider,
      createdAt: Date.now(),
    })

    // Auto-expire after 10 minutes
    setTimeout(() => this.pending.delete(nonce), 10 * 60 * 1000)

    const callbackUrl = `${callbackBaseUrl}/_anton/oauth/callback`
    const params = new URLSearchParams({
      callback_url: callbackUrl,
      nonce,
    })

    // Pass connector-specific scopes so the proxy doesn't use its own defaults
    if (scopes && scopes.length > 0) {
      params.set('scope', scopes.join(' '))
    }

    // Provider-specific extra params (e.g. domain for websearch)
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        params.set(k, v)
      }
    }

    log.info(
      {
        connectorId,
        oauthProvider: effectiveProvider,
        callbackBaseUrl,
        scopeCount: scopes?.length ?? 0,
      },
      'startFlow: OAuth flow started',
    )
    return `${proxyUrl}/oauth/${effectiveProvider}/authorize?${params.toString()}`
  }

  /**
   * Handle the callback from the OAuth proxy.
   * Validates the nonce, stores the token, returns result.
   * Returns connectorId (not the raw OAuth provider) so the server activates the right connector.
   */
  handleCallback(body: {
    provider: string
    nonce: string
    access_token: string
    refresh_token?: string
    expires_in?: number
    metadata?: Record<string, string>
  }): { provider: string; success: boolean; error?: string } {
    const pending = this.pending.get(body.nonce)

    if (!pending) {
      log.warn(
        { provider: body.provider, pendingCount: this.pending.size },
        'handleCallback: invalid or expired nonce',
      )
      return { provider: body.provider, success: false, error: 'Invalid or expired nonce' }
    }

    // The proxy sends back its own provider name (e.g. 'google'), but multiple connectors
    // can share one OAuth provider. Verify the OAuth provider matches, then use connectorId.
    if (pending.oauthProvider !== body.provider) {
      log.warn(
        {
          expected: pending.oauthProvider,
          got: body.provider,
          connectorId: pending.connectorId,
        },
        'handleCallback: provider mismatch',
      )
      return { provider: body.provider, success: false, error: 'Provider mismatch' }
    }

    // Single-use nonce
    this.pending.delete(body.nonce)

    const token: StoredCredentials = {
      provider: pending.connectorId,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? Math.floor(Date.now() / 1000) + body.expires_in : undefined,
      oauthProvider:
        pending.oauthProvider !== pending.connectorId ? pending.oauthProvider : undefined,
      metadata: body.metadata,
    }

    // Store under connectorId (e.g. 'google-calendar'), not raw provider ('google')
    this.tokenStore.save(pending.connectorId, token)
    log.info(
      {
        connectorId: pending.connectorId,
        oauthProvider: pending.oauthProvider,
        hasRefreshToken: Boolean(body.refresh_token),
        hasExpiry: Boolean(body.expires_in),
        metadataKeys: body.metadata ? Object.keys(body.metadata).length : 0,
      },
      'handleCallback: token stored',
    )
    return { provider: pending.connectorId, success: true }
  }

  /**
   * Get a valid access token, refreshing if needed.
   * Throws if no token exists or refresh fails.
   */
  async getToken(provider: string): Promise<string> {
    const stored = this.tokenStore.load(provider)
    if (!stored) {
      throw new Error(`No OAuth token stored for ${provider}`)
    }

    // If token has an expiry and is within 5 minutes of expiring, refresh
    if (stored.expiresAt && stored.expiresAt < Date.now() / 1000 + 300) {
      // Deduplicate concurrent refresh calls — if already refreshing, wait for that result
      const inflight = this.refreshing.get(provider)
      if (inflight) return inflight

      const refreshPromise = this.doRefresh(provider, stored)
      this.refreshing.set(provider, refreshPromise)
      try {
        return await refreshPromise
      } finally {
        this.refreshing.delete(provider)
      }
    }

    if (!stored.accessToken) {
      throw new Error(`No access token stored for ${provider}`)
    }
    return stored.accessToken
  }

  private async doRefresh(provider: string, stored: StoredCredentials): Promise<string> {
    if (!stored.refreshToken) {
      log.warn({ provider }, 'doRefresh: no refresh token stored, cannot refresh')
      throw new Error(`Token expired and no refresh token available for ${provider}`)
    }

    const proxyUrl = this.getProxyUrl()
    if (!proxyUrl) {
      log.error({ provider }, 'doRefresh: no proxy URL configured')
      throw new Error('Cannot refresh token: oauth proxy URL not configured')
    }

    log.info({ provider }, 'doRefresh: refreshing token via proxy')

    // Use the stored oauthProvider (e.g. 'google') for the proxy URL, not the connectorId
    // (e.g. 'google-calendar'). Fall back to registry lookup for tokens saved before this field
    // existed, then to provider for 1:1 mappings like 'gmail'.
    const refreshProvider =
      stored.oauthProvider ||
      CONNECTOR_REGISTRY.find((e) => e.id === provider)?.oauthProvider ||
      provider

    // Hard timeout so a hung proxy can't wedge the refresh dedup map forever —
    // every subsequent getToken() for this provider would otherwise block on
    // an unresolved promise.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${proxyUrl}/oauth/${refreshProvider}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: stored.refreshToken }),
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.error({ provider, timeoutMs: REFRESH_TIMEOUT_MS }, 'doRefresh: proxy timeout')
        throw new Error(`Token refresh timed out for ${provider}`)
      }
      log.error({ err, provider }, 'doRefresh: network error talking to proxy')
      throw err
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      const errText = await res.text()
      log.error(
        { provider, status: res.status, body: errText.slice(0, 200) },
        'doRefresh: proxy returned non-2xx',
      )
      throw new Error(`Token refresh failed for ${provider}: ${errText}`)
    }

    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    stored.accessToken = data.access_token
    if (data.refresh_token) stored.refreshToken = data.refresh_token
    if (data.expires_in) stored.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in
    this.tokenStore.save(provider, stored)

    log.info(
      {
        provider,
        expiresIn: data.expires_in,
        rotatedRefreshToken: Boolean(data.refresh_token),
      },
      'doRefresh: token refreshed',
    )
    return stored.accessToken
  }

  /**
   * Check if a provider has a stored token. Returns true even if the blob
   * exists but cannot be decrypted — the connector is "connected from the
   * user's perspective" and getToken() will surface the decrypt error to
   * trigger a reconnect prompt rather than silently appearing disconnected.
   */
  hasToken(provider: string): boolean {
    try {
      return this.tokenStore.load(provider) !== null
    } catch {
      return true
    }
  }

  /** Remove a provider's stored token */
  disconnect(provider: string): void {
    this.tokenStore.delete(provider)
    log.info({ provider }, 'disconnect: token removed from store')
  }

  /** List all providers with stored tokens */
  listConnected(): string[] {
    return this.tokenStore.list()
  }

  getProxyUrl(): string | null {
    return process.env.OAUTH_PROXY_URL || this.config.oauth?.proxyUrl || null
  }

  private getCallbackBaseUrl(): string | null {
    return process.env.OAUTH_CALLBACK_BASE_URL || this.config.oauth?.callbackBaseUrl || null
  }
}
