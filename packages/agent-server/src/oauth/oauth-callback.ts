/**
 * HTTP handler for POST /_anton/oauth/callback
 *
 * Receives tokens from the OAuth proxy after successful authorization.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createLogger } from '@anton/logger'
import type { OAuthFlow } from './oauth-flow.js'

const log = createLogger('oauth-callback')
const MAX_BODY_BYTES = 65_536
/** Generous cap on metadata payloads forwarded from the proxy. */
const MAX_METADATA_KEYS = 32
const MAX_METADATA_VALUE_LEN = 4096

export function oauthCallbackHandler(
  req: IncomingMessage,
  res: ServerResponse,
  oauthFlow: OAuthFlow,
  onComplete: (result: {
    provider: string
    success: boolean
    error?: string
    metadata?: Record<string, string>
  }) => void,
): void {
  log.info(
    {
      remoteAddr: req.socket.remoteAddress,
      contentLength: req.headers['content-length'],
    },
    'callback received',
  )
  // Validate Content-Type up front so a misconfigured proxy gets a clear
  // error rather than the misleading "Invalid JSON body" we used to return
  // for any non-JSON payload.
  const contentType = (req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('application/json')) {
    log.warn({ contentType }, 'callback: bad content-type, rejecting with 415')
    res.writeHead(415, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Content-Type must be application/json' }))
    req.resume()
    return
  }

  let body = ''
  let aborted = false

  req.on('data', (chunk: Buffer) => {
    if (aborted) return
    body += chunk.toString()
    if (body.length > MAX_BODY_BYTES) {
      aborted = true
      // Send the error response cleanly before tearing down the socket so
      // the proxy actually receives a 413 instead of a connection reset.
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request too large' }))
      }
      // Drain rather than destroy so the response flush isn't truncated.
      req.unpipe()
      req.resume()
    }
  })

  req.on('end', () => {
    if (aborted) return
    let data: {
      provider?: string
      nonce?: string
      access_token?: string
      refresh_token?: string
      expires_in?: number
      metadata?: Record<string, string>
    }
    try {
      data = JSON.parse(body)
    } catch (err) {
      log.warn({ err, bodyBytes: body.length }, 'callback: JSON parse failed')
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }

    if (!data.provider || !data.nonce || !data.access_token) {
      log.warn(
        {
          hasProvider: Boolean(data.provider),
          hasNonce: Boolean(data.nonce),
          hasAccessToken: Boolean(data.access_token),
        },
        'callback: missing required fields',
      )
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing required fields: provider, nonce, access_token' }))
      return
    }

    // Validate metadata shape — the proxy is trusted, but a misbehaving or
    // future-version proxy must not be able to bloat the on-disk config or
    // smuggle non-string values into a Record<string,string> store.
    const metadata = sanitizeMetadata(data.metadata)
    if (metadata === null) {
      log.warn({ provider: data.provider }, 'callback: metadata rejected by sanitizer')
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid metadata payload' }))
      return
    }

    const result = oauthFlow.handleCallback({
      provider: data.provider,
      nonce: data.nonce,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      metadata,
    })

    if (result.success) {
      log.info({ provider: result.provider }, 'callback: success')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } else {
      log.warn({ provider: data.provider, error: result.error }, 'callback: rejected')
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: result.error }))
    }

    // Notify the server to update connector status and tell the desktop.
    // Forward the (sanitized) proxy metadata so the server can persist things
    // like forward_secret onto the connector config.
    onComplete({ ...result, metadata })
  })
}

/**
 * Validate that metadata is a flat string→string record, bounded in key
 * count and value length. Returns:
 *   - undefined when the field is absent
 *   - null on a structurally invalid payload (caller should reject)
 *   - the cleaned record otherwise
 */
function sanitizeMetadata(raw: unknown): Record<string, string> | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_METADATA_KEYS) return null
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (typeof v !== 'string') return null
    if (v.length > MAX_METADATA_VALUE_LEN) return null
    out[k] = v
  }
  return out
}
