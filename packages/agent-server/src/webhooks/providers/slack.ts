/**
 * Slack webhook provider (slack-bot connector).
 *
 * Inbound traffic does NOT come from Slack directly — the agent never
 * registers an Events API URL with Slack. Instead, the developer-owned
 * Cloudflare Worker proxy at oauth.antoncomputer.in is the single Events
 * URL for the entire Anton Slack app, and it forwards each event to the
 * one Anton instance that owns the workspace (matched by team_id in KV).
 *
 * That means:
 *
 *   - The slug is `slack-bot` (matches the connector id).
 *   - We verify `x-anton-proxy-sig` (HMAC-SHA256 with the per-install
 *     forward_secret the proxy gave us at OAuth time), NOT Slack's own
 *     signature. The agent never sees Slack's signing secret.
 *   - We still handle Slack's url_verification handshake the proxy may
 *     forward to us during testing, but in production the proxy answers
 *     it synchronously and never forwards.
 *
 * Outbound chat.postMessage still goes directly to Slack with the bot
 * token (xoxb) — that one's stored in connector credentials normally.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@anton/logger'
import type {
  CanonicalEvent,
  WebhookHandshakeResponse,
  WebhookProvider,
  WebhookRequest,
} from '../provider.js'

const log = createLogger('slack-webhook')

const SLACK_API = 'https://slack.com/api'
const MAX_TS_SKEW_SECONDS = 60 * 5

export interface SlackBotIdentity {
  /** Display name shown next to the message in Slack (chat:write.customize). */
  displayName?: string
  /** Public HTTPS URL of an avatar image (chat:write.customize). */
  iconUrl?: string
}

export interface SlackWebhookOpts {
  /**
   * Lazily resolves the per-install HMAC key the proxy uses to sign forwarded
   * events. Returned by the OAuth callback as `metadata.forward_secret` and
   * persisted with the slack-bot connector. Returning null disables verification
   * (and therefore the whole inbound path) — used to early-drop traffic when
   * the connector is disconnected mid-flight.
   */
  getForwardSecret: () => Promise<string | null>
  /** Lazily resolves the bot token (xoxb-…) used for chat.postMessage. */
  getBotToken: () => Promise<string | null>
  /** Lazily resolves the bot user ID (Uxxxx) used for mention stripping. */
  getBotUserId?: () => Promise<string | null>
  /**
   * Lazily resolves a per-message display identity (custom name + avatar).
   * Uses the chat:write.customize scope on the bot token.
   */
  getBotIdentity?: () => Promise<SlackBotIdentity | null>
}

export class SlackWebhookProvider implements WebhookProvider {
  readonly slug = 'slack-bot'

  constructor(private opts: SlackWebhookOpts) {}

  /** Slack's url_verification challenge — only seen if the proxy forwards it. */
  handleHandshake(req: WebhookRequest): WebhookHandshakeResponse | null {
    try {
      const body = JSON.parse(req.rawBody) as { type?: string; challenge?: string }
      if (body.type === 'url_verification' && body.challenge) {
        return { status: 200, body: body.challenge, contentType: 'text/plain' }
      }
    } catch {
      /* fall through */
    }
    return null
  }

  async verify(req: WebhookRequest): Promise<boolean> {
    log.info(
      {
        hasTs: Boolean(req.headers['x-anton-proxy-ts']),
        hasSig: Boolean(req.headers['x-anton-proxy-sig']),
        teamId: req.headers['x-anton-team-id'],
        bodyBytes: req.rawBody.length,
      },
      'verify: start',
    )
    const secret = await this.opts.getForwardSecret()
    if (!secret) {
      // Connector disconnected mid-flight, or never installed. Drop hard so
      // the proxy stops sending us traffic for this workspace.
      log.warn('slack-bot: no forward_secret available, rejecting')
      return false
    }
    const ts = req.headers['x-anton-proxy-ts']
    const sig = req.headers['x-anton-proxy-sig']
    if (!ts || !sig) {
      log.warn('slack-bot: missing proxy signature headers')
      return false
    }

    const tsNum = Number.parseInt(ts, 10)
    if (!Number.isFinite(tsNum)) return false
    const skewSeconds = Date.now() / 1000 - tsNum
    if (Math.abs(skewSeconds) > MAX_TS_SKEW_SECONDS) {
      // Log the actual skew so a wedged system clock surfaces clearly instead
      // of looking like a generic verification failure.
      log.warn(
        { skewSeconds: Math.round(skewSeconds), maxSkewSeconds: MAX_TS_SKEW_SECONDS },
        'slack-bot: stale proxy timestamp (check system clock)',
      )
      return false
    }

    // The Worker signs with base64url (no padding, `-_` instead of `+/`) —
    // see `bufToB64()` in huddle/connectors/oauth-proxy/src/lib/slack-bot.ts.
    // We have to emit the same flavour or the strings will differ purely on
    // encoding and verification will 401 every event forever. This used to
    // be standard `.digest('base64')` which meant slack-bot was silently
    // broken from day one — the symptom looked exactly like a forward_secret
    // mismatch even when both sides were in perfect sync.
    //
    // `Buffer.from(secret, 'base64')` is already base64url-tolerant on Node
    // (it accepts both alphabets), so the key decode above is fine.
    const base = `v1:${ts}:${req.rawBody}`
    const computed = `v1=${createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(base)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}`
    const a = Buffer.from(sig)
    const b = Buffer.from(computed)
    if (a.length !== b.length) {
      log.warn(
        {
          sigLen: a.length,
          computedLen: b.length,
          // Log a short prefix of both so a future encoding drift is obvious
          // at a glance instead of looking like a generic "secret mismatch".
          sigPrefix: sig.slice(0, 16),
          computedPrefix: computed.slice(0, 16),
        },
        'verify: signature length mismatch (encoding drift or forward_secret drift)',
      )
      return false
    }
    try {
      const ok = timingSafeEqual(a, b)
      if (!ok) {
        log.warn('verify: HMAC mismatch — forward_secret on disk differs from proxy KV')
      } else {
        log.info('verify: ok')
      }
      return ok
    } catch {
      return false
    }
  }

  async parse(req: WebhookRequest): Promise<CanonicalEvent[]> {
    let body: SlackEventEnvelope
    try {
      body = JSON.parse(req.rawBody) as SlackEventEnvelope
    } catch {
      log.warn('parse: invalid JSON body')
      return []
    }
    // One info line at the top so every verified inbound event leaves a
    // breadcrumb even when it's filtered out below. Without this a dropped
    // bot-echo or wrong-channel-type event is indistinguishable from a
    // forward that never arrived.
    log.info(
      {
        envelopeType: body.type,
        eventType: body.event?.type,
        subtype: body.event?.subtype,
        channelType: body.event?.channel_type,
        teamId: body.team_id,
        eventId: body.event_id,
        hasBotId: Boolean(body.event?.bot_id),
      },
      'parse: event received',
    )
    if (body.type !== 'event_callback' || !body.event) {
      log.info({ envelopeType: body.type }, 'parse: not an event_callback, dropping')
      return []
    }

    const ev = body.event
    // Ignore the bot's own messages and edited/deleted variants
    if (ev.bot_id || ev.subtype === 'bot_message') {
      log.info({ botId: ev.bot_id, subtype: ev.subtype }, 'parse: bot echo, dropping')
      return []
    }
    if (ev.type !== 'app_mention' && ev.type !== 'message') {
      log.info({ type: ev.type }, 'parse: unsupported event type, dropping')
      return []
    }

    // For 'message' events, only respond inside DMs (channel_type === 'im').
    if (ev.type === 'message' && ev.channel_type !== 'im') {
      log.info({ channelType: ev.channel_type }, 'parse: message not in DM, dropping')
      return []
    }

    const text = await this.stripMention(ev.text ?? '')
    if (!text) {
      log.info('parse: empty text after mention strip, dropping')
      return []
    }

    const sessionId = `slack:${body.team_id ?? 'unknown'}:${ev.channel}`
    return [
      {
        provider: this.slug,
        sessionId,
        deliveryId: body.event_id,
        text,
        context: {
          channel: ev.channel,
          threadTs: ev.thread_ts ?? ev.ts,
          teamId: body.team_id,
        },
      },
    ]
  }

  async reply(event: CanonicalEvent, text: string): Promise<void> {
    const token = await this.opts.getBotToken()
    if (!token) {
      log.warn('no Slack bot token available, skipping reply')
      return
    }
    const channel = event.context.channel as string
    const threadTs = event.context.threadTs as string | undefined
    const identity = this.opts.getBotIdentity ? await this.opts.getBotIdentity() : null

    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        // chat:write.customize lets us set a per-message display name/avatar.
        ...(identity?.displayName ? { username: identity.displayName } : {}),
        ...(identity?.iconUrl ? { icon_url: identity.iconUrl } : {}),
      }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      // Distinguish auth/permission failures from transient errors so a dead
      // bot token doesn't silently swallow every reply with a generic warning.
      // See https://api.slack.com/methods/chat.postMessage#errors
      const fatalAuth = new Set([
        'invalid_auth',
        'not_authed',
        'token_revoked',
        'token_expired',
        'account_inactive',
        'no_permission',
        'missing_scope',
      ])
      if (data.error && fatalAuth.has(data.error)) {
        log.error(
          { error: data.error, channel },
          'chat.postMessage rejected by Slack — bot token is invalid or lacks scope; reconnect the slack-bot connector',
        )
      } else {
        log.warn({ error: data.error, channel }, 'chat.postMessage failed')
      }
    }
  }

  private async stripMention(text: string): Promise<string> {
    const botUserId = this.opts.getBotUserId ? await this.opts.getBotUserId() : null
    if (botUserId) {
      const re = new RegExp(`<@${botUserId}>\\s*`, 'g')
      return text.replace(re, '').trim()
    }
    // Fallback: strip a single leading <@Uxxx> mention. Slack user IDs always
    // start with `U` (or `W` for workspace-shared bots), never raw digits, so
    // anchor on that to avoid matching unrelated angle-bracket tokens.
    return text.replace(/^<@[UW][A-Z0-9]+>\s*/, '').trim()
  }
}

interface SlackEventEnvelope {
  type?: string
  team_id?: string
  event_id?: string
  event?: {
    type: string
    subtype?: string
    bot_id?: string
    user?: string
    text?: string
    channel: string
    channel_type?: string
    ts: string
    thread_ts?: string
  }
}
