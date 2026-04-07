/**
 * WebhookProvider — pluggable interface for inbound bot integrations.
 *
 * Each provider (Slack, Telegram, GitHub, Linear, Discord, …) implements
 * this interface and is mounted under a single canonical URL:
 *
 *   POST /_anton/webhooks/{slug}
 *
 * The router (see ./router.ts) handles HTTP plumbing, signature verification,
 * de-duplication, and dispatching to the shared agent runner. Providers stay
 * thin — typically ~80 lines — and only contain provider-specific concerns:
 *   - signature/secret verification
 *   - challenge/handshake replies
 *   - parsing the raw payload into 0..N CanonicalEvents
 *   - sending replies back to the source
 */

export interface WebhookRequest {
  /** Raw request body, exactly as received (signature schemes need this). */
  rawBody: string
  /** HTTP headers (lowercased keys). */
  headers: Record<string, string | undefined>
  /** Parsed query string. */
  query: URLSearchParams
}

/** A short-circuit response — used for handshakes (e.g. Slack url_verification). */
export interface WebhookHandshakeResponse {
  status: number
  body: string
  contentType?: string
}

/**
 * Canonical, provider-agnostic event the agent runner consumes.
 *
 * Anything provider-specific lives in `context` and is only read by the
 * same provider's `reply()` method.
 */
export interface CanonicalEvent {
  /** Provider slug (matches the URL path). */
  provider: string
  /** Stable session key. e.g. `slack:T123:C456:U789` or `telegram:42`. */
  sessionId: string
  /** Per-delivery dedupe key. Optional — providers without one skip dedup. */
  deliveryId?: string
  /** User-visible text the agent should respond to. */
  text: string
  /** Free-form provider context, opaque to the router. */
  context: Record<string, unknown>
}

export interface WebhookProvider {
  /** URL slug under /_anton/webhooks/{slug}. Must be unique. */
  readonly slug: string

  /**
   * Optional handshake handler. If it returns a response, the router writes
   * that response and skips verify/parse/dispatch. Used for Slack
   * `url_verification` challenges and similar one-shot setup pings.
   */
  handleHandshake?(req: WebhookRequest): WebhookHandshakeResponse | null

  /**
   * Verify the request is authentic. Return false (or throw) to reject.
   * Providers without verification should return true.
   */
  verify(req: WebhookRequest): Promise<boolean> | boolean

  /**
   * Parse the raw body into 0..N canonical events. An empty array is valid
   * (e.g. Slack heartbeat events we don't care about).
   */
  parse(req: WebhookRequest): Promise<CanonicalEvent[]> | CanonicalEvent[]

  /**
   * Send a textual reply for a given event back to the originating source.
   * Called after the agent runner has produced a response.
   */
  reply(event: CanonicalEvent, text: string): Promise<void>
}
