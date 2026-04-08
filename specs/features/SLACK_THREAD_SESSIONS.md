# Slack: Thread-Scoped Sessions + Bot Tool Surface

Status: **approved**, partial implementation in flight. The thread
participation tracker, identity resolver, and per-thread session keys
are landed. Slack bot tool surface and OAuth UI work are still ahead.

This spec narrows a specific slice of `SLACK_BOT.md`: how Anton should map
Slack's channel/thread/DM structure onto its own Session identity, and what
Slack-specific tools Anton should have in its hand when it's replying
inside a Slack surface.

---

## 1. The problem the current code has

After the thread-followup fix that just landed, follow-up messages inside a
thread work — but the **session key is still per-channel**:

```ts
// slack.ts (current)
const sessionId = `slack:${body.team_id ?? 'unknown'}:${ev.channel}`
```

That means *every* thread in the same channel shares one Session object,
one message history, one memory store, and one compaction state. Three
distinct conversations in `#eng` — "can you deploy?", "debug this stack
trace", "what's for lunch?" — all collapse into one linear timeline. The
model sees a hallucinatorily-mixed history. Compaction decisions are made
on the blob of all three. Memory keys collide. It's bad.

The user's mental model is the right one: a Slack **thread** is a unit of
conversation. A Slack **channel** is a forum. A Slack **DM** is both.
Sessions should map to conversations, not to forums.

---

## 2. Proposed model

Three session shapes, one per surface mode:

| Slack context | Session key | Rationale |
|---|---|---|
| DM (`channel_type === 'im'`) or group DM (`channel_type === 'mpim'`) | `slack:dm:${teamId}:${channelId}:${threadRoot}` | **Per-thread, mirroring channels.** Each top-level DM message starts a new thread → new session. Follow-ups under that message resume the same session. Different top-level messages in the same DM are different conversations. Symmetry with channels means one mental model. `mpim` (group DM with the bot as a participant) follows the same rule — no `@mention` required, per-thread sessions. |
| Channel thread | `slack:thread:${teamId}:${channelId}:${threadRoot}` | Each thread is a distinct conversation. `threadRoot` is `thread_ts` if present, else the `ts` of the mentioning message. |
| Channel toplevel (no thread_ts) | **not a session** — the parser always creates a thread on the first reply by threading under the mentioning message, so every acknowledged mention *becomes* a thread. Toplevel messages the bot isn't mentioned in get dropped in `parse()`. | |

**Note on DM behavior change:** under the per-thread DM model, a user
who DMs Anton with three unrelated questions over the course of a day —
all as top-level messages — gets three separate sessions, none of which
remember the others. To carry context, the user must reply *inside* the
thread Anton creates. This is intentional and matches the channel model,
but it's a behavior change worth surfacing in onboarding so users
discover it without surprise. (Possible mitigation: a small "tip:
reply in this thread to keep context" hint on Anton's first DM reply.)

Note the `dm:` vs `thread:` discriminator in the key. It keeps the two
spaces from colliding on a `channelId` that happens to be a DM id in one
workspace and a channel id in another.

### Identity lifecycle in plain words

- **"@anton, you there?"** in `#eng` with no `thread_ts` → Slack event has
  `ts=T1`. We build sessionId `slack:thread:TEAM:ENG:T1`. There is no
  matching Session → `createSession()`. Bot replies `thread_ts=T1`.
  That's the thread root.
- User types in the same thread, no re-mention → `message` event,
  `thread_ts=T1`. Parser sees it's in an active thread (the existing
  tracker), builds sessionId `slack:thread:TEAM:ENG:T1`, finds the live
  Session, resumes it. Continuity.
- Parallel to this, another user in `#eng` does "@anton, different
  question" with no thread_ts → Slack event `ts=T2`. sessionId
  `slack:thread:TEAM:ENG:T2`. **Different session object**, fresh
  history, no cross-contamination. Runs in parallel to the T1 session
  (the existing per-session FIFO queue already handles concurrency per
  sessionId).
- In a DM, the user types a brand-new top-level message → Slack event
  `ts=T3`, no `thread_ts`. We build sessionId
  `slack:dm:TEAM:CHANNEL:T3`. Different from any prior top-level DM
  message → fresh session. Replies inside the thread Anton creates
  resume the same session. This mirrors the channel model exactly:
  per-thread, not per-channel. (See "Note on DM behavior change"
  above.) `mpim` group DMs follow the same `slack:dm:` rule.

### Why this is the right model

- **Memory isolation**: conversation memory and cross-conversation
  memory lookups are keyed on `session.id`. Per-thread sessions mean
  each thread gets its own memory without bleeding.
- **Compaction isolation**: the long-running `#eng` channel doesn't
  grow one monstrous compacted context. Each thread has its own
  budget, each thread compacts at its own pace.
- **Cross-thread parallelism**: the existing per-session FIFO queue in
  `agent-runner.ts` already serialises events for the same sessionId.
  Different sessionIds run in parallel. Two users asking Anton two
  different questions in two threads of the same channel will be
  handled concurrently under this model. Under the current model they
  queue serially because they share a sessionId.
- **Natural "context reset"**: the user's mental model of "start a new
  @mention, get a fresh Anton" is exactly what happens. No `/reset`
  command needed, no session-clear button.

### The user's phrase: "breaks your consciousness"

> *"you are gonna work until and unless no newer thread is created on
> the channel with a new anton tag, that breaks your conciousness and
> you drop in and work on the channel"*

Under the proposed model, nothing "breaks" — the old thread's session
stays alive exactly as long as it's being used. A *new* @mention that
creates a *new* thread spawns a **separate, parallel** session. The old
session is not torn down. It just isn't the one handling the new thread.
If the user goes back to the old thread and types a follow-up, it
resumes that thread's session as if nothing happened. Anton isn't
amnesic, it's multi-conscious.

(If you actually want "the old session dies when a new thread is
created in the same channel", that's a different design — a channel
holds at most one thread session at a time, and new mentions evict old
ones. I don't recommend it because it breaks the "go back to an old
thread and continue" flow. But it's a knob we could add. Flagging it
as an open question.)

---

## 3. Active-thread tracking — does it still exist?

Yes, but its role narrows. After this change:

- **Purpose**: distinguish "this is a follow-up in a thread Anton has
  already joined" from "this is random channel chatter." Still needed
  because Slack doesn't tag follow-ups as mentions.
- **Key**: stays `${channel}:${threadRoot}`.
- **Population**: same as now — registered on every accepted event,
  and on every bot_message echo for self-healing after a restart.
- **Additional invariant**: if an entry exists in `activeThreads`,
  there should be a Session on disk or in memory keyed by the
  corresponding thread sessionId. The map is effectively a fast index
  over "threads I have state for."

Alternative considered: **drop the in-memory map and just check
`sessions.has(sessionId)` or try `resumeSession`**. Cleaner but adds a
disk hit per inbound event (most of which are dropped anyway). Keep the
map.

---

## 4. Anton's Slack tool surface

Right now a Slack-session Anton has **the same toolset as a desktop
Anton**: shell, filesystem, browser, TodoWrite, etc. It has zero tools
that understand it's on Slack. Everything Slack-related routes through
the framework-level `reply()` path, which Anton doesn't see or control.

This is the first legit use case for **surface-filtered tool
registration**: a small set of Slack-specific tools that exist *only*
in Slack sessions and use the **bot token** (not the user-level slack
connector token).

### Proposed tools

| Tool | When Anton calls it | Implementation |
|---|---|---|
| `slack_reply` | Post a reply into the current thread. Normally the framework does this automatically at end-of-turn; this tool is for **progress updates mid-turn** ("working on it, will take a minute"), **multi-message replies**, or **status pings**. | `chat.postMessage` with `thread_ts` from session context. |
| `slack_post_in_channel` | Post a brand-new toplevel message into any channel the bot is in. E.g. "post a release summary to #eng". | `chat.postMessage` without `thread_ts`. |
| `slack_post_in_thread` | Post into a specific thread in a specific channel — not necessarily the current one. E.g. "reply to the deployment thread from earlier". | `chat.postMessage` with explicit `channel` + `thread_ts`. |
| `slack_edit_message` | Edit a message Anton previously posted. Lets the bot turn "thinking..." placeholders into real replies, or fix typos. | `chat.update`. Only allowed on bot-authored messages (Slack enforces). |
| `slack_react` | Add an emoji reaction to a message. Lets Anton ack silently, flag items, celebrate. Separate from the lifecycle reactions in `onTurnStart`/`onTurnEnd` which are framework-level. | `reactions.add`. |
| `slack_list_channels` | What channels is the bot a member of? | `conversations.list` with `types=public_channel,private_channel` filtered to `is_member=true`. |
| `slack_get_thread` | Read a thread's full reply history. Useful when Anton is asked "what's going on in the deploy thread?" | `conversations.replies`. |
| `slack_lookup_user` | Resolve a user id to a display name / email. | `users.info`. |

### Gating: surface-filtered registration

The tools are added to the session's toolset **only if**
`surface?.kind === 'slack'`. Implementation is a small conditional in
`buildTools()` (or in a new helper that wraps it), driven by the
`surface` field we already plumb into `createSession`. This is the
first non-hypothetical caller of "filter tools by surface" — before
now there was nothing to filter, so the filter didn't exist.

### Credential: bot token, not user token

All of these use the `xoxb-` bot token from the `slack-bot` connector
install for the workspace the session belongs to. They are *not* the
same tools as the `slack_*` tools from the user-level `slack`
connector (which use the installing user's `xoxp-` token). If a
workspace has both connectors installed, the session sees the
bot-flavored tools — the user tools remain available in desktop
sessions only.

This implies the tools need a way to resolve "which workspace am I in?"
at call time. That's the `teamId` already in `event.context` and soon
in the session key. Stash it on the Session or pull it from the
sessionId parse.

### Non-tools that stay framework-level

Two things should stay automatic and not become tools:

1. **Lifecycle reactions** (`👀 → ✅/❌`). These target the *source*
   message and are timing-sensitive to turn start/end. They must not
   wait for the model to decide to emit a tool call. Framework-level,
   in `onTurnStart`/`onTurnEnd`.
2. **The end-of-turn reply itself**. If the model just emits text, the
   framework posts it to the current thread. No tool call required.
   `slack_reply` exists as an *opt-in* alternative for mid-turn
   updates, not as a replacement for the default reply path.

---

## 5. Implementation plan (after approval)

Four commits, each independently shippable:

1. **Switch session key scheme** — change the `sessionId` construction
   in `slack.ts` parse() to the new `slack:dm:...` / `slack:thread:...`
   format. One-line change plus a few log updates. **Breaking for any
   in-flight per-channel sessions** — they become orphans on disk. I'd
   add a comment and ship (there's nothing worth keeping in those
   corrupted-context sessions).
2. **Surface-filtered tool registration** — in `agent-core/src/agent.ts`
   `buildTools()`, add a Slack branch that appends the bot-flavored
   tools when `surface?.kind === 'slack'`. Plumb the bot token getter
   + teamId through to each tool. The tools themselves are ~30 LOC
   each.
3. **The tool implementations** — roughly one file per tool group
   under `packages/agent-core/src/tools/slack/`. Use the Slack Web API
   directly (the existing user-side slack connector has a client we
   can factor out or reimplement per the monorepo's conventions).
4. **Identity resolver** (lazy cache of channel/user/team names) — to
   make the surface prompt show `#eng` / `Huddle01` / `@om` instead of
   raw IDs. This is being **shipped in this same turn** as a separate
   change, ahead of the session-scheme work, because it's small and
   orthogonal. See `buildSlackSurface` in `slack.ts`.

---

## 6. Decisions (locked)

1. **Parallel sessions, not killed.** A new @mention in the same
   channel spawns a parallel session. The old thread's session stays
   alive. Anton operates on multiple threads concurrently. Going back
   to an old thread and typing a follow-up resumes its session
   seamlessly. "It's a computer, it can work in parallel."
2. **Per-thread DMs.** DM messages key on `threadRoot` like channel
   messages do. New top-level DM message → new session. Follow-ups
   inside the thread Anton creates → same session. See note above.
3. **Slack bot tools live in `packages/connectors/src/slack/`** (the
   existing connector module), extended with new tools. Not moved to
   `agent-core/src/tools/`. Reasoning: the tools already exist there
   today, the credential lifecycle (OAuth, token refresh, disconnect)
   is connector-layer concern, and moving them would require
   re-implementing or cross-importing that machinery. The fix for
   "desktop sees Slack bot tools" is a small `surfaces?: string[]`
   filter on `ConnectorManager.getAllTools(surface)`, not a relocation.
4. **Session eviction** — deferred. Revisit when we have real
   multi-month workspace data showing the disk pattern.
