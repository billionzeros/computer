/**
 * Slack identity resolver — lazy, bounded, TTL-cached lookups for
 * channel names, user display names, and workspace/team names.
 *
 * Why this exists:
 *   The surface prompt injected into every Slack session turn names the
 *   location Anton is replying in. Without a resolver that prompt shows
 *   raw IDs like `C0AQZ5B419V` / `U02V7RLA64C` / `T01FWAG6SSV`. Raw IDs
 *   work — the model can still tell sessions apart — but they read
 *   badly and make Anton sound like it's parsing Slack internals
 *   instead of talking in the room. This resolver turns them into
 *   `#eng` / `Om Gupta (@om)` / `Huddle01`.
 *
 * Why it's lazy (not eager):
 *   - First message in a channel pays a one-time ~3 API-call cost to
 *     populate all three caches. Every subsequent message is free.
 *   - If the bot token is revoked mid-flight we fail gracefully to
 *     raw IDs, the parse still succeeds, the turn still runs.
 *   - Parse() in a webhook handler has a short budget (the router wraps
 *     parse in a 10s timeout). Lazy lookups keep the happy path fast.
 *
 * Why it has a TTL (not forever-cached):
 *   - Channel renames happen (`#eng-old` → `#eng`). Users change their
 *     display names. The bot getting added to a new workspace is
 *     actually a new provider instance, so team name change is a
 *     non-event, but keep the TTL uniform.
 *   - TTL is 1 hour. Long enough that even a busy channel doesn't
 *     refetch, short enough that a rename shows up within reason.
 *
 * Why it's a separate file (not inline in slack.ts):
 *   slack.ts is already 500+ LOC and owns the inbound event pipeline.
 *   Keeping resolver concerns out of that file makes both easier to
 *   reason about.
 */

import { createLogger } from '@anton/logger'

const log = createLogger('slack-identity')

const SLACK_API = 'https://slack.com/api'
const TTL_MS = 60 * 60 * 1000 // 1 hour
/**
 * Hard cap per cache. Bounded to keep memory predictable on long-lived
 * processes; 1024 is plenty for realistic workspace sizes — no Slack
 * install has thousands of channels the bot is simultaneously being
 * @-mentioned in.
 */
const MAX_CACHE_ENTRIES = 1024
/**
 * Per-lookup timeout. The resolver runs inline in `parse()`, which the
 * router bounds to 10 s. Without a per-call cap, three slow Slack REST
 * calls (channel + user + team) could blow that budget and the whole
 * event would be dropped — including the agent run that depends on it.
 * Identity is decorative ("turn ids into pretty labels"), not
 * load-bearing — bias hard toward fast-failing to the raw id.
 */
const LOOKUP_TIMEOUT_MS = 1500

/**
 * Race a fetch against the per-lookup timeout. Aborts the underlying
 * request when the timer fires so we don't keep a stalled connection
 * open past the budget.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

interface CacheEntry<T> {
  value: T
  fetchedAt: number
}

export class SlackIdentityResolver {
  /**
   * The token getter is injected rather than the token itself so a
   * mid-flight reconnect (new bot token in the connector store) is
   * picked up on the next resolve without needing to rebuild the
   * resolver. The getter can return null when the connector is
   * disconnected; resolution then returns null for every lookup and
   * the surface falls back to raw IDs.
   */
  constructor(private getBotToken: () => Promise<string | null>) {}

  private channels = new Map<string, CacheEntry<string | null>>()
  private users = new Map<string, CacheEntry<string | null>>()
  /**
   * Team is per-workspace, so there's only ever one entry here in
   * practice — but keying on teamId keeps the same machinery working
   * if a future refactor consolidates resolvers across workspaces.
   */
  private teams = new Map<string, CacheEntry<string | null>>()

  /**
   * Return a human label for a channel, e.g. `#eng` (public), or
   * `private-eng` (private, without a leading `#`), or the raw id on
   * failure. `null` is never returned — callers can use the value
   * directly without a fallback dance.
   */
  async getChannelLabel(channelId: string): Promise<string> {
    const cached = readCache(this.channels, channelId)
    if (cached !== undefined) return cached ?? channelId

    const token = await this.getBotToken()
    if (!token) {
      writeCache(this.channels, channelId, null)
      return channelId
    }

    try {
      const res = await fetchWithTimeout(
        `${SLACK_API}/conversations.info?channel=${encodeURIComponent(channelId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        LOOKUP_TIMEOUT_MS,
      )
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        channel?: { name?: string; is_private?: boolean; is_im?: boolean }
      }
      if (!data.ok) {
        if (data.error === 'missing_scope') {
          log.warn(
            { channelId, error: data.error },
            'conversations.info: missing scope, falling back to raw id',
          )
        } else {
          log.debug({ channelId, error: data.error }, 'conversations.info: non-ok')
        }
        writeCache(this.channels, channelId, null)
        return channelId
      }
      const name = data.channel?.name
      if (!name) {
        writeCache(this.channels, channelId, null)
        return channelId
      }
      // Public channels render as `#name` the way humans talk about
      // them. Private channels technically render the same in Slack's
      // UI, but we prefix them differently so the prompt makes the
      // privacy state explicit to Anton without requiring a separate
      // `details` entry.
      const label = data.channel?.is_private ? `private #${name}` : `#${name}`
      writeCache(this.channels, channelId, label)
      return label
    } catch (err) {
      log.debug({ err, channelId }, 'conversations.info threw')
      writeCache(this.channels, channelId, null)
      return channelId
    }
  }

  /**
   * Return a human label for a user, e.g. `Om Gupta (@om)`. Falls back
   * to the raw id on failure. Uses `users.info`.
   */
  async getUserLabel(userId: string): Promise<string> {
    const cached = readCache(this.users, userId)
    if (cached !== undefined) return cached ?? userId

    const token = await this.getBotToken()
    if (!token) {
      writeCache(this.users, userId, null)
      return userId
    }

    try {
      const res = await fetchWithTimeout(
        `${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        LOOKUP_TIMEOUT_MS,
      )
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        user?: {
          name?: string
          real_name?: string
          profile?: { display_name?: string; real_name?: string }
        }
      }
      if (!data.ok) {
        log.debug({ userId, error: data.error }, 'users.info: non-ok')
        writeCache(this.users, userId, null)
        return userId
      }
      // Prefer profile.display_name (what users actively set), fall
      // back to real_name, fall back to name (the handle). Any of the
      // three produces a reasonable label.
      const display =
        data.user?.profile?.display_name || data.user?.profile?.real_name || data.user?.real_name
      const handle = data.user?.name
      const label = display && handle ? `${display} (@${handle})` : display || handle || null
      writeCache(this.users, userId, label)
      return label ?? userId
    } catch (err) {
      log.debug({ err, userId }, 'users.info threw')
      writeCache(this.users, userId, null)
      return userId
    }
  }

  /**
   * Return a human label for a workspace, e.g. `Huddle01`. Falls back
   * to the raw team id. Uses `team.info`. Cached aggressively because
   * team names change ~never.
   */
  async getTeamLabel(teamId: string): Promise<string> {
    const cached = readCache(this.teams, teamId)
    if (cached !== undefined) return cached ?? teamId

    const token = await this.getBotToken()
    if (!token) {
      writeCache(this.teams, teamId, null)
      return teamId
    }

    try {
      const res = await fetchWithTimeout(
        `${SLACK_API}/team.info`,
        { headers: { Authorization: `Bearer ${token}` } },
        LOOKUP_TIMEOUT_MS,
      )
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        team?: { name?: string; domain?: string }
      }
      if (!data.ok) {
        log.debug({ teamId, error: data.error }, 'team.info: non-ok')
        writeCache(this.teams, teamId, null)
        return teamId
      }
      // Prefer the human team name; fall back to the domain (e.g.
      // `huddle01.slack.com` → `huddle01`). Either is recognisable to
      // the model; the raw team id is not.
      const label = data.team?.name || data.team?.domain || null
      writeCache(this.teams, teamId, label)
      return label ?? teamId
    } catch (err) {
      log.debug({ err, teamId }, 'team.info threw')
      writeCache(this.teams, teamId, null)
      return teamId
    }
  }
}

/**
 * Cache read that enforces TTL — returns `undefined` on miss or
 * expiry, the stored value on a live hit. Note the distinction:
 * `undefined` means "look it up"; a stored `null` means "we already
 * tried and it failed, don't retry until TTL expires."
 *
 * On a hit we delete-then-set the entry to bump it to the tail of the
 * Map's insertion order, so the eviction in `writeCache` picks the
 * genuinely least-recently-*used* key instead of the least-recently-
 * inserted one. Without this, a hot key inserted early would always be
 * evicted before a cold key inserted later — backwards from what an
 * LRU should do.
 */
function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(key)
    return undefined
  }
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  // Delete-then-set so a refresh of an existing key moves it to the
  // tail (most-recently-used) end of the Map's insertion order, not
  // just updates in place. The eviction loop then drops genuine LRU
  // entries.
  cache.delete(key)
  cache.set(key, { value, fetchedAt: Date.now() })
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}
