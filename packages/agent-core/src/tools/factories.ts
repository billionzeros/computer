/**
 * Anton core tool catalog.
 *
 * One entry point — `buildAntonCoreTools(ctx)` — that returns the set
 * of Anton-specific tools a session should have. Each tool's definition
 * lives in its own file next to its implementation (memory.ts,
 * database.ts, etc.); this file only decides which to include based on
 * the session's context (projectId, handlers, domain).
 *
 * "Anton core" = the tools that define what Anton adds on top of any
 * execution backend. The Pi SDK agent spreads this array into its full
 * tool set (alongside shell/read/write/etc.). The harness MCP shim
 * routes each tool through an AgentTool→MCP adapter so a Claude Code or
 * Codex subprocess sees the same Anton tools through MCP.
 *
 * Do not inline tool definitions here. Extend by editing the relevant
 * per-tool file and adding it to the array below.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { AskUserHandler } from '../agent.js'
import { type ActivateWorkflowHandler, buildActivateWorkflowTool } from './activate-workflow.js'
import { buildAntonWebResearchTool } from './anton-web-research.js'
import { buildAntonWebSearchTool } from './anton-web-search.js'
import { buildArtifactTool } from './artifact-factory.js'
import { buildAskUserTool } from './ask-user.js'
import { buildBrowserTool } from './browser-factory.js'
import type { BrowserCallbacks } from './browser.js'
import { buildClipboardTool } from './clipboard-factory.js'
import { buildDatabaseTool } from './database.js'
import { buildDeliverResultTool } from './deliver-result-factory.js'
import type { DeliverResultHandler } from './deliver-result.js'
import { buildImageTool } from './image-factory.js'
import type { JobActionHandler } from './job.js'
import { buildMemoryTool } from './memory.js'
import { buildNotificationTool } from './notification.js'
import { buildPublishTool } from './publish.js'
import { buildRoutineTool } from './routine-factory.js'
import { type SetSessionTitleHandler, buildSetSessionTitleTool } from './set-session-title.js'
import { buildSpawnSubAgentTool } from './spawn-sub-agent.js'
import { buildTaskTrackerTool } from './task-tracker-factory.js'
import { buildUpdateProjectContextTool } from './update-project-context.js'

/**
 * Resolved provider for a proxy-style connector — base URL of the proxy
 * worker plus the bearer token to send. Returned by `ProviderTokenResolver`,
 * consumed by anton-core canonical tools (`web_search`, `web_research`).
 */
export interface ResolvedProviderToken {
  baseUrl: string
  token: string
}

/**
 * Resolves a connector's `{ baseUrl, token }` pair on demand. Implemented
 * server-side as the union of two paths — API-key from the connector
 * config row (for `type: 'api'` connectors with manually-pasted creds) OR
 * OAuth token from the credential store paired with the connector class's
 * `proxyBaseUrl`. Anton-core wrappers don't know which path was used; they
 * just call the resolver and get back enough to make an HTTP request.
 *
 * Returns null when the connector is disabled, missing, or has no
 * resolvable credentials yet — the calling tool surfaces a setup message
 * to the user instead of a half-formed request.
 */
export type ProviderTokenResolver = (connectorId: string) => Promise<ResolvedProviderToken | null>

export interface AntonCoreToolContext {
  /**
   * Conversation / session ID. Threads through to memory scoping so
   * conversation-scoped memories are stored under the right dir.
   */
  conversationId?: string
  /** Project the session is attached to. Gates project-scoped tools. */
  projectId?: string
  /**
   * Workspace directory to seed child sessions with. When
   * `spawn_sub_agent` is called inside a project, its child gets this
   * as cwd so it can read project files.
   */
  workspacePath?: string
  /**
   * Handler for the activate_workflow tool. Leave undefined to hide the
   * tool (e.g. for scheduled-agent sessions that shouldn't activate
   * workflows recursively).
   */
  onActivateWorkflow?: ActivateWorkflowHandler
  /**
   * Handler that displays interactive multi-choice questions to the
   * user. When set, the `ask_user` tool is exposed. Pi SDK callers leave
   * this undefined and use Session.setAskUserHandler instead, which feeds
   * an inline copy of the tool inside agent.ts.
   */
  onAskUser?: AskUserHandler
  /** Domain used by the publish tool to build the public URL. */
  domain?: string
  /**
   * Browser-state callbacks for the `browser` tool. When undefined, the
   * tool still works for `fetch` / `extract` (no live state needed),
   * but the desktop sidebar won't update on `open` / `screenshot` /
   * etc. Pi SDK passes the same callbacks via `ToolCallbacks`.
   */
  browserCallbacks?: BrowserCallbacks
  /**
   * Handler that delivers an agent's final result back to the
   * conversation that spawned it. When set, the `deliver_result` tool
   * is exposed. Pi SDK callers leave this undefined unless the agent
   * has an explicit handoff handler (scheduled / sub-agent paths).
   */
  onDeliverResult?: DeliverResultHandler
  /**
   * Job-action handler used by the `routine` tool. Project-scoped:
   * tool only registered when both `projectId` AND this handler are
   * set. Pi SDK has its own inline copy in agent.ts.
   */
  onJobAction?: JobActionHandler
  /**
   * When true, include harness-only tools (e.g. `spawn_sub_agent`)
   * that rely on the MCP progress plumbing. Pi SDK callers of
   * `buildTools()` spread only the core tools and keep their own
   * inline sub_agent implementation, so we keep the default off.
   */
  includeHarnessMcpTools?: boolean
  /**
   * Handler the `set_session_title` tool forwards to. Server wires this
   * per-session so the tool call lands on the owning session's
   * `setTitle()`, which emits a `title_update` SessionEvent. Undefined =
   * tool hidden (Pi SDK path, which uses its own `generateAITitle`).
   */
  onSetTitle?: SetSessionTitleHandler
  /**
   * Resolves a connector's proxy URL + bearer token on demand. Used by
   * `web_search` (delegates to `exa-search`) and `web_research` (delegates
   * to `parallel-research`) so they don't have to embed OAuth /
   * credential-store knowledge in agent-core. Server wires this; when
   * undefined the canonical wrappers return a "not configured" message.
   */
  resolveProviderToken?: ProviderTokenResolver
}

/**
 * Return the Anton-core tool set for a given session context.
 * Callers get exactly the tools their context permits:
 *   - no projectId         → no update_project_context, no activate_workflow
 *   - no onActivateWorkflow → no activate_workflow
 */
export function buildAntonCoreTools(ctx: AntonCoreToolContext = {}): AgentTool[] {
  const tools: AgentTool[] = [
    buildDatabaseTool(),
    buildMemoryTool(ctx.conversationId),
    buildNotificationTool(),
    buildPublishTool({ domain: ctx.domain, askUser: ctx.onAskUser }),
    // Exposed to every harness surface as `anton:web_search` via the
    // MCP shim. Delegates to whichever auth path the `exa-search`
    // connector uses (API-key or OAuth) via `resolveProviderToken`. When
    // no resolver is wired (or no connector is enabled) the tool returns
    // a setup message instead of failing opaquely.
    buildAntonWebSearchTool({ resolveProviderToken: ctx.resolveProviderToken }),
    // Sibling of web_search backed by the Parallel research-proxy. Use
    // for deep multi-hop research; web_search is faster for simple
    // lookups. Same resolver pattern as web_search.
    buildAntonWebResearchTool({ resolveProviderToken: ctx.resolveProviderToken }),
    // Renders rich content in the desktop side panel. Pi SDK has the
    // same tool inline in agent.ts; both paths emit the artifact
    // SessionEvent (Pi SDK via Session.detectArtifact, harness via the
    // CodexHarnessSession mcpToolCall handler).
    buildArtifactTool(),
    // Screenshot / resize / convert / crop / info. Pi SDK has its own
    // inline copy in agent.ts; the harness path needs the factory so
    // codex / Claude Code can take screenshots without shelling out.
    buildImageTool(),
    // Read / write the system clipboard. Trivial but lets the model
    // act on "paste what I just copied".
    buildClipboardTool(),
    // Web browsing + Playwright automation. Same callbacks Pi SDK
    // uses to drive the desktop browser sidebar — when undefined, the
    // tool still supports the lightweight fetch/extract operations.
    buildBrowserTool(ctx.browserCallbacks),
    // Session-scoped work plan. Codex emits its own plan items which
    // the harness session translates directly; Claude Code has no
    // equivalent native surface, so this MCP tool is the only path
    // for Claude Code to populate the desktop checklist.
    buildTaskTrackerTool(),
  ]
  if (ctx.includeHarnessMcpTools) {
    // Typed sub-agent dispatch (research/execute/verify). Pi SDK has
    // its own inline `sub_agent` tool (see agent.ts), so we gate this
    // behind the harness flag to avoid showing two near-duplicate
    // tools in the Pi SDK path.
    tools.push(
      buildSpawnSubAgentTool({
        parentProjectId: ctx.projectId,
        parentWorkspacePath: ctx.workspacePath,
      }),
    )
    // ask_user only flows over the harness MCP shim. Pi SDK keeps its
    // inline tool in agent.ts because Session has its own setter for
    // the handler. Both paths produce the same Channel.AI ask_user
    // round-trip server-side.
    if (ctx.onAskUser) {
      tools.push(buildAskUserTool(ctx.onAskUser))
    }
    // One-shot conversation title. Only the harness path needs it: Pi
    // SDK already runs `generateAITitle` at turn-start from within the
    // session, so giving the model a tool would be redundant.
    if (ctx.onSetTitle) {
      tools.push(buildSetSessionTitleTool(ctx.onSetTitle))
    }
  }
  if (ctx.projectId) {
    tools.push(buildUpdateProjectContextTool())
    if (ctx.onActivateWorkflow) {
      tools.push(buildActivateWorkflowTool(ctx.projectId, ctx.onActivateWorkflow))
    }
    if (ctx.onJobAction) {
      tools.push(
        buildRoutineTool({
          projectId: ctx.projectId,
          jobActionHandler: ctx.onJobAction,
          askUser: ctx.onAskUser,
        }),
      )
    }
  }
  if (ctx.onDeliverResult) {
    tools.push(buildDeliverResultTool(ctx.onDeliverResult))
  }
  return tools
}
