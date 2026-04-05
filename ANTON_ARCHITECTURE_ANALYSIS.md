# Anton Agent Codebase Architecture

## Overview
Anton is a sophisticated AI agent harness that provides autonomous task execution on a local machine. It operates through a WebSocket connection between a client and a remote server, with full tool access and session management.

## 1. MAIN SYSTEM PROMPT / INSTRUCTIONS

### Core System Prompt Location
- **File**: `/Users/omg/Desktop/01/computer/packages/agent-config/prompts/system.md`
- **Embedded in**: `/Users/omg/Desktop/01/computer/packages/agent-config/src/embedded-prompts.ts`
- **Loaded by**: `loadCoreSystemPrompt()` in `/packages/agent-core/src/agent.ts:99`

### System Prompt Components
The prompt is structured with several key directives:
1. **Identity**: "You are anton, an AI agent running on this machine"
2. **Behavioral Mode**: "You are a doer, and a describer. When the user asks you to do something, use your tools and do it. Never list your capabilities — demonstrate them."
3. **Tool listing**: Comprehensive overview of all available tools
4. **Guidelines**: Step-by-step execution, planning, artifact creation, memory management

### Context Injection (10-Layer System)
System prompt is augmented with contextual information via `<system-reminder>` tags (session.ts:1688-1820):

1. **Workspace Rules** (.anton.md files in project root)
2. **User Rules** (~/.anton/prompts/append.md + ~/.anton/prompts/rules/*.md)
3. **Current Context** (workspace path, project context, date)
4. **Memory** (global, conversation-scoped, cross-conversation)
5. **Project Memory Instructions** (for update_project_context tool)
6. **Agent Context** (standing instructions + run history for scheduled agents)
7. **Project Type Guidelines** (code.md, document.md, etc.)
8. **Reference Knowledge** (auto-selected coding guides)
9. **Active Skills** (installed skill prompts)
10. **Available Workflows** (for suggestions)

---

## 2. AVAILABLE TOOLS

### Tool Architecture
- **Tool factory**: `defineTool<T>()` function (agent.ts:114) - type-safe tool builder
- **Tool execution**: Pi SDK agentic loop handles retries, context management, streaming
- **Total tools**: 20+ built-in tools + dynamic MCP tools + connectors

### Built-in Tools (Complete List)

#### Core Execution Tools
1. **shell** - Execute shell commands (install packages, run scripts, deploy code)
2. **filesystem** - Read, write, list, search, tree files (operations: read, write, list, search, tree)
3. **browser** - Web page automation
   - fetch/extract: lightweight content retrieval
   - open: full browser automation with live screenshots
4. **process** - List, inspect, kill running processes
5. **network** - Port scanning, HTTP requests, DNS lookups, ping

#### Development Tools
6. **git** - Safe, structured git operations (status, diff, log, commit, branch, checkout, stash, add, reset)
7. **code_search** - Search code using ripgrep (regex, file type filtering, context lines)
8. **diff** - Compare files, apply patches

#### Artifact/UI Tools
9. **artifact** - Create rich visual content (HTML, markdown, code, SVG, mermaid diagrams)
10. **publish** - Publish artifacts to web

#### Data & Integration
11. **database** - SQLite operations (~/.anton/data.db)
12. **http_api** - Structured HTTP API client with JSON parsing

#### Productivity
13. **memory** - Persistent cross-session knowledge (global, conversation, project-scoped)
14. **task_tracker** - Session-scoped work plan with live checklist
15. **todo** - Persistent task list across sessions
16. **clipboard** - Read/write system clipboard
17. **notification** - Send desktop notifications

#### Media
18. **image** - Screenshot, resize, convert formats, crop

#### User Interaction
19. **ask_user** - Ask clarifying questions with optional multiple-choice (max 6 questions, max 6 options per question)
20. **plan** - Create multi-step plans for approval

#### Autonomy & Workflow
21. **sub_agent** - Spawn independent sub-agents for parallel/focused work
22. **agent** - Create, list, start, stop, delete scheduled agents (with user confirmation)
23. **activate_workflow** - Activate workflow after bootstrap setup
24. **shared_state** - Workflow agents: read/write shared state database with state transitions
25. **job** - Agent management (for server-side agent control)
26. **deliver_result** - Send results back to origin conversation

#### Project/Context
27. **update_project_context** - Save session summaries to project memory

#### Search
28. **web_search** - Search web (SearXNG or Brave Search)

### MCP (Model Context Protocol) Tools
- **McpManager** (mcp/mcp-manager.ts) manages multiple MCP server connections
- **McpClient** (mcp/mcp-client.ts) handles individual MCP server lifecycle
- **mcpClientToAgentTools** (mcp/mcp-tool-adapter.ts) adapts MCP tools to Pi SDK format
- Tools are discovered at runtime and merged with built-in tools

### Tool Schema System
- Uses Typebox for JSON Schema definitions
- Each tool has:
  - `name` (kebab-case)
  - `label` (display name)
  - `description` (what it does, when to use)
  - `parameters` (Type.Object with required/optional fields)
  - `execute()` function (async, type-safe params)

### Tool Callbacks (Hooks)
Passed via `ToolCallbacks` interface (agent.ts:130-176):
- `getAskUserHandler()` - Interactive question handler
- `onSubAgentEvent()` - Stream sub-agent events to client
- `subAgentDepth` - Nesting level (max 2)
- `getConfirmHandler()` - Shell/SQL confirmation
- `clientApiKey` - API key passthrough
- `conversationId` - Memory scoping
- `projectId` - Project context
- `onJobAction()` - Agent management
- `onActivateWorkflow()` - Workflow spawning
- `onSharedState()` - Workflow state DB
- `onDeliverResult()` - Result delivery
- `onBrowserState()` - Browser state updates
- `getParentTraceSpan()` - Tracing

---

## 3. SUB-AGENT SPAWNING & TRIGGERS

### Sub-Agent Tool (agent.ts:896-1013)
**Purpose**: Spawn independent agents for parallel/focused work

**Trigger**: Agent calls `sub_agent` tool with task description

**Execution Flow**:
1. Agent builds new tool set via `buildTools()` with incremented `subAgentDepth`
2. Creates ephemeral `Session` with:
   - id: `sub_${toolCallId}`
   - model: inherited from parent
   - maxTokenBudget: 100,000 tokens
   - maxDurationMs: 600,000ms (10 minutes)
   - maxTurns: 50
3. Inherits parent's:
   - ask_user handler
   - confirm handler
   - project ID
   - conversation ID (for shared memory)
4. Runs message processing loop (`subSession.processMessage(params.task)`)
5. Emits events:
   - `sub_agent_start` - when spawned
   - `sub_agent_progress` - on text events
   - All intermediate events forwarded with `parentToolCallId`
   - `sub_agent_end` - when complete

**Limitations**:
- Max nesting depth: 2 levels (currentDepth + 1)
- Safety limits enforced (token budget, duration, turn count)
- Shares parent's confirm handler for interactive confirmations
- Uses project-scoped memory for coordination: `project-${projectId}`

### Workflow Agent Spawning (workflow-installer.ts:118-179)
**Purpose**: Create autonomous agents from workflow manifests

**Trigger**: `activate_workflow` tool called (after bootstrap setup)

**Execution Flow**:
1. Loads workflow manifest
2. For each agent in `manifest.agents`:
   - `agentManager.createAgent(projectId, {...})`
   - Sets `workflowId` and `workflowAgentKey`
   - Saves metadata to `agent.json`
3. Creates state DB if manifest defines `sharedState`
4. Saves all agent IDs to `installed.json`

**Agent Creation** (agent-manager.ts:97):
- Generates session ID: `agent--${projectId}--${timestamp}_${hex}`
- Creates conversation directory
- Saves `agent.json` metadata (name, description, instructions, schedule)
- Optionally schedules cron runs

---

## 4. ASK_USER QUESTION TOOL

### Tool Definition (agent.ts:751-807)
**Purpose**: Ask user clarifying questions with optional multiple-choice

**Parameters**:
```typescript
{
  questions: Array<{
    question: string                    // required
    description?: string                // optional context
    options?: string[]                  // max 6 selectable options
    allowFreeText?: boolean             // allow custom input (default: true)
    freeTextPlaceholder?: string        // placeholder text
  }>                                     // max 6 questions total
}
```

**Execution**:
1. Gets handler via `callbacks.getAskUserHandler()`
2. Validates questions array (1-6 questions)
3. Calls handler with `AskUserQuestion[]`
4. Returns answers as JSON object: `{ questionIndex: "answer" }`

**UI Behavior**:
- Shows one question at a time
- User can pick from options OR type custom text (if allowed)
- "Next" button moves through questions
- "Submit" button on last question

**Error Handling**:
- If no handler available: returns error
- If no questions provided: returns error
- Options capped at 6 per question

**Use Cases**:
- Technology choices ("Which framework: React, Vue, Svelte?")
- User preferences
- Project details
- Configuration options
- Anything that needs human input before proceeding

---

## 5. SESSION & INTERACTION FLOW

### Session Lifecycle (session.ts:143+)

**Creation**:
```
createSession(id, config) 
  → new Session({...})
  → piAgent = new Agent(provider, model, tools, systemPrompt)
```

**First Message**:
```
session.loadConversationContext(firstMessage)
  → assembleConversationContext() loads memories
  → system prompt updated with context
```

**Message Processing** (session.ts:531):
```typescript
async *processMessage(userMessage, attachments) {
  // 1. Optional task resume hint injection (if multi-step task in progress)
  // 2. Auto-generate session title (first message)
  // 3. Assemble system prompt with 10 layers of context
  // 4. Call pi SDK agent loop
  // 5. For each event:
  //    - Tool calls → beforeToolCall hook (confirmations)
  //    - Tool results → collect output
  //    - Text → emit text event
  //    - Images → emit artifact event
  // 6. Track token usage, cost, duration
  // 7. Persist session to disk
  // 8. Emit all events to client
}
```

### Session Persistence (SESSIONS.md)
**Storage**:
```
~/.anton/sessions/
├── index.json                    # fast session list
└── data/
    ├── sess_abc123/
    │   ├── meta.json            # metadata (title, model, stats)
    │   ├── messages.jsonl       # structured message log
    │   ├── images/              # user image attachments
    │   └── compaction.json      # compaction state
```

**Message Format**:
- Each line in `messages.jsonl` is a pi SDK message
- Self-contained JSON objects
- Images stored in session-local `images/` directory
- Referenced by relative path from messages

### Context Window Management
**Compaction Flow** (session.ts:316-377):
1. transformContext hook fires when messages exceed threshold
2. Calls `compactContext()` (compaction.ts)
3. Summarizes old messages via LLM
4. Replaces oldest messages with summary
5. Emits `compaction` event with stats
6. Fallback: sliding window (keep last N messages)

**System Prompt Assembly** (session.ts:1702-1820):
```
CORE_SYSTEM_PROMPT (from embedded-prompts.ts)
  + Workspace Rules (.anton.md)
  + User Rules (append.md + rules/*.md)
  + Current Context (workspace, project, date)
  + Memory (global + conversation + cross-conversation)
  + Project Memory Instructions
  + Agent Context (standing instructions + run history)
  + Project Type Guidelines
  + Reference Knowledge (auto-selected coding guides)
  + Active Skills
  + Available Workflows
```

### Event Types (session.ts:83-108)
- `thinking` - reasoning/planning
- `text` - assistant output
- `tool_call` - tool invocation
- `tool_result` - tool output
- `artifact` - visual content
- `confirm` - approval request
- `title_update` - session title update
- `compaction` - context compression event
- `sub_agent_start` / `sub_agent_progress` / `sub_agent_end` - sub-agent events

---

## 6. TOOL DEFINITIONS & SCHEMAS

### Tool Definition Pattern (agent.ts:114-124)
```typescript
defineTool<T extends TSchema>({
  name: string                          // kebab-case, unique
  label: string                         // display name
  description: string                   // what, when, why
  parameters: Type.Object({...})        // Typebox schema
  async execute(
    toolCallId: string,
    params: Static<T>,                  // type-safe
    signal?: AbortSignal
  ): Promise<AgentToolResult<unknown>>
})
```

### Parameter Validation
- Uses Typebox JSON Schema library
- Type inference: `Static<T>` extracts TypeScript types from schema
- Supports: Object, String, Number, Boolean, Array, Union, Literal, Optional
- Examples:
  - `Type.String({ description: '...' })`
  - `Type.Optional(Type.Number({...}))`
  - `Type.Union([Type.Literal('a'), Type.Literal('b')])`
  - `Type.Array(Type.Object({...}))`

### Tool Result Format
```typescript
{
  content: TextContent[]              // { type: 'text', text: string }
  details: {
    raw: string                       // raw output
    isError?: boolean                 // error flag
  }
}
```

### Tool Callbacks Integration
Each tool can access callbacks to:
- Request user input (`ask_user`)
- Get confirmation (`confirmHandler`)
- Emit events to client (`onSubAgentEvent`, `onBrowserState`)
- Manage projects (`projectId`)
- Scope memory (`conversationId`)
- Get API keys (`clientApiKey`)
- Trace execution (`getParentTraceSpan`)

---

## 7. WORKFLOW SYSTEM

### Workflow Manifest Structure
Defined in workflow manifest.json:
```json
{
  "name": "Workflow Name",
  "description": "What it does",
  "trigger": { "type": "schedule", "schedule": "0 9 * * *" },
  "agents": {
    "agent-key": {
      "name": "Display Name",
      "description": "What this agent does",
      "schedule": "optional override",
      "role": "main" | "support"
    }
  },
  "connectors": {
    "required": ["connector-id"],
    "optional": ["connector-id"]
  },
  "sharedState": {
    "transitions": {...},
    "setupSql": "..."
  },
  "bootstrap": {
    "file": "bootstrap.md"
  }
}
```

### Workflow Installation Flow
1. **Install** (workflow-installer.ts:38-116)
   - Copy workflow files to project
   - Save user inputs
   - Save bootstrap prompt as project instructions
   - Write `installed.json` (no agents yet)

2. **Bootstrap** (orchestrated by server)
   - User completes setup in first conversation
   - Agent calls `activate_workflow` tool

3. **Activate** (workflow-installer.ts:122-179)
   - Creates shared state DB if needed
   - For each agent in manifest:
     - Creates session with `workflowId` + `workflowAgentKey`
     - Saves metadata
   - Saves agent IDs to `installed.json`

4. **Runtime** (scheduled agents)
   - Scheduler checks cron on every 30s interval
   - Sends message to agent conversation
   - Agent loads workflow context + standing instructions
   - Agent executes task autonomously

### Shared State Database (shared-state-db.ts)
- SQLite database at `${workflowDir}/state/db.sqlite`
- Defines state transitions (state machine)
- Agents can call `shared_state` tool to:
  - Read current state
  - Transition to new state
  - Query shared tables
  - Enforce state machine rules

---

## 8. MEMORY & CONTEXT SYSTEMS

### Memory Layers (context.ts)

**Global Memory**
- Location: `~/.anton/memory/`
- Scope: All conversations, all projects
- Loaded: Every session
- Used for: User preferences, general knowledge

**Conversation Memory**
- Location: `~/.anton/sessions/${conversationId}/memory/`
- Scope: Single conversation
- Loaded: Only in that conversation
- Used for: Conversation-scoped notes, facts

**Cross-Conversation Memory**
- Mechanism: Keyword matching on first message
- Extracted keywords from first message
- Match against all other conversations' memory
- Limit: top 5 results
- Used for: Automatic context from related conversations

**Project Memory**
- Location: `~/.anton/projects/${projectId}/context/`
- Scope: Single project, all conversations
- Tool: `update_project_context` (end of session)
- Used for: Project summaries, architecture notes

### Memory Assembly (context.ts:266-327)
```typescript
assembleConversationContext(conversationId, firstMessage, projectId) {
  // 1. Load global memories from ~/.anton/memory/
  // 2. Load conversation memories from session memory dir
  // 3. Extract keywords from first message
  // 4. Find cross-conversation matches (keyword scoring)
  // 5. Build structured MemoryData object
  // 6. Persist context.json for transparency
  // 7. Return data for system prompt injection
}
```

---

## 9. AGENT SCHEDULING

### Scheduled Agents (agent-manager.ts)

**Agent Structure**:
```json
{
  "id": "agent--projectId--timestamp_hex",
  "projectId": "project-id",
  "name": "Agent Name",
  "description": "What it does",
  "instructions": "Standing instructions (loaded at runtime from workflow)",
  "schedule": {
    "cron": "0 9 * * *",
    "timezone": "America/New_York"
  },
  "status": "idle" | "running" | "paused",
  "nextRunAt": number,
  "lastRunAt": number,
  "runs": [
    {
      "runSessionId": "sess_...",
      "startedAt": number,
      "completedAt": number,
      "status": "success" | "error",
      "summary": "What the agent accomplished"
    }
  ]
}
```

**Scheduler** (server.ts + scheduler.ts):
- Runs every 30 seconds
- Checks all scheduled agents
- For each agent with `nextRunAt <= now()`:
  - Loads agent instructions
  - Loads agent memory
  - Creates ephemeral session
  - Sends message: `${agentInstructions}`
  - Captures output as run record
  - Saves agent memory

**Standing Instructions** (session.ts:1767):
```
You are a scheduled agent. Execute these instructions on every run.
Do NOT re-create scripts or tooling that you have already built in previous runs. Re-use existing work.
If something is broken, fix it. If everything works, just run it.

${this.agentInstructions}
```

---

## 10. SERVER ARCHITECTURE

### WebSocket Server (server.ts)
- **Port**: 9876 (ws://) + 9877 (wss://)
- **Multiplexing**: Multiple channels per connection (conversations, project files, etc.)
- **Auth**: API key validation
- **Handlers**:
  - Session lifecycle (create, resume, delete, list)
  - Message processing
  - Tool execution
  - Browser automation
  - File operations
  - Project management
  - Workflow management
  - Agent management

### Agent Manager (agent-manager.ts)
- Manages agent CRUD operations
- Loads all agents from project directories on startup
- Scheduler integration for cron-based execution
- Event callbacks for real-time updates

### Connector System
- **ConnectorManager** (server.ts): Manages MCP server instances
- **McpManager** (mcp-manager.ts): Multi-server lifecycle
- **McpClient** (mcp-client.ts): Individual server connections
- **Adapters**: Convert MCP tools to Pi SDK format
- **Status tracking**: connected/failed/disabled per connector

### Session Management (server.ts)
```
client connects → authentication
              → create/resume session
              → load project/conversation context
              → processMessage() loop
              → stream events to client
              → persist to disk
              → cleanup on disconnect
```

---

## KEY INSIGHTS

1. **Tool-driven autonomy**: All capabilities accessed via structured tool calls, not hardcoded logic
2. **Context injection**: System prompt enhanced with 10 layers of contextual information
3. **Safe sub-agents**: Sandboxed, limited (10min, 100k tokens, 50 turns), share parent's confirm handler
4. **Persistent sessions**: All conversation state on server, survives client reconnects
5. **Automatic compaction**: Long conversations transparently summarized to avoid context overflow
6. **Workflow as code**: Manifests define multi-agent systems, installed into projects
7. **Memory-driven**: Global, conversation, and cross-conversation memories auto-loaded
8. **Confirmation gates**: Interactive approval for dangerous operations (shell, SQL, filesystem)
9. **MCP integration**: Extensible via Model Context Protocol servers
10. **Real-time events**: WebSocket streaming of all agent activity to clients

