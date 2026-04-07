/**
 * Typed Slack Web API client.
 * Makes direct HTTP calls — no MCP subprocess, no SDK dependency.
 *
 * Each instance holds a single token. Use one SlackAPI per connector class:
 * the user connector hands it an xoxp- token; the bot connector hands it an
 * xoxb- token. Method-level routing was removed in favour of two distinct
 * connectors so the agent sees clearly-scoped tools.
 */

const BASE_URL = 'https://slack.com/api'

export class SlackAPI {
  private token = ''
  private tokenProvider?: () => Promise<string>

  setToken(token: string) {
    this.token = token
  }

  setTokenProvider(fn: () => Promise<string>): void {
    this.tokenProvider = fn
  }

  private async resolveToken(): Promise<string> {
    return this.tokenProvider ? await this.tokenProvider() : this.token
  }

  private async call<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
    const token = await this.resolveToken()
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      throw new Error(`Slack API ${method}: HTTP ${res.status}`)
    }

    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) {
      throw new Error(`Slack API ${method}: ${data.error || 'unknown error'}`)
    }

    return data as T
  }

  // ── Auth ──

  async authTest(): Promise<{ team: string; team_id: string; user: string; user_id: string }> {
    return this.call('auth.test')
  }

  // ── Channels ──

  async listChannels(opts: { types?: string; limit?: number; cursor?: string } = {}): Promise<{
    channels: Array<{
      id: string
      name: string
      is_channel: boolean
      is_private: boolean
      topic: { value: string }
      purpose: { value: string }
      num_members: number
    }>
    response_metadata?: { next_cursor: string }
  }> {
    return this.call('conversations.list', {
      types: opts.types || 'public_channel,private_channel',
      limit: opts.limit || 100,
      cursor: opts.cursor,
      exclude_archived: true,
    })
  }

  // ── Messages ──

  async postMessage(
    channel: string,
    text: string,
    opts?: { thread_ts?: string; username?: string; icon_url?: string },
  ): Promise<{
    ts: string
    channel: string
  }> {
    return this.call('chat.postMessage', {
      channel,
      text,
      ...(opts?.thread_ts ? { thread_ts: opts.thread_ts } : {}),
      ...(opts?.username ? { username: opts.username } : {}),
      ...(opts?.icon_url ? { icon_url: opts.icon_url } : {}),
    })
  }

  async getHistory(
    channel: string,
    opts: { limit?: number; oldest?: string; latest?: string } = {},
  ): Promise<{
    messages: Array<{
      type: string
      user?: string
      text: string
      ts: string
      thread_ts?: string
      reply_count?: number
    }>
    has_more: boolean
  }> {
    return this.call('conversations.history', {
      channel,
      limit: opts.limit || 20,
      ...(opts.oldest ? { oldest: opts.oldest } : {}),
      ...(opts.latest ? { latest: opts.latest } : {}),
    })
  }

  async getReplies(
    channel: string,
    ts: string,
    opts: { limit?: number } = {},
  ): Promise<{
    messages: Array<{ user?: string; text: string; ts: string }>
    has_more: boolean
  }> {
    return this.call('conversations.replies', {
      channel,
      ts,
      limit: opts.limit || 50,
    })
  }

  // ── Users ──

  async listUsers(opts: { limit?: number; cursor?: string } = {}): Promise<{
    members: Array<{
      id: string
      name: string
      real_name: string
      is_bot: boolean
      deleted: boolean
      profile: { email?: string; display_name?: string }
    }>
    response_metadata?: { next_cursor: string }
  }> {
    return this.call('users.list', {
      limit: opts.limit || 100,
      cursor: opts.cursor,
    })
  }

  async getUserInfo(userId: string): Promise<{
    user: {
      id: string
      name: string
      real_name: string
      profile: { email?: string; display_name?: string; status_text?: string }
    }
  }> {
    return this.call('users.info', { user: userId })
  }

  // ── Search (user-token only — xoxp) ──

  async searchMessages(
    query: string,
    opts: { count?: number; sort?: string } = {},
  ): Promise<{
    messages: {
      total: number
      matches: Array<{
        channel: { id: string; name: string }
        username: string
        text: string
        ts: string
        permalink: string
      }>
    }
  }> {
    return this.call('search.messages', {
      query,
      count: opts.count || 20,
      sort: opts.sort || 'timestamp',
    })
  }

  // ── Reactions ──

  async addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    await this.call('reactions.add', { channel, timestamp, name })
  }
}
