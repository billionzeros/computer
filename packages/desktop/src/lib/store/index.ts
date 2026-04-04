/**
 * Store index — re-exports from domain stores and the legacy monolithic store.
 *
 * During migration, the monolithic store.ts continues to work unchanged.
 * Domain stores are available for new code and gradual migration.
 * Components importing from '../lib/store.js' will get everything they need.
 *
 * Migration path for components:
 *   Before: import { useStore, ConnectorStatusInfo } from '../lib/store.js'
 *   After:  import { connectorStore } from '../lib/store/connectorStore.js'
 */

// Re-export domain stores for direct use by new code
export { connectorStore } from './connectorStore.js'
export { updateStore } from './updateStore.js'
export { usageStore } from './usageStore.js'
export { uiStore } from './uiStore.js'
export { artifactStore } from './artifactStore.js'
export { projectStore } from './projectStore.js'
export { sessionStore } from './sessionStore.js'
export { connectionStore } from './connectionStore.js'

// Re-export shared types so components can import from here
export type { InitPhase, SyncProgress } from './connectionStore.js'

export type {
  ChatMessage,
  ChatImageAttachment,
  CitationSource,
  ProviderInfo,
  SessionMeta,
  AgentStatus,
  AgentStep,
  ConnectorStatusInfo,
  ConnectorRegistryInfo,
  UpdateInfo,
  UpdateStage,
  SavedMachine,
  SidebarTab,
  ActiveView,
  ActiveMode,
  SidePanelView,
  UsageStats,
  PendingConfirm,
  PendingPlan,
  PendingAskUser,
} from './types.js'

export type { SessionState } from './sessionStore.js'

export { updateStageLabel } from './types.js'
