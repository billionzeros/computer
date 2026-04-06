import type { AgentSession, Project } from './projects.js'

// ── Control Channel (0x00) ──────────────────────────────────────────

export interface AuthMessage {
  type: 'auth'
  token: string
}

export interface AuthOkMessage {
  type: 'auth_ok'
  agentId: string
  version: string
  gitHash: string
  /** If the agent knows a newer version is available, include it here. */
  updateAvailable?: {
    version: string
    changelog: string
    releaseUrl: string
  }
}

export interface AuthErrorMessage {
  type: 'auth_error'
  reason: string
}

export interface PingMessage {
  type: 'ping'
}

export interface PongMessage {
  type: 'pong'
}

export interface ConfigQueryMessage {
  type: 'config_query'
  key: 'providers' | 'defaults' | 'security' | 'system_prompt' | 'memories'
  /** Optional session ID — when provided, system_prompt returns the full composed prompt and memories includes conversation-scoped ones. */
  sessionId?: string
  /** Optional project ID — when provided, memories also includes project-scoped context. */
  projectId?: string
}

export interface ConfigQueryResponse {
  type: 'config_query_response'
  key: string
  value: unknown
}

export interface ConfigUpdateMessage {
  type: 'config_update'
  key: string
  value: unknown
}

export interface ConfigUpdateResponse {
  type: 'config_update_response'
  success: boolean
  error?: string
}

// ── Update messages ──────────────────────────────────────────────

/** Client asks agent to check for updates now */
export interface UpdateCheckMessage {
  type: 'update_check'
}

/** Agent responds with current update status */
export interface UpdateCheckResponse {
  type: 'update_check_response'
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

/** Client tells agent to self-update */
export interface UpdateStartMessage {
  type: 'update_start'
}

/** Agent streams progress as it updates */
export interface UpdateProgressMessage {
  type: 'update_progress'
  stage:
    | 'checking'
    | 'stopping'
    | 'downloading'
    | 'installing'
    | 'building'
    | 'starting'
    | 'swapping'
    | 'verifying'
    | 'done'
    | 'error'
  message: string
}

export type ControlMessage =
  | AuthMessage
  | AuthOkMessage
  | AuthErrorMessage
  | PingMessage
  | PongMessage
  | ConfigQueryMessage
  | ConfigQueryResponse
  | ConfigUpdateMessage
  | ConfigUpdateResponse
  | UpdateCheckMessage
  | UpdateCheckResponse
  | UpdateStartMessage
  | UpdateProgressMessage

// ── Terminal Channel (0x01) ─────────────────────────────────────────

export interface PtySpawnMessage {
  type: 'pty_spawn'
  id: string
  cols: number
  rows: number
  shell?: string
  cwd?: string // working directory — defaults to project workspace
}

export interface PtyResizeMessage {
  type: 'pty_resize'
  id: string
  cols: number
  rows: number
}

export interface PtyCloseMessage {
  type: 'pty_close'
  id: string
}

export interface PtyDataMessage {
  type: 'pty_data'
  id: string
  data: string // base64 for binary safety over JSON
}

export type TerminalMessage = PtySpawnMessage | PtyResizeMessage | PtyCloseMessage | PtyDataMessage

// ── AI Channel (0x02) ───────────────────────────────────────────────

// Session management
export interface SessionCreateMessage {
  type: 'session_create'
  id: string
  provider?: string
  model?: string
  apiKey?: string // client-provided key override (not persisted)
  projectId?: string // create session scoped to a project
}

export interface SessionCreatedMessage {
  type: 'session_created'
  id: string
  provider: string
  model: string
}

export interface ContextInfoMessage {
  type: 'context_info'
  sessionId: string
  globalMemories: string[]
  conversationMemories: string[]
  crossConversationMemories: Array<{
    fromConversation: string
    conversationTitle: string
    memoryKey: string
  }>
  projectId?: string
}

export interface SessionsListMessage {
  type: 'sessions_list'
}

export interface SessionMeta {
  id: string
  title: string
  provider: string
  model: string
  messageCount: number
  createdAt: number
  lastActiveAt: number
}

export interface SessionsListResponse {
  type: 'sessions_list_response'
  sessions: SessionMeta[]
}

export interface SessionDestroyMessage {
  type: 'session_destroy'
  id: string
}

export interface SessionDestroyedMessage {
  type: 'session_destroyed'
  id: string
}

export interface SessionHistoryMessage {
  type: 'session_history'
  id: string
  /** Load entries with seq < this value (for pagination). Omit for latest page. */
  before?: number
  /** Max entries to return (default: 200) */
  limit?: number
}

export interface SessionHistoryEntry {
  seq: number
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: string
  ts: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolId?: string
  isError?: boolean
  isThinking?: boolean
  attachments?: SessionImageAttachment[]
}

export interface SessionHistoryArtifact {
  id: string
  type: 'file' | 'output' | 'artifact'
  renderType: string
  title?: string
  filename?: string
  filepath?: string
  language: string
  content: string
  toolCallId: string
}

export interface SessionHistoryResponse {
  type: 'session_history_response'
  id: string
  messages: SessionHistoryEntry[]
  /** Seq of the last message in the full session history */
  lastSeq: number
  /** Total number of entries in the full session */
  totalCount: number
  /** True if there are older messages before the returned page */
  hasMore: boolean
  /** Artifacts extracted from full history (only included on first page) */
  artifacts?: SessionHistoryArtifact[]
}

export interface ChatImageAttachmentInput {
  id: string
  name: string
  mimeType: string
  data: string
  sizeBytes: number
}

export interface SessionImageAttachment {
  id: string
  name: string
  mimeType: string
  storagePath: string
  sizeBytes: number
  data?: string
}

// Provider management
export interface ProvidersListMessage {
  type: 'providers_list'
}

export interface ProviderInfoPayload {
  name: string
  models: string[]
  defaultModels?: string[]
  hasApiKey: boolean
  baseUrl?: string
}

export interface ProvidersListResponse {
  type: 'providers_list_response'
  providers: ProviderInfoPayload[]
  defaults: { provider: string; model: string }
  onboarding?: { completed: boolean; role?: string }
}

export interface ProviderSetKeyMessage {
  type: 'provider_set_key'
  provider: string
  apiKey: string
}

export interface ProviderSetKeyResponse {
  type: 'provider_set_key_response'
  success: boolean
  provider: string
}

export interface ProviderSetDefaultMessage {
  type: 'provider_set_default'
  provider: string
  model: string
}

export interface ProviderSetDefaultResponse {
  type: 'provider_set_default_response'
  success: boolean
  provider: string
  model: string
}

export interface ProviderSetModelsMessage {
  type: 'provider_set_models'
  provider: string
  models: string[]
}

export interface ProviderSetModelsResponse {
  type: 'provider_set_models_response'
  success: boolean
  provider: string
}

// Chat messages
export interface AiUserMessage {
  type: 'message'
  content: string
  sessionId?: string // target session (defaults to "default")
  attachments?: ChatImageAttachmentInput[]
}

// Steering: user sends a message while the agent is actively working
export interface AiSteerMessage {
  type: 'steer'
  content: string
  sessionId?: string
  attachments?: ChatImageAttachmentInput[]
}

/** Client requests cancellation of the active turn */
export interface AiCancelTurnMessage {
  type: 'cancel_turn'
  sessionId?: string
}

export interface AiSteerAckMessage {
  type: 'steer_ack'
  content: string
  sessionId?: string
  attachments?: ChatImageAttachmentInput[]
}

export interface AiThinkingMessage {
  type: 'thinking'
  text: string
  sessionId?: string
}

export interface AiTextMessage {
  type: 'text'
  content: string
  sessionId?: string
  parentToolCallId?: string // set when this event is from a sub-agent
}

export interface AiToolCallMessage {
  type: 'tool_call'
  id: string
  name: string
  input: Record<string, unknown>
  sessionId?: string
  parentToolCallId?: string
}

export interface AiToolResultMessage {
  type: 'tool_result'
  id: string
  output: string
  isError?: boolean
  sessionId?: string
  parentToolCallId?: string
}

export interface AiConfirmMessage {
  type: 'confirm'
  id: string
  command: string
  reason: string
  sessionId?: string
}

export interface AiConfirmResponseMessage {
  type: 'confirm_response'
  id: string
  approved: boolean
}

export interface AiPlanConfirmMessage {
  type: 'plan_confirm'
  id: string
  title: string
  content: string // markdown
  sessionId?: string
}

export interface AiPlanConfirmResponseMessage {
  type: 'plan_confirm_response'
  id: string
  approved: boolean
  feedback?: string
}

// Ask-user questionnaire (interactive clarification)
export interface AskUserOption {
  label: string
  description?: string
}

export interface AskUserQuestion {
  question: string
  description?: string
  options?: (string | AskUserOption)[]
  allowFreeText?: boolean
  freeTextPlaceholder?: string
  metadata?: Record<string, unknown>
}

export interface AiAskUserMessage {
  type: 'ask_user'
  id: string
  questions: AskUserQuestion[]
  sessionId?: string
}

export interface AiAskUserResponseMessage {
  type: 'ask_user_response'
  id: string
  answers: Record<string, string>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

// Artifact events — emitted by session when a tool produces viewable content
export type ArtifactRenderType = 'code' | 'markdown' | 'html' | 'svg' | 'mermaid'

export interface AiArtifactMessage {
  type: 'artifact'
  id: string
  toolCallId: string
  artifactType: 'file' | 'output' | 'artifact'
  renderType: ArtifactRenderType
  title?: string
  filename?: string
  filepath?: string
  language: string
  content: string
  sessionId?: string
  parentToolCallId?: string
}

// ── Browser automation state ─────────────────────────────────────────

export interface BrowserAction {
  action: string // 'open', 'click', 'fill', 'scroll', 'snapshot', etc.
  target?: string // URL or @ref
  value?: string // fill text, scroll direction
  timestamp: number
}

export interface AiBrowserStateMessage {
  type: 'browser_state'
  sessionId?: string
  url: string
  title: string
  screenshot?: string // base64 JPEG
  lastAction: BrowserAction
  elementCount?: number
}

export interface AiBrowserCloseMessage {
  type: 'browser_close'
  sessionId?: string
}

// ── Task tracker (Claude Code–style todo list) ──────────────────────
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskItem {
  /** What needs to be done (imperative, e.g. "Run tests") */
  content: string
  /** Present-continuous form shown while active (e.g. "Running tests") */
  activeForm: string
  status: TaskStatus
}

export interface AiTasksUpdateMessage {
  type: 'tasks_update'
  tasks: TaskItem[]
  sessionId?: string
}

export interface AiTokenUpdateMessage {
  type: 'token_update'
  usage: TokenUsage // cumulative so far this turn
  sessionId?: string
}

export interface AiTextReplaceMessage {
  type: 'text_replace'
  sessionId?: string
  /** The exact substring to remove from the current assistant message */
  remove: string
}

export interface AiDoneMessage {
  type: 'done'
  sessionId?: string
  usage?: TokenUsage
  cumulativeUsage?: TokenUsage
  provider?: string
  model?: string
}

export interface AiErrorMessage {
  type: 'error'
  message: string
  code?: string
  sessionId?: string
  parentToolCallId?: string
}

export interface AiTitleUpdateMessage {
  type: 'title_update'
  sessionId: string
  title: string
}

// Sub-agent lifecycle events
export interface AiSubAgentStartMessage {
  type: 'sub_agent_start'
  toolCallId: string // the parent tool_call ID that spawned this sub-agent
  task: string
  sessionId?: string
}

export interface AiSubAgentEndMessage {
  type: 'sub_agent_end'
  toolCallId: string
  success: boolean
  sessionId?: string
}

export interface AiSubAgentProgressMessage {
  type: 'sub_agent_progress'
  toolCallId: string
  content: string
  sessionId?: string
}

// Compaction events
export interface CompactionStartMessage {
  type: 'compaction_start'
  sessionId?: string
}

export interface CompactionCompleteMessage {
  type: 'compaction_complete'
  sessionId?: string
  compactedMessages: number
  totalCompactions: number
}

// Scheduler messages
export interface SchedulerListMessage {
  type: 'scheduler_list'
}

export interface SchedulerJob {
  name: string
  description: string
  schedule: string
  nextRun: number // timestamp
  lastRun: number | null // timestamp
  enabled: boolean
}

export interface SchedulerListResponse {
  type: 'scheduler_list_response'
  jobs: SchedulerJob[]
}

export interface SchedulerRunMessage {
  type: 'scheduler_run'
  name: string // run a skill immediately
}

export interface SchedulerRunResponse {
  type: 'scheduler_run_response'
  name: string
  success: boolean
  error?: string
}

// Project management
export interface ProjectCreateMessage {
  type: 'project_create'
  project: {
    name: string
    description?: string
    icon?: string
    color?: string
    workspacePath?: string // custom location — if not provided, auto-generates ~/Anton/{name}/
  }
}

export interface ProjectCreatedMessage {
  type: 'project_created'
  project: Project
}

export interface ProjectsListMessage {
  type: 'projects_list'
}

export interface ProjectsListResponse {
  type: 'projects_list_response'
  projects: Project[]
}

export interface ProjectUpdateMessage {
  type: 'project_update'
  id: string
  changes: Partial<Pick<Project, 'name' | 'description' | 'icon' | 'color'>>
}

export interface ProjectUpdatedMessage {
  type: 'project_updated'
  project: Project
}

export interface ProjectDeleteMessage {
  type: 'project_delete'
  id: string
}

export interface ProjectDeletedMessage {
  type: 'project_deleted'
  id: string
}

// Project context updates (legacy — use project_instructions_* instead for instructions)
export interface ProjectContextUpdateMessage {
  type: 'project_context_update'
  id: string
  field: 'notes' | 'summary'
  value: string
}

// ── Project instructions ────────────────────────────────────────────

export interface ProjectInstructionsGetMessage {
  type: 'project_instructions_get'
  projectId: string
}

export interface ProjectInstructionsResponse {
  type: 'project_instructions_response'
  projectId: string
  content: string
}

export interface ProjectInstructionsSaveMessage {
  type: 'project_instructions_save'
  projectId: string
  content: string
}

// ── User preferences (per-project, persistent) ─────────────────────

export interface Preference {
  id: string
  title: string
  content: string
  createdAt: number
}

export interface ProjectPreferencesGetMessage {
  type: 'project_preferences_get'
  projectId: string
}

export interface ProjectPreferencesResponse {
  type: 'project_preferences_response'
  projectId: string
  preferences: Preference[]
}

export interface ProjectPreferenceAddMessage {
  type: 'project_preference_add'
  projectId: string
  title: string
  content: string
}

export interface ProjectPreferenceDeleteMessage {
  type: 'project_preference_delete'
  projectId: string
  preferenceId: string
}

// Project file operations
export interface ProjectFileUploadMessage {
  type: 'project_file_upload'
  projectId: string
  filename: string
  content: string // base64
  mimeType: string
  sizeBytes: number
}

export interface ProjectFileTextCreateMessage {
  type: 'project_file_text_create'
  projectId: string
  filename: string
  content: string // plain text
}

export interface ProjectFileDeleteMessage {
  type: 'project_file_delete'
  projectId: string
  filename: string
}

export interface ProjectFilesListMessage {
  type: 'project_files_list'
  projectId: string
}

export interface ProjectFileInfo {
  name: string
  size: number
  mimeType: string
}

export interface ProjectFilesListResponse {
  type: 'project_files_list_response'
  projectId: string
  files: ProjectFileInfo[]
}

export interface ProjectSessionsListMessage {
  type: 'project_sessions_list'
  projectId: string
}

export interface ProjectSessionsListResponse {
  type: 'project_sessions_list_response'
  projectId: string
  sessions: SessionMeta[]
}

// ── Agent management ─────────────────────────────────────────────────

// Client → Server
export interface AgentCreateMessage {
  type: 'agent_create'
  projectId: string
  agent: {
    name: string
    description?: string
    instructions: string
    schedule?: string // cron expression
    originConversationId?: string
  }
}

export interface AgentsListMessage {
  type: 'agents_list'
  projectId: string
}

export interface AgentActionMessage {
  type: 'agent_action'
  projectId: string
  sessionId: string // the agent's conversation session ID
  action: 'start' | 'stop' | 'delete' | 'pause' | 'resume'
}

// Server → Client
export interface AgentCreatedMessage {
  type: 'agent_created'
  agent: AgentSession
}

export interface AgentsListResponse {
  type: 'agents_list_response'
  projectId: string
  agents: AgentSession[]
}

export interface AgentUpdatedMessage {
  type: 'agent_updated'
  agent: AgentSession
}

export interface AgentDeletedMessage {
  type: 'agent_deleted'
  projectId: string
  sessionId: string
}

export interface AgentResultDeliveredMessage {
  type: 'agent_result_delivered'
  projectId: string
  agentSessionId: string
  agentName: string
  originConversationId: string
  summary: string
}

// Client → Server: request logs for a specific agent run
export interface AgentRunLogsMessage {
  type: 'agent_run_logs'
  projectId: string
  sessionId: string
  runSessionId?: string // specific run session (new arch: each run = fresh session)
  startedAt: number
  completedAt: number
}

// Server → Client: logs for a specific agent run
export interface AgentRunLogsResponse {
  type: 'agent_run_logs_response'
  sessionId: string
  logs: AgentRunLogEntry[]
}

export interface AgentRunLogEntry {
  ts: number
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result'
  content: string
  toolName?: string
  toolInput?: string
  isError?: boolean
}

// ── Workflow management ──────────────────────────────────────────────

import type { InstalledWorkflow, WorkflowManifest, WorkflowRegistryEntry } from './workflows.js'

// Client → Server
export interface WorkflowRegistryListMessage {
  type: 'workflow_registry_list'
}

export interface WorkflowCheckConnectorsMessage {
  type: 'workflow_check_connectors'
  workflowId: string
}

export interface WorkflowInstallMessage {
  type: 'workflow_install'
  projectId: string
  workflowId: string
  userInputs: Record<string, unknown>
}

export interface WorkflowsListMessage {
  type: 'workflows_list'
  projectId: string
}

export interface WorkflowUninstallMessage {
  type: 'workflow_uninstall'
  projectId: string
  workflowId: string
}

// Server → Client
export interface WorkflowRegistryListResponse {
  type: 'workflow_registry_list_response'
  entries: WorkflowRegistryEntry[]
}

export interface WorkflowCheckConnectorsResponse {
  type: 'workflow_check_connectors_response'
  workflowId: string
  manifest: WorkflowManifest
  satisfied: string[]
  missing: string[]
  optional: { id: string; connected: boolean }[]
}

export interface WorkflowInstalledMessage {
  type: 'workflow_installed'
  workflow: InstalledWorkflow
}

export interface WorkflowsListResponse {
  type: 'workflows_list_response'
  projectId: string
  workflows: InstalledWorkflow[]
}

export interface WorkflowUninstalledMessage {
  type: 'workflow_uninstalled'
  projectId: string
  workflowId: string
}

export interface WorkflowActivateMessage {
  type: 'workflow_activate'
  projectId: string
  workflowId: string
}

export interface WorkflowActivatedMessage {
  type: 'workflow_activated'
  workflow: InstalledWorkflow
  agents: AgentSession[]
}

// ── Connector management ─────────────────────────────────────────────

export interface ConnectorConfigPayload {
  id: string
  name: string
  description?: string
  icon?: string
  type: 'mcp' | 'api' | 'oauth'
  command?: string
  args?: string[]
  env?: Record<string, string>
  apiKey?: string
  baseUrl?: string
  metadata?: Record<string, string>
  enabled: boolean
  oauthProvider?: string
}

export interface ConnectorStatusPayload {
  id: string
  name: string
  description?: string
  icon?: string
  type: 'mcp' | 'api' | 'oauth'
  connected: boolean
  enabled: boolean
  toolCount: number
  tools: string[]
  error?: string
}

export interface ConnectorRegistryEntryPayload {
  id: string
  name: string
  description: string
  icon: string
  category: string
  type: 'mcp' | 'api' | 'oauth'
  command?: string
  args?: string[]
  requiredEnv: string[]
  optionalFields?: { key: string; label: string; hint?: string }[]
  featured?: boolean
  oauthProvider?: string
  oauthScopes?: string[]
  setupGuide?: {
    steps: string[]
    url: string
    urlLabel?: string
  }
}

// Client → Server
export interface ConnectorsListMessage {
  type: 'connectors_list'
}

export interface ConnectorAddMessage {
  type: 'connector_add'
  connector: ConnectorConfigPayload
}

export interface ConnectorUpdateMessage {
  type: 'connector_update'
  id: string
  changes: Partial<ConnectorConfigPayload>
}

export interface ConnectorRemoveMessage {
  type: 'connector_remove'
  id: string
}

export interface ConnectorToggleMessage {
  type: 'connector_toggle'
  id: string
  enabled: boolean
}

export interface ConnectorTestMessage {
  type: 'connector_test'
  id: string
}

export interface ConnectorRegistryListMessage {
  type: 'connector_registry_list'
}

// Server → Client
export interface ConnectorsListResponse {
  type: 'connectors_list_response'
  connectors: ConnectorStatusPayload[]
}

export interface ConnectorAddedMessage {
  type: 'connector_added'
  connector: ConnectorStatusPayload
}

export interface ConnectorUpdatedMessage {
  type: 'connector_updated'
  connector: ConnectorStatusPayload
}

export interface ConnectorRemovedMessage {
  type: 'connector_removed'
  id: string
}

export interface ConnectorStatusMessage {
  type: 'connector_status'
  id: string
  connected: boolean
  toolCount: number
  error?: string
}

export interface ConnectorTestResponse {
  type: 'connector_test_response'
  id: string
  success: boolean
  tools: string[]
  error?: string
}

export interface ConnectorRegistryListResponse {
  type: 'connector_registry_list_response'
  entries: ConnectorRegistryEntryPayload[]
}

// OAuth connector flow
export interface ConnectorOAuthStartMessage {
  type: 'connector_oauth_start'
  provider: string
}

export interface ConnectorOAuthUrlMessage {
  type: 'connector_oauth_url'
  provider: string
  url: string
}

export interface ConnectorOAuthCompleteMessage {
  type: 'connector_oauth_complete'
  provider: string
  success: boolean
  error?: string
}

export interface ConnectorOAuthDisconnectMessage {
  type: 'connector_oauth_disconnect'
  provider: string
}

// ── Usage stats ─────────────────────────────────────────────────────

export interface UsageStatsMessage {
  type: 'usage_stats'
}

export interface UsageStatsModelBreakdown {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  sessionCount: number
}

export interface UsageStatsDayBreakdown {
  date: string // YYYY-MM-DD
  inputTokens: number
  outputTokens: number
  totalTokens: number
  sessionCount: number
}

export interface UsageStatsSessionEntry {
  id: string
  title: string
  provider: string
  model: string
  createdAt: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
}

export interface UsageStatsResponse {
  type: 'usage_stats_response'
  totals: TokenUsage
  byModel: UsageStatsModelBreakdown[]
  byDay: UsageStatsDayBreakdown[]
  sessions: UsageStatsSessionEntry[]
}

// ── Publish ──────────────────────────────────────────────────────────

export interface PublishArtifactMessage {
  type: 'publish_artifact'
  artifactId: string
  title: string
  content: string
  contentType: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string
  slug?: string
}

export interface PublishArtifactResponse {
  type: 'publish_artifact_response'
  artifactId: string
  publicUrl: string
  slug: string
  success: boolean
  error?: string
}

export type AiMessage =
  // Session management
  | SessionCreateMessage
  | SessionCreatedMessage
  | SessionsListMessage
  | SessionsListResponse
  | SessionDestroyMessage
  | SessionDestroyedMessage
  | SessionHistoryMessage
  | SessionHistoryResponse
  | ContextInfoMessage
  // Provider management
  | ProvidersListMessage
  | ProvidersListResponse
  | ProviderSetKeyMessage
  | ProviderSetKeyResponse
  | ProviderSetDefaultMessage
  | ProviderSetDefaultResponse
  | ProviderSetModelsMessage
  | ProviderSetModelsResponse
  // Chat
  | AiUserMessage
  | AiSteerMessage
  | AiSteerAckMessage
  | AiCancelTurnMessage
  | AiThinkingMessage
  | AiTextMessage
  | AiToolCallMessage
  | AiToolResultMessage
  | AiConfirmMessage
  | AiConfirmResponseMessage
  | AiPlanConfirmMessage
  | AiPlanConfirmResponseMessage
  | AiAskUserMessage
  | AiAskUserResponseMessage
  | AiArtifactMessage
  | AiTasksUpdateMessage
  | AiTokenUpdateMessage
  | AiTextReplaceMessage
  | AiDoneMessage
  | AiErrorMessage
  | AiTitleUpdateMessage
  // Sub-agent
  | AiSubAgentStartMessage
  | AiSubAgentEndMessage
  | AiSubAgentProgressMessage
  // Compaction
  | CompactionStartMessage
  | CompactionCompleteMessage
  // Scheduler
  | SchedulerListMessage
  | SchedulerListResponse
  | SchedulerRunMessage
  | SchedulerRunResponse
  // Projects
  | ProjectCreateMessage
  | ProjectCreatedMessage
  | ProjectsListMessage
  | ProjectsListResponse
  | ProjectUpdateMessage
  | ProjectUpdatedMessage
  | ProjectDeleteMessage
  | ProjectDeletedMessage
  | ProjectContextUpdateMessage
  | ProjectFileUploadMessage
  | ProjectFileTextCreateMessage
  | ProjectFileDeleteMessage
  | ProjectFilesListMessage
  | ProjectFilesListResponse
  | ProjectSessionsListMessage
  | ProjectSessionsListResponse
  | ProjectInstructionsGetMessage
  | ProjectInstructionsResponse
  | ProjectInstructionsSaveMessage
  | ProjectPreferencesGetMessage
  | ProjectPreferencesResponse
  | ProjectPreferenceAddMessage
  | ProjectPreferenceDeleteMessage
  // Agents
  | AgentCreateMessage
  | AgentCreatedMessage
  | AgentsListMessage
  | AgentsListResponse
  | AgentActionMessage
  | AgentUpdatedMessage
  | AgentDeletedMessage
  | AgentResultDeliveredMessage
  | AgentRunLogsMessage
  | AgentRunLogsResponse
  // Workflows
  | WorkflowRegistryListMessage
  | WorkflowRegistryListResponse
  | WorkflowCheckConnectorsMessage
  | WorkflowCheckConnectorsResponse
  | WorkflowInstallMessage
  | WorkflowInstalledMessage
  | WorkflowsListMessage
  | WorkflowsListResponse
  | WorkflowUninstallMessage
  | WorkflowUninstalledMessage
  | WorkflowActivateMessage
  | WorkflowActivatedMessage
  // Connectors
  | ConnectorsListMessage
  | ConnectorsListResponse
  | ConnectorAddMessage
  | ConnectorAddedMessage
  | ConnectorUpdateMessage
  | ConnectorUpdatedMessage
  | ConnectorRemoveMessage
  | ConnectorRemovedMessage
  | ConnectorToggleMessage
  | ConnectorStatusMessage
  | ConnectorTestMessage
  | ConnectorTestResponse
  | ConnectorRegistryListMessage
  | ConnectorRegistryListResponse
  | ConnectorOAuthStartMessage
  | ConnectorOAuthUrlMessage
  | ConnectorOAuthCompleteMessage
  | ConnectorOAuthDisconnectMessage
  // Browser automation
  | AiBrowserStateMessage
  | AiBrowserCloseMessage
  // Publish
  | PublishArtifactMessage
  | PublishArtifactResponse
  // Usage stats
  | UsageStatsMessage
  | UsageStatsResponse

// ── Event Channel (0x04) ────────────────────────────────────────────

export interface FileChangedEvent {
  type: 'file_changed'
  path: string
  change: 'created' | 'modified' | 'deleted' | 'renamed'
}

export interface PortChangedEvent {
  type: 'port_changed'
  port: number
  status: 'opened' | 'closed'
  process?: string
}

export interface TaskCompletedEvent {
  type: 'task_completed'
  summary: string
}

export interface AgentStatusEvent {
  type: 'agent_status'
  status: 'idle' | 'working' | 'error'
  detail?: string
  sessionId?: string
}

/** Emitted proactively when the agent detects a newer version is available */
export interface UpdateAvailableEvent {
  type: 'update_available'
  currentVersion: string
  latestVersion: string
  latestSpecVersion: string
  changelog: string
  releaseUrl: string
}

export interface ArtifactPublishedEvent {
  type: 'artifact_published'
  artifactId: string
  slug: string
  publicUrl: string
}

export interface JobEvent {
  type: 'job_event'
  projectId: string
}

export type EventMessage =
  | FileChangedEvent
  | PortChangedEvent
  | TaskCompletedEvent
  | AgentStatusEvent
  | UpdateAvailableEvent
  | ArtifactPublishedEvent
  | JobEvent
