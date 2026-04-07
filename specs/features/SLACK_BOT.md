# Slack: User Connector + Bot Connector + Proxy Fan-Out

## TL;DR

Slack is two separate connectors in Anton:

1. **`slack` (user)** — your personal delegate. Anton acts *as you*. One per
   user. Backed by an `xoxp-` user token. Used for searching messages,
   posting on your behalf, reading channels you belong to.
2. **`slack-bot` (Anton Bot)** — the workspace's Anton bot. Anton receives
   `@anton` mentions, replies in threads, posts under a custom display name.
   **Exactly one** Anton instance owns the bot install for a given Slack
   workspace at a time. Backed by an `xoxb-` bot token.

End users see two tiles in Connectors. Click → OAuth → done. They never touch
api.slack.com, never paste a webhook URL, never copy a signing secret.

A single developer-owned Cloudflare Worker (`oauth-proxy`) is the one Slack
Events URL for the entire Anton Slack app. It fans out incoming events to the
right Anton instance based on workspace ownership stored in KV.

## Why two connectors

Slack tokens come in two flavours and the agent-facing tools differ:

| | `xoxp-` (user) | `xoxb-` (bot) |
|---|---|---|
| Acts as | The installing human | The Anton app |
| `search.messages` | ✅ | ❌ (`not_allowed_token_type`) |
| `chat.postMessage` | as user | as bot, can `chat:write.customize` |
| Receives `@mention` events | ❌ | ✅ |
| Scope of read | only channels the user is in | only channels the bot is in |

The previous design merged both into a single tile and routed methods to the
right token internally. That broke the agent's mental model: a tool named
`slack_search` either worked or didn't depending on which token happened to
be present, and the agent couldn't tell the difference between "search isn't
installed" and "search is broken". Splitting into two connectors makes each
tool surface unambiguous: if `slack_search` exists in the toolset, it works.

It also reflects the actual product intent: "every company can have one
Anton computer for all the work-related stuff" (the bot install) plus "every
person can have their own Anton act on their behalf" (the user install).
Those are two different things and shouldn't share a tile.

## Token scopes

### `slack` (user) — `user_scope=` only

```
search:read           channels:read       channels:history
groups:read           groups:history      im:read
im:history            mpim:read           mpim:history
users:read            users:read.email    files:read
chat:write
```

### `slack-bot` — `scope=` only

```
app_mentions:read     channels:read       channels:history
groups:read           groups:history      im:read
im:history            mpim:read           chat:write
chat:write.customize  reactions:read      reactions:write
users:read            team:read           files:read
```

`chat:write.customize` lets the bot post under a per-message display name and
avatar — used by the SlackBotIdentityCard in the desktop UI to give each
Anton install its own bot persona without provisioning a fresh Slack app.

## Agent-facing tools

Both connectors share the same tool implementations (`packages/connectors/src/slack/tools.ts`)
but are filtered by mode:

| User tool (xoxp) | Bot tool (xoxb) | Slack method |
|---|---|---|
| `slack_list_channels` | `slack_bot_list_channels` | `conversations.list` |
| `slack_send_message` | `slack_bot_send_message` | `chat.postMessage` |
| `slack_get_history` | `slack_bot_get_history` | `conversations.history` |
| `slack_get_thread` | `slack_bot_get_thread` | `conversations.replies` |
| `slack_list_users` | `slack_bot_list_users` | `users.list` |
| `slack_search` | — (bot tokens get `not_allowed_token_type`) | `search.messages` |
| `slack_add_reaction` | `slack_bot_add_reaction` | `reactions.add` |

Each connector class holds a single-token `SlackAPI` instance. There's no
runtime per-method token routing — the connector that owns the API client
also owns the token type, and the toolset is built from that mode at
construction time.

```
SlackUserConnector  ──holds──▶  SlackAPI(xoxp)  ──tools──▶  [7 tools, slack_*]
SlackBotConnector   ──holds──▶  SlackAPI(xoxb)  ──tools──▶  [6 tools, slack_bot_*]
```

### Why the bot tools are renamed, not shared

Both connectors share `createSlackTools` (same execute bodies), but for
`mode: 'bot'` the factory rewrites every surviving tool's name from
`slack_X` to `slack_bot_X`. This is not cosmetic — it's what makes it safe
for both connectors to be active simultaneously.

`ConnectorManager` keys its runtime state by tool *name*, not by
`(connectorId, toolName)`:

- `getAllTools()` flattens every active connector's tools into a single
  array. Two tools with the same name and different execute bodies collide
  here, and most model providers either error on duplicates or pick one
  arbitrarily.
- `getToolPermission(toolName)` scans connectors linearly and returns the
  first match. Setting `slack_send_message: 'never'` on one connector would
  silently block the other if the names were identical.
- `session.beforeToolCall` looks up the permission by raw tool name before
  dispatching execution — same collision.

Giving the bot surface its own `slack_bot_*` prefix resolves all three at
the source: each tool is uniquely named, `getAllTools` returns a clean set,
and permissions belong to exactly one connector. The prefix is also
agent-legible — the model can tell immediately whether a tool acts as *you*
or as the *Anton bot*, which matters for channels the user isn't in or
messages attributed to the bot identity.

## OAuth proxy: one Slack app, many workspaces

The Anton Slack app is registered **once** by the developer at api.slack.com.
It has:

- One Events Request URL: `https://oauth.antoncomputer.in/_in/slack`
- One Redirect URL: `https://oauth.antoncomputer.in/oauth/slack-bot/callback`
  (and a separate one for the user flow at `…/slack/callback`)
- One signing secret stored as `SLACK_SIGNING_SECRET` on the Worker

Every Anton install in the world OAuths against this same Slack app. The
proxy is the only thing Slack ever talks to. The agent never talks to
api.slack.com directly (except for outbound `chat.postMessage` calls using
its own tokens).

This is what makes the end-user experience zero-config: there's nothing for
the user to set up, because the developer set it up once.

## Workspace ownership

For the user connector this is trivial: the proxy just forwards the access
token back to whichever agent kicked off the OAuth flow.

For the bot connector it's more interesting. **Slack only allows one bot
install per workspace per app.** If two Antons (Alice's and Bob's) both try
to install the bot in the same workspace, only one of them can "own" it —
i.e., be the one whose `/_anton/webhooks/slack-bot` receives the events.

Ownership lives in Cloudflare KV at `ws:<team_id>`:

```jsonc
{
  "agent_url":      "https://alice.antoncomputer.in",
  "forward_secret": "<32 random bytes, base64url>",
  "owner_label":    "Anton @ alice.antoncomputer.in",
  "bot_user_id":    "U0123…",
  "app_id":         "A0456…",
  "team_name":      "Acme Corp",
  "installed_at":   1700000000000
}
```

`forward_secret` is the per-install HMAC key the proxy uses to sign events
forwarded to the agent. The agent receives it once at OAuth time (in the
callback `metadata`), persists it in connector metadata, and uses it to
verify every inbound event. Rotating the secret on a re-install instantly
locks out the old owner.

### Conflict and transfer

When a second Anton OAuths the bot for a workspace that already has an
owner, the proxy refuses to silently overwrite. Instead:

1. Stash the install payload at `pending:<random-token>` (TTL 15 min).
2. 302 the user to `https://oauth.antoncomputer.in/_confirm/slack-bot/<token>`.
3. The user sees a styled HTML page:

   > **Transfer Slack workspace?**
   > The Slack workspace **Acme Corp** is currently connected to a different Anton instance.
   > **Currently owned by:** Anton @ alice.antoncomputer.in
   > **Transfer to:** Anton @ bob.antoncomputer.in
   > [Cancel]  [Transfer to this Anton]

4. On confirm, the proxy:
   - **Delete-before-process** consumes the pending payload (so a double-click
     can't double-transfer).
   - Atomically replaces `ws:<team_id>` with the new owner record.
   - Best-effort POSTs `/_anton/proxy/notify` to the *previous* owner with a
     `slack-bot.ownership-lost` payload, signed with the previous owner's
     forward_secret. Their UI drops the slack-bot tile.
   - Forwards the OAuth result to the *new* owner so its slack-bot connector
     activates with the fresh `forward_secret`.

If the previous owner is offline, no harm done — its forward_secret is now
stale, so even if Slack events somehow reach it directly, signature
verification fails and they get dropped.

## Inbound event flow

```
                    ┌────────────────────────────────────────────────┐
                    │ Slack workspace                                │
                    │   user types "@anton hey"                      │
                    └────────────────────┬───────────────────────────┘
                                         │ Events API
                                         ▼
              ┌───────────────────────────────────────────────────┐
              │  POST /_in/slack    (Cloudflare Worker)           │
              │  ─ verify x-slack-signature                       │
              │  ─ url_verification → echo challenge              │
              │  ─ KV dedup: evt:<team_id>:<event_id>             │
              │  ─ KV lookup: ws:<team_id>                        │
              │  ─ ack 200 to Slack synchronously                 │
              │  ─ waitUntil(forward to agent)                    │
              └────────────────────────┬──────────────────────────┘
                                       │ POST agent_url + /_anton/webhooks/slack-bot
                                       │ headers:
                                       │   x-anton-proxy-ts:  <unix>
                                       │   x-anton-proxy-sig: v1=base64(HMAC(secret, "v1:ts:body"))
                                       │   x-anton-team-id:   T...
                                       │ body: <verbatim Slack JSON>
                                       │ AbortSignal.timeout(5000)
                                       ▼
              ┌───────────────────────────────────────────────────┐
              │  Agent server  /_anton/webhooks/slack-bot         │
              │  → SlackWebhookProvider.verify()                  │
              │       reads forward_secret from connector metadata│
              │       HMAC-SHA256 over "v1:<ts>:<body>"           │
              │  → handleHandshake (in case proxy forwarded one)  │
              │  → 200 ack                                        │
              │  → parse → CanonicalEvent                         │
              │  → WebhookAgentRunner.run(event)                  │
              │  → reply via chat.postMessage with bot xoxb       │
              └───────────────────────────────────────────────────┘
```

Three independent verification layers, each with its own secret:

| Hop | Secret | Verifies |
|---|---|---|
| Slack → proxy | `SLACK_SIGNING_SECRET` (one, on the Worker) | Request came from Slack |
| Proxy → agent | `forward_secret` (per workspace install) | Request came from the proxy AND this workspace is still owned by us |
| Agent → proxy (`/_disconnect`) | same `forward_secret` | Disconnect request came from the legitimate current owner |
| Proxy → agent (`/_anton/proxy/notify`) | same `forward_secret` | Notification came from the proxy that originally minted our secret |

The agent **never sees Slack's signing secret**. It only sees its own
per-install forward_secret, which is meaningless to anyone else.

## Dedup

Slack retries events aggressively (within 3 seconds, then with exponential
backoff up to 1 hour). Two layers of dedup:

1. **Proxy KV** (`evt:<team_id>:<event_id>`, TTL 300s) — kills the >99% case
   even across Worker restarts and isolates tenants.
2. **Router LRU** (1024 entries, in-memory) — catches anything that slipped
   through during KV propagation lag.

KV is eventually consistent (~60s propagation), so the proxy dedup is
best-effort. The router LRU is the safety net.

## Disconnect flow

There are **two UI entry points** that can drop the slack-bot connector — the
generic "Disconnect" button on an OAuth connector tile and the explicit
"Remove" button on the connectors page. They MUST run the same teardown
sequence; otherwise the OAuth path leaves the workspace owned in the proxy
and live sessions keep the slack-bot tools.

This is enforced by having `handleConnectorOAuthDisconnect()` drop the stored
token first, then **delegate to** `handleConnectorRemove()`. There is no
separate cleanup path.

The full sequence (regardless of entry point):

1. `handleConnectorOAuthDisconnect` (if invoked) clears the encrypted token
   so no more outbound calls can be made, then calls `handleConnectorRemove`.
2. `handleConnectorRemove` notices `id === 'slack-bot'` and calls
   `notifyProxySlackBotDisconnect()`:
   - Reads `team_id` and `forward_secret` from connector metadata.
   - Computes `sig = base64url(HMAC(forward_secret, "<team_id>:<ts>"))`.
   - POSTs to `/_disconnect/slack-bot` with `{team_id, ts}` and
     `x-anton-agent-sig` header.
3. Proxy verifies the signature against the current `ws:<team_id>` record's
   forward_secret. If it matches, deletes the KV record. Future events for
   this workspace are silently dropped (and the proxy stops forwarding).
4. Local cleanup proceeds:
   - MCP teardown attempt (no-op for slack-bot, but uniform across types).
   - `connectorManager.deactivate('slack-bot')` drops the active client.
   - `connectorManager.setToolPermissions('slack-bot', undefined)` clears any
     persisted `never`/`ask` overrides so a fresh re-install starts clean.
   - `removeConnectorConfig` wipes the config row.
   - `invalidateSlackBotSecretCache()` drops the cached forward_secret.
   - `refreshAllSessionTools()` removes Slack tools from any in-flight
     session immediately.
   - `connector_removed` is pushed to the UI.

The disconnect proxy call happens **before** local cleanup so the agent can
still produce a valid signature. Once `forward_secret` is gone from local
metadata, the disconnect can never be sent.

### Why the OAuth-disconnect → remove delegation matters

Earlier the OAuth disconnect path only deleted the token + config row and
emitted `connector_removed`. It did **not** call `notifyProxySlackBotDisconnect`,
did **not** call `connectorManager.deactivate`, and did **not** call
`refreshAllSessionTools`. The visible failure modes were:

- The Slack workspace stayed owned by the now-disconnected Anton in the
  proxy KV. Re-installing from a different Anton hit the ownership-transfer
  flow instead of installing cleanly.
- Live agent sessions kept the slack-bot tools in their tool list and could
  still attempt outbound calls (which then 401'd because the token was gone).

Both UIs (`ConnectorsView.tsx`, `ConnectorsPage.tsx`) route OAuth connector
disconnects through the same `connector_oauth_disconnect` message, so the
delegation in the server fixes both call sites at once.

## Conflict resolution: ownership-lost

When the proxy transfers ownership to another Anton, it notifies the old
owner via `/_anton/proxy/notify`:

```http
POST /_anton/proxy/notify
content-type: application/json
x-anton-proxy-ts:  1700000123
x-anton-proxy-sig: v1=base64(HMAC(old_forward_secret, "v1:1700000123:<body>"))

{
  "type": "slack-bot.ownership-lost",
  "team_id": "T0123",
  "team_name": "Acme Corp",
  "new_owner_label": "Anton @ bob.antoncomputer.in",
  "ts": "1700000123"
}
```

The agent verifies the signature using its *own* forward_secret (the one the
proxy minted for *this* install). On match, it deactivates the slack-bot
connector, removes it from config, and pushes a `connector_removed` event to
the desktop so the tile disappears.

This is the only "remote-control" path the proxy has into the agent. It's
deliberately narrow:

- One signature scheme, scoped to the slack-bot install.
- One payload type (`slack-bot.ownership-lost`); unknown types are rejected.
- The agent always acks first, then does cleanup, so a slow agent never
  causes the proxy to retry.

## Persisted secrets

The slack-bot connector metadata holds these keys after install:

| Key | Source | Sensitive? |
|---|---|---|
| `team_id` | Slack OAuth response | no |
| `team_name` | Slack OAuth response | no |
| `bot_user_id` | Slack OAuth response | no |
| `app_id` | Slack OAuth response | no |
| `displayName` | user input via SlackBotIdentityCard | no |
| `iconUrl` | user input via SlackBotIdentityCard | no |
| `forward_secret` | proxy, at OAuth time | **yes** |

`forward_secret` is in `SENSITIVE_METADATA_KEYS` and is stripped from any
`connector_status` payload sent to the desktop. It lives only in
`~/.anton/config.json` and the in-memory connector record.

### Forward-secret hot-path cache

Inbound Slack events arrive frequently and `SlackWebhookProvider.verify()`
needs the forward_secret on every single one. Reading it through
`getConnectors(this.config).find(...)` per event was an O(n) scan in the hot
path, so the agent-server caches the resolved secret in
`slackBotSecretCache` and exposes it via `getSlackBotForwardSecret()`. The
cache is invalidated by `invalidateSlackBotSecretCache()`, which is called
from every lifecycle path that can change the value:

- `handleConnectorAdd` (id === 'slack-bot')
- `handleConnectorUpdate` (id === 'slack-bot')
- `handleConnectorToggle` (id === 'slack-bot')
- `handleConnectorRemove` (id === 'slack-bot')
- `handleOAuthComplete` (provider === 'slack-bot')
- `handleProxyNotify` after `slack-bot.ownership-lost` cleanup

Verification correctness still depends on HMAC, not on the cache: a stale
secret never accepts a forged event, it just rejects valid ones until the
next invalidation. Wiring the cache to *every* mutation path keeps that
window at zero in normal operation.

### Bot identity card target

The `SlackBotIdentityCard` in `ConnectorsView.tsx` is rendered only when
`id === 'slack-bot'` and writes its `displayName` / `iconUrl` metadata to
the **slack-bot** connector — not the user `slack` connector. Two reasons
this matters:

1. `chat:write.customize` is a bot-token capability. The display name and
   icon only have an effect on `chat.postMessage` calls made with the bot's
   `xoxb` token, which is owned by `SlackBotConnector`.
2. `SlackWebhookProvider.opts.getBotIdentity()` reads from
   `getSlackBotConnector()?.metadata`. Saving to the wrong id would silently
   no-op for bot replies and clobber the user connector's metadata if both
   were installed.

The bot's `xoxb` token is stored encrypted in the normal `TokenStore`
(`~/.anton/tokens/slack-bot.enc`), same as every other OAuth connector.

## What this avoids

- **No per-user Slack apps.** Everyone shares the developer's Anton app.
- **No webhook URL configuration.** Users never see or paste `/_in/slack`.
- **No shared signing secret on the agent.** Compromising one Anton install
  doesn't let an attacker forge events for other workspaces, because each
  install has its own forward_secret.
- **No silent overwrites.** Re-installing from a different Anton always
  prompts for explicit ownership transfer.
- **No agent-side multi-tenant routing.** The proxy already knows which
  Anton owns which workspace; the agent only ever sees its own traffic.

## Files

### Anton repo (`computer/`)

- `packages/agent-config/src/config.ts` — registry entries for `slack` and `slack-bot`
- `packages/connectors/src/slack/api.ts` — single-token `SlackAPI` HTTP client
- `packages/connectors/src/slack/tools.ts` — tool definitions, mode-filtered
- `packages/connectors/src/slack/index.ts` — `SlackUserConnector`, `SlackBotConnector`
- `packages/connectors/src/index.ts` — factories for both connectors
- `packages/agent-server/src/webhooks/providers/slack.ts` — `SlackWebhookProvider` (slack-bot slug)
- `packages/agent-server/src/server.ts`:
  - `startWebhooks()` — registers the provider
  - `handleProxyNotify()` — `/_anton/proxy/notify` route
  - `notifyProxySlackBotDisconnect()` — disconnect helper
  - `handleOAuthComplete()` — persists `forward_secret` to connector metadata
  - `SENSITIVE_METADATA_KEYS` — includes `forward_secret`
- `packages/desktop/src/components/connectors/ConnectorsView.tsx` —
  `SlackBotIdentityCard` (gated on `id === 'slack-bot'`)

### OAuth proxy (`huddle/connectors/oauth-proxy/`)

- `src/providers/slack.ts` — `slack` (user_scope) and `slackBot` (scope) configs
- `src/providers/types.ts` — `SLACK_STATE` KVNamespace, `SLACK_SIGNING_SECRET` env, `slack-bot` credential alias
- `src/slack-bot.ts` — KV helpers, `forward_secret` generation, HMAC sign/verify, Slack signature verify
- `src/index.ts`:
  - authorize: routes `slack` → `user_scope=`, `slack-bot` → `scope=`
  - callback: token extraction, KV ownership arbitration, conflict redirect
  - `POST /_in/slack` — Slack Events fan-out
  - `GET/POST /_confirm/slack-bot/:token` — ownership transfer page
  - `POST /_disconnect/slack-bot` — agent-initiated disconnect
- `wrangler.toml` — `SLACK_STATE` KV binding, `SLACK_SIGNING_SECRET` doc

## See also

- `specs/architecture/WEBHOOK_ROUTER.md` for the generic webhook provider
  pattern that the slack-bot provider plugs into.
- `specs/features/connectors.md` for the broader OAuth/MCP/API connector
  taxonomy.
