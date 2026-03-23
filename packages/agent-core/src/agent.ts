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
import { loadSystemPrompt } from '@anton/agent-config'
import type { AskUserQuestion } from '@anton/protocol'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import type { TextContent } from '@mariozechner/pi-ai'
import { executeArtifact } from './tools/artifact.js'
import { executeBrowser } from './tools/browser.js'
import { executeClipboard } from './tools/clipboard.js'
import { executeCodeSearch } from './tools/code-search.js'
import { executeDatabase } from './tools/database.js'
import { executeDiff } from './tools/diff.js'
import { executeFilesystem } from './tools/filesystem.js'
import { executeGit } from './tools/git.js'
import { executeHttpApi } from './tools/http-api.js'
import { executeImage } from './tools/image.js'
import { executeMemory } from './tools/memory.js'
import { executeNetwork } from './tools/network.js'
import { executeNotification } from './tools/notification.js'
import { executePlan } from './tools/plan.js'
import { executeProcess } from './tools/process.js'
import { executeShell } from './tools/shell.js'
import { executeTodo } from './tools/todo.js'

// Re-export for session.ts
export { needsConfirmation } from './tools/shell.js'

export type AskUserHandler = (questions: AskUserQuestion[]) => Promise<Record<string, string>>

/**
 * System prompt — loaded from ~/.anton/prompts/system.md at startup.
 * Editable on the server, persists across agent updates.
 *
 * Prompt layering:
 *   ~/.anton/prompts/system.md     — base prompt (seeded from packages/agent/prompts/system.md)
 *   ~/.anton/prompts/append.md     — appended after base (optional, for user customization)
 *   ~/.anton/prompts/rules/*.md    — rules appended as sections (optional)
 *
 * Skills are appended automatically by session.ts.
 */
export const SYSTEM_PROMPT = loadSystemPrompt()

/**
 * Wrap a string result into the AgentToolResult format pi SDK expects.
 */
function toolResult(output: string, isError = false) {
  const content: TextContent[] = [{ type: 'text', text: output }]
  return { content, details: { raw: output, isError } }
}

/**
 * Build the tool set. Shared across all sessions — tools are stateless,
 * only the config (security rules) matters.
 */
export interface ToolCallbacks {
  getAskUserHandler?: () => AskUserHandler | undefined
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool array requires any
export function buildTools(config: AgentConfig, callbacks?: ToolCallbacks): AgentTool<any>[] {
  return [
    // ── Core tools ──────────────────────────────────────────────────
    {
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
        const output = await executeShell(params, config)
        return toolResult(output)
      },
    },
    {
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
    },
    {
      name: 'browser',
      label: 'Browser',
      description:
        'Fetch remote web pages or extract content from URLs. Operations: fetch, extract, screenshot. ' +
        'Only use for remote URLs (http/https). For local files, use the filesystem tool to read them and the artifact tool to display them.',
      parameters: Type.Object({
        operation: Type.Union(
          [Type.Literal('fetch'), Type.Literal('screenshot'), Type.Literal('extract')],
          { description: 'Operation to perform' },
        ),
        url: Type.String({ description: 'URL to fetch' }),
        selector: Type.Optional(Type.String({ description: 'CSS selector for extract' })),
      }),
      async execute(_toolCallId, params) {
        const output = executeBrowser(params)
        return toolResult(output)
      },
    },
    {
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
    },
    {
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
        const output = executeNetwork(params)
        return toolResult(output)
      },
    },

    // ── Artifact ────────────────────────────────────────────────────
    {
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
    },

    // ── Git ─────────────────────────────────────────────────────────
    {
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
    },

    // ── Code search ─────────────────────────────────────────────────
    {
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
    },

    // ── HTTP API ────────────────────────────────────────────────────
    {
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
    },

    // ── Database ────────────────────────────────────────────────────
    {
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
    },

    // ── Memory ──────────────────────────────────────────────────────
    {
      name: 'memory',
      label: 'Memory',
      description:
        'Persistent memory that survives across sessions. Save facts, preferences, project context. ' +
        'Operations: save (store a memory by key), recall (retrieve by key), list (show all, optionally filtered), forget (delete by key). ' +
        'Use proactively to remember user preferences and important context.',
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
      }),
      async execute(_toolCallId, params) {
        const output = executeMemory(params)
        return toolResult(output)
      },
    },

    // ── Todo ────────────────────────────────────────────────────────
    {
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
    },

    // ── Clipboard ───────────────────────────────────────────────────
    {
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
    },

    // ── Notification ────────────────────────────────────────────────
    {
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
    },

    // ── Image ───────────────────────────────────────────────────────
    {
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
    },

    // ── Diff ────────────────────────────────────────────────────────
    {
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
    },

    // ── Ask User ─────────────────────────────────────────────────────
    {
      name: 'ask_user',
      label: 'Ask User',
      description:
        'Ask the user clarifying questions with optional multiple-choice options. ' +
        'Use when you need specific information before proceeding — e.g., technology choices, preferences, project details. ' +
        'Maximum 4 questions. Each question can have selectable options and/or allow free-text input. ' +
        'The user sees an interactive questionnaire in the chat UI.',
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            question: Type.String({ description: 'The question to ask' }),
            options: Type.Optional(
              Type.Array(Type.String(), { description: 'Selectable options (max 5)' }),
            ),
            allowFreeText: Type.Optional(
              Type.Boolean({ description: 'Allow custom text input (default: true)' }),
            ),
          }),
          { description: 'Questions to ask (max 4)' },
        ),
      }),
      async execute(_toolCallId, params) {
        const handler = callbacks?.getAskUserHandler?.()
        if (!handler) {
          return toolResult('Ask user requires an interactive handler but none is available.', true)
        }
        const questions: AskUserQuestion[] = params.questions.map(
          (q: { question: string; options?: string[]; allowFreeText?: boolean }) => ({
            question: q.question,
            options: q.options,
            allowFreeText: q.allowFreeText,
          }),
        )
        const answers = await handler(questions)
        return toolResult(JSON.stringify(answers, null, 2))
      },
    },

    // ── Planning ──────────────────────────────────────────────────────
    {
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
    },
  ]
}
