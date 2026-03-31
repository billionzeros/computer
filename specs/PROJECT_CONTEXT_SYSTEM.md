# Project Context System

## Overview

Project memory gives each project persistent context that carries across sessions. When a user opens a new conversation within a project, the LLM receives the project summary, notes, and recent session history — so it doesn't start from zero.

## Architecture

### Storage Layout

```
~/.anton/projects/{projectId}/
├── project.json              # Metadata + context.summary (auto-updated by LLM)
├── conversations/            # Project-scoped sessions
│   └── {sessionId}/
│       ├── meta.json
│       └── messages.jsonl
├── context/
│   ├── notes.md              # User-editable project notes (injected into prompt)
│   └── session-history.jsonl # One-line summaries of past sessions
├── jobs/                     # Agent/job definitions
└── files/                    # Project files on server
```

### Key Data

**context.summary** (in project.json) — Auto-maintained by the LLM via the `update_project_context` tool. Example:
> "Scrapes VP-level SaaS leads from LinkedIn. Uses Playwright with BrightData proxies. Output goes to Airtable 'Lead Pipeline'. Two daily runs (8am, 2pm)."

**session-history.jsonl** — One entry per completed session turn:
```json
{"sessionId": "...", "title": "Set up initial scraper", "summary": "Wrote Python script...", "ts": 1711234567}
```

**context/notes.md** — User-editable notes surfaced in the UI and injected into the system prompt.

## How Context Gets Into Sessions

On `session_create` with a `projectId`, the server calls `buildProjectContext()` which assembles clean content:

```
- Project: {name}
- Description: ...
- Type: ...
- Project workspace: ...

## Project Summary
{context.summary}

## Project Notes
{context/notes.md}

## Recent Sessions
- {title}: {summary}
- {title}: {summary}
... (last 5)
```

This content is injected into the "Current Context" `<system-reminder>` block by `session.ts → getSystemPrompt()`.

## How Memory Gets Built

### The `update_project_context` Tool

Defined in `agent.ts`, only registered when `projectId` is set. The LLM calls it with:
- `session_summary` (required): 1-2 sentence summary of what was accomplished
- `project_summary` (optional): Updated overall project summary, only if something significant changed

The tool is a passthrough — it returns the input as JSON. The **server** captures the tool result from the event stream by tracking tool call IDs.

### System Prompt Instruction

When `projectId` is set, `session.ts` appends a "Project Memory Instructions" `<system-reminder>` block telling the LLM to call the tool once per session when meaningful work has been done. This is the critical piece — without it, the LLM never calls the tool on its own.

### Server-Side Capture (server.ts)

During message processing, the server:
1. Tracks pending tool call names via a `Map<id, name>`
2. When a `tool_result` event arrives for `update_project_context`, parses the JSON
3. **Validates shape**: `sessionSummary` must be a string, `projectSummary` must be a string or undefined
4. **Merges on repeat calls**: latest `sessionSummary` wins, but `projectSummary` is preserved from earlier calls if a later call omits it

After the turn completes:
1. If `projectSummary` was provided → calls `updateProjectContext(projectId, 'summary', ...)` which writes to `project.json` and updates the index
2. Appends to `session-history.jsonl` using `sessionSummary` (falls back to session title if tool was never called)
3. Sends `project_updated` event to the desktop client so the UI refreshes

### What the Desktop Shows

`ProjectConfigPanel.tsx` displays:
- **Memory section**: Shows `project.context.summary`. If empty, shows "Project memory will build up after a few sessions."
- **Edit modal**: Users can manually edit the summary. Saves via `sendProjectContextUpdate()`.

## Design Decisions

1. **No separate LLM call** — Memory is built within the session itself via a tool call, not a post-session summarization step. This avoids extra API costs and latency.

2. **Tool-based, not output parsing** — Earlier designs used `[PROJECT_CONTEXT_UPDATE]` text blocks parsed from output. The tool approach is more reliable — structured parameters, typed validation, explicit invocation.

3. **Session history as fallback context** — Even if the LLM never calls the tool, session titles still get appended to `session-history.jsonl` and injected into future sessions. The memory field stays empty but sessions still have some continuity.

4. **Single system prompt instruction** — The "Project Memory Instructions" `<system-reminder>` block in the system prompt is what makes the LLM actually call the tool. The tool description alone was not sufficient — LLMs need explicit behavioral instructions, not just tool availability.
