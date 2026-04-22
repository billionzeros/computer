export type { HarnessAdapter, SpawnOpts, EnvOpts, DetectResult } from './adapter.js'
export { ClaudeAdapter } from './adapters/claude.js'
export { CodexAdapter } from './adapters/codex.js'
export type { ClaudeStreamEvent } from './claude-events.js'
export type { CodexStreamEvent } from './codex-events.js'
export {
  HarnessSession,
  isHarnessSession,
  type HarnessSessionOpts,
  type HarnessMcpOpts,
} from './harness-session.js'
export {
  CodexHarnessSession,
  type CodexHarnessSessionOpts,
  type CodexHarnessMcpOpts,
} from './codex-harness-session.js'
export {
  buildMcpSpawnConfig,
  getExpectedShimVersion,
  probeMcpShim,
  type McpSpawnConfig,
  type ShimProbeResult,
  type ShimProbeOk,
  type ShimProbeErr,
} from './mcp-spawn-config.js'
export type { CodexRpcClient, CodexRpcError } from './codex-rpc.js'
export { PINNED_CLI_VERSION, MIN_SUPPORTED_CLI_VERSION, detectCodexCli } from './codex-version.js'
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
  ANTON_MCP_NAMESPACE,
  buildHarnessCapabilityBlock,
  buildHarnessContextPrompt,
  buildHarnessIdentityBlock,
  type HarnessContextPromptOpts,
  type LiveConnectorSummary,
  type WorkflowEntry,
} from '../prompt-layers.js'
export {
  synthesizeHarnessTurn,
  ensureHarnessSessionInit,
  appendHarnessTurn,
  readHarnessHistory,
  writeHarnessSessionTitle,
  type HarnessSessionInitOpts,
  type AppendHarnessTurnOpts,
  type WriteHarnessSessionTitleOpts,
} from './mirror.js'
export { buildReplaySeed, type BuildReplaySeedOpts } from './replay.js'
export {
  extractHarnessMemoriesFromMirror,
  type ExtractHarnessMemoriesOpts,
  type HarnessExtractionResult,
} from './memory-extract.js'
