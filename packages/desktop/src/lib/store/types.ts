/**
 * Shared types used across domain stores.
 * Extracted from the original monolithic store.ts.
 */

import type {
  AskUserQuestion,
  ConnectorRegistryEntryPayload,
  ConnectorStatusPayload,
  SessionMeta as ProtocolSessionMeta,
  ProviderInfoPayload,
  TokenUsage,
} from '@anton/protocol'

// ── Chat types ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  attachments?: ChatImageAttachment[]
  toolName?: string
  toolInput?: Record<string, unknown>
  isError?: boolean
  isThinking?: boolean
  parentToolCallId?: string
  isSteering?: boolean
  askUserAnswers?: Record<string, string>
}

export interface CitationSource {
  index: number
  title: string
  url: string
  domain: string
}

export interface ChatImageAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  data?: string
  storagePath?: string
}

// ── Provider types (aliased from protocol) ────────────────────────

export type ProviderInfo = ProviderInfoPayload

// ── Session types (aliased from protocol) ─────────────────────────

export type SessionMeta = ProtocolSessionMeta

export type AgentStatus = 'idle' | 'working' | 'error' | 'unknown'

export interface AgentStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result'
  label: string
  toolName?: string
  status: 'active' | 'complete' | 'error'
  timestamp: number
}

// ── Connector types (aliased from protocol) ───────────────────────

export type ConnectorStatusInfo = ConnectorStatusPayload
export type ConnectorRegistryInfo = ConnectorRegistryEntryPayload

// ── Update types ───────────────────────────────────────────────────

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

export type UpdateStage =
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
  | null

export function updateStageLabel(stage: string | null): string {
  switch (stage) {
    case 'checking':
      return 'Checking for updates...'
    case 'stopping':
      return 'Stopping agent...'
    case 'downloading':
      return 'Pulling latest code...'
    case 'installing':
      return 'Installing dependencies...'
    case 'building':
      return 'Building...'
    case 'swapping':
      return 'Swapping to new version...'
    case 'starting':
      return 'Starting agent...'
    case 'verifying':
      return 'Verifying health...'
    default:
      return 'Updating...'
  }
}

// ── Machine types ──────────────────────────────────────────────────

export interface SavedMachine {
  id: string
  name: string
  host: string
  port: number
  token: string
  useTLS: boolean
}

// ── UI types ───────────────────────────────────────────────────────

export type SidebarTab = 'history'

export type ActiveView =
  | 'home'
  | 'chat'
  | 'memory'
  | 'agents'
  | 'terminal'
  | 'files'
  | 'connectors'
  | 'developer'
  | 'skills'
  | 'workflows'
  | 'projects'

export type ActiveMode = 'chat' | 'computer'

export type SidePanelView = 'artifacts' | 'plan' | 'context' | 'browser' | 'devmode'

// ── Usage stats types ──────────────────────────────────────────────

export interface UsageStats {
  totals: TokenUsage
  byModel: import('@anton/protocol').UsageStatsModelBreakdown[]
  byDay: import('@anton/protocol').UsageStatsDayBreakdown[]
  sessions: import('@anton/protocol').UsageStatsSessionEntry[]
}

// ── Pending interaction types ──────────────────────────────────────

export interface PendingConfirm {
  id: string
  command: string
  reason: string
  sessionId?: string
}

export interface PendingPlan {
  id: string
  title: string
  content: string
  sessionId?: string
}

export interface PendingAskUser {
  id: string
  questions: AskUserQuestion[]
  sessionId?: string
}
