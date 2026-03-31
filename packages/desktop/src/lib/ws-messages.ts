/**
 * Typed interfaces for every WebSocket message exchanged between
 * the desktop client and the agent server.
 *
 * Each interface corresponds to a `msg.type` discriminant used in
 * the `handleWsMessage` switch in store.ts.
 */

import type {
  AgentRunLogEntry,
  AgentSession,
  AskUserQuestion,
  Project,
  TaskItem,
  TokenUsage,
  UsageStatsDayBreakdown,
  UsageStatsModelBreakdown,
  UsageStatsSessionEntry,
} from '@anton/protocol'

import type { ArtifactRenderType } from './artifacts.js'
import type {
  AgentStatus,
  ConnectorRegistryInfo,
  ConnectorStatusInfo,
  ProviderInfo,
  SessionMeta,
  UpdateStage,
} from './store.js'

// ── Control channel ────────────────────────────────────────────────

export interface WsAuthOk {
  type: 'auth_ok'
  version: string
  gitHash: string
  updateAvailable?: { version: string; changelog: string | null; releaseUrl: string | null }
}

export interface WsUpdateCheckResponse {
  type: 'update_check_response'
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

export interface WsUpdateProgress {
  type: 'update_progress'
  stage: UpdateStage
  message: string
}

// ── Events channel ─────────────────────────────────────────────────

export interface WsJobEvent {
  type: 'job_event'
  projectId: string
}

export interface WsUpdateAvailable {
  type: 'update_available'
  currentVersion: string
  latestVersion: string | null
  changelog: string | null
  releaseUrl: string | null
}

export interface WsAgentStatusMsg {
  type: 'agent_status'
  status: AgentStatus
  detail?: string
  sessionId?: string
}

// ── AI channel: chat ───────────────────────────────────────────────

export interface WsSteerAck {
  type: 'steer_ack'
  content: string
  sessionId?: string
}

export interface WsText {
  type: 'text'
  content: string
  sessionId?: string
}

export interface WsThinking {
  type: 'thinking'
  text: string
  sessionId?: string
}

export interface WsTextReplace {
  type: 'text_replace'
  remove: string
  sessionId?: string
}

// ── AI channel: tools ──────────────────────────────────────────────

export interface WsToolCall {
  type: 'tool_call'
  id: string
  name: string
  input?: Record<string, unknown>
  parentToolCallId?: string
  sessionId?: string
}

export interface WsToolResult {
  type: 'tool_result'
  id: string
  output: string
  isError?: boolean
  parentToolCallId?: string
  sessionId?: string
}

// ── AI channel: sub-agents ─────────────────────────────────────────

export interface WsSubAgentStart {
  type: 'sub_agent_start'
  toolCallId: string
  task: string
  sessionId?: string
}

export interface WsSubAgentEnd {
  type: 'sub_agent_end'
  toolCallId: string
  success: boolean
  sessionId?: string
}

export interface WsSubAgentProgress {
  type: 'sub_agent_progress'
  toolCallId: string
  content: string
  sessionId?: string
}

// ── AI channel: artifacts ──────────────────────────────────────────

export interface WsArtifact {
  type: 'artifact'
  id: string
  artifactType: 'file' | 'output' | 'artifact'
  renderType: ArtifactRenderType
  title?: string
  filename?: string
  filepath?: string
  language?: string
  content: string
  toolCallId: string
  sessionId?: string
}

export interface WsPublishArtifactResponse {
  type: 'publish_artifact_response'
  success: boolean
  artifactId: string
  publicUrl: string
  slug: string
}

// ── AI channel: confirmations & prompts ────────────────────────────

export interface WsConfirm {
  type: 'confirm'
  id: string
  command: string
  reason: string
  sessionId?: string
}

export interface WsPlanConfirm {
  type: 'plan_confirm'
  id: string
  title: string
  content: string
  sessionId?: string
}

export interface WsAskUser {
  type: 'ask_user'
  id: string
  questions: AskUserQuestion[]
  sessionId?: string
}

// ── AI channel: errors & status ────────────────────────────────────

export interface WsError {
  type: 'error'
  message: string
  code?: string
  sessionId?: string
}

export interface WsTitleUpdate {
  type: 'title_update'
  sessionId: string
  title: string
}

export interface WsTasksUpdate {
  type: 'tasks_update'
  tasks: TaskItem[]
  sessionId?: string
}

export interface WsBrowserState {
  type: 'browser_state'
  url: string
  title: string
  screenshot?: string
  lastAction: { action: string; target?: string; value?: string; timestamp: number }
  elementCount?: number
  sessionId?: string
}

export interface WsTokenUpdate {
  type: 'token_update'
  usage: TokenUsage
  sessionId?: string
}

export interface WsDone {
  type: 'done'
  usage?: TokenUsage
  cumulativeUsage?: TokenUsage
  provider?: string
  model?: string
  sessionId?: string
}

// ── AI channel: sessions ───────────────────────────────────────────

export interface WsSessionCreated {
  type: 'session_created'
  id: string
  provider: string
  model: string
}

export interface WsContextInfo {
  type: 'context_info'
  sessionId: string
  globalMemories: string[]
  conversationMemories: string[]
  crossConversationMemories: string[]
  projectId: string
}

export interface WsSessionsListResponse {
  type: 'sessions_list_response'
  sessions: SessionMeta[]
}

export interface WsUsageStatsResponse {
  type: 'usage_stats_response'
  totals: TokenUsage
  byModel: UsageStatsModelBreakdown[]
  byDay: UsageStatsDayBreakdown[]
  sessions: UsageStatsSessionEntry[]
}

export interface WsSessionHistoryResponse {
  type: 'session_history_response'
  id: string
  messages: unknown[]
  hasMore?: boolean
  artifacts?: unknown[]
}

export interface WsSessionDestroyed {
  type: 'session_destroyed'
  id: string
}

// ── AI channel: compaction ─────────────────────────────────────────

export interface WsCompactionComplete {
  type: 'compaction_complete'
  compactedMessages: number
  totalCompactions: number
  sessionId?: string
}

// ── AI channel: providers ──────────────────────────────────────────

export interface WsProvidersListResponse {
  type: 'providers_list_response'
  providers: ProviderInfo[]
  defaults: { provider: string; model: string }
  onboarding?: { completed: boolean; role?: string }
}

export interface WsProviderSetDefaultResponse {
  type: 'provider_set_default_response'
  success: boolean
  provider: string
  model: string
}

// ── AI channel: projects ───────────────────────────────────────────

export interface WsProjectCreated {
  type: 'project_created'
  project: Project
}

export interface WsProjectsListResponse {
  type: 'projects_list_response'
  projects: Project[]
}

export interface WsProjectUpdated {
  type: 'project_updated'
  project: { id: string } & Partial<Project>
}

export interface WsProjectDeleted {
  type: 'project_deleted'
  id: string
}

export interface WsProjectFilesListResponse {
  type: 'project_files_list_response'
  projectId: string
  files: { name: string; size: number; mimeType: string }[]
}

export interface WsProjectSessionsListResponse {
  type: 'project_sessions_list_response'
  projectId: string
  sessions: SessionMeta[]
}

// ── AI channel: agents ─────────────────────────────────────────────

export interface WsAgentsListResponse {
  type: 'agents_list_response'
  projectId: string
  agents: AgentSession[]
}

export interface WsAgentCreated {
  type: 'agent_created'
  agent: AgentSession
}

export interface WsAgentUpdated {
  type: 'agent_updated'
  agent: AgentSession
}

export interface WsAgentDeleted {
  type: 'agent_deleted'
  sessionId: string
}

export interface WsAgentRunLogsResponse {
  type: 'agent_run_logs_response'
  logs: AgentRunLogEntry[] | null
}

// ── AI channel: connectors ─────────────────────────────────────────

export interface WsConnectorsListResponse {
  type: 'connectors_list_response'
  connectors: ConnectorStatusInfo[]
}

export interface WsConnectorAdded {
  type: 'connector_added'
  connector: ConnectorStatusInfo
}

export interface WsConnectorUpdated {
  type: 'connector_updated'
  connector: ConnectorStatusInfo
}

export interface WsConnectorRemoved {
  type: 'connector_removed'
  id: string
}

export interface WsConnectorStatus {
  type: 'connector_status'
  id: string
  connected: boolean
  toolCount: number
  error?: string
}

export interface WsConnectorRegistryListResponse {
  type: 'connector_registry_list_response'
  entries: ConnectorRegistryInfo[]
}
