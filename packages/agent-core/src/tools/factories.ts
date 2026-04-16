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
import { buildDatabaseTool } from './database.js'
import { buildMemoryTool } from './memory.js'
import { buildNotificationTool } from './notification.js'
import { buildPublishTool } from './publish.js'
import { type ActivateWorkflowHandler, buildActivateWorkflowTool } from './activate-workflow.js'
import { buildUpdateProjectContextTool } from './update-project-context.js'

export interface AntonCoreToolContext {
  /**
   * Conversation / session ID. Threads through to memory scoping so
   * conversation-scoped memories are stored under the right dir.
   */
  conversationId?: string
  /** Project the session is attached to. Gates project-scoped tools. */
  projectId?: string
  /**
   * Handler for the activate_workflow tool. Leave undefined to hide the
   * tool (e.g. for scheduled-agent sessions that shouldn't activate
   * workflows recursively).
   */
  onActivateWorkflow?: ActivateWorkflowHandler
  /** Domain used by the publish tool to build the public URL. */
  domain?: string
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
    buildPublishTool(ctx.domain),
  ]
  if (ctx.projectId) {
    tools.push(buildUpdateProjectContextTool())
    if (ctx.onActivateWorkflow) {
      tools.push(buildActivateWorkflowTool(ctx.projectId, ctx.onActivateWorkflow))
    }
  }
  return tools
}
