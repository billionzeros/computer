/**
 * Unipile API client for LinkedIn operations.
 * Uses the Unipile unified API to interact with LinkedIn accounts.
 *
 * Auth: X-API-KEY header with Unipile access token.
 * Base URL: User's Unipile DSN (e.g., https://api1.unipile.com:13337)
 */

export interface UnipileAccount {
  id: string
  name?: string
  type: string
  status: string
  created_at?: string
}

export interface UnipileAccountList {
  items: UnipileAccount[]
}

export interface UnipileProfile {
  id: string
  account_id?: string
  provider?: string
  first_name?: string
  last_name?: string
  headline?: string
  public_identifier?: string
  profile_url?: string
  network_distance?: string
  location?: string
  industry?: string
  summary?: string
  company?: string
  position?: string
  profile_picture_url?: string
  connections_count?: number
  followers_count?: number
}

export interface UnipileChat {
  id: string
  account_id?: string
  provider?: string
  name?: string
  type?: string
  timestamp?: string
  unread_count?: number
  attendees?: Array<{
    id?: string
    name?: string
    provider_id?: string
  }>
}

export interface UnipileChatList {
  items: UnipileChat[]
  cursor?: string
}

export interface UnipileMessage {
  id: string
  chat_id?: string
  sender_id?: string
  text?: string
  timestamp?: string
  attachments?: Array<{
    id?: string
    type?: string
    name?: string
    url?: string
  }>
}

export interface UnipileMessageList {
  items: UnipileMessage[]
  cursor?: string
}

export interface UnipilePost {
  id: string
  author_id?: string
  text?: string
  created_at?: string
  likes_count?: number
  comments_count?: number
  shares_count?: number
  url?: string
}

export interface UnipileSearchResult {
  items: Array<{
    id?: string
    first_name?: string
    last_name?: string
    headline?: string
    public_identifier?: string
    profile_url?: string
    location?: string
    company?: string
    network_distance?: string
  }>
  cursor?: string
}

export interface UnipileInvitation {
  id?: string
  provider_id?: string
  name?: string
  headline?: string
  sent_at?: string
  status?: string
}

export class UnipileLinkedInAPI {
  private apiKey = ''
  private baseUrl = ''
  private accountId = ''

  setCredentials(apiKey: string, dsn: string, accountId?: string): void {
    this.apiKey = apiKey
    this.baseUrl = dsn.replace(/\/+$/, '')
    this.accountId = accountId ?? ''
  }

  setAccountId(accountId: string): void {
    this.accountId = accountId
  }

  getAccountId(): string {
    return this.accountId
  }

  private async request<T>(
    path: string,
    opts: {
      method?: string
      body?: Record<string, unknown>
      params?: Record<string, string>
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`)
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v)
      }
    }

    const res = await fetch(url.toString(), {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        'X-API-KEY': this.apiKey,
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Unipile API ${opts.method ?? 'GET'} ${path}: ${res.status} ${text}`)
    }

    return res.json() as Promise<T>
  }

  // ── Account management ──

  async listAccounts(): Promise<UnipileAccountList> {
    return this.request('/accounts')
  }

  async getAccount(id: string): Promise<UnipileAccount> {
    return this.request(`/accounts/${id}`)
  }

  // ── Profile ──

  async getMyProfile(): Promise<UnipileProfile> {
    return this.request('/profiles/me', {
      params: { account_id: this.accountId },
    })
  }

  async getProfile(profileId: string): Promise<UnipileProfile> {
    return this.request(`/profiles/${encodeURIComponent(profileId)}`, {
      params: { account_id: this.accountId },
    })
  }

  // ── Messaging ──

  async listChats(opts: { limit?: number; cursor?: string; account_id?: string } = {}): Promise<UnipileChatList> {
    return this.request('/chats', {
      params: {
        account_id: opts.account_id ?? this.accountId,
        ...(opts.limit ? { limit: String(opts.limit) } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    })
  }

  async getChat(chatId: string): Promise<UnipileChat> {
    return this.request(`/chats/${chatId}`)
  }

  async listMessages(
    chatId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<UnipileMessageList> {
    return this.request(`/chats/${chatId}/messages`, {
      params: {
        ...(opts.limit ? { limit: String(opts.limit) } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    })
  }

  async sendMessage(chatId: string, text: string): Promise<UnipileMessage> {
    return this.request(`/chats/${chatId}/messages`, {
      body: { text },
    })
  }

  async startChat(attendeeId: string, text: string): Promise<UnipileChat> {
    return this.request('/chats', {
      body: {
        account_id: this.accountId,
        text,
        attendees_ids: [attendeeId],
      },
    })
  }

  // ── LinkedIn Search ──

  async searchPeople(
    query: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<UnipileSearchResult> {
    return this.request('/linkedin/search', {
      method: 'POST',
      body: {
        account_id: this.accountId,
        api: 'classic',
        category: 'people',
        keyword: query,
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    })
  }

  // ── Invitations ──

  async listSentInvitations(): Promise<{ items: UnipileInvitation[] }> {
    return this.request('/profiles', {
      params: { account_id: this.accountId },
    })
  }

  async listReceivedInvitations(): Promise<{ items: UnipileInvitation[] }> {
    return this.request('/profiles/received', {
      params: { account_id: this.accountId },
    })
  }

  async sendInvitation(profileId: string, message?: string): Promise<unknown> {
    return this.request(`/linkedin/profiles/${encodeURIComponent(profileId)}/action`, {
      method: 'POST',
      body: {
        account_id: this.accountId,
        action: 'INVITE',
        ...(message ? { message } : {}),
      },
    })
  }

  // ── Posts ──

  async createPost(text: string): Promise<UnipilePost> {
    return this.request('/posts', {
      body: {
        account_id: this.accountId,
        text,
      },
    })
  }

  async getPost(postId: string): Promise<UnipilePost> {
    return this.request(`/posts/${postId}`)
  }

  async getPostComments(
    postId: string,
    opts: { limit?: number } = {},
  ): Promise<{ items: Array<{ id: string; text?: string; author_id?: string }> }> {
    return this.request(`/posts/${postId}/comments`, {
      params: {
        ...(opts.limit ? { limit: String(opts.limit) } : {}),
      },
    })
  }

  async commentOnPost(postId: string, text: string): Promise<unknown> {
    return this.request(`/posts/${postId}/comments`, {
      body: { text },
    })
  }

  async reactToPost(postId: string, reaction = 'LIKE'): Promise<unknown> {
    return this.request(`/posts/${postId}/reactions`, {
      body: { reaction_type: reaction },
    })
  }

  // ── InMail ──

  async getInMailBalance(): Promise<{ balance?: number }> {
    return this.request('/linkedin/inmail-balance', {
      params: { account_id: this.accountId },
    })
  }
}
