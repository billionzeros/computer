/**
 * Connector domain store — completely isolated from other domains.
 * Manages MCP/API/OAuth connector state and registry.
 */

import { create } from 'zustand'
import { connection } from '../connection.js'
import type { ConnectorRegistryInfo, ConnectorStatusInfo } from './types.js'

/**
 * Defense-in-depth: even though the agent-server strips sensitive metadata
 * before sending connector status to the desktop, we strip again here so a
 * regression on the server side can't quietly leak secrets into Zustand
 * state. Mirrors SENSITIVE_METADATA_KEYS in agent-server/src/server.ts.
 */
const SENSITIVE_METADATA_KEYS = new Set([
  'access_token',
  'bot_token',
  'refresh_token',
  'client_secret',
  'api_key',
  'signing_secret',
  'forward_secret',
])

function sanitizeConnector(c: ConnectorStatusInfo): ConnectorStatusInfo {
  if (!c.metadata) return c
  let dirty = false
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(c.metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(k)) {
      dirty = true
      continue
    }
    out[k] = v
  }
  if (!dirty) return c
  // eslint-disable-next-line no-console
  console.warn('[connectorStore] stripped sensitive metadata from connector', c.id)
  return { ...c, metadata: Object.keys(out).length > 0 ? out : undefined }
}

interface ConnectorState {
  connectors: ConnectorStatusInfo[]
  connectorRegistry: ConnectorRegistryInfo[]

  // Actions
  setConnectors: (connectors: ConnectorStatusInfo[]) => void
  addOrUpdateConnector: (connector: ConnectorStatusInfo) => void
  removeConnector: (id: string) => void
  updateConnectorStatus: (id: string, updates: Partial<ConnectorStatusInfo>) => void
  setConnectorRegistry: (entries: ConnectorRegistryInfo[]) => void

  // Connection actions (wrapping connection.send*)
  listConnectors: () => void
  listConnectorRegistry: () => void
  addConnectorRemote: (config: {
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
    enabled: boolean
  }) => void
  removeConnectorRemote: (id: string) => void
  toggleConnectorRemote: (id: string, enabled: boolean) => void
  testConnectorRemote: (id: string) => void
  updateConnectorRemote: (id: string, updates: Record<string, unknown>) => void
  setToolPermission: (id: string, toolName: string, permission: 'auto' | 'ask' | 'never') => void
  startOAuth: (id: string) => void
  disconnectOAuth: (id: string) => void

  // Reset
  reset: () => void
}

export const connectorStore = create<ConnectorState>((set) => ({
  connectors: [],
  connectorRegistry: [],

  setConnectors: (connectors) => set({ connectors: connectors.map(sanitizeConnector) }),
  addOrUpdateConnector: (connector) =>
    set((s) => {
      const sanitized = sanitizeConnector(connector)
      const idx = s.connectors.findIndex((c) => c.id === sanitized.id)
      if (idx >= 0) {
        const updated = [...s.connectors]
        updated[idx] = sanitized
        return { connectors: updated }
      }
      return { connectors: [...s.connectors, sanitized] }
    }),
  removeConnector: (id) => set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) })),
  updateConnectorStatus: (id, updates) =>
    set((s) => ({
      connectors: s.connectors.map((c) =>
        c.id === id ? sanitizeConnector({ ...c, ...updates } as ConnectorStatusInfo) : c,
      ),
    })),
  setConnectorRegistry: (entries) => set({ connectorRegistry: entries }),

  // Connection actions
  listConnectors: () => connection.sendConnectorsList(),
  listConnectorRegistry: () => connection.sendConnectorRegistryList(),
  addConnectorRemote: (config) => connection.sendConnectorAdd(config),
  removeConnectorRemote: (id) => connection.sendConnectorRemove(id),
  toggleConnectorRemote: (id, enabled) => connection.sendConnectorToggle(id, enabled),
  testConnectorRemote: (id) => connection.sendConnectorTest(id),
  updateConnectorRemote: (id, updates) => connection.sendConnectorUpdate(id, updates),
  setToolPermission: (id, toolName, permission) =>
    connection.sendConnectorSetToolPermission(id, toolName, permission),
  startOAuth: (id) => connection.sendConnectorOAuthStart(id),
  disconnectOAuth: (id) => connection.sendConnectorOAuthDisconnect(id),

  reset: () => set({ connectors: [], connectorRegistry: [] }),
}))
