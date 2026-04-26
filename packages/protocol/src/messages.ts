import type { Project, RoutineSession } from './projects.js'

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
  /** Wire-protocol version the server speaks. Absent on servers that predate
   *  the version handshake (2026-04) — treat missing as "unversioned, very old". */
  protocolVersion?: number
  /** Public domain for this agent (e.g. "itsomg.antoncomputer.in") */
  domain?: string
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
  key: 'providers' | 'defaults' | 'security' | 'system_prompt' | 'memories' | 'sessions'
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

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

// Session management
export interface SessionCreateMessage {
  type: 'session_create'
  id: string
  provider?: string
  model?: string
  apiKey?: string // client-provided key override (not persisted)
  projectId?: string // create session scoped to a project
  thinkingLevel?: ThinkingLevel
}

// Runtime effort update — applies to next turn on both pi-SDK sessions
// (via PiAgent.setThinkingLevel) and Codex harness sessions (via the
// per-turn `effort` override in TurnStartParams).
export interface SessionSetThinkingLevelMessage {
  type: 'session_set_thinking_level'
  sessionId: string
  level: ThinkingLevel
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
  /** Derived status so the task list can render without fetching full history */
  status?: 'working' | 'completed' | 'error' | 'idle'
}

export interface SessionsListResponse {
  type: 'sessions_list_response'
  sessions: SessionMeta[]
}

// ── Session sync protocol ──────────────────────────────────────────

/** A single change to the session index */
export interface SyncDelta {
  action: 'I' | 'U' | 'D'
  syncVersion: number
  sessionId: string
  session?: SessionMeta
  timestamp: number
}

/** Client -> Server: request sync (replaces sessions_list for incremental sync) */
export interface SessionsSyncRequest {
  type: 'sessions_sync'
  lastSyncVersion: number // 0 = full bootstrap
}

/** Server -> Client: sync response (full list or deltas only) */
export interface SessionsSyncResponse {
  type: 'sessions_sync_response'
  syncVersion: number
  full: boolean
  sessions?: SessionMeta[] // present when full=true
  deltas?: SyncDelta[] // present when full=false
}

/** Server -> Client: real-time push when a session changes */
export interface SessionSyncPush {
  type: 'session_sync'
  syncVersion: number
  delta: SyncDelta
}

export interface SessionDestroyMessage {
  type: 'session_destroy'
  id: string
}

/**
 * Client asks the server to swap the provider/model of an existing
 * harness session without losing its conversation history. Server
 * tears down the current HarnessSession, spawns a new one keyed on
 * the same `id`, and seeds the new provider with a replay of the
 * mirrored messages.jsonl on its first turn. Non-harness sessions
 * are rejected.
 */
export interface SessionProviderSwitchMessage {
  type: 'session_provider_switch'
  id: string
  provider: string
  model: string
}

/** Ack for SessionProviderSwitchMessage. Fires after the new session is ready. */
export interface SessionProviderSwitchedMessage {
  type: 'session_provider_switched'
  id: string
  provider: string
  model: string
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
  messageId?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolId?: string
  parentToolCallId?: string
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
  type?: 'api' | 'harness'
  installed?: boolean
}

export interface ProvidersListResponse {
  type: 'providers_list_response'
  providers: ProviderInfoPayload[]
  defaults: { provider: string; model: string }
  onboarding?: {
    completed: boolean
    role?: string
    tourCompleted?: boolean
    tourCompletedAt?: string
  }
}

export interface DetectHarnessesMessage {
  type: 'detect_harnesses'
}

export interface HarnessStatus {
  id: string
  name: string
  installed: boolean
  version?: string
  auth?: {
    loggedIn: boolean
    email?: string
    subscriptionType?: string
  }
}

export interface DetectHarnessesResponse {
  type: 'detect_harnesses_response'
  harnesses: HarnessStatus[]
}

export interface HarnessSetupMessage {
  type: 'harness_setup'
  harnessId: string
  action: 'install' | 'login' | 'login_code' | 'status'
  code?: string
}

export interface HarnessSetupResponse {
  type: 'harness_setup_response'
  harnessId: string
  action: 'install' | 'login' | 'login_code' | 'status'
  success: boolean
  step?: string
  message?: string
  status?: HarnessStatus
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
  /** Composer-mode hint. 'research' biases the model toward web_research. */
  mode?: 'research'
}

// Steering: user sends a message while the agent is actively working
export interface AiSteerMessage {
  type: 'steer'
  content: string
  sessionId?: string
  attachments?: ChatImageAttachmentInput[]
  /** See AiUserMessage.mode — propagated when a steer falls back to a regular message. */
  mode?: 'research'
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
  agentType?: 'research' | 'execute' | 'verify'
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

// Skill list messages
export interface SkillListMessage {
  type: 'skill_list'
}

export interface SkillListResponseSkill {
  name: string
  description: string
  icon?: string
  category?: string
  featured?: boolean
  prompt: string
  whenToUse?: string
  context?: 'inline' | 'fork'
  allowedTools?: string[]
  tools?: string[]
  schedule?: string
  model?: string
  source: 'builtin' | 'user' | 'project'
  skillDir?: string
  assets?: {
    agents?: string[]
    scripts?: string[]
    references?: string[]
    other?: string[]
  }
  parameters?: {
    name: string
    label: string
    type: 'text' | 'select' | 'boolean'
    placeholder?: string
    options?: string[]
    required?: boolean
  }[]
}

export interface SkillListResponse {
  type: 'skill_list_response'
  skills: SkillListResponseSkill[]
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

// ── Routine management ───────────────────────────────────────────────

// Client → Server
export interface RoutineCreateMessage {
  type: 'routine_create'
  projectId: string
  routine: {
    name: string
    description?: string
    instructions: string
    schedule?: string // cron expression
    originConversationId?: string
    /** Provider (e.g. "anthropic", "openrouter", "codex"). Omit to inherit default. */
    provider?: string
    /** Model ID. Omit to inherit default. */
    model?: string
  }
}

export interface RoutinesListMessage {
  type: 'routines_list'
  projectId: string
}

export interface RoutineActionMessage {
  type: 'routine_action'
  projectId: string
  sessionId: string // the routine's conversation session ID
  action: 'start' | 'stop' | 'delete' | 'pause' | 'resume'
}

export interface RoutineUpdateMessage {
  type: 'routine_update'
  projectId: string
  sessionId: string
  patch: {
    name?: string
    description?: string
    instructions?: string
    schedule?: string | null // cron expression, or null to clear (manual-only)
    /** Provider override. `null` clears it (revert to default); omitted leaves unchanged. */
    provider?: string | null
    /** Model override. `null` clears it (revert to default); omitted leaves unchanged. */
    model?: string | null
  }
}

// Server → Client
export interface RoutineCreatedMessage {
  type: 'routine_created'
  routine: RoutineSession
}

export interface RoutinesListResponse {
  type: 'routines_list_response'
  projectId: string
  routines: RoutineSession[]
}

export interface RoutineUpdatedMessage {
  type: 'routine_updated'
  routine: RoutineSession
}

export interface RoutineDeletedMessage {
  type: 'routine_deleted'
  projectId: string
  sessionId: string
}

export interface RoutineResultDeliveredMessage {
  type: 'routine_result_delivered'
  projectId: string
  routineSessionId: string
  routineName: string
  originConversationId: string
  summary: string
}

// Client → Server: request logs for a specific routine run
export interface RoutineRunLogsMessage {
  type: 'routine_run_logs'
  projectId: string
  sessionId: string
  runSessionId?: string // specific run session (new arch: each run = fresh session)
  startedAt: number
  completedAt: number
}

// Server → Client: logs for a specific routine run
export interface RoutineRunLogsResponse {
  type: 'routine_run_logs_response'
  sessionId: string
  logs: RoutineRunLogEntry[]
}

export interface RoutineRunLogEntry {
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
  routines: RoutineSession[]
}

// ── Connector management ─────────────────────────────────────────────

/**
 * Per-tool permission for a connector tool.
 * - 'auto': always allowed (default if unset)
 * - 'ask':  allowed but should prompt user before each call (UI persists; runtime enforcement TODO)
 * - 'never': tool is hidden from the agent entirely
 */
export type ConnectorToolPermission = 'auto' | 'ask' | 'never'

export interface ConnectorConfigPayload {
  id: string
  name: string
  description?: string
  icon?: string
  type: 'mcp' | 'api' | 'oauth'
  command?: string
  args?: string[]
  env?: Record<string, string>
  metadata?: Record<string, string>
  enabled: boolean
  oauthProvider?: string
  toolPermissions?: Record<string, ConnectorToolPermission>
  registryId?: string
  accountEmail?: string
  accountLabel?: string
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
  toolPermissions?: Record<string, ConnectorToolPermission>
  /**
   * Provider-specific runtime metadata. Slack stashes the bot identity
   * (displayName, iconUrl, bot_user_id, team info, user_access_token) here.
   * Surfaced to the UI so connector detail panels can render provider-specific
   * settings without a per-provider protocol message.
   */
  metadata?: Record<string, string>
  error?: string
  hasCredentials?: boolean
  registryId?: string
  accountEmail?: string
  accountLabel?: string
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
  requiredFields?: { key: string; label: string; hint?: string; placeholder?: string }[]
  optionalFields?: { key: string; label: string; hint?: string; placeholder?: string }[]
  featured?: boolean
  oauthProvider?: string
  oauthScopes?: string[]
  setupGuide?: {
    steps: string[]
    url: string
    urlLabel?: string
    reauthorizeHint?: string
  }
  multiAccount?: boolean
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

export interface ConnectorSetToolPermissionMessage {
  type: 'connector_set_tool_permission'
  id: string
  toolName: string
  permission: ConnectorToolPermission
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
  registryId?: string // for multi-account: the registry entry ID when provider is a UUID instance
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

export interface PublishedListMessage {
  type: 'published_list'
}

export interface PublishedListResponse {
  type: 'published_list_response'
  host?: string
  pages: {
    slug: string
    artifactId?: string
    title: string
    type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
    description?: string
    createdAt: number
    updatedAt: number
    projectId?: string
    views: number
  }[]
}

export interface UnpublishMessage {
  type: 'unpublish'
  slug: string
}

export interface UnpublishResponse {
  type: 'unpublish_response'
  slug: string
  success: boolean
  error?: string
}

export type AiMessage =
  // Session management
  | SessionCreateMessage
  | SessionCreatedMessage
  | SessionSetThinkingLevelMessage
  | SessionsListMessage
  | SessionsListResponse
  | SessionsSyncRequest
  | SessionsSyncResponse
  | SessionSyncPush
  | SessionDestroyMessage
  | SessionDestroyedMessage
  | SessionProviderSwitchMessage
  | SessionProviderSwitchedMessage
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
  | DetectHarnessesMessage
  | DetectHarnessesResponse
  | HarnessSetupMessage
  | HarnessSetupResponse
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
  // Skills
  | SkillListMessage
  | SkillListResponse
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
  // Routines
  | RoutineCreateMessage
  | RoutineCreatedMessage
  | RoutinesListMessage
  | RoutinesListResponse
  | RoutineActionMessage
  | RoutineUpdateMessage
  | RoutineUpdatedMessage
  | RoutineDeletedMessage
  | RoutineResultDeliveredMessage
  | RoutineRunLogsMessage
  | RoutineRunLogsResponse
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
  | ConnectorSetToolPermissionMessage
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
  | PublishedListMessage
  | PublishedListResponse
  | UnpublishMessage
  | UnpublishResponse
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

export interface RoutineStatusEvent {
  type: 'routine_status'
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
  | RoutineStatusEvent
  | UpdateAvailableEvent
  | ArtifactPublishedEvent
  | JobEvent
