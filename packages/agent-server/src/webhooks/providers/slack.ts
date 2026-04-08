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
import { toSlackMrkdwn } from '../format/slack-mrkdwn.js'
import type {
  CanonicalEvent,
  CanonicalImageAttachment,
  OutboundImage,
  SurfaceInfo,
  WebhookHandshakeResponse,
  WebhookProvider,
  WebhookRequest,
} from '../provider.js'
import { SlackIdentityResolver } from './slack-identity.js'

const log = createLogger('slack-webhook')

const SLACK_API = 'https://slack.com/api'

const MAX_TS_SKEW_PAST_SECONDS = 60 * 5
const MAX_TS_SKEW_FUTURE_SECONDS = 30

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

/** Bounded LRU of (channel, thread_ts) pairs the bot has already joined. */
const ACTIVE_THREAD_MAX = 2048

export class SlackWebhookProvider implements WebhookProvider {
  readonly slug = 'slack-bot'

  private activeThreads = new Map<string, number>()

  private identity: SlackIdentityResolver

  constructor(private opts: SlackWebhookOpts) {
    this.identity = new SlackIdentityResolver(opts.getBotToken)
  }

  rehydrateActiveThreadsFromSessionIds(sessionIds: Iterable<string>): void {
    let seeded = 0
    for (const id of sessionIds) {
      if (!id.startsWith('slack:dm:') && !id.startsWith('slack:thread:')) continue
      const parts = id.split(':')
      if (parts.length < 5) continue
      const channel = parts[3]
      const threadRoot = parts.slice(4).join(':')
      if (!channel || !threadRoot) continue
      this.markThreadActive(channel, threadRoot)
      seeded += 1
    }
    if (seeded > 0) {
      log.info({ seeded }, 'rehydrated activeThreads from persisted sessions')
    }
  }

  private markThreadActive(channel: string, threadTs: string): void {
    const key = `${channel}:${threadTs}`
    // Delete-then-set moves the entry to the end of the Map's insertion
    // order so the eviction below picks the genuinely-oldest key.
    this.activeThreads.delete(key)
    this.activeThreads.set(key, Date.now())
    if (this.activeThreads.size > ACTIVE_THREAD_MAX) {
      const oldest = this.activeThreads.keys().next().value
      if (oldest !== undefined) this.activeThreads.delete(oldest)
    }
  }

  private isThreadActive(channel: string, threadTs: string): boolean {
    return this.activeThreads.has(`${channel}:${threadTs}`)
  }

  /** Slack's url_verification challenge — only seen if the proxy forwards it. */
  handleHandshake(req: WebhookRequest): WebhookHandshakeResponse | null {
    try {
      const body = JSON.parse(req.rawBody.toString('utf8')) as {
        type?: string
        challenge?: string
      }
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
    // Positive `skewSeconds` = timestamp is in the past (we received it
    // later than the proxy stamped it). Negative = timestamp is in the
    // future (proxy clock ahead of ours, or a replay with a fabricated ts).
    const skewSeconds = Date.now() / 1000 - tsNum
    if (skewSeconds > MAX_TS_SKEW_PAST_SECONDS || skewSeconds < -MAX_TS_SKEW_FUTURE_SECONDS) {
      // Log the actual skew so a wedged system clock surfaces clearly
      // instead of looking like a generic verification failure.
      log.warn(
        {
          skewSeconds: Math.round(skewSeconds),
          maxPastSeconds: MAX_TS_SKEW_PAST_SECONDS,
          maxFutureSeconds: MAX_TS_SKEW_FUTURE_SECONDS,
        },
        'slack-bot: proxy timestamp outside accepted replay window (check system clock)',
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
    //
    // We feed `update()` the prefix as a string and the body as a Buffer
    // separately rather than concatenating into a JS string. The router
    // hands us `rawBody` as a Buffer specifically because UTF-8 round-trips
    // were lossy on chunk-boundary multi-byte chars; calling
    // `update(req.rawBody)` directly on the Buffer preserves every byte.
    const hmac = createHmac('sha256', Buffer.from(secret, 'base64'))
    hmac.update(`v1:${ts}:`)
    hmac.update(req.rawBody)
    const computed = `v1=${hmac
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
      // JSON is UTF-8 by spec, so this decode is lossless even though the
      // raw bytes go through `toString('utf8')`. The HMAC path above
      // operates on the Buffer directly to stay byte-exact.
      body = JSON.parse(req.rawBody.toString('utf8')) as SlackEventEnvelope
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
    // Ignore the bot's own messages and edited/deleted variants — BUT
    // first learn which thread they're in. A bot_message echo is how we
    // re-learn thread participation after a process restart: the next
    // inbound message in that thread will match and be accepted even
    // though the in-memory set was empty on boot.
    if (ev.bot_id || ev.subtype === 'bot_message') {
      if (ev.thread_ts) {
        this.markThreadActive(ev.channel, ev.thread_ts)
      } else if (ev.ts) {
        // Bot posted at the top level; that message's ts becomes the
        // thread root if a user replies to it.
        this.markThreadActive(ev.channel, ev.ts)
      }
      log.info({ botId: ev.bot_id, subtype: ev.subtype }, 'parse: bot echo, dropping')
      return []
    }
    if (ev.type !== 'app_mention' && ev.type !== 'message') {
      log.info({ type: ev.type }, 'parse: unsupported event type, dropping')
      return []
    }

    const isDirectChat = ev.channel_type === 'im' || ev.channel_type === 'mpim'
    if (ev.type === 'message' && !isDirectChat) {
      const threadTs = ev.thread_ts
      if (threadTs && this.isThreadActive(ev.channel, threadTs)) {
        log.info({ channel: ev.channel, threadTs }, 'parse: message in active thread, accepting')
      } else {
        log.info(
          { channelType: ev.channel_type, hasThreadTs: Boolean(threadTs) },
          'parse: message not in DM or active thread, dropping',
        )
        return []
      }
    }

    const text = await this.stripMention(ev.text ?? '')
    const imageFiles = (ev.files ?? []).filter(isSupportedImage)
    if (!text && imageFiles.length === 0) {
      // No text AND no images we can forward. This is the only case where
      // dropping is correct — a message with just a non-image file (PDF,
      // video, zip) has nothing for the model to chew on yet.
      log.info(
        { hadFiles: (ev.files ?? []).length > 0 },
        'parse: empty text and no supported attachments, dropping',
      )
      return []
    }

    // Download image bytes with the bot token. Slack's url_private requires
    // Authorization: Bearer xoxb-… — a bare fetch returns an HTML login page.
    // We download sequentially (not in parallel) because a typical Slack
    // message has one or two attachments; the simpler code path wins.
    const attachments: CanonicalImageAttachment[] = []
    if (imageFiles.length > 0) {
      const token = await this.opts.getBotToken()
      if (!token) {
        log.warn(
          { fileCount: imageFiles.length },
          'parse: image attachments present but no bot token available, dropping attachments',
        )
      } else {
        for (const file of imageFiles) {
          try {
            const att = await fetchSlackFile(file, token)
            if (att) attachments.push(att)
          } catch (err) {
            log.warn({ err, fileId: file.id }, 'parse: failed to fetch Slack file, skipping')
          }
        }
      }
    }

    const effectiveText = text || (attachments.length > 0 ? '(image)' : '')

    const threadRoot = ev.thread_ts ?? ev.ts

    const teamId = body.team_id
    if (!teamId) {
      log.warn(
        { eventId: body.event_id, channel: ev.channel },
        'parse: event missing team_id, dropping (would otherwise collide across workspaces)',
      )
      return []
    }

    const sessionId = isDirectChat
      ? `slack:dm:${teamId}:${ev.channel}:${threadRoot}`
      : `slack:thread:${teamId}:${ev.channel}:${threadRoot}`

    this.markThreadActive(ev.channel, threadRoot)

    log.info(
      {
        textBytes: effectiveText.length,
        attachmentCount: attachments.length,
        droppedFileCount: (ev.files ?? []).length - imageFiles.length,
        activeThreadCount: this.activeThreads.size,
      },
      'parse: event accepted',
    )
    return [
      {
        provider: this.slug,
        sessionId,
        deliveryId: body.event_id,
        text: effectiveText,
        attachments: attachments.length > 0 ? attachments : undefined,
        surface: await buildSlackSurface(body, ev, this.identity),
        context: {
          channel: ev.channel,
          sourceTs: ev.ts,
          threadTs: threadRoot,
          channelType: ev.channel_type,
          teamId: body.team_id,
          userId: ev.user,
        },
      },
    ]
  }

  async reply(event: CanonicalEvent, text: string, images: OutboundImage[]): Promise<void> {
    const token = await this.opts.getBotToken()
    if (!token) {
      log.warn('no Slack bot token available, skipping reply')
      return
    }
    const channel = event.context.channel as string
    const threadTs = event.context.threadTs as string | undefined
    const identity = this.opts.getBotIdentity ? await this.opts.getBotIdentity() : null

    const mrkdwn = toSlackMrkdwn(text)

    if (mrkdwn.length > 0) {
      await this.postTextMessage({ token, channel, threadTs, text: mrkdwn, identity })
    }

    for (const img of images) {
      try {
        await uploadImageToSlack({ token, channel, threadTs, image: img })
      } catch (err) {
        // Never fail a reply because an image upload broke. The text
        // already went through; log and continue.
        log.warn({ err, imageId: img.id }, 'slack image upload failed, continuing')
      }
    }
  }

  private async postTextMessage(args: {
    token: string
    channel: string
    threadTs: string | undefined
    text: string
    identity: SlackBotIdentity | null
  }): Promise<void> {
    const { token, channel, threadTs, text, identity } = args
    // First attempt: include the customize fields if we have them. If
    // the install was OAuth'd before `chat:write.customize` was added
    // to the manifest, Slack will reject with `not_allowed_token_type`
    // (or sometimes `missing_scope`) and we retry once without them.
    // Without this fallback the bot is silently dead until the user
    // reconnects.
    const wantsCustomize = Boolean(identity?.displayName || identity?.iconUrl)
    let result = await this.callPostMessage({
      token,
      channel,
      threadTs,
      text,
      identity: wantsCustomize ? identity : null,
    })
    if (result.ok) return

    if (
      wantsCustomize &&
      (result.error === 'not_allowed_token_type' || result.error === 'missing_scope')
    ) {
      log.warn(
        { error: result.error, channel },
        'chat.postMessage rejected the customize fields — retrying without them. Reconnect slack-bot to enable custom display name/avatar.',
      )
      const retry = await this.callPostMessage({
        token,
        channel,
        threadTs,
        text,
        identity: null,
      })
      if (retry.ok) return
      result = retry
    }

    // Distinguish auth/permission failures from transient errors so a
    // dead bot token doesn't silently swallow every reply with a
    // generic warning. See https://api.slack.com/methods/chat.postMessage#errors
    const fatalAuth = new Set([
      'invalid_auth',
      'not_authed',
      'token_revoked',
      'token_expired',
      'account_inactive',
      'no_permission',
      'missing_scope',
      'not_allowed_token_type',
    ])
    if (result.error && fatalAuth.has(result.error)) {
      log.error(
        { error: result.error, channel },
        'chat.postMessage rejected by Slack — bot token is invalid or lacks scope; reconnect the slack-bot connector',
      )
    } else {
      log.warn({ error: result.error, channel }, 'chat.postMessage failed')
    }
  }

  /** Single chat.postMessage round-trip. Returns the parsed `{ok, error}`. */
  private async callPostMessage(args: {
    token: string
    channel: string
    threadTs: string | undefined
    text: string
    identity: SlackBotIdentity | null
  }): Promise<{ ok: boolean; error?: string }> {
    const { token, channel, threadTs, text, identity } = args
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
        // chat:write.customize lets us set a per-message display
        // name/avatar. Caller decides whether to include them.
        ...(identity?.displayName ? { username: identity.displayName } : {}),
        ...(identity?.iconUrl ? { icon_url: identity.iconUrl } : {}),
      }),
    })
    return (await res.json()) as { ok: boolean; error?: string }
  }

  /**
   * Lifecycle reaction: eye on the source message when we start working.
   * Slack-only — Telegram uses its own typing indicator for this feedback.
   * Only reacts to the source message (the one that triggered the turn);
   * never to the bot's own reply or to other messages in the thread.
   */
  async onTurnStart(event: CanonicalEvent): Promise<void> {
    const channel = event.context.channel as string | undefined
    const sourceTs = event.context.sourceTs as string | undefined
    if (!channel || !sourceTs) {
      log.debug('onTurnStart: missing channel/sourceTs, skipping reaction')
      return
    }
    const token = await this.opts.getBotToken()
    if (!token) return
    await addReaction(token, channel, sourceTs, 'eyes')
  }

  /**
   * Lifecycle reaction: clear the eye and add a tick (ok) or cross (err).
   * Reactions are idempotent per (bot, message, emoji) so a retry on a
   * partial failure can't pile up duplicate icons.
   */
  async onTurnEnd(event: CanonicalEvent, result: { ok: boolean }): Promise<void> {
    const channel = event.context.channel as string | undefined
    const sourceTs = event.context.sourceTs as string | undefined
    if (!channel || !sourceTs) return
    const token = await this.opts.getBotToken()
    if (!token) return
    // Order: remove the in-progress marker first, then add the terminal
    // marker. If the remove fails (already gone, or the reaction was
    // never added because of a missing scope), the add still runs.
    await removeReaction(token, channel, sourceTs, 'eyes')
    await addReaction(token, channel, sourceTs, result.ok ? 'white_check_mark' : 'x')
  }

  private async stripMention(text: string): Promise<string> {
    const botUserId = this.opts.getBotUserId ? await this.opts.getBotUserId() : null
    if (botUserId) {
      const re = new RegExp(`<@${botUserId}>\\s*`, 'g')
      return text.replace(re, '').trim()
    }
    // Fallback: strip every leading <@Uxxx> mention (some clients send
    // duplicate mentions, autocomplete + typed, and mobile sometimes
    // injects a second one). Repeats until the prefix doesn't match
    // anymore so we mirror the global-replace behaviour above when we
    // can't filter on a specific bot user id. Slack user ids always
    // start with `U` (or `W` for workspace-shared bots), never raw
    // digits, so anchor on that to avoid matching unrelated
    // angle-bracket tokens.
    const re = /^<@[UW][A-Z0-9]+>\s*/
    let next = text
    while (re.test(next)) {
      next = next.replace(re, '')
    }
    return next.trim()
  }
}

interface SlackEventEnvelope {
  type?: string
  team_id?: string
  /** Workspace name is not always present on the envelope; read opportunistically. */
  team_domain?: string
  event_id?: string
  event?: {
    type: string
    subtype?: string
    bot_id?: string
    user?: string
    text?: string
    channel: string
    /** `im` = DM, `mpim` = group DM, `channel` = public, `group` = private. */
    channel_type?: string
    ts: string
    thread_ts?: string
    files?: SlackFile[]
  }
}

/**
 * Subset of the Slack file object we actually read. Full shape:
 * https://api.slack.com/types/file
 */
interface SlackFile {
  id: string
  name?: string
  title?: string
  mimetype?: string
  filetype?: string
  size?: number
  /** Auth-required download URL. Must be fetched with the bot token in Authorization. */
  url_private?: string
}

/**
 * Images Claude can actually see. PNG, JPEG, GIF, WebP — anything else
 * (HEIC, TIFF, SVG, PDF, etc.) is silently skipped in `parse()` with a
 * dropped-file log line. Keep this in sync with the model's supported
 * image mime types.
 */
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

/** Slack image attachment size cap — matches Anthropic's 5MB per-image limit. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Upload an image to Slack via the files.getUploadURLExternal +
 * files.completeUploadExternal flow (Slack deprecated the one-shot
 * files.upload endpoint in 2024; this is the new blessed path).
 *
 * Three steps:
 *   1. getUploadURLExternal → returns `upload_url` + `file_id`
 *   2. POST the raw bytes to upload_url (multipart/form-data)
 *   3. completeUploadExternal with `files: [{id, title}]` and
 *      `channel_id` + `thread_ts` to share it in-context
 *
 * We send the image into the same thread as the text reply so they
 * render as a pair. The image becomes a threaded bubble right after
 * the text one.
 *
 * This function throws on unrecoverable errors (missing scope, network
 * failure). The caller in reply() swallows these so one broken upload
 * doesn't sink the whole reply.
 */
async function uploadImageToSlack(args: {
  token: string
  channel: string
  threadTs: string | undefined
  image: OutboundImage
}): Promise<void> {
  const { token, channel, threadTs, image } = args
  const bytes = Buffer.from(image.data, 'base64')

  // 1. Get the upload URL.
  const filename = filenameForMime(image.mimeType, image.id)
  const step1Body = new URLSearchParams({
    filename,
    length: String(bytes.byteLength),
  })
  const step1 = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: step1Body.toString(),
  })
  const step1Data = (await step1.json()) as {
    ok: boolean
    error?: string
    upload_url?: string
    file_id?: string
  }
  if (!step1Data.ok || !step1Data.upload_url || !step1Data.file_id) {
    if (step1Data.error === 'missing_scope') {
      log.warn(
        { imageId: image.id },
        'files.getUploadURLExternal: missing_scope — bot needs `files:write`, reconnect the slack-bot connector',
      )
    }
    throw new Error(`files.getUploadURLExternal failed: ${step1Data.error ?? 'unknown'}`)
  }

  // 2. PUT (actually POST) the raw bytes to the ephemeral upload URL.
  //    Slack accepts either — POST is what their client libraries use.
  //    This endpoint does NOT take a bearer token; the URL is itself
  //    the credential and expires after a short window.
  const step2 = await fetch(step1Data.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': image.mimeType },
    body: bytes,
  })
  if (!step2.ok) {
    throw new Error(`upload PUT failed: ${step2.status} ${step2.statusText}`)
  }

  // 3. Complete the upload, sharing the file into the same channel/thread
  //    as the text reply. `initial_comment` would duplicate the text we
  //    already sent in reply(), so we leave it empty and rely on the
  //    threaded position to contextualise the image.
  const step3 = await fetch(`${SLACK_API}/files.completeUploadExternal`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      files: [{ id: step1Data.file_id, title: image.caption ?? 'screenshot' }],
      channel_id: channel,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  })
  const step3Data = (await step3.json()) as { ok: boolean; error?: string }
  if (!step3Data.ok) {
    throw new Error(`files.completeUploadExternal failed: ${step3Data.error ?? 'unknown'}`)
  }
  log.info({ imageId: image.id, channel }, 'slack image upload complete')
}

/** Guess a safe filename for the upload API. Slack uses this as the file title. */
function filenameForMime(mime: string, id: string): string {
  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/gif'
        ? 'gif'
        : mime === 'image/webp'
          ? 'webp'
          : 'jpg'
  return `${id}.${ext}`
}

/**
 * Call reactions.add on the source message. Errors are logged but never
 * thrown — decorative feedback must never block the real turn. Slack's
 * error vocabulary here is small and most are benign (`already_reacted`,
 * `no_reaction` on remove). A missing `reactions:write` scope shows up
 * as `missing_scope` and means the bot was OAuth'd before reactions were
 * a feature — surface that clearly so the fix is obvious.
 */
async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    const res = await fetch(`${SLACK_API}/reactions.add`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, timestamp, name }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok && data.error !== 'already_reacted') {
      if (data.error === 'missing_scope') {
        log.warn(
          { name, channel },
          'reactions.add: missing_scope — bot needs `reactions:write`, reconnect the slack-bot connector',
        )
      } else {
        log.warn({ name, channel, error: data.error }, 'reactions.add failed')
      }
    }
  } catch (err) {
    log.warn({ err, name, channel }, 'reactions.add threw')
  }
}

async function removeReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    const res = await fetch(`${SLACK_API}/reactions.remove`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, timestamp, name }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok && data.error !== 'no_reaction') {
      log.debug({ name, channel, error: data.error }, 'reactions.remove non-ok')
    }
  } catch (err) {
    log.debug({ err, name, channel }, 'reactions.remove threw')
  }
}

/**
 * Build the SurfaceInfo for this event, injected into the system prompt so
 * the model knows it's talking on Slack and formats accordingly.
 *
 * Uses the identity resolver to turn raw Slack IDs into human labels
 * on a best-effort basis. The resolver caches aggressively, so the
 * first message in a channel pays a few API calls and every
 * subsequent message is free until the TTL expires. Resolver
 * failures fall back to raw IDs without throwing — this is
 * decorative, not load-bearing.
 *
 * Lookups for channel, user, and team run in parallel: no reason to
 * serialise three independent REST calls.
 */
async function buildSlackSurface(
  body: SlackEventEnvelope,
  ev: NonNullable<SlackEventEnvelope['event']>,
  identity: SlackIdentityResolver,
): Promise<SurfaceInfo> {
  const channelType = ev.channel_type

  // Fire all three lookups in parallel. Any that fail return the raw
  // id, so the Promise.all resolves even when everything errors.
  const [channelLabel, userLabel, teamLabel] = await Promise.all([
    identity.getChannelLabel(ev.channel),
    ev.user ? identity.getUserLabel(ev.user) : Promise.resolve<string | null>(null),
    body.team_id ? identity.getTeamLabel(body.team_id) : Promise.resolve<string | null>(null),
  ])

  // Compose a natural-sounding label per channel type. DMs phrase it
  // as a conversation between the bot and the person; channels phrase
  // it as a location.
  const workspaceSuffix = teamLabel ? ` (workspace: ${teamLabel})` : ''
  const where =
    channelType === 'im'
      ? userLabel
        ? `Slack DM with ${userLabel}${workspaceSuffix}`
        : `Slack DM${workspaceSuffix}`
      : channelType === 'mpim'
        ? `Slack group DM ${channelLabel}${workspaceSuffix}`
        : `Slack channel ${channelLabel}${workspaceSuffix}`

  const details: Record<string, string> = {}
  if (channelType) details['channel type'] = channelType
  if (ev.thread_ts && ev.thread_ts !== ev.ts) {
    details.thread = 'reply inside an existing thread'
  } else {
    details.thread = 'start of a new thread (or toplevel message)'
  }
  // Keep the raw ids in details for debugging — if the model ever
  // needs to call a Slack tool it will need them, and the human
  // labels above cover the readability side.
  details['channel id'] = ev.channel
  if (ev.user) details['user id'] = ev.user
  if (body.team_id) details['team id'] = body.team_id

  return {
    kind: 'slack',
    label: where,
    userLabel: userLabel ?? undefined,
    format: 'slack-mrkdwn',
    details,
  }
}

function isSupportedImage(file: SlackFile): boolean {
  if (!file.url_private) return false
  if (!file.mimetype) return false
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.mimetype)) return false
  if (file.size !== undefined && file.size > MAX_IMAGE_BYTES) return false
  return true
}

/**
 * Hosts we're willing to send the bot token to. `url_private` comes
 * straight out of the inbound event payload, which is influenceable by
 * anyone who can post a file into a channel the bot watches. Without
 * this allowlist a crafted file object could trick us into firing the
 * `xoxb-` token at an attacker-chosen host — a one-shot bot-token
 * exfiltration. Slack serves file downloads from `files.slack.com` and
 * regional `*.files.slack.com` variants; nothing else gets the bearer.
 */
const SLACK_FILE_HOST_SUFFIXES = ['files.slack.com']

function isSlackFileHost(hostname: string): boolean {
  for (const suffix of SLACK_FILE_HOST_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true
  }
  return false
}

/**
 * Download a single Slack file and base64-encode it. Slack requires the bot
 * token in the Authorization header — a bare fetch of url_private returns
 * an HTML login page with 200 OK, so we also sanity-check the Content-Type
 * we actually got back and reject anything that isn't the image we asked for.
 *
 * Before attaching the bearer we hard-validate the URL host against the
 * allowlist above. This is the SSRF / token-leak guard — `url_private`
 * is attacker-influenceable and would otherwise let a crafted file
 * object redirect the bot token wherever it likes.
 */
async function fetchSlackFile(
  file: SlackFile,
  botToken: string,
): Promise<CanonicalImageAttachment | null> {
  if (!file.url_private || !file.mimetype) return null
  let parsed: URL
  try {
    parsed = new URL(file.url_private)
  } catch {
    log.warn({ fileId: file.id }, 'fetchSlackFile: url_private is not a valid URL, refusing')
    return null
  }
  if (parsed.protocol !== 'https:' || !isSlackFileHost(parsed.hostname)) {
    log.warn(
      { fileId: file.id, host: parsed.hostname, protocol: parsed.protocol },
      'fetchSlackFile: url_private host not on allowlist, refusing (potential token exfil attempt)',
    )
    return null
  }
  // `redirect: 'manual'` so a 30x can't smuggle the bearer to an
  // off-allowlist host. Slack file downloads are direct 200s in
  // practice; a redirect here is itself suspicious.
  const res = await fetch(file.url_private, {
    headers: { Authorization: `Bearer ${botToken}` },
    redirect: 'manual',
  })
  if (res.status >= 300 && res.status < 400) {
    log.warn(
      { fileId: file.id, status: res.status, location: res.headers.get('location') },
      'fetchSlackFile: unexpected redirect from Slack file host, refusing to follow',
    )
    return null
  }
  if (!res.ok) {
    log.warn({ fileId: file.id, status: res.status }, 'fetchSlackFile: non-2xx')
    return null
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    // Most common failure mode here is the bot token lacking `files:read`
    // scope — Slack responds with a 200 HTML login page instead of a 403,
    // which would otherwise get silently base64-encoded and shipped to the
    // model as a broken image.
    log.warn(
      { fileId: file.id, contentType },
      'fetchSlackFile: response is not an image (likely missing files:read scope)',
    )
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    log.warn(
      { fileId: file.id, sizeBytes: buf.byteLength, maxBytes: MAX_IMAGE_BYTES },
      'fetchSlackFile: image too large, skipping',
    )
    return null
  }
  return {
    id: file.id,
    name: file.name ?? file.title ?? `${file.id}.${file.filetype ?? 'bin'}`,
    mimeType: file.mimetype,
    data: buf.toString('base64'),
    sizeBytes: buf.byteLength,
  }
}
