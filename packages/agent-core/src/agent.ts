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
 * - Custom tools (shell, read, write, edit, glob, grep, browser, artifact, git, etc.)
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
import { executeEdit } from './tools/edit.js'
import { executeGit } from './tools/git.js'
import { executeGlob, executeList, executeTree } from './tools/glob.js'
import { executeHttpApi } from './tools/http-api.js'
import { executeImage } from './tools/image.js'
import type { JobActionHandler, JobToolInput } from './tools/job.js'
import { executeMemory } from './tools/memory.js'
import { executeNotification } from './tools/notification.js'
import { executePlan } from './tools/plan.js'
// process and network tools removed — shell handles ps/kill/ping/curl
import { executePublish } from './tools/publish.js'
import { buildAntonCoreTools } from './tools/factories.js'
import { defineTool, toolResult } from './tools/_helpers.js'
import { executeRead } from './tools/read.js'
import { setForbiddenPaths } from './tools/security.js'
import type { SharedStateHandler } from './tools/shared-state.js'
import { executeShell } from './tools/shell.js'
import { type TasksUpdateCallback, executeTaskTracker } from './tools/task-tracker.js'
import { executeTodo } from './tools/todo.js'
import { executeWebSearch } from './tools/web-search.js'
import { executeWrite } from './tools/write.js'

// ── Tool name constants ────────────────────────────────────────────
// Use these everywhere so descriptions auto-update if a tool is renamed.
export const SHELL_TOOL_NAME = 'shell'
export const READ_TOOL_NAME = 'read'
export const WRITE_TOOL_NAME = 'write'
export const EDIT_TOOL_NAME = 'edit'
export const GLOB_TOOL_NAME = 'glob'
export const LIST_TOOL_NAME = 'list'
export const GREP_TOOL_NAME = 'grep'
export const GIT_TOOL_NAME = 'git'
export const HTTP_API_TOOL_NAME = 'http_api'
export const BROWSER_TOOL_NAME = 'browser'

// Re-export for session.ts
export { needsConfirmation } from './tools/shell.js'

// ── Sub-agent type specializations ──────────────────────────────

export type SubAgentType = 'research' | 'execute' | 'verify'

/** Tools that each sub-agent type IS allowed to use (whitelist). */
const SUB_AGENT_ALLOWED_TOOLS: Record<SubAgentType, Set<string>> = {
  research: new Set([
    'web_search',
    'browser',
    'read',
    'grep',
    'glob',
    'list',
    'http_api',
    'memory',
    'git',
  ]),
  execute: new Set([
    'shell',
    'read',
    'write',
    'edit',
    'glob',
    'list',
    'grep',
    'git',
    'http_api',
    'web_search',
    'browser',
    'memory',
    'task',
  ]),
  verify: new Set([
    'shell',
    'read',
    'glob',
    'list',
    'grep',
    'git',
    'http_api',
    'web_search',
    'browser',
    'memory',
  ]),
}

/** Budget configuration per sub-agent type. */
const SUB_AGENT_BUDGETS: Record<SubAgentType, { maxTokenBudget: number; maxTurns: number }> = {
  research: { maxTokenBudget: 100_000, maxTurns: 30 },
  execute: { maxTokenBudget: 200_000, maxTurns: 50 },
  verify: { maxTokenBudget: 100_000, maxTurns: 30 },
}

const SUB_AGENT_TYPE_PREFIXES: Record<SubAgentType, string> = {
  research: `You are a research sub-agent. You are NOT the main agent.

STRATEGY: search → scan results → fetch 2-3 most relevant pages → synthesize.

RULES (non-negotiable):
1. Do NOT spawn sub-agents. You ARE the sub-agent — execute directly using your tools.
2. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
3. Do NOT converse, ask questions, or suggest next steps.
4. Focus on FINDING and ORGANIZING information, not on making changes.
5. ALWAYS start with web_search. Never open browser as your first action.
6. Only use browser on URLs you found in search results — never guess URLs.
7. Each browser call costs ~10k tokens. You have a HARD LIMIT of 5 browser calls — the system will block further calls. Plan accordingly: pick the 2-3 best URLs from search results.
8. Use ${READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME}, and ${HTTP_API_TOOL_NAME} for local/API data gathering.
9. Do NOT create, modify, or delete files unless the task explicitly asks you to save results somewhere.
10. If you find conflicting information, note the discrepancy rather than silently picking one.
11. Stay strictly within the task scope. If you discover related topics outside scope, mention them in one sentence at most.
12. Keep your report under 300 words unless the task specifies otherwise.

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings, limited to the scope above>
  Key files: <relevant file paths — include for code research tasks>
  Sources: <list of URLs or references used>
  Issues: <list — include only if there are issues to flag>

Task:
`,
  execute: `You are an execution sub-agent. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents. You ARE the sub-agent — execute directly using your tools.
2. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
3. Do NOT converse, ask questions, or suggest next steps.
4. Execute the task precisely as described. Do not expand scope beyond what is asked.
5. Verify your work: run the code, check the output, test the endpoint, read back the file. Never assume success.
6. If you encounter an error, diagnose and fix it. Retry up to 3 times before reporting failure.
7. Do NOT ask the user for clarification — work with what you have. Make reasonable assumptions and note them.
8. Stay strictly within the task scope.
9. Keep your report under 500 words unless the task specifies otherwise.

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <what you did and the outcome>
  Files changed: <list of modified files>
  Issues: <list — include only if there are issues to flag>

Task:
`,
  verify: `You are a verification sub-agent. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents. You ARE the sub-agent — execute directly using your tools.
2. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
3. Do NOT converse, ask questions, or suggest next steps.
4. Run concrete checks: execute tests, build commands, linters, curl endpoints, read logs. Do not just review code by eye.
5. Do NOT fix problems. Report them clearly so the parent agent can decide what to do.
6. If the task does not specify what to check, look for: test suites, build scripts, linter configs, and verify each one.
7. Stay strictly within the task scope.

For each check, report:
  Check: <what you tested>
  Command: <exact command you ran>
  Output: <actual terminal output — copy-paste, not paraphrased>
  Result: PASS or FAIL (with Expected vs Actual)

End with exactly one of:
  VERDICT: PASS
  VERDICT: FAIL
  VERDICT: PARTIAL (for environmental limitations only — not for uncertainty)

Task:
`,
}

// ── Fork sub-agent mechanism ──────────────────────────────────
// When sub_agent is called without a type, we create a "fork" that inherits
// the parent's full conversation context, system prompt, tools, and model.

const FORK_BOILERPLATE_TAG = 'fork_context'
const FORK_DIRECTIVE_PREFIX = 'Directive:\n'

/** Max turns for fork children (primary limit — no token budget). */
const FORK_MAX_TURNS = 200

/**
 * Build the child directive message that gets appended to the forked conversation.
 * Wrapped in a detectable tag so we can prevent recursive forking.
 */
function buildForkChildMessage(directive: string): string {
  return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. You ARE the fork. Do NOT spawn sub-agents or further forks — execute directly using your tools.
2. Do NOT converse, ask questions, or suggest next steps.
3. Do NOT editorialize or add meta-commentary.
4. USE your tools directly: shell, read, write, edit, browser, web_search, etc.
5. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
6. Stay strictly within your directive's scope. If you discover related topics outside scope, mention them in one sentence at most.
7. Keep your report under 500 words unless the directive specifies otherwise.
8. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings, limited to the scope above>
  Key files: <relevant file paths — include for code research tasks>
  Files changed: <list with details — include only if files were modified>
  Issues: <list — include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`
}

/**
 * Detect whether we're inside a fork child by scanning messages for the
 * fork boilerplate tag. Used to prevent recursive forking.
 */
function isInForkChild(messages: unknown[]): boolean {
  return (messages as { role?: string; content?: unknown }[]).some((m) => {
    if (m.role !== 'user') return false
    const content = m.content
    if (typeof content === 'string') return content.includes(`<${FORK_BOILERPLATE_TAG}>`)
    if (Array.isArray(content)) {
      return content.some(
        (block: { type?: string; text?: string }) =>
          block.type === 'text' && block.text?.includes(`<${FORK_BOILERPLATE_TAG}>`),
      )
    }
    return false
  })
}

/** Context needed to create a fork child session. */
export interface ParentForkContext {
  messages: unknown[]
  systemPrompt: string
  tools: AgentTool[]
  provider: string
  model: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
}

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

// defineTool + toolResult helpers live in tools/_helpers.ts — imported at top of this file.

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
  /** Get parent session's full context for fork sub-agents. */
  getParentForkContext?: () => ParentForkContext | undefined
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
  const forbiddenPaths = config.security?.forbiddenPaths ?? []
  setForbiddenPaths(forbiddenPaths)

  const tools: AgentTool[] = [
    // ── Shell ───────────────────────────────────────────────────────
    defineTool({
      name: SHELL_TOOL_NAME,
      label: 'Shell',
      description: `Executes a shell command and returns its output.\n\nIMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands. Instead, use the appropriate dedicated tool:\n- File search: Use **${GLOB_TOOL_NAME}** (NOT find or ls)\n- Content search: Use **${GREP_TOOL_NAME}** (NOT grep or rg)\n- Read files: Use **${READ_TOOL_NAME}** (NOT cat/head/tail)\n- Edit files: Use **${EDIT_TOOL_NAME}** (NOT sed/awk)\n- Write files: Use **${WRITE_TOOL_NAME}** (NOT echo/cat redirection)\n- Git operations: Use **${GIT_TOOL_NAME}** (NOT shell with git commands)\n- HTTP APIs: Use **${HTTP_API_TOOL_NAME}** (NOT shell with curl)\n\nReserve shell exclusively for: running programs, installing packages, build commands, deploying code, and system operations that have no dedicated tool.`,
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

    // ── Read ────────────────────────────────────────────────────────
    defineTool({
      name: READ_TOOL_NAME,
      label: 'Read',
      description: `Reads a file from the filesystem. ALWAYS use this tool to read files. NEVER use ${SHELL_TOOL_NAME} with cat, head, or tail.\n\nUsage:\n- Returns file contents with line numbers (cat -n format)\n- Reads up to 2000 lines by default from the start of the file\n- Use offset and limit for large files to read specific sections\n- Can detect image files and report their metadata\n- The file_path should be an absolute path when possible`,
      parameters: Type.Object({
        file_path: Type.String({ description: 'Absolute path to the file to read' }),
        offset: Type.Optional(
          Type.Number({
            description:
              'Line number to start reading from (1-based). Only provide for large files.',
          }),
        ),
        limit: Type.Optional(
          Type.Number({ description: 'Number of lines to read. Only provide for large files.' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeRead(params)
        return toolResult(output)
      },
    }),

    // ── Write ───────────────────────────────────────────────────────
    defineTool({
      name: WRITE_TOOL_NAME,
      label: 'Write',
      description: `Writes a file to the filesystem. Creates parent directories automatically.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path\n- Prefer the **${EDIT_TOOL_NAME}** tool for modifying existing files — it only changes the specific part you need\n- Use this tool to create new files or for complete rewrites\n- NEVER use ${SHELL_TOOL_NAME} with echo/cat redirection to write files`,
      parameters: Type.Object({
        file_path: Type.String({ description: 'Absolute path to the file to write' }),
        content: Type.String({ description: 'The content to write to the file' }),
      }),
      async execute(_toolCallId, params) {
        const output = executeWrite(params)
        return toolResult(output)
      },
    }),

    // ── Edit ────────────────────────────────────────────────────────
    defineTool({
      name: EDIT_TOOL_NAME,
      label: 'Edit',
      description: `Performs exact string replacements in files. ALWAYS prefer this over ${WRITE_TOOL_NAME} for modifying existing files.\n\nUsage:\n- You must use ${READ_TOOL_NAME} first before editing to know the exact content to replace\n- Provide the exact string to find (old_string) and the replacement (new_string)\n- The edit will FAIL if old_string is not found or appears multiple times (unless replace_all is true)\n- Preserve exact indentation (tabs/spaces) when specifying old_string\n- Use replace_all for renaming variables or replacing all occurrences\n- NEVER use ${SHELL_TOOL_NAME} with sed or awk to edit files`,
      parameters: Type.Object({
        file_path: Type.String({ description: 'Absolute path to the file to modify' }),
        old_string: Type.String({ description: 'The exact text to find and replace' }),
        new_string: Type.String({
          description: 'The text to replace it with (must be different from old_string)',
        }),
        replace_all: Type.Optional(
          Type.Boolean({ description: 'Replace all occurrences of old_string (default: false)' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeEdit(params)
        return toolResult(output)
      },
    }),

    // ── Glob ────────────────────────────────────────────────────────
    defineTool({
      name: GLOB_TOOL_NAME,
      label: 'Glob',
      description: `Fast file pattern matching. ALWAYS use this to find files. NEVER use ${SHELL_TOOL_NAME} with find or ls.\n\n- Supports glob patterns like "*.js", "**/*.ts", "src/**/*.tsx"\n- Auto-excludes node_modules, .git, dist, build\n- Returns matching file paths sorted alphabetically\n- Use when you need to find files by name or extension pattern`,
      parameters: Type.Object({
        pattern: Type.String({
          description: 'Glob pattern to match files (e.g. "*.ts", "**/*.tsx")',
        }),
        path: Type.Optional(
          Type.String({
            description: 'Directory to search in. Defaults to current working directory.',
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const output = executeGlob(params)
        return toolResult(output)
      },
    }),

    // ── List (directory listing + tree) ─────────────────────────────
    defineTool({
      name: LIST_TOOL_NAME,
      label: 'List',
      description:
        'List directory contents or show directory tree structure.\n\n' +
        '- "list" operation: shows files with type and size (like ls -la)\n' +
        '- "tree" operation: shows nested directory structure\n' +
        '- Use for understanding project layout and directory contents',
      parameters: Type.Object({
        operation: Type.Union([Type.Literal('list'), Type.Literal('tree')], {
          description: '"list" for directory contents, "tree" for directory structure',
        }),
        path: Type.String({ description: 'Directory path' }),
        maxDepth: Type.Optional(Type.Number({ description: 'Max depth for tree (default: 3)' })),
      }),
      async execute(_toolCallId, params) {
        if (params.operation === 'tree') {
          const output = executeTree({ path: params.path, maxDepth: params.maxDepth })
          return toolResult(output)
        }
        const output = executeList({ path: params.path, maxDepth: params.maxDepth })
        return toolResult(output)
      },
    }),
    defineTool({
      name: BROWSER_TOOL_NAME,
      label: 'Browser',
      description: `Web browsing and browser automation. Two modes:\n• **fetch/extract** — Fast, lightweight. Use for reading articles, docs, APIs behind the scenes. No JS execution.\n• **open/snapshot/click/fill/scroll/screenshot/get/wait/close** — Full browser with live screenshots shown in the user sidebar. Use \`open\` when the user asks to visit, browse, scrape, or interact with a website. Chromium auto-installs on first use.\nFor local files, use the ${READ_TOOL_NAME} tool.`,
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
    // ── Artifact ────────────────────────────────────────────────────
    defineTool({
      name: 'artifact',
      label: 'Artifact',
      description: `Create a visual artifact displayed in the desktop side panel. Use for HTML pages/apps, rendered markdown, code files, SVG graphics, or mermaid diagrams. The content renders live in a preview panel next to the chat. Always use this for visual content the user should see rendered, not as raw text. When the user asks to "open", "view", or "show" a local file (.html, .svg, .md, .css, .js, .ts, etc.), read the file with the ${READ_TOOL_NAME} tool first, then display it here as an artifact — do NOT use the ${BROWSER_TOOL_NAME} tool for local files.`,
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

    // publish moved into buildSharedTools — see tools/factories.ts

    // ── Git ─────────────────────────────────────────────────────────
    defineTool({
      name: GIT_TOOL_NAME,
      label: 'Git',
      description: `ALWAYS use this tool for git operations. NEVER use ${SHELL_TOOL_NAME} with git commands.\n\nOperations: status, diff, log, commit, branch, checkout, stash, add, reset. Has safety guards that block dangerous operations like force-push and hard reset.`,
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

    // ── Grep (content search) ──────────────────────────────────────
    defineTool({
      name: GREP_TOOL_NAME,
      label: 'Grep',
      description: `A powerful content search tool built on ripgrep.\n\nALWAYS use this tool for searching code and text content in files. NEVER invoke \`grep\` or \`rg\` as a ${SHELL_TOOL_NAME} command — this tool is optimized with correct exclusions and result formatting.\n\n- Supports full regex syntax (e.g. "log.*Error", "function\\s+\\w+")\n- Filter by file type (e.g. "ts", "py", "rs")\n- Auto-excludes node_modules, .git, dist, build\n- Shows context lines around matches\n- Use for finding function definitions, references, imports, patterns across a codebase`,
      parameters: Type.Object({
        pattern: Type.String({ description: 'Search pattern — supports regex' }),
        path: Type.Optional(
          Type.String({ description: 'File or directory to search in (default: current dir)' }),
        ),
        file_type: Type.Optional(
          Type.String({ description: 'Filter by extension, e.g. "ts", "py", "rs"' }),
        ),
        context_lines: Type.Optional(
          Type.Number({ description: 'Lines of context before/after each match (default: 2)' }),
        ),
        max_results: Type.Optional(
          Type.Number({ description: 'Max matches to return (default: 20)' }),
        ),
      }),
      async execute(_toolCallId, params) {
        // Map 'pattern' to 'query' for the existing executeCodeSearch implementation
        const output = executeCodeSearch({
          query: params.pattern,
          path: params.path,
          file_type: params.file_type,
          context_lines: params.context_lines,
          max_results: params.max_results,
        })
        return toolResult(output)
      },
    }),

    // ── HTTP API ────────────────────────────────────────────────────
    defineTool({
      name: HTTP_API_TOOL_NAME,
      label: 'HTTP API',
      description: `ALWAYS use this tool for HTTP API calls. NEVER use ${SHELL_TOOL_NAME} with curl or wget.\n\nMakes structured HTTP API calls with JSON parsing and response extraction. Auto-parses JSON, supports JSONPath extraction. Use for REST APIs, webhooks, and structured HTTP requests.`,
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

    // ── Anton core tools (database, memory, notification, publish,
    //    update_project_context, activate_workflow). Definitions live
    //    in the per-tool files next to each impl; buildAntonCoreTools
    //    is the single catalog both Pi SDK and the harness MCP shim
    //    consume. DO NOT inline duplicates here — extend the relevant
    //    per-tool file instead.
    ...buildAntonCoreTools({
      conversationId: callbacks?.conversationId,
      projectId: callbacks?.projectId,
      onActivateWorkflow: callbacks?.onActivateWorkflow,
      domain: callbacks?.domain,
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

    // notification moved into buildSharedTools — see tools/factories.ts

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

  // activate_workflow moved into buildSharedTools — see tools/factories.ts

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

  // ── Sub-agent (depth-limited — sub-agents cannot spawn further sub-agents) ──
  const currentDepth = callbacks?.subAgentDepth ?? 0
  const MAX_SUB_AGENT_DEPTH = 1

  if (currentDepth < MAX_SUB_AGENT_DEPTH) {
    tools.push(
      defineTool({
        name: 'sub_agent',
        label: 'Sub Agent',
        description:
          'Spawn a sub-agent that runs autonomously. ' +
          'Set `type` to specialize: "research" (information gathering, no file changes), "execute" (carry out a specific plan), "verify" (run tests/checks, report verdict). ' +
          'Omit `type` to create a **fork** that inherits your full conversation context — use when the task needs prior discussion history or would be tedious to restate as a self-contained prompt. ' +
          'Multiple sub_agent calls in the same response run in parallel. ' +
          'With a type: the sub-agent starts fresh — the task string is its entire context, make it self-contained. ' +
          "Without a type (fork): the sub-agent sees everything you've seen — write a short directive, not a full briefing.",
        parameters: Type.Object({
          task: Type.String({
            description:
              'For typed sub-agents: detailed, self-contained description with all context. For forks (no type): a short directive — the fork already has your conversation context.',
          }),
          type: Type.Optional(
            Type.Union(
              [Type.Literal('research'), Type.Literal('execute'), Type.Literal('verify')],
              {
                description:
                  'Sub-agent specialization. Omit to fork (inherits conversation context). ' +
                  'research: deep information gathering from web/files/APIs — does not modify files. ' +
                  'execute: carry out a specific build/change task to completion and verify the result. ' +
                  'verify: run tests/builds/checks and report PASS/FAIL/PARTIAL verdict without fixing issues.',
              },
            ),
          ),
        }),
        async execute(toolCallId, params) {
          const onEvent = callbacks?.onSubAgentEvent
          const isFork = !params.type

          // Emit sub_agent_start
          onEvent?.({
            type: 'sub_agent_start',
            toolCallId,
            task: params.task,
            agentType: isFork ? undefined : params.type,
            parentToolCallId: toolCallId,
          })

          let finalText = ''
          let hadError = false

          try {
            // Lazy import to avoid circular dependency (agent.ts <-> session.ts)
            const { Session } = await import('./session.js')

            if (isFork) {
              // ── Fork path: inherit parent's full context ──
              const forkContext = callbacks?.getParentForkContext?.()
              if (!forkContext) {
                throw new Error('Fork sub-agent requires parent context but none is available.')
              }

              // Prevent recursive forking
              if (isInForkChild(forkContext.messages)) {
                throw new Error(
                  'Cannot fork inside a forked worker. You ARE the fork — execute directly using your tools.',
                )
              }

              // Clone parent messages and append fork directive
              const forkedMessages = structuredClone(forkContext.messages)
              // Append user message with fork directive + task
              forkedMessages.push({
                role: 'user',
                content: [{ type: 'text', text: buildForkChildMessage(params.task) }],
                timestamp: Date.now(),
              })

              // Build tools for fork child (depth incremented, no type filtering)
              const forkTools = buildTools(
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
                  conversationId: callbacks?.projectId
                    ? `project-${callbacks.projectId}`
                    : callbacks?.conversationId,
                },
                mcpManager,
              )

              const forkSession = new Session({
                id: `fork_${toolCallId}`,
                provider: forkContext.provider,
                model: forkContext.model,
                config,
                tools: forkTools,
                apiKey: callbacks?.clientApiKey,
                existingMessages: forkedMessages,
                ephemeral: true,
                // Fork children use the parent's rendered system prompt
                systemPromptOverride: forkContext.systemPrompt,
                thinkingLevel: forkContext.thinkingLevel,
                // Turn-based limits (primary) — no token budget for forks
                maxTurns: FORK_MAX_TURNS,
                maxDurationMs: 600_000, // 10 minutes safety net
                maxTokenBudget: 0, // disabled — turns are the primary limit
                parentTraceSpan: callbacks?.getParentTraceSpan?.(),
              })

              // Wire confirm handler
              const confirmHandler = callbacks?.getConfirmHandler?.()
              if (confirmHandler) {
                forkSession.setConfirmHandler(confirmHandler)
              }

              // Trigger the fork — the existing messages already contain the directive,
              // so we send a minimal follow-up to kick off processing
              for await (const event of forkSession.processMessage(
                '[Execute the directive above. Begin immediately with tool calls.]',
              )) {
                if (onEvent && event.type !== 'done' && event.type !== 'title_update') {
                  onEvent({
                    ...event,
                    parentToolCallId: toolCallId,
                  } as import('./session.js').SessionEvent & { parentToolCallId: string })
                }
                if (event.type === 'text' && event.content) {
                  onEvent?.({
                    type: 'sub_agent_progress',
                    toolCallId,
                    content: event.content,
                    parentToolCallId: toolCallId,
                  } as import('./session.js').SessionEvent & { parentToolCallId: string })
                }
                if (event.type === 'text') {
                  finalText += event.content
                }
                if (event.type === 'error') {
                  hadError = true
                  finalText += `\nError: ${event.message}`
                }
              }
            } else {
              // ── Typed sub-agent path: fresh session with type prefix ──

              // Build tools for sub-agent with depth incremented, then filter by type
              let subTools = buildTools(
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
                  conversationId: callbacks?.projectId
                    ? `project-${callbacks.projectId}`
                    : callbacks?.conversationId,
                },
                mcpManager,
              )

              // Filter tools based on sub-agent type specialization
              // params.type is guaranteed non-undefined in this else branch (isFork is false)
              const agentType = params.type as SubAgentType
              if (SUB_AGENT_ALLOWED_TOOLS[agentType]) {
                const allowed = SUB_AGENT_ALLOWED_TOOLS[agentType]
                subTools = subTools.filter((t) => allowed.has(t.name))
              }

              const subSession = new Session({
                id: `sub_${toolCallId}`,
                provider: config.defaults.provider,
                model: config.defaults.model,
                config,
                tools: subTools,
                apiKey: callbacks?.clientApiKey,
                ephemeral: true,
                // Safety limits for typed sub-agents (budget varies by type)
                maxTokenBudget: SUB_AGENT_BUDGETS[agentType].maxTokenBudget,
                maxDurationMs: 600_000, // 10 minutes
                maxTurns: SUB_AGENT_BUDGETS[agentType].maxTurns,
                maxToolCalls: agentType === 'research' ? { browser: 5, http_api: 10 } : undefined,
                parentTraceSpan: callbacks?.getParentTraceSpan?.(),
              })

              // Wire confirm handler
              const confirmHandler = callbacks?.getConfirmHandler?.()
              if (confirmHandler) {
                subSession.setConfirmHandler(confirmHandler)
              }

              const subAgentMessage = `${SUB_AGENT_TYPE_PREFIXES[agentType]}${params.task}`

              for await (const event of subSession.processMessage(subAgentMessage)) {
                if (onEvent && event.type !== 'done' && event.type !== 'title_update') {
                  onEvent({
                    ...event,
                    parentToolCallId: toolCallId,
                  } as import('./session.js').SessionEvent & { parentToolCallId: string })
                }
                if (event.type === 'text' && event.content) {
                  onEvent?.({
                    type: 'sub_agent_progress',
                    toolCallId,
                    content: event.content,
                    parentToolCallId: toolCallId,
                  } as import('./session.js').SessionEvent & { parentToolCallId: string })
                }
                if (event.type === 'text') {
                  finalText += event.content
                }
                if (event.type === 'error') {
                  hadError = true
                  finalText += `\nError: ${event.message}`
                }
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

  // update_project_context moved into buildSharedTools — see tools/factories.ts

  // ── Routine management (only for project-scoped sessions with handler) ──
  if (callbacks?.projectId && callbacks?.onJobAction) {
    const projectId = callbacks.projectId
    const agentHandler = callbacks.onJobAction
    const getAskUser = callbacks?.getAskUserHandler
    tools.push(
      defineTool({
        name: 'routine',
        label: 'Routine',
        description:
          'Create and manage routines — autonomous conversations that run on a schedule. ' +
          'A routine is its own conversation with full tool and MCP access that executes instructions repeatedly. ' +
          'Operations: create (define a new routine), list (show all routines), start (trigger a run), stop (cancel a run), ' +
          'delete (remove a routine), status (check routine details). ' +
          'IMPORTANT: For create, the user will be asked to confirm before the routine is created.',
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
                'Routine name (for create, or for delete/start/stop to display in confirmation)',
            }),
          ),
          description: Type.Optional(
            Type.String({ description: 'What the routine does (for create)' }),
          ),
          prompt: Type.Optional(
            Type.String({
              description:
                'Instructions for the routine — what it should do on each run. Be specific.',
            }),
          ),
          schedule: Type.Optional(
            Type.String({
              description:
                'Cron expression for scheduling, e.g. "0 9 * * *" for daily at 9am, "0 */6 * * *" for every 6 hours. Omit for manual-only.',
            }),
          ),
          routine_id: Type.Optional(
            Type.String({ description: 'Routine session ID (for start/stop/delete/status)' }),
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
                  question: `Create routine "${params.name || 'Untitled'}"?`,
                  description: params.description || '',
                  options: ['Yes, create it', 'No, cancel'],
                  allowFreeText: false,
                  metadata: {
                    type: 'routine_create',
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
                return toolResult('Routine creation cancelled by user.')
              }
            }
          }

          // For delete: also require confirmation
          if (params.operation === 'delete' && getAskUser) {
            const askUser = getAskUser()
            if (askUser) {
              const displayName = params.name || params.routine_id || 'this routine'
              const answers = await askUser([
                {
                  question: `Delete routine "${displayName}"?`,
                  description: 'This will remove the routine and its conversation history.',
                  options: ['Yes, delete it', 'No, keep it'],
                  allowFreeText: false,
                  metadata: {
                    type: 'routine_delete',
                    name: displayName,
                    routineId: params.routine_id || '',
                  },
                },
              ])
              const answer = Object.values(answers)[0]
              if (
                answer &&
                (answer.toLowerCase().includes('no') || answer.toLowerCase().includes('keep'))
              ) {
                return toolResult('Routine deletion cancelled by user.')
              }
            }
          }

          const input: JobToolInput = {
            operation: params.operation,
            name: params.name,
            description: params.description,
            prompt: params.prompt,
            schedule: params.schedule,
            jobId: params.routine_id,
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
