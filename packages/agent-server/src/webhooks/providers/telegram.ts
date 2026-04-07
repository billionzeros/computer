/**
 * Telegram webhook provider — migrated from the original telegram-bot.ts.
 *
 * Most of the original handler's complexity (sessions, dedup, ack timing,
 * sanitization) lives in the router + WebhookAgentRunner now. This file is
 * just: verify, parse, reply.
 */

import { createLogger } from '@anton/logger'
import type { CanonicalEvent, WebhookProvider, WebhookRequest } from '../provider.js'

const log = createLogger('telegram-webhook')

const TELEGRAM_API = 'https://api.telegram.org'
const MAX_MESSAGE_LENGTH = 4096
/**
 * Telegram's typing indicator expires ~5–6 seconds after the last
 * sendChatAction call. Re-send at 4s to give a safety margin.
 */
const TYPING_REFRESH_MS = 4000

export class TelegramWebhookProvider implements WebhookProvider {
  readonly slug = 'telegram'
  /**
   * Per-chat typing keepalive intervals. Started when we begin processing an
   * event and cleared when `reply()` runs (or when the next event for the
   * same chat replaces it). Tracked on the provider so the lifecycle is
   * observable and an orphaned interval can't leak past a restart.
   */
  private typingTimers = new Map<number, ReturnType<typeof setInterval>>()

  constructor(private token: string) {
    if (!token) {
      // Without a token, sendMessage POSTs to https://api.telegram.org/botsendMessage
      // which silently 404s — every reply would be a black hole. Refuse to
      // construct rather than register a broken provider.
      throw new Error('TelegramWebhookProvider requires a non-empty bot token')
    }
  }

  /**
   * Optional: Telegram lets you set a `secret_token` when registering the
   * webhook, which it then echoes back in the `X-Telegram-Bot-Api-Secret-Token`
   * header. We accept anything if no secret was configured.
   */
  verify(req: WebhookRequest): boolean {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!expected) {
      log.debug('verify: no secret configured, accepting all')
      return true
    }
    const got = req.headers['x-telegram-bot-api-secret-token']
    const ok = got === expected
    if (!ok) log.warn('verify: secret token mismatch')
    return ok
  }

  parse(req: WebhookRequest): CanonicalEvent[] {
    let update: TelegramUpdate
    try {
      update = JSON.parse(req.rawBody) as TelegramUpdate
    } catch (err) {
      log.warn({ err }, 'parse: invalid JSON body')
      return []
    }
    const msg = update.message
    if (!msg?.text) {
      log.info({ updateId: update.update_id }, 'parse: update has no text message, dropping')
      return []
    }

    const chatId = msg.chat.id
    const text = msg.text.trim()
    if (!text) {
      log.info({ chatId }, 'parse: empty text after trim, dropping')
      return []
    }

    log.info(
      {
        chatId,
        updateId: update.update_id,
        textBytes: text.length,
        fromUsername: msg.from?.username,
      },
      'parse: canonical event',
    )

    // Kick off the typing indicator immediately so the user sees feedback
    // during the model's first-token latency. Fire-and-forget; errors here
    // are non-fatal (a missing indicator doesn't break the reply path).
    this.startTyping(chatId)

    return [
      {
        provider: this.slug,
        sessionId: `telegram-${chatId}`,
        deliveryId: `telegram-${update.update_id}`,
        text,
        context: { chatId },
      },
    ]
  }

  async reply(event: CanonicalEvent, text: string): Promise<void> {
    const chatId = event.context.chatId as number
    // Whatever happens below, stop the keepalive first so we don't leak the
    // interval past the reply.
    this.stopTyping(chatId)

    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH)
    log.info({ chatId, chunks: chunks.length, totalBytes: text.length }, 'reply: sending')
    for (const [i, chunk] of chunks.entries()) {
      const res = await fetch(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable>')
        log.warn(
          { status: res.status, chatId, chunkIndex: i, body: body.slice(0, 200) },
          'sendMessage failed',
        )
      } else {
        log.debug({ chatId, chunkIndex: i, chunkBytes: chunk.length }, 'sendMessage ok')
      }
    }
    log.info({ chatId }, 'reply: done')
  }

  /**
   * Send a single typing indicator and schedule keepalives. Telegram's
   * chat_action expires after ~6s, so the original telegram-bot.ts re-fired
   * every 4s while the agent was thinking. That behaviour disappeared in
   * the webhook refactor; this reinstates it.
   *
   * A 2-minute hard cap guards against the runner crashing between parse()
   * and reply() — without it the interval would leak forever since nothing
   * else owns the lifecycle.
   */
  private startTyping(chatId: number): void {
    // Stop any previous timer for this chat — a second event in the same
    // chat effectively resets the keepalive schedule.
    this.stopTyping(chatId)
    this.sendChatAction(chatId).catch((err) => {
      log.debug({ err, chatId }, 'initial sendChatAction failed (non-fatal)')
    })
    const timer = setInterval(() => {
      this.sendChatAction(chatId).catch((err) => {
        log.debug({ err, chatId }, 'keepalive sendChatAction failed (non-fatal)')
      })
    }, TYPING_REFRESH_MS)
    this.typingTimers.set(chatId, timer)
    // Safety net: a stuck turn must not leak the interval.
    setTimeout(
      () => {
        if (this.typingTimers.get(chatId) === timer) {
          log.warn({ chatId }, 'typing keepalive exceeded 2min, force-stopping')
          this.stopTyping(chatId)
        }
      },
      2 * 60 * 1000,
    ).unref?.()
  }

  private stopTyping(chatId: number): void {
    const timer = this.typingTimers.get(chatId)
    if (timer) {
      clearInterval(timer)
      this.typingTimers.delete(chatId)
    }
  }

  private async sendChatAction(chatId: number): Promise<void> {
    await fetch(`${TELEGRAM_API}/bot${this.token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    })
  }

  /** Register the webhook URL with Telegram. */
  async registerWebhook(publicUrl: string): Promise<void> {
    const webhookUrl = `${publicUrl}/_anton/webhooks/${this.slug}`
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        ...(process.env.TELEGRAM_WEBHOOK_SECRET
          ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET }
          : {}),
      }),
    })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (data.ok) {
      log.info({ webhookUrl }, 'webhook registered')
    } else {
      log.error({ description: data.description }, 'webhook registration failed')
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    // Prefer the latest newline, then the latest space, before falling back
    // to a hard cut. The previous version only accepted newlines past the
    // halfway mark, which produced mid-word breaks for long unstructured
    // paragraphs.
    let cutAt = remaining.lastIndexOf('\n', maxLen)
    if (cutAt < maxLen / 4) cutAt = remaining.lastIndexOf(' ', maxLen)
    if (cutAt < maxLen / 4) cutAt = maxLen
    else cutAt += 1 // include the delimiter in the previous chunk
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt)
  }
  return chunks
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name: string; username?: string }
    chat: { id: number; type: string; first_name?: string; username?: string }
    text?: string
    date: number
  }
}
