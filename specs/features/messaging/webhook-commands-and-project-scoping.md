# Project-Aware Webhook Conversations + Command System

## Context

Slack and Telegram conversations are completely unscoped from the project system. `WebhookAgentRunner.getOrCreateSession()` creates sessions with no `projectId`, no workspace, no project context. Shell cwd falls back to `$HOME`. Starting a new thread = fresh isolated session with zero context.

**Goal:**
1. Make all webhook conversations project-aware by default (scoped to "My Computer")
2. Build an official Anton command system that works across all surfaces (Slack, Telegram, future)
3. Register commands natively with Telegram's Bot Commands menu

## Command System

Commands are intercepted **before** the LLM — zero tokens spent. The parser sits in front of `session.processMessage()` and short-circuits.

### Commands

| Command | Description | Behavior |
|---------|-------------|----------|
| `/project <name>` | Switch to a project | Fuzzy match by name, save binding, evict session |
| `/project` | Show current project | Display name, description, workspace path |
| `/projects` | List all projects | Numbered list with current binding highlighted |
| `/model <name>` | Switch model | Change model for this session (e.g. `/model sonnet`) |
| `/model` | Show current model | Display active provider + model |
| `/help` | Show available commands | List all commands with descriptions |
| `/status` | Show current status | Project, model, session info |
| `/reset` | Reset conversation | Evict session, start fresh with same project |

## Implementation

### Step 1: Command registry in agent-core

**New file: `packages/agent-core/src/commands.ts`**

A command registry that any surface can use. No system prompt involvement.

```typescript
interface Command {
  name: string           // "project"
  description: string    // "Switch to a project"
  usage?: string         // "/project <name>"
  handler: (args: string, context: CommandContext) => CommandResult
}

interface CommandContext {
  sessionId: string
  config: AgentConfig
  // callbacks to interact with the runner
  evictSession: () => void
  getSession: () => Session | undefined
}

interface CommandResult {
  text: string
  images: OutboundImage[]
}

function parseCommand(text: string): { name: string; args: string } | null
function executeCommand(text: string, context: CommandContext): CommandResult | null
function listCommands(): Command[]
```

- `parseCommand` checks if text starts with `/` followed by a registered command name
- `executeCommand` parses + dispatches, returns null if not a command
- Commands are registered at module level (simple array, no DI needed)

### Step 2: Implement command handlers

**Same file or split into `packages/agent-core/src/commands/` directory**

Each command is a pure function. They import from `@anton/agent-config` for project operations.

**`/project <name>`:**
1. `findProjectsByName(args)` — case-insensitive substring match
2. 0 matches → error + list all projects
3. 1 match → save binding, call `evictSession()`, return confirmation
4. N matches → list ambiguous matches

**`/projects`:**
1. `loadProjects()` → format as numbered list
2. Mark current binding with a indicator

**`/model <name>`:**
1. Map shorthand names: `sonnet` → `claude-sonnet-4-20250514`, `opus` → `claude-opus-4-0-20250115`, etc.
2. Update session model (need to expose a setter or recreate session)

**`/model`:**
1. Read current session's provider + model, display it

**`/help`:**
1. `listCommands()` → format as table

**`/status`:**
1. Current project (from binding), current model, session age, message count

**`/reset`:**
1. Call `evictSession()`, return "Session reset. Next message starts fresh."

### Step 3: Webhook bindings persistence

**New file: `packages/agent-server/src/webhooks/bindings.ts`**

Manages `~/.anton/webhook-bindings.json` — a `{bindingKey: projectId}` map.

- `getBinding(bindingKey)` / `saveBinding(bindingKey, projectId)` / `removeBinding(bindingKey)`
- `extractBindingKey(sessionId)` — strip thread suffix to get channel-level key:
  - `slack:dm:T123:C456:ts123` → `slack:dm:T123:C456`
  - `slack:thread:T123:C456:ts123` → `slack:thread:T123:C456`
  - `telegram-12345` → `telegram-12345`

### Step 4: Add `findProjectsByName` helper

**Modified file: `packages/agent-config/src/projects.ts`**

```typescript
export function findProjectsByName(query: string): Project[] {
  return loadProjects().filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  )
}
```

### Step 5: Make `WebhookAgentRunner` project-aware

**Modified file: `packages/agent-server/src/webhooks/agent-runner.ts`**

**5a. Add `evictSession(sessionId)` method** — removes from `this.sessions` Map.

**5b. Intercept commands in `run()`:**
Before entering the FIFO queue, call `executeCommand(event.text, context)`. If it returns a result, return immediately — no queue, no LLM.

**5c. Inject project context in `getOrCreateSession()`:**
- Derive binding key via `extractBindingKey(sessionId)`
- Look up `projectId` via `getBinding(bindingKey)`
- If no binding: use `ensureDefaultProject()`, save the binding
- Load project, build context via `buildProjectContext()`
- Pass `projectId`, `projectContext`, `projectWorkspacePath`, `projectType` to `createSession()` / `resumeSession()`

### Step 6: Register commands with Telegram Bot API

**Modified file: `packages/agent-server/src/webhooks/providers/telegram.ts`**

On provider initialization (or server startup), call `setMyCommands`:

```typescript
async registerCommands(token: string) {
  const commands = listCommands().map(cmd => ({
    command: cmd.name,
    description: cmd.description,
  }))
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  })
}
```

This gives Telegram users the native command autocomplete menu. Call once on startup — Telegram stores it server-side.

### Step 7: Handle project switching flow

When `/project X` is sent:
1. Save new binding: `saveBinding(bindingKey, newProjectId)`
2. Evict current session: `evictSession(sessionId)`
3. Reply with confirmation
4. Next message → fresh session created with new project's context

Old session data stays on disk (no data loss).

## Files Changed

| File | Type | What |
|------|------|------|
| `packages/agent-core/src/commands.ts` | New | Command registry + handlers |
| `packages/agent-server/src/webhooks/bindings.ts` | New | Channel→project binding persistence |
| `packages/agent-server/src/webhooks/agent-runner.ts` | Modify | Command interception + project context injection |
| `packages/agent-config/src/projects.ts` | Modify | Add `findProjectsByName()` |
| `packages/agent-server/src/webhooks/providers/telegram.ts` | Modify | Register commands via `setMyCommands` on startup |

## Verification

1. Send a message via Slack → session created under "My Computer" project
2. Verify shell cwd is `~/Anton/my-computer/`
3. Send `/help` → see all commands listed
4. Send `/projects` → see project list
5. Send `/project` → see current binding ("My Computer")
6. Send `/project <other>` → verify binding changes, next message uses new project
7. Send `/model` → see current model
8. Send `/model sonnet` → verify model switches
9. Send `/status` → see project + model + session info
10. Send `/reset` → verify fresh session on next message
11. In Telegram → verify native command menu appears when typing `/`
