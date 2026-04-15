# Webhook Router & Provider Pattern

## Why this exists

Anton receives inbound traffic from many sources: Telegram bot updates, Slack
events, GitHub App webhooks, Linear webhooks, Discord interactions, scheduled
job triggers. Each source has its own signature scheme, payload shape, dedup
contract, and reply mechanism — but they all converge on the same downstream
behaviour: **resume (or create) a session, run the agent, send the reply
back through the same source**.

Before this pattern, each integration was its own bespoke HTTP handler in
`agent-server/src/server.ts` (`TelegramBotHandler`, `SlackBotHandler`, …),
each duplicating: raw-body collection, signature verification, immediate ack,
de-dup cache, session lookup, agent invocation, reply marshaling. Adding a
new bot meant copy-pasting ~300 lines and re-introducing the same bugs.

The Webhook Router collapses all of that into a single HTTP entry point and a
~80-line provider interface.

## Surface

```
POST /_anton/webhooks/{slug}
```

One URL, one router. Each provider mounts itself under a unique slug
(`telegram`, `slack-bot`, `github-app`, `linear`, …) and the router handles
everything else.

## Components

| Component | File | Responsibility |
|---|---|---|
| `WebhookProvider` interface | `agent-server/src/webhooks/provider.ts` | Per-source plug: verify, parse, reply, optional handshake |
| `CanonicalEvent` | `agent-server/src/webhooks/provider.ts` | Provider-agnostic event the runner consumes |
| `WebhookRouter` | `agent-server/src/webhooks/router.ts` | URL match, raw body, ack, dedup, dispatch |
| `WebhookAgentRunner` | `agent-server/src/webhooks/agent-runner.ts` | Session resume, agent execution, reply text |
| Provider implementations | `agent-server/src/webhooks/providers/{telegram,slack}.ts` | The thin source-specific code |

## Provider interface

```ts
interface WebhookProvider {
  readonly slug: string

  /** Optional one-shot handshake (e.g. Slack url_verification). */
  handleHandshake?(req: WebhookRequest): WebhookHandshakeResponse | null

  /** Verify request authenticity. May be async (some providers need a KV/DB lookup). */
  verify(req: WebhookRequest): Promise<boolean> | boolean

  /** Parse raw body into 0..N canonical events. */
  parse(req: WebhookRequest): Promise<CanonicalEvent[]> | CanonicalEvent[]

  /** Send a reply back to the originating source. */
  reply(event: CanonicalEvent, text: string): Promise<void>
}

interface CanonicalEvent {
  provider: string          // matches slug
  sessionId: string         // stable per conversation, e.g. "slack:T123:C456"
  deliveryId?: string       // for dedup; absent → no dedup
  text: string              // user-visible text the agent should respond to
  context: Record<string, unknown>  // opaque to router; only the same provider's reply() reads it
}
```

The interface is intentionally tiny:

- **`verify` may be async.** Some providers can compute the signature
  synchronously from a static secret (Telegram), but others need an async
  lookup — Slack-bot reads the per-install `forward_secret` out of connector
  metadata on every request so a disconnect is observed immediately.
- **`parse` returns a list.** A single delivery may carry zero (heartbeat),
  one (typical), or many (batched events) canonical events.
- **`context` is opaque.** Anything provider-specific (channel ID, thread ts,
  chat ID) lives here; only the same provider's `reply()` reads it. The
  router and runner never look inside.

## Router lifecycle (per request)

```
POST /_anton/webhooks/<slug>
        │
        ▼
1. Resolve provider by slug          → 404 if unknown
2. Collect raw body (signature schemes need byte-exact bytes)
3. handleHandshake?  ── yes ──▶ write response, return
        │ no
        ▼
4. verify()         ── false ──▶ 401, return
        │ true
        ▼
5. 200 {"ok":true}            (immediate ack — most providers retry on >5s)
        │
        ▼ (out-of-band)
6. parse() → CanonicalEvent[]
7. for each event:
     - dedup by deliveryId in LRU(1024)
     - WebhookAgentRunner.run(event) → reply text
     - provider.reply(event, text)
```

Three guarantees the router enforces:

1. **Always ack first.** Providers like Slack and GitHub retry on >3s
   timeouts and Anton's agent runs can take 30s+. Ack happens at step 5,
   before any agent work.
2. **Dedup is provider-agnostic.** A small in-memory LRU keyed by
   `deliveryId` covers the >99% case. Providers that need stronger guarantees
   (Slack-bot's proxy does cross-restart KV dedup) layer their own.
3. **Reply uses the same provider that parsed.** The runner never knows what
   "reply" means for Slack vs Telegram vs GitHub — it just hands the text
   back to `provider.reply(event, text)`.

## Agent runner

`WebhookAgentRunner` is shared by all providers. It owns:

- **Per-`sessionId` Session resumption.** Two messages from the same Slack
  channel resume the same conversation; two messages from different channels
  get isolated histories.
- **Per-session FIFO queue.** A second event for an in-flight session is
  queued behind it on a per-`sessionId` promise chain — agents aren't safe
  to run concurrently against the same `Session`, and dropping events meant
  silently losing user messages. Each queued event still gets its own awaited
  reply, so the router calls `provider.reply()` once per event in the order
  they arrived.
- **Bounded queue depth (`MAX_QUEUE_DEPTH = 5`).** A spammed channel can't
  grow memory unboundedly: new events past the cap are dropped with a
  `queue full, dropping event` warn log instead of joining the chain. Five
  is large enough to absorb normal bursts (a user firing three messages
  while the agent is mid-response) but small enough to bound the worst case.
- **Failure-tolerant chaining.** Both `then` callbacks on the previous tail
  are wired to start the next run, so a thrown agent run doesn't poison the
  queue and stall every subsequent event.
- **`<think>` sanitization.** The agent's internal thinking blocks never make
  it back to the source.
- **`refreshAllSessionTools()`** so newly-installed connectors are visible to
  in-flight conversations without restart.

The runner is the *only* code that touches `Session`/`AgentManager` from the
webhook side. Adding a new provider never requires touching it.

```
sessionId "slack:T123:C456"          chain entry { tail, depth }
                          ┌────────────────────────────────────────────┐
event A ──run()──▶ runOne(A) ──reply A──┐                              │
event B ──run()──▶ awaits A ─▶ runOne(B) ──reply B──┐                  │
event C ──run()──▶ awaits B ─▶ runOne(C) ──reply C──┘ depth → 0 → GC   │
                          └────────────────────────────────────────────┘
event D (depth ≥ 5)  ──▶  drop with warn log
```

## Adding a new provider

The full process for a new bot:

1. **Implement the interface** in `agent-server/src/webhooks/providers/<name>.ts`.
   Most providers fit in 100–150 lines (see `telegram.ts` as the canonical
   minimum example).
2. **Register it** in `WebhookServer.startWebhooks()` (server.ts) inside an
   `if (!this.<name>Provider)` block — `startWebhooks()` is idempotent and
   re-runs on connector activation.
3. **Done.** The URL `/_anton/webhooks/<slug>` works immediately. No router
   changes, no session-management code, no reply plumbing.

If the provider needs to register its webhook URL with the upstream service
(Telegram does, Slack-bot does not — see `SLACK_BOT.md`), expose a
`registerWebhook(publicUrl)` method on the provider class and call it from
`startWebhooks()` after registration.

## Why a single URL prefix

`/_anton/webhooks/{slug}` is a single mount point so:

- TLS, reverse proxy, and CORS rules need one entry, not N.
- Backwards-compat aliases for legacy URLs (`/_anton/telegram/webhook` →
  `/_anton/webhooks/telegram`) are a single line of `req.url = …` rewrite.
- `getPublicUrl()` produces `https://<host>/_anton/webhooks/` once and every
  provider derives its registration URL from it.

## What the router deliberately does NOT do

- **No persistent storage.** The dedup LRU is in-memory; cross-restart dedup
  is the provider's job (Slack-bot uses Cloudflare KV in the proxy).
- **No retry of agent work.** If `WebhookAgentRunner.run()` throws, the event
  is logged and the queue moves on. Sources retry on their own schedule.
  (A future deadletter file can persist failed events for user-driven retry —
  see the metrics/observability discussion in code review notes.)
- **No multi-tenant routing.** A single agent process owns one set of
  connectors; routing across multiple Antons (Slack-bot ownership) happens at
  the proxy layer, not here.

## End-to-end inbound flow (Slack-bot example)

```
                ┌──────────────────────────────────────────────┐
                │ Slack workspace                              │
                │   user @-mentions Anton in #general          │
                └──────────────────┬───────────────────────────┘
                                   │ Events API (HMAC w/ Slack signing secret)
                                   ▼
                ┌──────────────────────────────────────────────┐
                │ Cloudflare Worker  POST /_in/slack           │
                │  ─ verify x-slack-signature                  │
                │  ─ KV dedup  evt:<team>:<event_id>           │
                │  ─ KV lookup ws:<team> → owner agent_url     │
                │  ─ ack 200 to Slack                          │
                │  ─ waitUntil(forward → agent)                │
                └──────────────────┬───────────────────────────┘
                                   │ POST /_anton/webhooks/slack-bot
                                   │ HMAC w/ per-install forward_secret
                                   ▼
            ┌──────────────────────────────────────────────────┐
            │ Agent server                                     │
            │                                                  │
            │  WebhookRouter.tryHandle()                       │
            │   ├─ slug → SlackWebhookProvider                 │
            │   ├─ provider.handleHandshake?  (no)             │
            │   ├─ provider.verify()                           │
            │   │    ↳ getSlackBotForwardSecret() (cached)     │
            │   │    ↳ HMAC over "v1:<ts>:<body>"              │
            │   ├─ 200 ack {"ok":true}                         │
            │   ├─ provider.parse() → CanonicalEvent[]         │
            │   │    sessionId = "slack:<team>:<channel>"      │
            │   ├─ LRU dedup by event_id                       │
            │   └─ runner.run(event)  ── enqueues on chain     │
            │                                                  │
            │  WebhookAgentRunner                              │
            │   chains["slack:T:C"] = { tail, depth }          │
            │     ├─ awaits previous tail (FIFO)               │
            │     ├─ getOrCreateSession(sessionId)             │
            │     ├─ session.processMessage(text)              │
            │     │    ↳ beforeToolCall checks tool perms      │
            │     │      from BOTH mcpManager and              │
            │     │      connectorManager — 'never' blocks,    │
            │     │      'ask' routes through confirmHandler   │
            │     ├─ collect text events, sanitize <think>     │
            │     └─ return reply text                         │
            │                                                  │
            │  router.processEvent → provider.reply(event,txt) │
            │   ↳ chat.postMessage  (xoxb token, identity from │
            │     slack-bot connector metadata)                │
            └──────────────────────────────────────────────────┘
                                   │
                                   ▼
                            Slack thread reply
```

The same pipeline serves Telegram, GitHub, Linear, … — only the boxes
labeled `SlackWebhookProvider` and `chat.postMessage` change per provider.

## Files

- `packages/agent-server/src/webhooks/provider.ts` — interface + types
- `packages/agent-server/src/webhooks/router.ts` — `WebhookRouter`
- `packages/agent-server/src/webhooks/agent-runner.ts` — `WebhookAgentRunner`
- `packages/agent-server/src/webhooks/providers/telegram.ts` — minimal example
- `packages/agent-server/src/webhooks/providers/slack.ts` — proxy-mediated example

## See also

- `SLACK_BOT.md` for the Slack-specific dual-connector + proxy fan-out flow
  that the slack-bot provider plugs into.
- `connectors.md` for the broader connector model (OAuth, MCP, API types).
