export {
  CORE_SYSTEM_PROMPT,
  buildTools,
  needsConfirmation,
  type AskUserHandler,
  type ToolCallbacks,
} from './agent.js'
export type { ActivateWorkflowHandler } from './tools/activate-workflow.js'
export type { SharedStateHandler } from './tools/shared-state.js'
export type { JobActionHandler, JobToolInput } from './tools/job.js'
export type { DeliverResultHandler } from './tools/deliver-result.js'
export {
  McpClient,
  McpManager,
  matchesSurface,
  type McpServerConfig,
  type ConnectorStatus,
  type McpToolPermission,
} from './mcp/index.js'
export {
  type CompactionConfig,
  type CompactionState,
  compactContext,
  createInitialCompactionState,
  estimateMessageTokens,
  estimateTokens,
  getDefaultCompactionConfig,
  getModelContextSize,
  trimToolOutputs,
} from './compaction.js'
export {
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_USER_PROMPT_PREFIX,
  COMPACTION_CUSTOM_INSTRUCTIONS_PREFIX,
  buildCompactionUserPrompt,
} from './compaction-prompt.js'
export {
  Session,
  createSession,
  resumeSession,
  type ConfirmHandler,
  type SessionEvent,
  type SessionInfo,
  type SubAgentEventHandler,
  type SurfaceInfo,
} from './session.js'
export {
  type ContextInfo,
  type MemoryData,
  type MemoryItem,
  type MemoryItemWithSource,
  assembleConversationContext,
} from './context.js'
export {
  executeCommand,
  listCommands,
  parseCommand,
  type Command,
  type CommandContext,
  type CommandResult,
} from './commands.js'
export { executePublish, type PublishInput } from './tools/publish.js'
// Individual tool factories (buildMemoryTool, buildDatabaseTool, etc.) are
// internal to agent-core — external callers should use buildAntonCoreTools
// or, for the Pi SDK path, go through buildTools() from './agent.js'.
export {
  buildAntonCoreTools,
  type AntonCoreToolContext,
  type ProviderTokenResolver,
  type ResolvedProviderToken,
} from './tools/factories.js'
export { initTracing, flushTraces, hashPromptVersion, logSpanFeedback } from './tracing.js'
export { closeBrowserSession } from './tools/browser.js'
export {
  type HarnessAdapter,
  ClaudeAdapter,
  CodexAdapter,
  HarnessSession,
  CodexHarnessSession,
  type CodexHarnessSessionOpts,
  type CodexHarnessMcpOpts,
  type HarnessMcpOpts,
  isHarnessSession,
  type HarnessSessionOpts,
  createMcpIpcServer,
  type IpcToolProvider,
  type McpIpcServer,
  type McpToolSchema,
  type McpToolResult,
  AntonToolRegistry,
  type AntonToolRegistryOpts,
  type HarnessSessionContext,
  ANTON_MCP_NAMESPACE,
  buildHarnessCapabilityBlock,
  buildHarnessContextPrompt,
  type HarnessContextPromptOpts,
  type LiveConnectorSummary,
  type WorkflowEntry,
  synthesizeHarnessTurn,
  ensureHarnessSessionInit,
  appendHarnessTurn,
  popLastTurnFromHarness,
  readHarnessHistory,
  readLastUserFromHarness,
  writeHarnessSessionTitle,
  buildReplaySeed,
  extractHarnessMemoriesFromMirror,
  buildMcpSpawnConfig,
  getExpectedShimVersion,
  probeMcpShim,
  type McpSpawnConfig,
  type ShimProbeResult,
  type ShimProbeOk,
  type ShimProbeErr,
} from './harness/index.js'
export { resolveModel } from './session.js'
export {
  SessionRegistry,
  DEFAULT_POOLS,
  type SessionCategory,
  type PoolConfig,
  type SessionRegistryOpts,
  type Shutdownable,
} from './session-registry.js'
