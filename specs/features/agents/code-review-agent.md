# Code Review Agent — Spec

> **Status:** Design
> **Depends on:** Event triggers (new), GitHub webhook handler (new), PR review API tools (new), Workflow system (implemented)

## Overview

A workflow that automatically reviews pull requests when Anton is tagged (`@anton review`) or when a PR is opened/updated on configured repos. Anton reads the diff, analyzes the code for bugs, style issues, security problems, and performance concerns, then posts inline review comments directly on the PR.

**Key difference from lead-qualification:** This workflow is **event-triggered** (GitHub webhooks), not cron-scheduled. This requires a new trigger type in the workflow system.

---

## What Already Exists

The GitHub App infrastructure is **already built**:

| Component | Status | Where |
|-----------|--------|-------|
| GitHub App registration | Done | github.com/settings/apps |
| JWT signing + installation tokens | Done | `huddle/connectors/oauth-proxy/src/github-app.ts` |
| OAuth proxy install flow | Done | `huddle/connectors/oauth-proxy/src/index.ts` (lines 63-66, 293-339) |
| Token refresh (installation_id → new token) | Done | `huddle/connectors/oauth-proxy/src/index.ts` (lines 443-459) |
| GitHub API client (App-aware) | Done | `packages/connectors/src/github/api.ts` — uses `/installation/repositories`, falls back to `/app` |
| GitHub connector + tools | Done | `packages/connectors/src/github/` — repos, issues, PRs, branches, files, search |
| Connector config in registry | Done | `packages/agent-config/src/config.ts` — `id: 'github'`, `type: 'oauth'`, `oauthProvider: 'github'` |

**How it works today:**
1. User clicks "Connect GitHub" → Anton redirects to OAuth proxy
2. Proxy redirects to `github.com/apps/{GITHUB_APP_SLUG}/installations/new`
3. User installs App on repos/org → GitHub sends back `installation_id`
4. Proxy generates installation access token via JWT (RS256) using App's private key
5. Token sent to Anton agent server, `installation_id` stored as `refresh_token`
6. On expiry (1hr), Anton calls proxy's `/oauth/github/refresh` → new token from same `installation_id`

**The App already has an identity** — when it posts comments/reviews, they show as the App bot account. Users can already @mention the App's bot account in GitHub.

---

## What Needs to Be Built

### 1. GitHub Webhook Handler (`/_anton/github/webhook`)

**The App can already send webhooks** — we just need an endpoint to receive them. The webhook URL is configured in the GitHub App settings.

Mirrors the existing Telegram webhook pattern (`telegram-bot.ts`):

**File:** `packages/agent-server/src/github-webhook.ts`

```
POST /_anton/github/webhook
  │
  ├─ Verify signature (HMAC-SHA256 using webhook secret)
  │   Header: X-Hub-Signature-256
  │   Verify: hmac('sha256', webhookSecret, rawBody) === signature
  │
  ├─ Parse event type from X-GitHub-Event header
  ├─ Parse JSON payload
  │
  ├─ pull_request (action: opened | synchronize | review_requested)
  │   ├─ Check: is this repo configured for auto-review?
  │   ├─ Extract: owner, repo, pr_number, head_sha, sender
  │   ├─ Skip if sender is the App itself (avoid self-review loops)
  │   └─ Dispatch to review agent
  │
  ├─ issue_comment (action: created)
  │   ├─ Check: is this comment on a PR? (payload.issue.pull_request exists)
  │   ├─ Check: does comment body mention the App bot? (@app-slug or app bot login)
  │   ├─ Parse command from mention (e.g. "@anton review", "@anton review security", "@anton lgtm?")
  │   └─ Dispatch to review agent with command context
  │
  └─ Respond 200 immediately, process async (same as Telegram pattern)
```

**Webhook secret storage:** The webhook secret needs to be stored in the agent server config. Two options:
- **Option A:** Store in `config.yaml` alongside other connector config (e.g. `github.webhookSecret`)
- **Option B:** Store as env var on the OAuth proxy and have the proxy forward/validate — but this adds latency. Better to have the agent server verify directly.

→ **Decision: Option A** — store `webhookSecret` in agent server config. The bootstrap conversation collects it during setup.

**Server integration** in `server.ts`:

```typescript
// In the HTTP request handler (where Telegram webhook already lives, line ~286)
if (req.method === 'POST' && req.url === '/_anton/github/webhook') {
  if (this.githubWebhook) {
    this.githubWebhook.handle(req, res)
  }
  return
}
```

**Constructor pattern** (mirrors TelegramBotHandler):

```typescript
export class GitHubWebhookHandler {
  constructor(opts: {
    webhookSecret: string
    config: AgentConfig
    mcpManager: McpManager
    connectorManager: ConnectorManager
    onEvent: (event: GitHubWebhookEvent) => Promise<void>
  })

  handle(req: IncomingMessage, res: ServerResponse): void
}
```

### 2. Event Trigger System

Extend the workflow trigger type to support webhook events:

```typescript
// In WorkflowManifest.trigger (packages/protocol/src/workflows.ts)
trigger: {
  type: 'schedule' | 'manual' | 'event'
  schedule?: string
  event?: {
    source: 'github'                    // extensible later (slack, linear, etc.)
    events: string[]                     // ['pull_request.opened', 'issue_comment.created']
    filter?: Record<string, string>      // optional, e.g. { action: 'opened|synchronize' }
  }
  description?: string
}
```

**Event dispatch flow:**

```
Webhook arrives at agent server
  │
  ├─ GitHubWebhookHandler verifies + parses
  ├─ Emits event: { source: 'github', event: 'pull_request.opened', payload: {...} }
  │
  ├─ Server looks up installed workflows with trigger.type === 'event'
  │   AND trigger.event.source === 'github'
  │   AND trigger.event.events includes 'pull_request.opened'
  │
  ├─ For each matching workflow:
  │   ├─ Find the workflow's agent(s)
  │   ├─ Inject event payload into agent context as a structured block:
  │   │   <github-event type="pull_request" action="opened">
  │   │     repo: billionzeros/computer
  │   │     pr: #42 "Add dark mode support"
  │   │     author: contributor123
  │   │     head: feature/dark-mode → main
  │   │     files_changed: 8
  │   │     additions: 234, deletions: 45
  │   │   </github-event>
  │   └─ Run agent (same as AgentManager.runAgent but with event context instead of cron)
  │
  └─ Done
```

**Key detail:** The agent needs the GitHub installation token to call the API. Since the GitHub connector is already connected (user went through install flow), the agent gets GitHub tools via the connector manager — same as any other workflow agent. No special token handling needed.

### 3. PR Review API Tools

New methods on `GitHubAPI` (`packages/connectors/src/github/api.ts`):

```typescript
/** Get the diff for a PR as a unified diff string */
async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
  // Use Accept: application/vnd.github.diff header
}

/** List files changed in a PR with patch/status info */
async getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<Array<{
  sha: string
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  patch?: string        // unified diff for this file
  previous_filename?: string
}>>

/** Submit a pull request review with inline comments */
async createReview(owner: string, repo: string, prNumber: number, review: {
  body?: string                           // top-level review comment
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments?: Array<{
    path: string                           // file path relative to repo root
    line: number                           // line number in the diff (new file line)
    side?: 'LEFT' | 'RIGHT'               // LEFT = deletion side, RIGHT = addition side
    body: string                           // comment body (markdown)
  }>
}): Promise<{ id: number; html_url: string }>

/** Reply to a review comment thread */
async createReviewReply(
  owner: string, repo: string, prNumber: number,
  commentId: number, body: string
): Promise<{ id: number; html_url: string }>

/** List existing review comments on a PR (to avoid duplicate reviews) */
async listReviewComments(owner: string, repo: string, prNumber: number): Promise<Array<{
  id: number
  user: { login: string }
  body: string
  path: string
  line: number
  created_at: string
}>>
```

New tools in `tools.ts`:

| Tool | Description |
|------|-------------|
| `github_get_pr_diff` | Get the full unified diff for a PR |
| `github_get_pr_files` | List changed files with per-file patches |
| `github_submit_review` | Submit a review (approve / request changes / comment) with inline comments |
| `github_reply_to_review` | Reply to a review comment thread |
| `github_list_review_comments` | List existing review comments (check for prior reviews) |

### 4. App Permissions Update

The current GitHub App may need additional permissions for PR reviews. Check and add if missing:

```
Permissions needed:
  - Pull requests: Read & Write     (to read PRs AND submit reviews)
  - Contents: Read                   (to read file contents for context)
  - Issues: Read & Write             (to read/post comments — issue_comment events)
  - Metadata: Read                   (required by GitHub)

Webhook events to subscribe:
  - Pull request                     (opened, synchronize, review_requested)
  - Issue comment                    (for @mention detection)
```

Also need to **set the webhook URL** in the App settings to point at the Anton server: `https://<domain>/_anton/github/webhook` and set a webhook secret.

---

## Code Review Workflow

### Directory Structure

```
code-review/
├── workflow.json
├── agents/
│   ├── bootstrap.md              # Setup: configure webhook, pick repos, set preferences
│   ├── reviewer.md               # Main agent: reads diff, posts review
│   └── reviewer/
│       └── task.md
├── templates/
│   ├── review-checklist.md       # What to check (bugs, security, perf, style)
│   ├── review-style-guide.md     # How to write review comments (concise, actionable, kind)
│   └── severity-rubric.md        # Critical / Warning / Suggestion / Nit
└── config/
    └── defaults.json
```

### workflow.json

```json
{
  "id": "code-review",
  "name": "Code Review Agent",
  "description": "Automatically review PRs, catch bugs, and suggest improvements. Triggered when you @mention Anton on a PR or when PRs are opened on configured repos.",
  "version": "1.0.0",
  "author": "anton",
  "category": "Engineering",

  "whenToUse": "Use when the user mentions: code review, PR review, pull request review, review my code, review bot, automated code review, catch bugs in PRs, review agent, GitHub review bot. Also suggest when user asks about automating code reviews, catching bugs before merge, or setting up a review bot across repos.",

  "connectors": {
    "required": ["github"],
    "optional": ["slack"]
  },

  "inputs": [
    {
      "id": "webhook_secret",
      "type": "secret",
      "label": "GitHub Webhook Secret",
      "description": "Set this in your GitHub App settings under Webhook → Secret. Used to verify incoming events.",
      "required": true
    },
    {
      "id": "auto_review_repos",
      "type": "textarea",
      "label": "Repos to auto-review on every PR (one per line, e.g. billionzeros/computer)",
      "description": "Leave empty to only review when @mentioned. All repos with the App installed can use @mention regardless.",
      "required": false
    },
    {
      "id": "review_style",
      "type": "select",
      "label": "Review style",
      "options": [
        { "label": "Thorough — bugs, security, perf, style, architecture", "value": "thorough" },
        { "label": "Focused — bugs and security only", "value": "focused" },
        { "label": "Quick — high-level feedback, no nits", "value": "quick" }
      ],
      "default": "thorough"
    },
    {
      "id": "auto_approve",
      "type": "select",
      "label": "Auto-approve clean PRs?",
      "options": [
        { "label": "Yes — APPROVE if no issues found", "value": "yes" },
        { "label": "No — always post as COMMENT only", "value": "no" }
      ],
      "default": "no"
    },
    {
      "id": "slack_channel",
      "type": "text",
      "label": "Slack channel for review summaries (optional)",
      "required": false
    }
  ],

  "trigger": {
    "type": "event",
    "event": {
      "source": "github",
      "events": [
        "pull_request.opened",
        "pull_request.synchronize",
        "pull_request.review_requested",
        "issue_comment.created"
      ]
    },
    "description": "Triggered on PR events or @mention in PR comments"
  },

  "agents": {
    "reviewer": {
      "file": "agents/reviewer.md",
      "role": "main",
      "name": "Code Reviewer",
      "description": "Reads PR diffs, analyzes code quality, posts inline review comments",
      "connectors": ["github", "slack"]
    }
  },

  "pipeline": [
    {
      "id": "github-event",
      "label": "GitHub Event",
      "description": "PR opened, updated, or @mentioned",
      "icon": "github",
      "type": "trigger",
      "next": ["reviewer"]
    },
    {
      "id": "reviewer",
      "label": "Code Reviewer",
      "description": "Analyze diff, post inline comments",
      "icon": "code",
      "type": "agent",
      "next": ["slack-notify"]
    },
    {
      "id": "slack-notify",
      "label": "Slack Summary",
      "description": "Post review summary to channel",
      "icon": "slack",
      "type": "connector",
      "next": []
    }
  ],

  "resources": [
    "templates/review-checklist.md",
    "templates/review-style-guide.md",
    "templates/severity-rubric.md"
  ]
}
```

### Review Agent Behavior

When triggered, the reviewer agent receives event context and:

1. **Check for prior review** — Call `github_list_review_comments` to see if Anton already reviewed this PR (avoid duplicates on re-trigger)
2. **Fetch diff** — Call `github_get_pr_files` to get per-file patches. For large PRs (50+ files), prioritize: source code > config > docs > generated files
3. **Understand scope** — Read PR title, body, and branch name to understand intent (new feature? bug fix? refactor? deps update?)
4. **Analyze each changed file** — Check against review checklist:
   - **Bugs**: Logic errors, off-by-one, null/undefined handling, race conditions, error swallowing
   - **Security**: Injection (SQL, XSS, command), auth bypass, secret exposure, OWASP top 10
   - **Performance**: N+1 queries, unnecessary loops, missing indexes, memory leaks, unbounded growth
   - **Style**: Naming clarity, function complexity, dead code, missing error handling
   - **Architecture**: Coupling, abstraction level, API design, breaking changes
5. **Classify findings** — Each as Critical (must fix) / Warning (should fix) / Suggestion (consider) / Nit (minor style)
6. **Submit review** — Call `github_submit_review` with:
   - `event`: `REQUEST_CHANGES` if any Critical findings, else `COMMENT` (or `APPROVE` if auto_approve=yes and clean)
   - `comments`: Inline comments on specific lines
   - `body`: Summary with finding counts and overall assessment
7. **Notify Slack** — If configured, post summary to channel

### Review Comment Style

Comments should be:
- **Actionable** — say what to do, not just what's wrong
- **Specific** — reference the exact line/pattern
- **Kind** — professional tone, no snark
- **Brief** — 1-3 sentences per comment, use `suggestion` blocks where possible

Example inline comment:
```markdown
**Warning** — Potential null pointer

`user.profile.email` will throw if `profile` is null. Consider optional chaining:

```suggestion
const email = user.profile?.email ?? 'unknown'
```⁣
```

Example summary:
```markdown
## Anton Review Summary

**3 files reviewed** · 2 warnings · 1 suggestion

### Findings
- **Warning**: Null pointer risk in `src/auth.ts:42` — missing null check on user profile
- **Warning**: SQL query in `src/db.ts:88` — string interpolation instead of parameterized query
- **Suggestion**: `src/utils.ts:15` — this helper duplicates `lodash.debounce`

Overall: Good PR, two issues to address before merge. The auth fix looks solid.
```

---

## Implementation Plan

### Phase 1: Webhook Infrastructure
1. Store webhook secret in agent config (`config.yaml` → `github.webhookSecret`)
2. Create `GitHubWebhookHandler` class (`packages/agent-server/src/github-webhook.ts`)
   - HMAC-SHA256 signature verification
   - Event type parsing from `X-GitHub-Event` header
   - Payload parsing with type guards for `pull_request` and `issue_comment`
   - @mention detection (check comment body for App bot login)
   - Self-loop prevention (skip events from the App itself)
   - Async dispatch (respond 200 immediately, process in background)
3. Wire into `server.ts` HTTP handler next to Telegram webhook route
4. Update GitHub App settings: set webhook URL + secret

### Phase 2: Event Trigger System
1. Extend `WorkflowManifest.trigger` type in `packages/protocol/src/workflows.ts`
2. Add `dispatchEvent(source, eventType, payload)` method to server
3. Event routing: match incoming events → find installed workflows with matching event triggers → run agents
4. Inject event payload as structured context block into agent's initial message

### Phase 3: PR Review API Tools
1. Add to `GitHubAPI` (`packages/connectors/src/github/api.ts`):
   - `getPullRequestDiff()` — unified diff via Accept header
   - `getPullRequestFiles()` — changed files with patches
   - `createReview()` — submit review with inline comments
   - `createReviewReply()` — reply to review thread
   - `listReviewComments()` — check for existing reviews
2. Add tools to `tools.ts` (`packages/connectors/src/github/tools.ts`):
   - `github_get_pr_diff`
   - `github_get_pr_files`
   - `github_submit_review`
   - `github_reply_to_review`
   - `github_list_review_comments`

### Phase 4: Code Review Workflow
1. Create `packages/agent-server/src/workflows/builtin/code-review/` directory
2. Write `workflow.json` manifest (above)
3. Write `agents/reviewer.md` — review agent prompt with checklist integration
4. Write `agents/bootstrap.md` — setup: configure webhook URL/secret, test connection, pick repos, set preferences
5. Write templates:
   - `review-checklist.md` — comprehensive review criteria
   - `review-style-guide.md` — how to write good comments
   - `severity-rubric.md` — Critical / Warning / Suggestion / Nit definitions

### Phase 5: Bootstrap UX
The bootstrap conversation guides the user through:
1. Verify GitHub connector is connected (App already installed on repos)
2. Configure webhook: tell user to go to App settings → set webhook URL to `https://<domain>/_anton/github/webhook` → set a secret
3. Enter the webhook secret into Anton
4. Test: Anton makes a test comment on a PR to verify connectivity
5. Pick repos for auto-review (vs @mention-only)
6. Set review style and auto-approve preference
7. Activate the workflow

---

## Open Questions

1. **Large diffs** — PRs with 50+ files or 2000+ lines. Chunk the review? Summarize then deep-dive on flagged files? Token budget cap per review?
2. **Re-review on push** — When new commits are pushed (`synchronize`), re-review entire diff or just the incremental changes since last review?
3. **Learning** — Track which comments get "resolved" vs "dismissed" in GitHub to learn what the team finds useful? Store in workflow memory?
4. **Rate limiting** — If a repo gets 20 PRs in an hour, queue reviews? Concurrency limit per installation?
5. **Multi-repo preferences** — Same review config for all repos, or allow per-repo overrides?
6. **Cost visibility** — Each review = ~$0.05-0.30 in API calls depending on diff size. Show cumulative cost somewhere?

---

## Success Metrics

- Reviews posted within 60 seconds of webhook event
- <5% false positive rate on Critical findings
- Developers find at least 1 useful finding per review
- Zero missed security vulnerabilities on known patterns (OWASP top 10)
