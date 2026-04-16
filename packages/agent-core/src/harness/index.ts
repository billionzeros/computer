export { type HarnessAdapter, type SpawnOpts, type EnvOpts, type DetectResult } from './adapter.js'
export { ClaudeAdapter } from './adapters/claude.js'
export { CodexAdapter } from './adapters/codex.js'
export type { ClaudeStreamEvent } from './claude-events.js'
export type { CodexStreamEvent } from './codex-events.js'
export { HarnessSession, isHarnessSession, type HarnessSessionOpts } from './harness-session.js'
export {
  createMcpIpcServer,
  type IpcToolProvider,
  type McpIpcServer,
  type McpToolSchema,
  type McpToolResult,
} from './mcp-ipc-handler.js'
export {
  AntonToolRegistry,
  agentToolToMcpDefinition,
  type AntonToolRegistryOpts,
  type HarnessSessionContext,
} from './tool-registry.js'
// Per-layer builders are internal to agent-core. External callers should
// use buildHarnessContextPrompt when they need the full harness context
// string; it lives next to Session.getSystemPrompt in prompt-layers.ts.
export {
  buildHarnessContextPrompt,
  type HarnessContextPromptOpts,
  type WorkflowEntry,
} from '../prompt-layers.js'
export {
  synthesizeHarnessTurn,
  ensureHarnessSessionInit,
  appendHarnessTurn,
  type HarnessSessionInitOpts,
  type AppendHarnessTurnOpts,
} from './mirror.js'
