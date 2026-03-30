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
import type { StoredToken, TokenStore } from './token-store.js'

interface PendingFlow {
  nonce: string
  connectorId: string // the registry ID (e.g. 'google-calendar')
  oauthProvider: string // the proxy provider (e.g. 'google')
  createdAt: number
}

export class OAuthFlow {
  private pending = new Map<string, PendingFlow>()
  private tokenStore: TokenStore
  private config: AgentConfig

  constructor(config: AgentConfig, tokenStore: TokenStore) {
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
    if (!proxyUrl) return null

    const callbackBaseUrl = this.getCallbackBaseUrl()
    if (!callbackBaseUrl) return null

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
      return { provider: body.provider, success: false, error: 'Invalid or expired nonce' }
    }

    // The proxy sends back its own provider name (e.g. 'google'), but multiple connectors
    // can share one OAuth provider. Verify the OAuth provider matches, then use connectorId.
    if (pending.oauthProvider !== body.provider) {
      return { provider: body.provider, success: false, error: 'Provider mismatch' }
    }

    // Single-use nonce
    this.pending.delete(body.nonce)

    const token: StoredToken = {
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
      if (!stored.refreshToken) {
        throw new Error(`Token expired and no refresh token available for ${provider}`)
      }

      const proxyUrl = this.getProxyUrl()
      if (!proxyUrl) {
        throw new Error('Cannot refresh token: oauth proxy URL not configured')
      }

      // Use the stored oauthProvider (e.g. 'google') for the proxy URL, not the connectorId
      // (e.g. 'google-calendar'). Fall back to registry lookup for tokens saved before this field
      // existed, then to provider for 1:1 mappings like 'gmail'.
      const refreshProvider =
        stored.oauthProvider ||
        CONNECTOR_REGISTRY.find((e) => e.id === provider)?.oauthProvider ||
        provider

      const res = await fetch(`${proxyUrl}/oauth/${refreshProvider}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: stored.refreshToken }),
      })

      if (!res.ok) {
        const errText = await res.text()
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
    }

    return stored.accessToken
  }

  /** Check if a provider has a stored token */
  hasToken(provider: string): boolean {
    return this.tokenStore.load(provider) !== null
  }

  /** Remove a provider's stored token */
  disconnect(provider: string): void {
    this.tokenStore.delete(provider)
  }

  /** List all providers with stored tokens */
  listConnected(): string[] {
    return this.tokenStore.list()
  }

  private getProxyUrl(): string | null {
    return process.env.OAUTH_PROXY_URL || this.config.oauth?.proxyUrl || null
  }

  private getCallbackBaseUrl(): string | null {
    return process.env.OAUTH_CALLBACK_BASE_URL || this.config.oauth?.callbackBaseUrl || null
  }
}
