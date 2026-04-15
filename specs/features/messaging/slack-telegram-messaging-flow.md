# Slack & Telegram Messaging Flow

## How It Works (Plain English)

When someone messages Anton on Slack or Telegram, here's what happens end-to-end:

### The Message Journey

```
User sends "Deploy the staging server" in Slack
                    │
                    ▼
         ┌──────────────────┐
         │   Slack servers   │  Slack sends the message to our proxy
         └────────┬─────────┘
                  │
                  ▼
    ┌─────────────────────────┐
    │  OAuth Proxy (CF Worker) │  Verifies Slack's signature,
    │  oauth.antoncomputer.in  │  looks up which Anton instance
    │                          │  owns this Slack workspace,
    │  Routes:                 │  signs the request, forwards it
    │  /_in/slack (events)     │
    │  /_in/slack/interactivity│ ← button clicks come here
    └───────────┬──────────────┘
                │ HMAC-signed forward
                ▼
    ┌────────────────────────┐
    │  Anton Agent Server    │
    │  /_anton/webhooks/     │
    │    slack-bot/          │ ← events (messages)
    │    slack-bot/interact  │ ← button clicks
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │  WebhookRouter         │  Matches the URL slug to the
    │                        │  right provider (Slack/Telegram),
    │                        │  verifies signature, deduplicates,
    │                        │  acks immediately (Slack needs
    │                        │  200 within 3 seconds)
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │  WebhookAgentRunner    │  Gets or creates a Session for
    │                        │  this user/thread, feeds the
    │                        │  message to the AI, collects
    │                        │  the response
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │  SlackWebhookProvider  │  Formats the response as Slack
    │  .reply()              │  mrkdwn, posts in the thread,
    │                        │  uploads any images
    └────────────────────────┘
```

### What the User Sees

**1. Immediate feedback** — the moment Anton gets the message:
- Slack: 👀 `eyes` reaction on the message
- Telegram: "typing..." indicator

**2. Progress updates** — for long tasks (>3 seconds):
- A message appears in the thread showing what Anton is doing
- It edits itself as tasks complete, like a live status board:
  ```
  ✅ Analyzed codebase
  ⏳ Running tests...
  ⚪ Generating PR

  Step 2/3 | 45s elapsed
  ```

**3. Approval prompts** — when Anton needs permission:
- Dangerous commands (like `rm -rf`) show a confirmation with **Allow** / **Deny** buttons
- Plans show the full plan with **Approve** / **Reject** buttons
- If buttons aren't available, Anton asks in plain text and waits for "yes" or "no"
- 60-second timeout for confirms, 24 hours for plans

**4. Final response** — the actual reply:
- Slack: ✅ reaction replaces 👀, reply posted in thread
- Telegram: typing stops, reply sent as message

**5. Errors** — if something goes wrong:
- Slack: ❌ reaction + error message in thread explaining what happened
- Telegram: error message sent directly

### The Button Click Flow

When a user clicks "Approve" on a plan in Slack:

```
User clicks [Approve] button
        │
        ▼
Slack sends POST to /_in/slack/interactivity
        │
        ▼
OAuth Proxy verifies Slack signature, finds workspace,
signs + forwards to Anton
        │
        ▼
Router receives at /_anton/webhooks/slack-bot/interact
        │
        ▼
SlackWebhookProvider.handleInteraction() parses the
button click, edits the message to remove buttons
and show "✅ Approved by @user"
        │
        ▼
Runner.resolveInteraction() unblocks the session —
the AI continues executing the plan
```

Telegram uses inline keyboards and `callback_query` instead of Slack's interactivity URL — same concept, different transport.

### Text-Based Fallback

If buttons don't render (email notifications, third-party Slack clients), users can always reply with text:
- `yes`, `y`, `approve`, `ok`, `go`, `allow`, `confirm` → approve
- `no`, `n`, `reject`, `deny`, `cancel` → deny
- Anything else → treated as feedback (plan gets revised with the feedback)

---

## Architecture

### Components

| Component | Role |
|-----------|------|
| **OAuth Proxy** (Cloudflare Worker) | Receives webhooks from Slack, verifies origin, routes to correct Anton instance |
| **WebhookRouter** | HTTP entry point on Anton, dispatches to providers, handles dedup |
| **WebhookProvider** (interface) | Pluggable per-platform adapter (Slack, Telegram) |
| **WebhookAgentRunner** | Shared session/agent execution, interactive handler wiring, progress tracking |
| **SlackWebhookProvider** | Slack-specific: Block Kit messages, reactions, file uploads, interactivity handling |
| **TelegramWebhookProvider** | Telegram-specific: inline keyboards, typing indicators, callback queries |

### Key Files

```
packages/agent-server/src/webhooks/
├── agent-runner.ts      # Session management, interactive handlers, progress
├── router.ts            # HTTP dispatch, dedup, sub-path routing
├── provider.ts          # WebhookProvider interface definition
├── index.ts             # Barrel exports
└── providers/
    ├── slack.ts          # Slack Block Kit, reactions, interactivity
    └── telegram.ts       # Telegram API, inline keyboards, callback queries

# OAuth Proxy (separate repo)
connectors/oauth-proxy/src/routes/slack-bot.ts   # Slack event + interactivity forwarding
```

### Provider Interface

Every webhook provider implements this interface:

```typescript
interface WebhookProvider {
  slug: string                                    // URL path segment
  handleHandshake?(req): HandshakeResponse | null // Challenge responses
  verify(req): boolean                            // Signature check
  parse(req): CanonicalEvent[]                    // Raw → canonical events
  reply(event, text, images): void                // Send response

  // Lifecycle hooks
  onTurnStart?(event): void                       // 👀 reaction / typing
  onTurnEnd?(event, result): void                 // ✅/❌ reaction / stop typing

  // Mid-turn messaging (progress updates)
  sendMessage?(event, text): string               // Post, return message ID
  editMessage?(event, messageId, text): void      // Edit existing message

  // Interactive prompts (buttons)
  sendConfirmPrompt?(event, id, command, reason): void
  sendPlanForApproval?(event, id, title, content): void
  handleInteraction?(req): InteractionResult      // Button click handler
}
```

### Interactive Handler Flow

The runner wires three handlers on every webhook session:

1. **Confirm handler** — fires when a tool needs approval (e.g. shell command)
   - Posts prompt with Allow/Deny buttons (or text fallback)
   - Blocks session generator until response arrives
   - 60-second timeout → auto-deny

2. **Plan confirm handler** — fires when the agent creates a plan
   - Posts plan with Approve/Reject buttons (or text fallback)
   - Blocks session generator until response arrives
   - 24-hour timeout → auto-deny

3. **Ask user handler** — fires when the agent has questions
   - Posts numbered question list
   - Blocks until user replies with answers
   - 24-hour timeout → empty answers

When a user replies while a handler is blocking, `run()` intercepts the message and routes it to `resolveInteraction()` instead of creating a new agent turn.

### Security

- **Slack → Proxy**: Verified with Slack signing secret (HMAC-SHA256)
- **Proxy → Anton**: Signed with per-workspace `forward_secret` (HMAC-SHA256)
- **Telegram → Anton**: Verified with proxy signature (same HMAC scheme)
- **Body size limit**: 2 MiB max, enforced before signature verification
- **Parse timeout**: 10 seconds max to prevent hung lookups

### Rate Limiting

- Progress message edits throttled to 1 per 3 seconds (Slack/Telegram API limits)
- Trailing-edge timer ensures the final state is always sent
- Per-session queue depth capped at 5 to prevent memory exhaustion

---

## Slack App Configuration

In the Slack app settings (api.slack.com):

1. **Event Subscriptions** → Request URL:
   ```
   https://oauth.antoncomputer.in/_in/slack
   ```

2. **Interactivity & Shortcuts** → Request URL:
   ```
   https://oauth.antoncomputer.in/_in/slack/interactivity
   ```

3. **Bot Token Scopes** needed:
   - `chat:write` — send messages
   - `reactions:write` — add/remove reactions
   - `files:write` — upload images
   - `channels:history` — read messages for context

4. **Event Subscriptions** → Subscribe to bot events:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
   - `app_mention`

## Telegram Bot Configuration

Register the webhook URL with the Telegram Bot API:
```
POST https://api.telegram.org/bot{TOKEN}/setWebhook
{
  "url": "https://{agent-url}/_anton/webhooks/telegram",
  "allowed_updates": ["message", "callback_query"]
}
```

`callback_query` is required for inline keyboard button responses.

---

## Deploying the OAuth Proxy

The proxy is a Cloudflare Worker:

```bash
cd /path/to/connectors/oauth-proxy
npx wrangler deploy
```

That's it. Wrangler reads `wrangler.toml` for the worker name, routes, and KV bindings. The interactivity route (`/_in/slack/interactivity`) deploys alongside the existing events route — no separate deployment needed.

Make sure the `SLACK_SIGNING_SECRET` is set in the worker's environment (via `wrangler secret put SLACK_SIGNING_SECRET` if not already configured).
