/**
 * Agent tools & system prompt — shared by all sessions.
 *
 * pi SDK (OpenClaw engine) does the heavy lifting:
 * - Agentic tool-calling loop
 * - Context management (transformContext hook)
 * - Multi-model support
 * - Streaming, retries, parallel tool calls
 *
 * We add:
 * - Custom tools (shell, filesystem, browser, process, network, artifact, git, etc.)
 * - Skills system
 * - Desktop confirmation flow
 */

import type { AgentConfig } from '@anton/agent-config'
import { loadCoreSystemPrompt } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AskUserQuestion } from '@anton/protocol'

const log = createLogger('tools')
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import type { Static, TSchema, TextContent } from '@mariozechner/pi-ai'
import type { ActivateWorkflowHandler } from './tools/activate-workflow.js'
import { executeArtifact } from './tools/artifact.js'
import { executeBrowser } from './tools/browser.js'
import { executeClipboard } from './tools/clipboard.js'
import { executeCodeSearch } from './tools/code-search.js'
import { executeDatabase } from './tools/database.js'
import type { DeliverResultHandler } from './tools/deliver-result.js'
import { executeDiff } from './tools/diff.js'
import { executeFilesystem, setForbiddenPaths } from './tools/filesystem.js'
import { executeGit } from './tools/git.js'
import { executeHttpApi } from './tools/http-api.js'
import { executeImage } from './tools/image.js'
import type { JobActionHandler, JobToolInput } from './tools/job.js'
import { executeMemory } from './tools/memory.js'
import { executeNetwork } from './tools/network.js'
import { executeNotification } from './tools/notification.js'
import { executePlan } from './tools/plan.js'
import { executeProcess } from './tools/process.js'
import { executePublish } from './tools/publish.js'
import type { SharedStateHandler } from './tools/shared-state.js'
import { executeShell } from './tools/shell.js'
import { type TasksUpdateCallback, executeTaskTracker } from './tools/task-tracker.js'
import { executeTodo } from './tools/todo.js'
import { executeWebSearch } from './tools/web-search.js'

// Re-export for session.ts
export { needsConfirmation } from './tools/shell.js'

/** Turn a 5-field cron expression into a short human-readable string. */
function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  const [min, hour, dom, mon, dow] = parts

  // Every N minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(min.slice(2))
    return n === 1 ? 'every minute' : `every ${n} minutes`
  }
  // Every N hours
  if (min !== '*' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(hour.slice(2))
    return n === 1 ? 'every hour' : `every ${n} hours`
  }
  // Daily at HH:MM
  if (
    min !== '*' &&
    hour !== '*' &&
    !hour.includes('/') &&
    dom === '*' &&
    mon === '*' &&
    dow === '*'
  ) {
    const h = Number(hour)
    const m = String(min).padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `daily at ${h12}:${m} ${ampm}`
  }
  // Weekdays
  if (dow === '1-5' && dom === '*' && mon === '*') {
    return `weekdays at ${hour}:${String(min).padStart(2, '0')}`
  }
  return expr
}

export type AskUserHandler = (questions: AskUserQuestion[]) => Promise<Record<string, string>>

/**
 * Core system prompt — self-contained behavioral instructions.
 * Loaded from the embedded prompt (identical for all deployments).
 * Contextual data (rules, memory, project context, skills) is injected
 * separately via <system-reminder> tags in session.ts.
 */
export const CORE_SYSTEM_PROMPT = loadCoreSystemPrompt()

/**
 * Wrap a string result into the AgentToolResult format pi SDK expects.
 */
function toolResult(output: string, isError = false) {
  const content: TextContent[] = [{ type: 'text', text: output }]
  return { content, details: { raw: output, isError } }
}

/**
 * Type-safe tool factory. Infers the params type from the typebox schema
 * so each execute() gets properly typed params, while the returned tool
 * is widened to AgentTool<TSchema> for the heterogeneous array.
 */
function defineTool<T extends TSchema>(
  def: Omit<AgentTool<T>, 'execute'> & {
    execute: (
      toolCallId: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResult<unknown>>
  },
): AgentTool {
  return def as AgentTool
}

/**
 * Build the tool set. Shared across all sessions — tools are stateless,
 * only the config (security rules) matters.
 */
export interface ToolCallbacks {
  getAskUserHandler?: () => AskUserHandler | undefined
  /** Callback to stream sub-agent events to the client. */
  onSubAgentEvent?: (
    event: import('./session.js').SessionEvent & { parentToolCallId: string },
  ) => void
  /** Current sub-agent nesting depth. Max 2 levels. Replaces the old boolean excludeSubAgent. */
  subAgentDepth?: number
  /** Access the parent session's confirm handler for sub-agents. */
  getConfirmHandler?: () => import('./session.js').ConfirmHandler | undefined
  /** Client-provided API key to pass through to sub-agent sessions. */
  clientApiKey?: string
  /** Conversation ID for scoped memory. */
  conversationId?: string
  /** Callback when the agent updates its task list. */
  onTasksUpdate?: TasksUpdateCallback
  /** Default working directory for shell commands (project workspace or conversation workspace). */
  defaultWorkingDirectory?: string
  /** Project ID — when set, enables the update_project_context tool and job tool. */
  projectId?: string
  /** Callback for the agent management tool. Provided by the server. */
  onJobAction?: JobActionHandler
  /** Callback for activating a workflow (creating all its agents). Provided by the server. */
  onActivateWorkflow?: ActivateWorkflowHandler
  /** Callback for shared state DB operations. Provided by the server for workflow agents. */
  onSharedState?: SharedStateHandler
  /** The workflow ID this agent belongs to (for shared state context). */
  workflowId?: string
  /** The agent key within the workflow (for transition enforcement). */
  workflowAgentKey?: string
  /** Callback to deliver results back to the origin conversation. */
  onDeliverResult?: DeliverResultHandler
  /** Domain for this agent (e.g. "slug.antoncomputer.in"). Used by the publish tool. */
  domain?: string
  /** Callback when the browser tool updates its state (screenshot, URL, action). */
  onBrowserState?: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: import('@anton/protocol').BrowserAction
    elementCount?: number
  }) => void
  /** Callback when the browser is closed. */
  onBrowserClose?: () => void
  /** Get current trace span for sub-agent nesting in Braintrust. */
  getParentTraceSpan?: () => import('./tracing.js').Span | undefined
}

export function buildTools(
  config: AgentConfig,
  callbacks?: ToolCallbacks,
  mcpManager?: import('./mcp/mcp-manager.js').McpManager,
  connectorManager?: {
    getAllTools(surface?: string): AgentTool[]
    getToolPermission?(toolName: string): 'auto' | 'ask' | 'never'
  },
  surface?: string,
): AgentTool[] {
  // Initialize security settings for tools
  setForbiddenPaths(config.security?.forbiddenPaths ?? [])

  const tools: AgentTool[] = [
    // ── Core tools ──────────────────────────────────────────────────
    defineTool({
      name: 'shell',
      label: 'Shell',
      description:
        'Execute a shell command on the server. Returns stdout/stderr. ' +
        'Use for running programs, installing packages, deploying code.',
      parameters: Type.Object({
        command: Type.String({ description: 'Shell command to execute' }),
        timeout_seconds: Type.Optional(
          Type.Number({ description: 'Max time in seconds (default: 30)' }),
        ),
        working_directory: Type.Optional(Type.String({ description: 'Working directory' })),
      }),
      async execute(_toolCallId, params) {
        // Use project workspace as default cwd if available
        const enrichedParams = {
          ...params,
          working_directory: params.working_directory || callbacks?.defaultWorkingDirectory,
        }
        const output = await executeShell(enrichedParams, config)
        return toolResult(output)
      },
    }),
    defineTool({
      name: 'filesystem',
      label: 'Filesystem',
      description:
        'Read, write, list, search, or tree files. ' +
        'Operations: read, write, list, search, tree.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('read'),
            Type.Literal('write'),
            Type.Literal('list'),
            Type.Literal('search'),
            Type.Literal('tree'),
          ],
          { description: 'Operation to perform' },
        ),
        path: Type.String({ description: 'File or directory path' }),
        content: Type.Optional(Type.String({ description: 'Content for write' })),
        pattern: Type.Optional(Type.String({ description: 'Pattern for search' })),
        maxDepth: Type.Optional(Type.Number({ description: 'Depth for tree/search' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeFilesystem(params)
        return toolResult(output)
      },
    }),
    defineTool({
      name: 'browser',
      label: 'Browser',
      description:
        'Web browsing and browser automation. Two modes:\n' +
        '• **fetch/extract** — Fast, lightweight. Use for reading articles, docs, APIs behind the scenes. No JS execution.\n' +
        '• **open/snapshot/click/fill/scroll/screenshot/get/wait/close** — Full browser with live screenshots shown in the user sidebar. ' +
        'Use `open` when the user asks to visit, browse, scrape, or interact with a website. ' +
        'Chromium auto-installs on first use.\n' +
        'For local files, use the filesystem tool.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('fetch'),
            Type.Literal('extract'),
            Type.Literal('open'),
            Type.Literal('snapshot'),
            Type.Literal('click'),
            Type.Literal('fill'),
            Type.Literal('screenshot'),
            Type.Literal('scroll'),
            Type.Literal('get'),
            Type.Literal('wait'),
            Type.Literal('close'),
          ],
          {
            description:
              'fetch: GET page as markdown (fast, no JS). extract: CSS selector extraction. ' +
              'open: navigate real browser to URL. snapshot: get interactive elements with @refs. ' +
              'click: click element by @ref. fill: type text into @ref. screenshot: capture page. ' +
              'scroll: scroll page. get: get text/url/title. wait: wait for element/load. close: close browser.',
          },
        ),
        url: Type.Optional(Type.String({ description: 'URL for fetch/extract/open' })),
        ref: Type.Optional(Type.String({ description: 'Element ref like @e1 for click/fill/get' })),
        text: Type.Optional(Type.String({ description: 'Text for fill operation' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector for extract' })),
        direction: Type.Optional(
          Type.Union([Type.Literal('up'), Type.Literal('down')], {
            description: 'Scroll direction',
          }),
        ),
        amount: Type.Optional(Type.Number({ description: 'Scroll amount in pixels' })),
        property: Type.Optional(
          Type.Union(
            [
              Type.Literal('text'),
              Type.Literal('url'),
              Type.Literal('title'),
              Type.Literal('html'),
            ],
            { description: 'Property for get operation' },
          ),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = await executeBrowser(params, {
          onBrowserState: callbacks?.onBrowserState,
          onBrowserClose: callbacks?.onBrowserClose,
        })
        return toolResult(output)
      },
    }),
    defineTool({
      name: 'process',
      label: 'Process',
      description: 'List, inspect, or kill processes. Operations: list, info, kill.',
      parameters: Type.Object({
        operation: Type.Union([Type.Literal('list'), Type.Literal('kill'), Type.Literal('info')], {
          description: 'Operation to perform',
        }),
        pid: Type.Optional(Type.Number({ description: 'Process ID' })),
        name: Type.Optional(Type.String({ description: 'Filter by name' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeProcess(params)
        return toolResult(output)
      },
    }),
    defineTool({
      name: 'network',
      label: 'Network',
      description:
        'Network ops: scan ports, HTTP requests, DNS, ping. Operations: ports, curl, dns, ping.',
      parameters: Type.Object({
        operation: Type.Union(
          [Type.Literal('ports'), Type.Literal('curl'), Type.Literal('dns'), Type.Literal('ping')],
          { description: 'Operation to perform' },
        ),
        url: Type.Optional(Type.String({ description: 'URL for curl' })),
        host: Type.Optional(Type.String({ description: 'Host for dns/ping' })),
        method: Type.Optional(Type.String({ description: 'HTTP method' })),
        headers: Type.Optional(
          Type.Record(Type.String(), Type.String(), { description: 'HTTP headers' }),
        ),
        body: Type.Optional(Type.String({ description: 'Request body' })),
      }),
      async execute(_toolCallId, params) {
        const output = await executeNetwork(params)
        return toolResult(output)
      },
    }),

    // ── Artifact ────────────────────────────────────────────────────
    defineTool({
      name: 'artifact',
      label: 'Artifact',
      description:
        'Create a visual artifact displayed in the desktop side panel. ' +
        'Use for HTML pages/apps, rendered markdown, code files, SVG graphics, or mermaid diagrams. ' +
        'The content renders live in a preview panel next to the chat. ' +
        'Always use this for visual content the user should see rendered, not as raw text. ' +
        'When the user asks to "open", "view", or "show" a local file (.html, .svg, .md, .css, .js, .ts, etc.), ' +
        'read the file with the filesystem tool first, then display it here as an artifact — do NOT use the browser tool for local files.',
      parameters: Type.Object({
        title: Type.String({ description: 'Display title (e.g. "Landing Page", "README.md")' }),
        type: Type.Union(
          [
            Type.Literal('html'),
            Type.Literal('code'),
            Type.Literal('markdown'),
            Type.Literal('svg'),
            Type.Literal('mermaid'),
          ],
          {
            description:
              'Content type: html for web pages/apps, code for source files, markdown for docs, svg for graphics, mermaid for diagrams',
          },
        ),
        language: Type.Optional(
          Type.String({
            description:
              'Language for syntax highlighting when type=code (e.g. "typescript", "python")',
          }),
        ),
        content: Type.String({ description: 'The full content to render' }),
        filename: Type.Optional(
          Type.String({
            description: 'If provided, also saves the content to this file path on disk',
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeArtifact(params)
        return toolResult(output)
      },
    }),

    // ── Publish ──────────────────────────────────────────────────────
    defineTool({
      name: 'publish',
      label: 'Publish',
      description:
        'Publish content to a public URL accessible from the internet. ' +
        'Converts markdown, HTML, SVG, mermaid diagrams, or code into a standalone web page. ' +
        'Returns the public URL. Use after creating an artifact when the user wants to share it publicly.',
      parameters: Type.Object({
        title: Type.String({ description: 'Page title' }),
        content: Type.String({ description: 'The content to publish' }),
        type: Type.Union(
          [
            Type.Literal('html'),
            Type.Literal('markdown'),
            Type.Literal('svg'),
            Type.Literal('mermaid'),
            Type.Literal('code'),
          ],
          { description: 'Content type: html, markdown, svg, mermaid, or code' },
        ),
        language: Type.Optional(
          Type.String({ description: 'Language for code syntax (e.g. "typescript")' }),
        ),
        slug: Type.Optional(
          Type.String({ description: 'Custom URL slug (auto-generated if omitted)' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executePublish(params, callbacks?.domain)
        return toolResult(output)
      },
    }),

    // ── Git ─────────────────────────────────────────────────────────
    defineTool({
      name: 'git',
      label: 'Git',
      description:
        'Safe, structured git operations. Prefer this over shell for git commands. ' +
        'Operations: status, diff, log, commit, branch, checkout, stash, add, reset. ' +
        'Blocks dangerous operations like force-push and hard reset.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('status'),
            Type.Literal('diff'),
            Type.Literal('log'),
            Type.Literal('commit'),
            Type.Literal('branch'),
            Type.Literal('checkout'),
            Type.Literal('stash'),
            Type.Literal('add'),
            Type.Literal('reset'),
          ],
          { description: 'Git operation to perform' },
        ),
        path: Type.Optional(Type.String({ description: 'File path or branch name' })),
        message: Type.Optional(Type.String({ description: 'Commit or stash message' })),
        count: Type.Optional(Type.Number({ description: 'Number of log entries (default: 10)' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeGit(params)
        return toolResult(output)
      },
    }),

    // ── Code search ─────────────────────────────────────────────────
    defineTool({
      name: 'code_search',
      label: 'Code Search',
      description:
        'Search code using ripgrep. Supports regex patterns, file type filtering, and context lines. ' +
        'Better than grep — excludes node_modules, .git, dist by default. ' +
        'Use for finding function definitions, references, patterns across a codebase.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search pattern (supports regex)' }),
        path: Type.Optional(
          Type.String({ description: 'Directory to search (default: current dir)' }),
        ),
        file_type: Type.Optional(
          Type.String({ description: 'Filter by extension, e.g. "ts", "py", "rs"' }),
        ),
        context_lines: Type.Optional(
          Type.Number({ description: 'Lines of context before/after (default: 2)' }),
        ),
        max_results: Type.Optional(Type.Number({ description: 'Max matches (default: 20)' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeCodeSearch(params)
        return toolResult(output)
      },
    }),

    // ── HTTP API ────────────────────────────────────────────────────
    defineTool({
      name: 'http_api',
      label: 'HTTP API',
      description:
        'Make structured HTTP API calls with JSON parsing and response extraction. ' +
        'Better than curl for API work: auto-parses JSON, supports JSONPath extraction. ' +
        'Use for REST APIs, webhooks, and structured HTTP requests.',
      parameters: Type.Object({
        method: Type.Union(
          [
            Type.Literal('GET'),
            Type.Literal('POST'),
            Type.Literal('PUT'),
            Type.Literal('PATCH'),
            Type.Literal('DELETE'),
          ],
          { description: 'HTTP method' },
        ),
        url: Type.String({ description: 'Full URL to call' }),
        headers: Type.Optional(
          Type.Record(Type.String(), Type.String(), { description: 'HTTP headers' }),
        ),
        body: Type.Optional(Type.String({ description: 'Request body (JSON string)' })),
        extract: Type.Optional(
          Type.String({ description: 'JSONPath to extract from response, e.g. "$.data[0].name"' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = await executeHttpApi(params)
        return toolResult(output)
      },
    }),

    // ── Database ────────────────────────────────────────────────────
    defineTool({
      name: 'database',
      label: 'Database',
      description:
        'SQLite database operations. Use for structured data storage, queries, and analysis. ' +
        'Default database at ~/.anton/data.db. Can also work with any SQLite file. ' +
        'Operations: query (SELECT), execute (INSERT/UPDATE/DELETE/CREATE), tables, schema.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('query'),
            Type.Literal('execute'),
            Type.Literal('schema'),
            Type.Literal('tables'),
          ],
          { description: 'Database operation' },
        ),
        db_path: Type.Optional(
          Type.String({ description: 'SQLite database path (default: ~/.anton/data.db)' }),
        ),
        sql: Type.Optional(
          Type.String({ description: 'SQL statement, or table name for schema operation' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeDatabase(params)
        return toolResult(output)
      },
    }),

    // ── Memory ──────────────────────────────────────────────────────
    defineTool({
      name: 'memory',
      label: 'Memory',
      description:
        'Persistent memory that survives across sessions. Save facts, preferences, project context. ' +
        'Operations: save (store a memory by key), recall (retrieve by key), list (show all, optionally filtered), forget (delete by key). ' +
        'Scope: "conversation" (default) stores memory for this conversation only, "global" stores across all conversations. ' +
        'Use proactively to remember user preferences and important context. ' +
        'Use scope=global for broadly useful info (user preferences, server configs). ' +
        'Use scope=conversation for conversation-specific facts.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('save'),
            Type.Literal('recall'),
            Type.Literal('list'),
            Type.Literal('forget'),
          ],
          { description: 'Memory operation' },
        ),
        key: Type.Optional(Type.String({ description: 'Memory key (for save/recall/forget)' })),
        content: Type.Optional(Type.String({ description: 'Content to store (for save)' })),
        query: Type.Optional(Type.String({ description: 'Filter term (for list)' })),
        scope: Type.Optional(
          Type.Union([Type.Literal('global'), Type.Literal('conversation')], {
            description:
              'Memory scope: "conversation" (default) for this conversation, "global" for cross-conversation',
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeMemory(params, callbacks?.conversationId)
        return toolResult(output)
      },
    }),

    // ── Todo ────────────────────────────────────────────────────────
    defineTool({
      name: 'todo',
      label: 'Todo',
      description:
        'Persistent task list. Manage tasks that persist across sessions. ' +
        'Operations: add (create task), list (show all), complete (mark done), remove (delete), clear (remove all). ' +
        'Use when the user asks to track tasks, create checklists, or manage work items.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('add'),
            Type.Literal('list'),
            Type.Literal('complete'),
            Type.Literal('remove'),
            Type.Literal('clear'),
          ],
          { description: 'Todo operation' },
        ),
        text: Type.Optional(Type.String({ description: 'Task text (for add)' })),
        id: Type.Optional(Type.Number({ description: 'Task ID (for complete/remove)' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeTodo(params)
        return toolResult(output)
      },
    }),

    // ── Task Tracker (Claude Code–style work plan) ───────────────────
    defineTool({
      name: 'task_tracker',
      label: 'Task Tracker',
      description:
        'Update the task list for the current session. To be used proactively and often to track progress and pending tasks. ' +
        'Make sure that at least one task is in_progress at all times. ' +
        'Always provide both content (imperative) and activeForm (present continuous) for each task. ' +
        'Each call replaces the full task list. Mark tasks as pending/in_progress/completed. ' +
        'Only one task should be in_progress at a time.',
      parameters: Type.Object({
        tasks: Type.Array(
          Type.Object({
            content: Type.String({
              description: 'What needs to be done (imperative, e.g. "Run tests")',
            }),
            activeForm: Type.String({
              description: 'Present-continuous form (e.g. "Running tests")',
            }),
            status: Type.Union(
              [Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')],
              { description: 'Task status' },
            ),
          }),
          { description: 'The full task list (replaces previous list)' },
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeTaskTracker(params, callbacks?.onTasksUpdate)
        return toolResult(output)
      },
    }),

    // ── Clipboard ───────────────────────────────────────────────────
    defineTool({
      name: 'clipboard',
      label: 'Clipboard',
      description:
        'Read from or write to the system clipboard. ' +
        'Operations: read (get clipboard contents), write (copy text to clipboard). ' +
        'Use when user says "copy this", "paste what I have", or needs clipboard access.',
      parameters: Type.Object({
        operation: Type.Union([Type.Literal('read'), Type.Literal('write')], {
          description: 'Clipboard operation',
        }),
        content: Type.Optional(
          Type.String({ description: 'Text to copy to clipboard (for write)' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeClipboard(params)
        return toolResult(output)
      },
    }),

    // ── Notification ────────────────────────────────────────────────
    defineTool({
      name: 'notification',
      label: 'Notification',
      description:
        'Send a desktop notification. Use to alert the user when long tasks complete, ' +
        'for reminders, or when something needs attention.',
      parameters: Type.Object({
        title: Type.String({ description: 'Notification title' }),
        message: Type.String({ description: 'Notification body text' }),
        sound: Type.Optional(Type.Boolean({ description: 'Play alert sound (default: true)' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeNotification(params)
        return toolResult(output)
      },
    }),

    // ── Image ───────────────────────────────────────────────────────
    defineTool({
      name: 'image',
      label: 'Image',
      description:
        'Image operations: take screenshots, resize, convert formats, get info, crop. ' +
        'Use for capturing screen state, preparing images, or analyzing image files.',
      parameters: Type.Object({
        operation: Type.Union(
          [
            Type.Literal('screenshot'),
            Type.Literal('resize'),
            Type.Literal('convert'),
            Type.Literal('info'),
            Type.Literal('crop'),
          ],
          { description: 'Image operation' },
        ),
        path: Type.Optional(Type.String({ description: 'Input image file path' })),
        output: Type.Optional(Type.String({ description: 'Output file path' })),
        width: Type.Optional(Type.Number({ description: 'Target width in pixels' })),
        height: Type.Optional(Type.Number({ description: 'Target height in pixels' })),
        format: Type.Optional(Type.String({ description: 'Output format: png, jpg, webp' })),
        region: Type.Optional(
          Type.Object(
            {
              x: Type.Number({ description: 'X coordinate' }),
              y: Type.Number({ description: 'Y coordinate' }),
              w: Type.Number({ description: 'Width' }),
              h: Type.Number({ description: 'Height' }),
            },
            { description: 'Region for screenshot or crop' },
          ),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeImage(params)
        return toolResult(output)
      },
    }),

    // ── Diff ────────────────────────────────────────────────────────
    defineTool({
      name: 'diff',
      label: 'Diff',
      description:
        'Compare files or apply patches. Produces unified diff output. ' +
        'Operations: compare (diff two files), patch (apply a patch to a file). ' +
        'Use for reviewing changes, comparing versions, or applying modifications.',
      parameters: Type.Object({
        operation: Type.Union([Type.Literal('compare'), Type.Literal('patch')], {
          description: 'Diff operation',
        }),
        file_a: Type.String({ description: 'First file path (or target for patch)' }),
        file_b: Type.Optional(Type.String({ description: 'Second file path (for compare)' })),
        patch_content: Type.Optional(
          Type.String({ description: 'Unified diff patch content (for patch)' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeDiff(params)
        return toolResult(output)
      },
    }),

    // ── Ask User ─────────────────────────────────────────────────────
    defineTool({
      name: 'ask_user',
      label: 'Ask User',
      description:
        'Ask the user clarifying questions with optional multiple-choice options. ' +
        'Use when you need specific information before proceeding — e.g., technology choices, preferences, project details. ' +
        'Bundle all related questions into one call (max 6). The UI shows one question at a time with Next/Submit. ' +
        'The user can pick from options or type a free-text answer.',
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            question: Type.String({ description: 'The question to ask' }),
            description: Type.Optional(
              Type.String({ description: 'Additional context shown below the question' }),
            ),
            options: Type.Optional(
              Type.Array(Type.String(), {
                description: 'Selectable options as short labels (max 6)',
                maxItems: 6,
              }),
            ),
            allowFreeText: Type.Optional(
              Type.Boolean({ description: 'Allow custom text input (default: true)' }),
            ),
            freeTextPlaceholder: Type.Optional(
              Type.String({ description: 'Placeholder text for the free-text input' }),
            ),
          }),
          { description: 'Questions to ask (max 6)', maxItems: 6 },
        ),
      }),
      async execute(_toolCallId, params) {
        const handler = callbacks?.getAskUserHandler?.()
        if (!handler) {
          return toolResult('Ask user requires an interactive handler but none is available.', true)
        }
        if (!params.questions?.length) {
          return toolResult('ask_user requires at least one question.', true)
        }
        const questions: AskUserQuestion[] = params.questions.map(
          (q: {
            question: string
            description?: string
            options?: (string | { label: string; description?: string })[]
            allowFreeText?: boolean
            freeTextPlaceholder?: string
          }) => ({
            question: q.question,
            description: q.description,
            options: q.options?.slice(0, 6),
            allowFreeText: q.allowFreeText,
            freeTextPlaceholder: q.freeTextPlaceholder,
          }),
        )
        const answers = await handler(questions)
        return toolResult(JSON.stringify(answers, null, 2))
      },
    }),

    // ── Planning ──────────────────────────────────────────────────────
    defineTool({
      name: 'plan',
      label: 'Plan',
      description:
        'Submit an implementation plan for user review before executing. ' +
        'The plan is displayed as rendered markdown in a side panel. ' +
        'Execution pauses until the user approves or rejects with optional feedback. ' +
        'Use this for complex multi-step tasks, architectural changes, or when the user asks you to plan first.',
      parameters: Type.Object({
        title: Type.String({ description: 'Short plan title' }),
        content: Type.String({ description: 'Full plan in markdown format' }),
      }),
      async execute(_toolCallId, params) {
        const output = executePlan(params)
        return toolResult(output)
      },
    }),
  ]

  // ── Workflow activation (only for project-scoped sessions with handler) ──
  if (callbacks?.projectId && callbacks?.onActivateWorkflow) {
    const projectId = callbacks.projectId
    const activateHandler = callbacks.onActivateWorkflow
    tools.push(
      defineTool({
        name: 'activate_workflow',
        label: 'Activate Workflow',
        description:
          'Activate a workflow by creating all its agents. Call this ONLY after the user has approved the final configuration plan. ' +
          'This creates the scheduled agents defined in the workflow manifest and starts them running.',
        parameters: Type.Object({
          workflow_id: Type.String({
            description: 'The workflow ID to activate (e.g. "lead-qualification")',
          }),
        }),
        async execute(_toolCallId, params) {
          const output = await activateHandler(projectId, params.workflow_id)
          return toolResult(output)
        },
      }),
    )
  }

  // ── Shared state (workflow agents with DB access) ──
  if (callbacks?.onSharedState && callbacks?.workflowId) {
    const sharedStateHandler = callbacks.onSharedState
    const wfId = callbacks.workflowId
    const wfProjectId = callbacks.projectId!
    tools.push(
      defineTool({
        name: 'shared_state',
        label: 'Shared State',
        description:
          'Query or modify the workflow shared state database (SQLite). ' +
          'Use standard SQL. Status transitions are enforced by the system — invalid transitions will be rejected. ' +
          'Operations: "query" for SELECT statements, "execute" for INSERT/UPDATE/DELETE.',
        parameters: Type.Object({
          operation: Type.Union([Type.Literal('query'), Type.Literal('execute')], {
            description: '"query" for SELECT, "execute" for INSERT/UPDATE/DELETE',
          }),
          sql: Type.String({ description: 'SQL statement to run' }),
          params: Type.Optional(
            Type.Array(Type.Unknown(), { description: 'Bind parameters for the SQL statement' }),
          ),
        }),
        async execute(_toolCallId, params) {
          const output = await sharedStateHandler(
            wfProjectId,
            wfId,
            params.operation,
            params.sql,
            params.params as unknown[] | undefined,
          )
          return toolResult(output)
        },
      }),
    )
  }

  // ── Sub-agent (depth-limited — max 2 levels of nesting) ──
  const currentDepth = callbacks?.subAgentDepth ?? 0
  const MAX_SUB_AGENT_DEPTH = 2

  if (currentDepth < MAX_SUB_AGENT_DEPTH) {
    tools.push(
      defineTool({
        name: 'sub_agent',
        label: 'Sub Agent',
        description:
          'Spawn a sub-agent to handle a complex task independently. ' +
          'The sub-agent has its own context and access to all tools including project files and MCP connectors. ' +
          'Use for tasks that can be parallelized or need focused work — e.g. research, code analysis, file operations, API calls. ' +
          'Multiple sub_agent calls in the same response run in parallel. ' +
          'The sub-agent works autonomously until the task is complete, then returns its final output as the result.',
        parameters: Type.Object({
          task: Type.String({
            description: 'Detailed description of the task for the sub-agent to complete',
          }),
        }),
        async execute(toolCallId, params) {
          const onEvent = callbacks?.onSubAgentEvent

          // Emit sub_agent_start
          onEvent?.({
            type: 'sub_agent_start',
            toolCallId,
            task: params.task,
            parentToolCallId: toolCallId,
          })

          let finalText = ''
          let hadError = false

          try {
            // Lazy import to avoid circular dependency (agent.ts <-> session.ts)
            const { Session } = await import('./session.js')

            // Build tools for sub-agent with full project + MCP powers, depth incremented
            const subTools = buildTools(
              config,
              {
                getAskUserHandler: callbacks?.getAskUserHandler,
                getConfirmHandler: callbacks?.getConfirmHandler,
                onSubAgentEvent: callbacks?.onSubAgentEvent,
                subAgentDepth: currentDepth + 1,
                clientApiKey: callbacks?.clientApiKey,
                defaultWorkingDirectory: callbacks?.defaultWorkingDirectory,
                projectId: callbacks?.projectId,
                onJobAction: callbacks?.onJobAction,
                onDeliverResult: callbacks?.onDeliverResult,
                // Shared project-scoped memory so parallel sub-agents can coordinate
                conversationId: callbacks?.projectId
                  ? `project-${callbacks.projectId}`
                  : callbacks?.conversationId,
              },
              mcpManager,
            )

            const subSession = new Session({
              id: `sub_${toolCallId}`,
              provider: config.defaults.provider,
              model: config.defaults.model,
              config,
              tools: subTools,
              apiKey: callbacks?.clientApiKey,
              ephemeral: true,
              // Safety limits for sub-agents
              maxTokenBudget: 100_000,
              maxDurationMs: 600_000, // 10 minutes
              maxTurns: 50,
              // Thread Braintrust trace span so sub-agent appears nested under parent
              parentTraceSpan: callbacks?.getParentTraceSpan?.(),
            })

            // Wire confirm handler from parent so sub-agent shell commands can be approved
            const confirmHandler = callbacks?.getConfirmHandler?.()
            if (confirmHandler) {
              subSession.setConfirmHandler(confirmHandler)
            }

            for await (const event of subSession.processMessage(params.task)) {
              // Forward intermediate events to client, tagged with parentToolCallId
              if (onEvent && event.type !== 'done' && event.type !== 'title_update') {
                onEvent({
                  ...event,
                  parentToolCallId: toolCallId,
                } as import('./session.js').SessionEvent & { parentToolCallId: string })
              }

              // Stream progress: emit text events as live progress updates
              if (event.type === 'text' && event.content) {
                onEvent?.({
                  type: 'sub_agent_progress',
                  toolCallId,
                  content: event.content,
                  parentToolCallId: toolCallId,
                } as import('./session.js').SessionEvent & { parentToolCallId: string })
              }

              // Collect text output for the final tool result
              if (event.type === 'text') {
                finalText += event.content
              }
              if (event.type === 'error') {
                hadError = true
                finalText += `\nError: ${event.message}`
              }
            }
          } catch (err) {
            hadError = true
            finalText = `Sub-agent error: ${(err as Error).message}`
          }

          // Emit sub_agent_end
          onEvent?.({
            type: 'sub_agent_end',
            toolCallId,
            success: !hadError,
            parentToolCallId: toolCallId,
          })

          return toolResult(finalText || '(sub-agent produced no output)', hadError)
        },
      }),
    )
  }

  // ── Project context update (only for project-scoped sessions) ─────
  if (callbacks?.projectId) {
    tools.push(
      defineTool({
        name: 'update_project_context',
        label: 'Project Context',
        description:
          'Update the project context with a summary of what was accomplished in this session. ' +
          'Call this once per session when meaningful work has been done (feature implemented, bug fixed, significant decision made). ' +
          'This persists the summary so future sessions have context about past work.',
        parameters: Type.Object({
          session_summary: Type.String({
            description: '1-2 sentence summary of what was accomplished in this session',
          }),
          project_summary: Type.Optional(
            Type.String({
              description:
                'Updated overall project summary incorporating new info. Only provide if something significant changed.',
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          return toolResult(
            JSON.stringify({
              sessionSummary: params.session_summary,
              projectSummary: params.project_summary,
            }),
          )
        },
      }),
    )
  }

  // ── Agent management (only for project-scoped sessions with handler) ──
  if (callbacks?.projectId && callbacks?.onJobAction) {
    const projectId = callbacks.projectId
    const agentHandler = callbacks.onJobAction
    const getAskUser = callbacks?.getAskUserHandler
    tools.push(
      defineTool({
        name: 'agent',
        label: 'Agent',
        description:
          'Create and manage agents — autonomous conversations that run on a schedule. ' +
          'An agent is its own conversation with full tool and MCP access that executes instructions repeatedly. ' +
          'Operations: create (define a new agent), list (show all agents), start (trigger a run), stop (cancel a run), ' +
          'delete (remove an agent), status (check agent details). ' +
          'IMPORTANT: For create, the user will be asked to confirm before the agent is created.',
        parameters: Type.Object({
          operation: Type.Union(
            [
              Type.Literal('create'),
              Type.Literal('list'),
              Type.Literal('start'),
              Type.Literal('stop'),
              Type.Literal('delete'),
              Type.Literal('status'),
            ],
            { description: 'Operation to perform' },
          ),
          name: Type.Optional(
            Type.String({
              description:
                'Agent name (for create, or for delete/start/stop to display in confirmation)',
            }),
          ),
          description: Type.Optional(
            Type.String({ description: 'What the agent does (for create)' }),
          ),
          prompt: Type.Optional(
            Type.String({
              description:
                'Instructions for the agent — what it should do on each run. Be specific.',
            }),
          ),
          schedule: Type.Optional(
            Type.String({
              description:
                'Cron expression for scheduling, e.g. "0 9 * * *" for daily at 9am, "0 */6 * * *" for every 6 hours. Omit for manual-only.',
            }),
          ),
          agent_id: Type.Optional(
            Type.String({ description: 'Agent session ID (for start/stop/delete/status)' }),
          ),
        }),
        async execute(_toolCallId, params) {
          // For create: require user confirmation via ask_user
          if (params.operation === 'create' && getAskUser) {
            const askUser = getAskUser()
            if (askUser) {
              const humanSchedule = params.schedule ? humanizeCron(params.schedule) : null
              const answers = await askUser([
                {
                  question: `Create agent "${params.name || 'Untitled'}"?`,
                  description: params.description || '',
                  options: ['Yes, create it', 'No, cancel'],
                  allowFreeText: false,
                  metadata: {
                    type: 'agent_create',
                    name: params.name || 'Untitled',
                    description: params.description || '',
                    schedule: humanSchedule,
                    cron: params.schedule || null,
                    prompt: params.prompt || '',
                  },
                },
              ])
              // Check if user rejected
              const answer = Object.values(answers)[0]
              if (
                answer &&
                (answer.toLowerCase().includes('no') || answer.toLowerCase().includes('cancel'))
              ) {
                return toolResult('Agent creation cancelled by user.')
              }
            }
          }

          // For delete: also require confirmation
          if (params.operation === 'delete' && getAskUser) {
            const askUser = getAskUser()
            if (askUser) {
              const displayName = params.name || params.agent_id || 'this agent'
              const answers = await askUser([
                {
                  question: `Delete agent "${displayName}"?`,
                  description: 'This will remove the agent and its conversation history.',
                  options: ['Yes, delete it', 'No, keep it'],
                  allowFreeText: false,
                  metadata: {
                    type: 'agent_delete',
                    name: displayName,
                    agentId: params.agent_id || '',
                  },
                },
              ])
              const answer = Object.values(answers)[0]
              if (
                answer &&
                (answer.toLowerCase().includes('no') || answer.toLowerCase().includes('keep'))
              ) {
                return toolResult('Agent deletion cancelled by user.')
              }
            }
          }

          const input: JobToolInput = {
            operation: params.operation,
            name: params.name,
            description: params.description,
            prompt: params.prompt,
            schedule: params.schedule,
            jobId: params.agent_id,
          }
          const output = await agentHandler(projectId, input)
          return toolResult(output)
        },
      }),
    )
  }

  // ── Deliver result (for agents to send results back to origin conversation) ──
  if (callbacks?.onDeliverResult) {
    const deliverHandler = callbacks.onDeliverResult
    tools.push(
      defineTool({
        name: 'deliver_result',
        label: 'Deliver Result',
        description:
          'Send your results back to the conversation that created you. ' +
          'Use this after completing your task to deliver findings, summaries, or data to the user. ' +
          "Only call this when you have meaningful results to share — don't spam empty updates.",
        parameters: Type.Object({
          content: Type.String({
            description:
              'The full result to deliver — findings, data, summaries. Formatted as markdown.',
          }),
          summary: Type.Optional(
            Type.String({
              description: 'One-line summary for notifications (e.g. "Found 5 new AI quotes")',
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const output = await deliverHandler({
            content: params.content,
            summary: params.summary,
          })
          return toolResult(output)
        },
      }),
    )
  }

  // ── Web search (Exa via CF worker proxy) ──────────────────────────
  // Skip registration when exa_search is already available via MCP connector
  // (avoids a useless stub that just says "use exa_search instead").
  // Still register when nothing is configured so the user gets setup instructions.
  {
    const exa = config.connectors.find(
      (c) => c.id === 'exa-search' && c.enabled && c.baseUrl && c.apiKey,
    )
    const provider: import('./tools/web-search.js').SearchProvider | null =
      exa?.baseUrl && exa?.apiKey ? { baseUrl: exa.baseUrl, token: exa.apiKey } : null

    const hasExaConnector =
      !provider && connectorManager?.getAllTools().some((t) => t.name === 'exa_search')

    if (!hasExaConnector) {
      tools.push(
        defineTool({
          name: 'web_search',
          label: 'Web Search',
          description:
            'Search the web using Exa semantic search. Returns titles, URLs, and full page content as markdown. ' +
            'Use for researching topics, discovering resources, and answering questions that need up-to-date data. ' +
            'Results include extracted page content, not just snippets.',
          parameters: Type.Object({
            query: Type.String({ description: 'Search query' }),
            numResults: Type.Optional(
              Type.Number({ description: 'Number of results (default: 10, max: 30)' }),
            ),
            category: Type.Optional(
              Type.String({
                description:
                  'Focus area: "news", "research paper", "company", "personal site", "financial report", "people"',
              }),
            ),
            startPublishedDate: Type.Optional(
              Type.String({
                description:
                  'Filter results published after this ISO date (e.g. "2025-01-01T00:00:00.000Z")',
              }),
            ),
            endPublishedDate: Type.Optional(
              Type.String({ description: 'Filter results published before this ISO date' }),
            ),
          }),
          async execute(_toolCallId, params) {
            if (!provider) {
              return toolResult(
                'Web search is not configured. To enable it:\n\n' +
                  '1. Go to Settings → Connectors\n' +
                  '2. Find "Web Search (Exa)" and click Connect\n' +
                  '3. Enter your Exa API key\n\n' +
                  'In the meantime, you can use the browser tool to fetch specific URLs if you have them.',
                true,
              )
            }
            const output = await executeWebSearch(params, provider)
            return toolResult(output)
          },
        }),
      )
    }
  }

  // ── MCP tools (from connected connectors) ─────────────────────────
  if (mcpManager) {
    const mcpTools = mcpManager.getAllTools()
    if (mcpTools.length > 0) {
      log.info({ count: mcpTools.length }, 'adding MCP tools from connectors')
      tools.push(...mcpTools)
    }
  }

  // ── Direct connector tools (OAuth-based connectors) ───────────────
  if (connectorManager) {
    const directTools = connectorManager.getAllTools(surface)
    if (directTools.length > 0) {
      log.info(
        { count: directTools.length, surface: surface ?? 'unfiltered' },
        'adding direct connector tools',
      )
      tools.push(...directTools)
    }
  }

  // ── Deduplicate tools by name (API requires unique tool names) ────
  const seen = new Set<string>()
  const deduped: typeof tools = []
  const duplicates: string[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      duplicates.push(tool.name)
      continue
    }
    seen.add(tool.name)
    deduped.push(tool)
  }
  if (duplicates.length > 0) {
    log.warn({ duplicates, finalCount: deduped.length }, 'removed duplicate tools')
  }
  log.info({ count: deduped.length }, 'tools registered')

  return deduped
}
