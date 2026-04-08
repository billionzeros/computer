# Skills & Slash Commands

## TL;DR

Skills are reusable prompt templates with optional parameters, activated via
`/command` syntax in the desktop app. Slack and Telegram **do not** have skill
activation — messages starting with `/` are sent to the model as plain text.
The desktop skill system is entirely client-side; the server has a separate
YAML-based skill loader that is only used for scheduled/CLI skills.

## What is a skill

A skill is a **persona + prompt template + optional parameters**:

```typescript
{
  id: 'deploy-git',
  name: 'Deploy from Git',
  command: '/deploy',
  category: 'DevOps',
  icon: Rocket,
  description: 'Zero-downtime deployment from a git repository',
  prompt: 'Deploy the application from the git repository: {repo}. Branch: {branch}. Follow zero-downtime deployment practices.',
  parameters: [
    { name: 'repo', label: 'Repository URL', type: 'text', required: true },
    { name: 'branch', label: 'Branch', type: 'text' }
  ]
}
```

When activated, the `{placeholders}` are replaced with user-provided values
and the resulting prompt is sent to the agent as a user message in a **new
conversation**.

## Desktop flow (the only surface where skills work today)

```
User types "/" in ChatInput
       │
       ▼
ChatInput.handleChange()
  ├─ input.startsWith("/") → showSlashMenu = true
  └─ slashFilter = input.slice(1)
       │
       ▼
SlashCommandMenu renders
  ├─ filters skills by command + name (case-insensitive)
  ├─ arrow keys navigate, Enter selects, Escape closes
  └─ onSelect(skill) fires
       │
       ▼
ChatInput.handleSkillSelect(skill)
  ├─ clears input
  └─ onSkillSelect(skill) → opens SkillDialog
       │
       ▼
SkillDialog renders
  ├─ shows parameter form (text, select, boolean inputs)
  └─ on submit → executeSkill(skill, params)
       │
       ▼
executeSkill()  (packages/desktop/src/lib/skills.ts)
  ├─ replaces {placeholders} in prompt with param values
  ├─ strips unfilled placeholders
  ├─ creates new conversation via useStore.newConversation(skill.name)
  ├─ adds user message with the expanded prompt
  └─ connection.sendAiMessage(prompt)  → agent processes it
```

### Skill sources (desktop)

1. **Built-in skills** — 26 hardcoded skills in
   `packages/desktop/src/lib/skills.ts`, organized by category:
   DevOps, Security, Analysis, Data, System, Monitoring.
2. **Custom skills** — user-created, persisted in `localStorage` under
   `anton.customSkills`.

Both are merged and presented in the slash command menu.

### Key detail: skills never reach the server as skills

The desktop intercepts `/command` at the UI layer. By the time it reaches the
agent, it's just a regular prompt string like
`"Deploy the application from the git repository: github.com/user/repo..."`.
The agent has no concept of "this came from a skill".

## Server-side skill config (separate system)

`packages/agent-config/src/skills.ts` loads YAML skill files from
`~/.anton/skills/`:

```yaml
name: Server Monitor
description: Periodic health checks
prompt: |
  You are a server monitoring agent...
tools:
  - shell
  - network
schedule: '0 */6 * * *'
```

These are used for:
- **CLI**: `anton skills list`, `anton skills run <name>`
- **Scheduled skills**: cron-based execution via the scheduler

They are **not** surfaced in Slack or Telegram and are **not** the same skill
definitions as the desktop built-ins.

## Slack: no skill activation

When a user types `/deploy repo=foo` in Slack, the message flows through:

```
Slack Events API
  → oauth proxy (HMAC verify, fan-out)
    → /_anton/webhooks/slack-bot
      → SlackWebhookProvider.verify()  (forward_secret HMAC)
      → SlackWebhookProvider.parse()
        ├─ strips bot mention (<@U123>)
        ├─ extracts raw text — "/deploy repo=foo"
        └─ returns CanonicalEvent { text: "/deploy repo=foo", ... }
      → WebhookRouter dedup
      → WebhookAgentRunner.run()
        └─ session.processMessage("/deploy repo=foo")
          → model sees literal text, responds as best it can
```

There is **no skill lookup, no prompt template expansion, no parameter
extraction**. The model just sees the raw text.

### Additional constraint: channel filtering

Slack provider only accepts messages in:
- Direct messages (`im`, `mpim`)
- Active threads (where the bot already participated)

A standalone `/deploy` in a public channel (not in a thread, not a DM) is
**silently dropped** unless the bot was already in the thread.

## Telegram: no skill activation

Same story. Telegram natively shows `/command` as clickable blue text, but
Anton's `TelegramWebhookProvider.parse()` treats it as plain text:

```
Telegram webhook
  → /_anton/webhooks/telegram
    → TelegramWebhookProvider.verify()  (optional secret token)
    → TelegramWebhookProvider.parse()
      ├─ extracts msg.text — "/health"
      └─ returns CanonicalEvent { text: "/health", ... }
    → WebhookRouter dedup
    → WebhookAgentRunner.run()
      └─ session.processMessage("/health")
        → model sees literal text
```

No skill resolution. No parameter forms (obviously — it's a chat interface).

## Architecture summary

| Layer | Desktop | Slack | Telegram |
|-------|---------|-------|----------|
| **Slash detection** | ChatInput UI | None | None |
| **Skill lookup** | `findSkillByCommand()` | None | None |
| **Parameter UI** | SkillDialog form | None | None |
| **Prompt expansion** | `executeSkill()` | None | None |
| **What agent sees** | Expanded prompt text | Raw message text | Raw message text |
| **Conversation** | New per skill | Per-channel/thread session | Per-chat session |
| **Skill source** | Built-in + custom (localStorage) | N/A | N/A |

## Files

| File | What it does |
|------|-------------|
| `packages/desktop/src/lib/skills.ts` | Built-in skill definitions, custom skill CRUD, `executeSkill()` |
| `packages/desktop/src/components/chat/ChatInput.tsx` | Detects `/` input, triggers slash menu |
| `packages/desktop/src/components/chat/SlashCommandMenu.tsx` | Renders filtered skill list, keyboard navigation |
| `packages/desktop/src/components/skills/SkillDialog.tsx` | Parameter form, triggers execution |
| `packages/agent-config/src/skills.ts` | YAML skill loader, `buildSkillPrompt()`, scheduled skills |
| `packages/agent-server/src/webhooks/providers/slack.ts` | Slack event parsing (no skill detection) |
| `packages/agent-server/src/webhooks/providers/telegram.ts` | Telegram message parsing (no skill detection) |
| `packages/agent-server/src/webhooks/router.ts` | HTTP routing, verify, parse, dedup, dispatch |
| `packages/agent-server/src/webhooks/agent-runner.ts` | Session creation, `processMessage()`, response handling |

## See also

- `specs/features/SLACK_BOT.md` — Slack OAuth, proxy architecture, event flow
- `specs/architecture/WEBHOOK_ROUTER.md` — generic webhook provider pattern
- `specs/features/connectors.md` — broader connector taxonomy
