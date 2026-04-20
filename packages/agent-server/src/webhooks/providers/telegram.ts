/**
 * Telegram webhook provider — migrated from the original telegram-bot.ts.
 *
 * Most of the original handler's complexity (sessions, dedup, ack timing,
 * sanitization) lives in the router + WebhookAgentRunner now. This file is
 * just: verify, parse, reply.
 */

import { listCommands } from '@anton/agent-core'
import { createLogger } from '@anton/logger'
import { toTelegramMd } from '../format/telegram-md.js'
import type {
  CanonicalEvent,
  CanonicalImageAttachment,
  InlineMenuOpts,
  InlineMenuRef,
  OutboundImage,
  SurfaceInfo,
  WebhookProvider,
  WebhookRequest,
} from '../provider.js'

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

  async parse(req: WebhookRequest): Promise<CanonicalEvent[]> {
    let update: TelegramUpdate
    try {
      update = JSON.parse(req.rawBody.toString('utf8')) as TelegramUpdate
    } catch (err) {
      log.warn({ err }, 'parse: invalid JSON body')
      return []
    }

    // Handle callback_query from inline keyboard button clicks.
    // These resolve pending interactions (plan approval, confirms).
    if (update.callback_query) {
      return this.parseCallbackQuery(update)
    }

    const msg = update.message
    if (!msg) {
      log.info({ updateId: update.update_id }, 'parse: update has no message, dropping')
      return []
    }

    // Handle photo messages — download the image and attach it.
    const hasPhoto = msg.photo && msg.photo.length > 0
    const text = (msg.text ?? msg.caption ?? '').trim()

    if (!text && !hasPhoto) {
      log.info({ updateId: update.update_id }, 'parse: update has no text or photo, dropping')
      return []
    }

    const chatId = msg.chat.id
    let attachments: CanonicalImageAttachment[] | undefined

    if (hasPhoto) {
      // Telegram sends multiple sizes; the last element is the largest.
      const largest = msg.photo![msg.photo!.length - 1]
      try {
        const attachment = await this.downloadPhoto(largest.file_id)
        if (attachment) {
          attachments = [attachment]
          log.info(
            { chatId, fileId: largest.file_id, sizeBytes: attachment.sizeBytes },
            'parse: downloaded photo attachment',
          )
        }
      } catch (err) {
        log.warn({ err, chatId, fileId: largest.file_id }, 'parse: failed to download photo')
      }
    }

    // If we still have no text and the photo download failed, drop.
    if (!text && !attachments?.length) {
      log.info({ chatId }, 'parse: no text and photo download failed, dropping')
      return []
    }

    log.info(
      {
        chatId,
        updateId: update.update_id,
        textBytes: text.length,
        hasPhoto,
        fromUsername: msg.from?.username,
      },
      'parse: canonical event',
    )

    return [
      {
        provider: this.slug,
        sessionId: `telegram-${chatId}`,
        deliveryId: `telegram-${update.update_id}`,
        text: text || '[image]',
        attachments,
        surface: buildTelegramSurface(msg),
        context: {
          chatId,
          messageId: msg.message_id,
          userId: msg.from?.id,
        },
      },
    ]
  }

  /**
   * Download a photo from Telegram using the getFile API.
   * Returns a CanonicalImageAttachment with base64-encoded bytes, or
   * undefined if the download fails.
   */
  private async downloadPhoto(fileId: string): Promise<CanonicalImageAttachment | undefined> {
    // Step 1: get the file path from Telegram.
    const fileRes = await fetch(`${TELEGRAM_API}/bot${this.token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    })
    if (!fileRes.ok) {
      log.warn({ status: fileRes.status }, 'getFile request failed')
      return undefined
    }
    const fileData = (await fileRes.json()) as {
      ok: boolean
      result?: { file_id: string; file_path?: string; file_size?: number }
    }
    if (!fileData.ok || !fileData.result?.file_path) {
      log.warn({ fileData }, 'getFile returned no file_path')
      return undefined
    }

    // Step 2: download the actual file bytes.
    const downloadUrl = `${TELEGRAM_API}/file/bot${this.token}/${fileData.result.file_path}`
    const dlRes = await fetch(downloadUrl)
    if (!dlRes.ok) {
      log.warn({ status: dlRes.status }, 'photo download failed')
      return undefined
    }
    const bytes = Buffer.from(await dlRes.arrayBuffer())
    const filePath = fileData.result.file_path
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'

    return {
      id: fileId,
      name: filePath.split('/').pop() ?? `photo.${ext}`,
      mimeType,
      data: bytes.toString('base64'),
      sizeBytes: bytes.byteLength,
    }
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────

  async onTurnStart(event: CanonicalEvent): Promise<void> {
    const chatId = event.context.chatId as number
    if (!chatId) return
    this.startTyping(chatId)
  }

  async onTurnEnd(event: CanonicalEvent, _result: { ok: boolean }): Promise<void> {
    const chatId = event.context.chatId as number
    if (!chatId) return
    // Stop typing — on success reply() already stops it, but on error
    // no reply is sent so we need to clean up here.
    this.stopTyping(chatId)
  }

  // ── Mid-turn messaging ─────────────────────────────────────────────

  /**
   * Send a mid-turn message (progress, prompts). Returns the message_id
   * as a string so it can be edited later.
   */
  async sendMessage(event: CanonicalEvent, text: string): Promise<string | undefined> {
    const chatId = event.context.chatId as number
    const formatted = toTelegramMd(text)
    const res = await this.telegramPostWithMdFallback('sendMessage', {
      chat_id: chatId,
      text: formatted || text,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      log.warn({ chatId, status: res.status, body: body.slice(0, 200) }, 'sendMessage failed')
      return undefined
    }
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } }
    return data.result?.message_id?.toString()
  }

  /**
   * Edit a previously sent message by message_id. Used for updating
   * progress messages in-place.
   */
  async editMessage(event: CanonicalEvent, messageId: string, text: string): Promise<void> {
    const chatId = event.context.chatId as number
    const formatted = toTelegramMd(text)
    const res = await this.telegramPostWithMdFallback('editMessageText', {
      chat_id: chatId,
      message_id: Number.parseInt(messageId, 10),
      text: formatted || text,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      log.warn(
        { chatId, messageId, status: res.status, body: body.slice(0, 200) },
        'editMessageText failed',
      )
    }
  }

  // ── Interactive prompts (inline keyboards) ──────────────────────

  /**
   * Send a confirmation prompt with an inline keyboard.
   */
  async sendConfirmPrompt(
    event: CanonicalEvent,
    interactionId: string,
    command: string,
    reason: string,
  ): Promise<void> {
    const chatId = event.context.chatId as number
    const text = `⚠️ *Confirmation required*\n\`\`\`\n${command}\n\`\`\`\n${reason}`
    await this.telegramPostWithMdFallback('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Allow', callback_data: `confirm_approve:${interactionId}` },
            { text: '❌ Deny', callback_data: `confirm_deny:${interactionId}` },
          ],
        ],
      },
    })
  }

  // ── Inline menus (button drill-downs) ───────────────────────────

  /** Build a Telegram inline_keyboard from generic MenuRow data. */
  private toInlineKeyboard(opts: InlineMenuOpts): {
    inline_keyboard: { text: string; callback_data: string }[][]
  } {
    return {
      inline_keyboard: opts.rows.map((row) =>
        row.map((b) => ({ text: b.label, callback_data: b.action })),
      ),
    }
  }

  /**
   * Send a stateless drill-down menu. Returns a ref so the runner can
   * editInlineMenu() the same message in response to button clicks.
   */
  async sendInlineMenu(event: CanonicalEvent, opts: InlineMenuOpts): Promise<InlineMenuRef | null> {
    const chatId = event.context.chatId as number
    const res = await this.telegramPostWithMdFallback('sendMessage', {
      chat_id: chatId,
      text: toTelegramMd(opts.body) || opts.body,
      reply_markup: this.toInlineKeyboard(opts),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      log.warn({ chatId, status: res.status, body: body.slice(0, 200) }, 'sendInlineMenu failed')
      return null
    }
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } }
    const messageId = data.result?.message_id
    if (!messageId) return null
    return {
      provider: this.slug,
      channelId: String(chatId),
      messageId: String(messageId),
    }
  }

  async editInlineMenu(ref: InlineMenuRef, opts: InlineMenuOpts): Promise<void> {
    if (ref.provider !== this.slug) return
    const chatId = Number(ref.channelId)
    const messageId = Number(ref.messageId)
    const res = await this.telegramPostWithMdFallback('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: toTelegramMd(opts.body) || opts.body,
      reply_markup: this.toInlineKeyboard(opts),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      log.warn(
        { chatId, messageId, status: res.status, body: body.slice(0, 200) },
        'editInlineMenu failed',
      )
    }
  }

  /**
   * Send a plan for approval with an inline keyboard.
   */
  async sendPlanForApproval(
    event: CanonicalEvent,
    interactionId: string,
    title: string,
    content: string,
  ): Promise<void> {
    const chatId = event.context.chatId as number
    // Telegram has a 4096 char limit — truncate plan content if needed.
    const truncated =
      content.length > 3500 ? `${content.slice(0, 3500)}…\n\n_(plan truncated)_` : content
    const text = `📋 *Plan: ${title}*\n\n${toTelegramMd(truncated)}\n\nReply *approve* or use the buttons below.`
    await this.telegramPostWithMdFallback('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `plan_approve:${interactionId}` },
            { text: '❌ Reject', callback_data: `plan_reject:${interactionId}` },
          ],
        ],
      },
    })
  }

  /**
   * Parse a callback_query from an inline keyboard button press. Returns
   * a synthetic CanonicalEvent that the router can use to resolve
   * the pending interaction via runner.resolveInteraction().
   *
   * We return a CanonicalEvent with special context fields so the router
   * knows to handle it as an interaction resolution rather than a normal message.
   */
  private parseCallbackQuery(update: TelegramUpdate): CanonicalEvent[] {
    const cq = update.callback_query!
    const chatId = cq.message?.chat?.id
    const data = cq.data
    if (!chatId || !data) {
      log.info('parseCallbackQuery: missing chatId or data, dropping')
      return []
    }

    // Answer the callback immediately to dismiss the loading spinner.
    this.answerCallbackQuery(cq.id).catch((err) => {
      log.debug({ err }, 'answerCallbackQuery failed (non-fatal)')
    })

    // ── Inline menu navigation (m:*) ─────────────────────────────────
    // Stateless drill-down for button menus (model picker, etc.).
    // We tag the synthetic event with menuAction + menuRef in context;
    // the router's interactive intercept dispatches to the runner's
    // handleMenuAction without going through the agent.
    if (data.startsWith('m:') && cq.message?.message_id) {
      log.info({ chatId, action: data }, 'parseCallbackQuery: menu nav')
      return [
        {
          provider: this.slug,
          sessionId: `telegram-${chatId}`,
          deliveryId: `telegram-cb-${update.update_id}`,
          text: '',
          context: {
            chatId,
            isCallbackQuery: true,
            menuAction: data,
            menuRef: {
              provider: this.slug,
              channelId: String(chatId),
              messageId: String(cq.message.message_id),
            } satisfies InlineMenuRef,
          },
        },
      ]
    }

    // Parse callback data: "action:interactionId"
    const [action, interactionId] = data.split(':')
    if (!action || !interactionId) {
      log.warn({ data }, 'parseCallbackQuery: invalid callback data format')
      return []
    }

    const approved = action.includes('approve')

    // Edit the original message to remove the inline keyboard and show decision.
    if (cq.message?.message_id) {
      const statusEmoji = approved ? '✅' : '❌'
      const statusLabel = approved ? 'Approved' : 'Rejected'
      const userName = cq.from?.first_name ?? 'User'
      // Remove the keyboard and append the decision.
      this.editMessageReplyMarkup(chatId, cq.message.message_id).catch((err) => {
        log.debug({ err }, 'editMessageReplyMarkup failed (non-fatal)')
      })
      // We don't edit the text since Telegram often rejects markdown re-parse.
      // Instead, send a short follow-up message with the decision.
      this.sendPlainText(chatId, `${statusEmoji} ${statusLabel} by ${userName}`).catch((err) => {
        log.debug({ err }, 'sendPlainText decision follow-up failed')
      })
    }

    log.info({ chatId, action, interactionId, approved }, 'parseCallbackQuery: resolved')

    // Return a synthetic event. The text carries the approval keyword so
    // the runner's parseApprovalText picks it up. The context includes
    // a flag so the router knows this is a callback resolution.
    return [
      {
        provider: this.slug,
        sessionId: `telegram-${chatId}`,
        deliveryId: `telegram-cb-${update.update_id}`,
        text: approved ? 'approve' : 'reject',
        context: {
          chatId,
          isCallbackQuery: true,
          interactionId,
        },
      },
    ]
  }

  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await fetch(`${TELEGRAM_API}/bot${this.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    })
  }

  private async editMessageReplyMarkup(chatId: number, messageId: number): Promise<void> {
    await fetch(`${TELEGRAM_API}/bot${this.token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    })
  }

  private async sendPlainText(chatId: number, text: string): Promise<void> {
    await fetch(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  }

  /**
   * POST to a Telegram method with `parse_mode: 'Markdown'`. If the API
   * returns a 400 mentioning "can't parse entities", retry the same
   * payload without `parse_mode` so the message still arrives as plain
   * text rather than being silently lost.
   */
  private async telegramPostWithMdFallback(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const url = `${TELEGRAM_API}/bot${this.token}/${method}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, parse_mode: 'Markdown' }),
    })
    if (res.status === 400) {
      const body = await res.text().catch(() => '')
      if (body.includes("can't parse entities")) {
        log.warn(
          { method, chatId: payload.chat_id },
          'Markdown parse failed, retrying without parse_mode',
        )
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      // Body already consumed — re-wrap so callers can still read it.
      return new Response(body, { status: 400, statusText: res.statusText })
    }
    return res
  }

  // ── Reply ─────────────────────────────────────────────────────────

  async reply(event: CanonicalEvent, text: string, images: OutboundImage[]): Promise<void> {
    const chatId = event.context.chatId as number
    // Whatever happens below, stop the keepalive first so we don't leak the
    // interval past the reply.
    this.stopTyping(chatId)

    // Transform CommonMark → Telegram legacy Markdown before splitting so
    // the chunk boundaries line up with the text that actually gets sent.
    // Transform-then-split also avoids accidentally cutting a heading
    // mid-rewrite.
    const formatted = toTelegramMd(text)
    if (formatted.length > 0) {
      const chunks = splitMessage(formatted, MAX_MESSAGE_LENGTH)
      log.info(
        { chatId, chunks: chunks.length, totalBytes: formatted.length, imageCount: images.length },
        'reply: sending text',
      )
      for (const [i, chunk] of chunks.entries()) {
        const res = await this.telegramPostWithMdFallback('sendMessage', {
          chat_id: chatId,
          text: chunk,
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
    }

    // Send each image as its own sendPhoto call. Telegram has a 1024-char
    // limit on the `caption` field, so we attach the (truncated) caption
    // when short enough and skip it otherwise — the text has already
    // shipped via sendMessage above and is the primary narration.
    for (const img of images) {
      try {
        await this.sendPhoto(chatId, img)
      } catch (err) {
        log.warn({ err, chatId, imageId: img.id }, 'sendPhoto failed, continuing')
      }
    }
    log.info({ chatId }, 'reply: done')
  }

  /**
   * Send a single image as a photo message. Uses multipart/form-data to
   * upload the raw bytes — Telegram also accepts a URL in the `photo`
   * field, but base64-to-multipart is the safer default because we don't
   * need the bytes to be publicly reachable.
   */
  private async sendPhoto(chatId: number, image: OutboundImage): Promise<void> {
    const bytes = Buffer.from(image.data, 'base64')
    const form = new FormData()
    form.append('chat_id', String(chatId))
    // Telegram caps caption at 1024 chars; anything longer would 400. The
    // full text has already been sent via sendMessage, so a trimmed label
    // is fine here.
    if (image.caption) {
      const caption =
        image.caption.length > 1024 ? `${image.caption.slice(0, 1021)}...` : image.caption
      form.append('caption', caption)
    }
    const ext = image.mimeType === 'image/png' ? 'png' : 'jpg'
    const blob = new Blob([new Uint8Array(bytes)], { type: image.mimeType })
    form.append('photo', blob, `${image.id}.${ext}`)

    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/sendPhoto`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      throw new Error(`sendPhoto ${res.status}: ${body.slice(0, 200)}`)
    }
    log.debug({ chatId, imageId: image.id, sizeBytes: bytes.byteLength }, 'sendPhoto ok')
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

  /**
   * Register slash commands with the Telegram Bot Commands menu.
   * Call once on startup — Telegram stores them server-side. Users see
   * autocomplete when typing `/` in the chat.
   */
  async registerCommands(): Promise<void> {
    const cmds = listCommands().map((c) => ({
      command: c.name,
      description: c.description,
    }))
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: cmds }),
      })
      const data = (await res.json()) as { ok: boolean; description?: string }
      if (data.ok) {
        log.info({ count: cmds.length }, 'Telegram bot commands registered')
      } else {
        log.warn({ description: data.description }, 'setMyCommands failed')
      }
    } catch (err) {
      log.warn({ err }, 'setMyCommands threw (non-fatal)')
    }
  }

  /** Register the webhook URL with Telegram. */
  async registerWebhook(publicUrl: string): Promise<void> {
    const webhookUrl = `${publicUrl}/_anton/webhooks/${this.slug}`
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
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

/**
 * Build the SurfaceInfo for a Telegram message. Short labels only —
 * the prompt injection is re-rendered on every turn, so long strings
 * show up in every system prompt.
 */
function buildTelegramSurface(msg: NonNullable<TelegramUpdate['message']>): SurfaceInfo {
  const chatType = msg.chat.type
  const userLabel = msg.from
    ? msg.from.username
      ? `${msg.from.first_name} (@${msg.from.username})`
      : msg.from.first_name
    : undefined
  const where =
    chatType === 'private'
      ? `Telegram DM${userLabel ? ` with ${userLabel}` : ''}`
      : `Telegram ${chatType} chat`
  const details: Record<string, string> = { 'chat type': chatType }
  if (msg.from?.id) details['user id'] = String(msg.from.id)
  return {
    kind: 'telegram',
    label: where,
    userLabel,
    format: 'telegram-md',
    details,
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  // Track an open code fence across chunk boundaries. Telegram's legacy
  // Markdown parser treats ` ``` ` as fenced-code-block delimiters; if a
  // chunk ends inside a fence, the renderer will either eat the rest of
  // the message as code or fail to parse and 400 the request. We close
  // the fence at the end of the outgoing chunk and re-open it at the
  // start of the next so each chunk is balanced on its own. The same
  // logic preserves the opening language tag (e.g. ` ```ts `) — we
  // remember it from the most recent unclosed fence and reuse it when
  // re-opening.
  let openFence: string | null = null // the exact opening line, e.g. "```ts"
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(openFence ? `${openFence}\n${remaining}` : remaining)
      break
    }
    // Prefer the latest newline, then the latest space, before falling
    // back to a hard cut. The previous version only accepted newlines
    // past the halfway mark, which produced mid-word breaks for long
    // unstructured paragraphs.
    let cutAt = remaining.lastIndexOf('\n', maxLen)
    if (cutAt < maxLen / 4) cutAt = remaining.lastIndexOf(' ', maxLen)
    if (cutAt < maxLen / 4) cutAt = maxLen
    else cutAt += 1 // include the delimiter in the previous chunk

    // Reserve room for a closing fence on this chunk and an opening
    // fence on the next, so neither pushes us over `maxLen`. The
    // worst-case overhead is `\n```\n` (5 bytes) + the open line
    // (`openFence.length + 1`). Recompute cutAt under the tighter
    // budget if needed.
    const reserve = openFence ? 5 + openFence.length + 1 : 0
    if (reserve > 0 && cutAt > maxLen - reserve) {
      const tightMax = maxLen - reserve
      let altCut = remaining.lastIndexOf('\n', tightMax)
      if (altCut < tightMax / 4) altCut = remaining.lastIndexOf(' ', tightMax)
      if (altCut < tightMax / 4) altCut = tightMax
      else altCut += 1
      cutAt = altCut
    }

    let head = remaining.slice(0, cutAt)
    // Update the open-fence state from the chunk we're about to emit.
    // Walk every fence in `head` to find the trailing parity: if we end
    // inside a fence, remember its opening line for the next chunk.
    const updated = updateFenceState(head, openFence)
    if (updated.endsOpen && updated.openLine) {
      // Close the dangling fence at the end of this chunk so Telegram
      // sees a balanced block, and re-open with the same language at
      // the start of the next.
      head = `${head.endsWith('\n') ? head : `${head}\n`}\`\`\``
      openFence = updated.openLine
    } else {
      openFence = null
    }
    chunks.push(head)
    remaining = remaining.slice(cutAt)
    if (openFence && remaining.length > 0) {
      // Prepend the re-opened fence to the next chunk so the renderer
      // continues the code block from where we cut.
      remaining = `${openFence}\n${remaining}`
    }
  }
  return chunks
}

/**
 * Walk every ` ``` ` line in `chunk` and return the resulting fence
 * state at the end of the chunk:
 *   - `endsOpen`: true if there's an unclosed fence at the end.
 *   - `openLine`: the exact opening fence line (e.g. "```ts") if
 *     `endsOpen` is true, so the next chunk can re-open with the same
 *     language tag. Falls back to a bare "```".
 *
 * Anchors on `^\`\`\`` lines, which is what Telegram's legacy Markdown
 * recognises. Inline ` ``` ` mid-line is ignored.
 */
function updateFenceState(
  chunk: string,
  inheritedOpen: string | null,
): { endsOpen: boolean; openLine: string | null } {
  let open = inheritedOpen
  const lines = chunk.split('\n')
  for (const line of lines) {
    if (!line.startsWith('```')) continue
    if (open) {
      // Closing the current fence. The closing line is just "```";
      // any text after the backticks on a closing line is non-standard
      // and we ignore it.
      open = null
    } else {
      // Opening a new fence. Remember the full line so we can repeat
      // the language tag on the next chunk.
      open = line.length > 3 ? line : '```'
    }
  }
  return { endsOpen: open !== null, openLine: open }
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name: string; username?: string }
    chat: { id: number; type: string; first_name?: string; username?: string }
    text?: string
    caption?: string
    photo?: {
      file_id: string
      file_unique_id: string
      width: number
      height: number
      file_size?: number
    }[]
    date: number
  }
  callback_query?: {
    id: string
    from: { id: number; first_name: string; username?: string }
    message?: {
      message_id: number
      chat: { id: number; type: string }
    }
    data?: string
  }
}
