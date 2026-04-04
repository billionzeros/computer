/**
 * Shared types used across domain stores.
 * Extracted from the original monolithic store.ts.
 */

import type { AskUserQuestion, TokenUsage } from '@anton/protocol'

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
  parentToolCallId?: string
  isSteering?: boolean
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

// ── Provider types ─────────────────────────────────────────────────

export interface ProviderInfo {
  name: string
  models: string[]
  defaultModels?: string[]
  hasApiKey: boolean
  baseUrl?: string
}

// ── Session types ──────────────────────────────────────────────────

export interface SessionMeta {
  id: string
  title: string
  provider: string
  model: string
  messageCount: number
  createdAt: number
  lastActiveAt: number
}

export type AgentStatus = 'idle' | 'working' | 'error' | 'unknown'

export interface AgentStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result'
  label: string
  toolName?: string
  status: 'active' | 'complete' | 'error'
  timestamp: number
}

// ── Connector types ────────────────────────────────────────────────

export interface ConnectorStatusInfo {
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

export interface ConnectorRegistryInfo {
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

// ── Update types ───────────────────────────────────────────────────

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  changelog: string | null
  releaseUrl: string | null
}

export type UpdateStage = 'downloading' | 'replacing' | 'restarting' | 'done' | 'error' | null

export function updateStageLabel(stage: string | null): string {
  switch (stage) {
    case 'downloading':
      return 'Downloading update...'
    case 'replacing':
      return 'Installing binary...'
    case 'restarting':
      return 'Restarting your machine...'
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
