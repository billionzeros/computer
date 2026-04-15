# Sub-agents — Feature Spec

## Overview

Sub-agents are autonomous child sessions spawned by the main agent to handle focused, independent work. Each sub-agent gets its own conversation context, full tool access, and runs to completion before returning results to the parent.

The primary value is **parallelism** — the parent can spawn multiple sub-agents in a single response and they execute concurrently.

## Specialized Types

Sub-agents support an optional `type` parameter for specialization:

| Type | Purpose | Behavior |
|------|---------|----------|
| `research` | Information gathering | Searches web/files/APIs. Does NOT modify files or system state. Returns structured findings. |
| `execute` | Carry out specific work | Executes precisely as described, verifies its own work, retries on errors. Does not expand scope. |
| `verify` | Validate completed work | Runs tests/builds/linters/checks. Reports PASS/FAIL/PARTIAL verdict. Does NOT fix issues. |
| *(omit)* | General-purpose | No behavioral constraints. Same as parent agent. |

Each type prepends an instruction prefix to the task string before the sub-agent processes it. The prefix shapes behavior through prompting — no tool filtering or system prompt variants.

## Tool Definition

```typescript
{
  name: 'sub_agent',
  parameters: {
    task: string,      // Self-contained task description (sub-agent has no parent context)
    type?: 'research' | 'execute' | 'verify'  // Optional specialization
  }
}
```

## Architecture

### Session lifecycle

1. Parent agent calls `sub_agent` tool with a task (and optional type)
2. If `type` is set, the corresponding instruction prefix is prepended to the task
3. A new ephemeral `Session` is created (`id: sub_{toolCallId}`)
4. Sub-agent processes the prefixed task as a user message
5. Events stream back to the client via `onSubAgentEvent`, tagged with `parentToolCallId`
6. On completion, the sub-agent's text output becomes the tool result

### Safety limits

- **Token budget**: 100,000 tokens per sub-agent
- **Duration**: 10 minutes max wall-clock time
- **Turns**: 50 max LLM turns
- **Depth**: Max 2 levels of nesting (sub-agent can spawn its own sub-agent, but no deeper)

### Tool access

Sub-agents get full tool access: shell, filesystem, browser, code_search, MCP connectors, etc. The tool set is built via `buildTools()` with `subAgentDepth` incremented.

### Memory coordination

Sub-agents share a project-scoped conversation ID (`project-{projectId}`) so parallel sub-agents within the same project can read/write shared memory.

### Confirmation flow

Sub-agents inherit the parent session's confirm handler. Shell commands requiring approval route through the same UI flow.

## Protocol

Three event types for the sub-agent lifecycle:

```typescript
interface AiSubAgentStartMessage {
  type: 'sub_agent_start'
  toolCallId: string
  task: string
  agentType?: 'research' | 'execute' | 'verify'
}

interface AiSubAgentProgressMessage {
  type: 'sub_agent_progress'
  toolCallId: string
  content: string
}

interface AiSubAgentEndMessage {
  type: 'sub_agent_end'
  toolCallId: string
  success: boolean
}
```

Events flow: agent-core → agent-server (WebSocket forward) → desktop client.

## UI

Sub-agent groups render as collapsible tree items in the chat, similar to regular tool call groups but with:

- **Type-specific label**: "Research Agent", "Execute Agent", "Verify Agent" (or generic "Agent")
- **Task preview**: First 80 chars of the task string
- **Nested tool tree**: All tool calls made by the sub-agent, collapsible
- **Summary line**: Tool names used + error count (e.g., "Read · Shell · 4 tool calls")
- **Artifact cards**: Any artifacts created by the sub-agent

Sub-agent groups integrate with the task-section system — if preceded by a step narration, they collapse into a Manus-style task card.

## System prompt guidance

The system prompt (`packages/agent-config/prompts/system.md`) includes a `## Sub-agent guidelines` section that instructs the model:

- **When to spawn**: Parallel research, multi-file changes, independent subtasks, exploration, verification after non-trivial work
- **Parallelism**: "Always launch independent sub-agents together in one response"
- **Task quality**: Self-contained descriptions with file paths, context, deliverables, scope boundaries
- **Synthesis**: Combine results from sub-agents — don't just relay raw output
- **When NOT to use**: Single file ops, single commands, trivial lookups, sequential work

## Key files

| File | Role |
|------|------|
| `packages/agent-core/src/agent.ts` | Tool definition, type prefixes, session creation |
| `packages/agent-core/src/session.ts` | `SessionEvent` type for sub-agent events |
| `packages/protocol/src/messages.ts` | Protocol message types |
| `packages/agent-config/prompts/system.md` | System prompt sub-agent guidelines |
| `packages/agent-server/src/server.ts` | WebSocket event forwarding |
| `packages/desktop/src/components/chat/SubAgentGroup.tsx` | UI component |
| `packages/desktop/src/components/chat/groupMessages.ts` | Message grouping logic |
| `packages/desktop/src/lib/store/handlers/chatHandler.ts` | Event → store handler |

## Future work

- **Background/foreground mode**: Let the parent agent continue chatting while sub-agents run asynchronously. Requires pi SDK support for deferred tool results.
- **Tool filtering per type**: Restrict research agents from write operations at the tool level (currently enforced via prompting only).
