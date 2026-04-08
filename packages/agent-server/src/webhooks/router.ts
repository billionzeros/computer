/**
 * Webhook router — single HTTP entry point for all bot integrations.
 *
 *   POST /_anton/webhooks/{slug}
 *
 * The router owns:
 *   - URL matching
 *   - raw body collection (signature schemes need byte-exact bodies)
 *   - immediate ack (most providers require <5s response, then retry)
 *   - per-provider de-duplication via a small LRU
 *   - dispatching parsed events to the shared WebhookAgentRunner
 *
 * Providers stay thin and provider-specific. See ./provider.ts.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createLogger } from '@anton/logger'
import type { WebhookAgentRunner } from './agent-runner.js'
import type { CanonicalEvent, WebhookProvider, WebhookRequest } from './provider.js'

const log = createLogger('webhook-router')

const ROUTE_PREFIX = '/_anton/webhooks/'
const DEDUP_MAX = 1024
/**
 * Hard ceiling on provider.parse() — some providers do async lookups (db,
 * connector metadata) inside parse, and a hung lookup must not block the
 * entire inbound event pipeline. Generous because parse can legitimately
 * touch I/O, but tight enough that a wedge is bounded.
 */
const PARSE_TIMEOUT_MS = 10_000
/**
 * Hard ceiling on inbound webhook body size. The endpoint is publicly
 * reachable (the only thing in front is a trusted proxy, but we treat the
 * worker as the trust boundary, not the network), so without a cap an
 * unauthenticated client could stream arbitrary bytes and OOM the
 * process. Real provider events are kilobytes — Slack envelopes top out
 * around ~50 KB even with image metadata, Telegram updates are smaller,
 * so 2 MiB is several orders of magnitude of headroom and still
 * comfortably below any node memory pressure. The check fires before
 * verify(), so the attacker cost stays bounded.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024

export class WebhookRouter {
  private providers = new Map<string, WebhookProvider>()
  private seen = new Map<string, number>() // deliveryId → insertion order

  constructor(private runner: WebhookAgentRunner) {}

  register(provider: WebhookProvider): void {
    if (this.providers.has(provider.slug)) {
      log.warn({ slug: provider.slug }, 'overwriting existing provider')
    }
    this.providers.set(provider.slug, provider)
    log.info({ slug: provider.slug }, 'webhook provider registered')
  }

  /** Returns true if the URL belongs to this router (and was handled). */
  tryHandle(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'POST') return false
    const url = req.url ?? ''
    if (!url.startsWith(ROUTE_PREFIX)) return false

    const [path, queryString = ''] = url.slice(ROUTE_PREFIX.length).split('?', 2)
    const slug = path.split('/')[0] ?? ''
    const provider = this.providers.get(slug)

    // Log every inbound hit — the single most useful log line for debugging
    // "is the webhook even reaching us". Includes the signals we need to
    // distinguish real proxy traffic (Cloudflare/Slack/Telegram) from curl,
    // random scanners, and misrouted reverse-proxy traffic, without leaking
    // the signature itself.
    log.info(
      {
        slug,
        hasProvider: Boolean(provider),
        registeredProviders: Array.from(this.providers.keys()),
        ua: req.headers['user-agent'],
        contentLength: req.headers['content-length'],
        proxyTs: req.headers['x-anton-proxy-ts'],
        hasProxySig: Boolean(req.headers['x-anton-proxy-sig']),
        teamId: req.headers['x-anton-team-id'],
        remoteAddr: req.socket.remoteAddress,
      },
      'inbound webhook',
    )

    if (!provider) {
      log.warn({ slug, known: Array.from(this.providers.keys()) }, 'unknown provider slug')
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`Unknown webhook provider: ${slug}`)
      return true
    }

    // Buffer chunks as Buffers (NOT as a UTF-8 string). HMAC verification
    // is byte-exact and decoding through `chunk.toString('utf8')` lossily
    // replaces invalid sequences with U+FFFD — sometimes intermittently,
    // when a multi-byte char straddles a chunk boundary. Concatenating raw
    // Buffers preserves every byte for both signature and JSON parsing.
    const chunks: Buffer[] = []
    let bodyBytes = 0
    let aborted = false
    req.on('data', (chunk: Buffer) => {
      if (aborted) return
      bodyBytes += chunk.length
      // Refuse runaway bodies before they can OOM us. The check fires
      // before verify(), which is intentional: an unauthenticated caller
      // shouldn't be able to consume arbitrary memory just by streaming
      // bytes at us. Send 413 and tear the socket down.
      if (bodyBytes > MAX_BODY_BYTES) {
        aborted = true
        log.warn(
          { slug, bodyBytes, maxBytes: MAX_BODY_BYTES },
          'inbound webhook body exceeded MAX_BODY_BYTES, aborting',
        )
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'text/plain', Connection: 'close' })
          res.end('Payload too large')
        }
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      const body = Buffer.concat(chunks, bodyBytes)
      log.debug({ slug, bodyBytes }, 'body fully received, dispatching')
      this.dispatch(provider, body, req, res, queryString).catch((err) => {
        log.error({ err, slug }, 'dispatch failed')
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal error')
        }
      })
    })
    req.on('error', (err) => {
      log.warn({ err, slug }, 'inbound request stream errored')
    })
    return true
  }

  private async dispatch(
    provider: WebhookProvider,
    rawBody: Buffer,
    req: IncomingMessage,
    res: ServerResponse,
    queryString: string,
  ): Promise<void> {
    const slug = provider.slug
    const headers: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
    }
    const webhookReq: WebhookRequest = {
      rawBody,
      headers,
      query: new URLSearchParams(queryString),
    }

    // 1. Handshake / challenge — short-circuit before verification.
    //    (Slack url_verification has no signature; this also lets providers
    //    keep verify() simple.)
    if (provider.handleHandshake) {
      const handshake = provider.handleHandshake(webhookReq)
      if (handshake) {
        log.info({ slug, status: handshake.status }, 'handshake answered')
        res.writeHead(handshake.status, {
          'Content-Type': handshake.contentType ?? 'text/plain',
        })
        res.end(handshake.body)
        return
      }
    }

    // 2. Verify signature.
    let verified: boolean
    try {
      verified = await provider.verify(webhookReq)
    } catch (err) {
      log.warn({ err, slug }, 'verify threw')
      verified = false
    }
    if (!verified) {
      log.warn({ slug }, 'verify failed, returning 401')
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('Invalid signature')
      return
    }
    log.info({ slug }, 'verify passed, acking')

    // 3. Ack immediately — providers retry on >5s timeouts.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')

    // 4. Parse + process out-of-band. Wrap in a timeout — a hung parse
    //    (e.g. slow connector metadata lookup) must not stall later events.
    let events: CanonicalEvent[]
    try {
      events = await withTimeout(
        Promise.resolve(provider.parse(webhookReq)),
        PARSE_TIMEOUT_MS,
        `parse(${slug}) timed out`,
      )
    } catch (err) {
      log.error({ err, slug }, 'parse failed')
      return
    }

    log.info({ slug, eventCount: events.length }, 'parse complete')

    if (events.length === 0) {
      // Parse returning zero events is usually "provider filtered it out"
      // (bot echo, wrong channel type, etc). Not an error but very commonly
      // the reason users report "the bot isn't replying", so leave a
      // breadcrumb rather than silently dropping.
      log.info({ slug }, 'no canonical events produced, nothing to process')
      return
    }

    for (const event of events) {
      // Atomic claim-or-skip: isDuplicate() now inserts on first sight, so
      // two concurrent events sharing a deliveryId can't both miss the check.
      if (event.deliveryId && !this.claimDelivery(event.deliveryId)) {
        log.info({ slug, deliveryId: event.deliveryId }, 'duplicate delivery, skipping')
        continue
      }
      log.info(
        {
          slug,
          deliveryId: event.deliveryId,
          sessionId: event.sessionId,
          textPreview: event.text.slice(0, 80),
        },
        'processing event',
      )
      this.processEvent(provider, event).catch((err) => {
        log.error({ err, slug, sessionId: event.sessionId }, 'event processing failed')
      })
    }
  }

  private async processEvent(provider: WebhookProvider, event: CanonicalEvent): Promise<void> {
    const slug = provider.slug
    const started = Date.now()

    // Fire-and-forget start hook — never let a decorative side-effect
    // (e.g. a Slack reactions.add round-trip) block the actual turn.
    // Awaiting here only to surface errors into the log, not to gate
    // the model call on it.
    if (provider.onTurnStart) {
      try {
        await provider.onTurnStart(event)
      } catch (err) {
        log.warn({ err, slug, sessionId: event.sessionId }, 'onTurnStart failed (ignored)')
      }
    }

    let result: Awaited<ReturnType<typeof this.runner.run>>
    try {
      result = await this.runner.run(event)
    } catch (err) {
      log.error({ err, slug, sessionId: event.sessionId }, 'runner threw')
      if (provider.onTurnEnd) {
        try {
          await provider.onTurnEnd(event, { ok: false })
        } catch (hookErr) {
          log.warn({ err: hookErr, slug, sessionId: event.sessionId }, 'onTurnEnd failed (ignored)')
        }
      }
      throw err
    }

    const runnerMs = Date.now() - started
    const { text: reply, images } = result
    const hasContent = reply.length > 0 || images.length > 0
    if (!hasContent) {
      log.info({ slug, sessionId: event.sessionId, runnerMs }, 'runner returned no reply')
      // Still treat empty as "ok" — it just means dedup dropped this, not
      // that anything broke. The eye reaction gets cleared.
      if (provider.onTurnEnd) {
        try {
          await provider.onTurnEnd(event, { ok: true })
        } catch (err) {
          log.warn({ err, slug, sessionId: event.sessionId }, 'onTurnEnd failed (ignored)')
        }
      }
      return
    }
    log.info(
      {
        slug,
        sessionId: event.sessionId,
        runnerMs,
        replyBytes: reply.length,
        imageCount: images.length,
      },
      'runner produced reply, sending',
    )
    try {
      await provider.reply(event, reply, images)
      log.info({ slug, sessionId: event.sessionId }, 'reply sent')
    } catch (err) {
      log.error({ err, slug, sessionId: event.sessionId }, 'reply failed')
    }

    if (provider.onTurnEnd) {
      try {
        await provider.onTurnEnd(event, { ok: true })
      } catch (err) {
        log.warn({ err, slug, sessionId: event.sessionId }, 'onTurnEnd failed (ignored)')
      }
    }
  }

  /**
   * Atomic check-and-claim for dedup. Returns true if the delivery is new
   * (and has been claimed by this call), false if already seen. The claim
   * is registered before the function returns, so two concurrent callers
   * with the same id cannot both observe a miss.
   *
   * JS is single-threaded per event loop, but providers call `parse` across
   * await boundaries, so the previous check-then-insert pattern left a
   * window where a second event on another microtask could slip through.
   */
  private claimDelivery(deliveryId: string): boolean {
    if (this.seen.has(deliveryId)) return false
    this.seen.set(deliveryId, Date.now())
    if (this.seen.size > DEDUP_MAX) {
      // Drop oldest entry — Map preserves insertion order.
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    return true
  }
}

/** Race a promise against a timeout and reject with the provided message. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
