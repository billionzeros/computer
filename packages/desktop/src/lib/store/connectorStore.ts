/**
 * Connector domain store — completely isolated from other domains.
 * Manages MCP/API/OAuth connector state and registry.
 */

import { create } from 'zustand'
import { connection } from '../connection.js'
import type { ConnectorRegistryInfo, ConnectorStatusInfo } from './types.js'

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
  startOAuth: (id: string) => void
  disconnectOAuth: (id: string) => void

  // Reset
  reset: () => void
}

export const connectorStore = create<ConnectorState>((set) => ({
  connectors: [],
  connectorRegistry: [],

  setConnectors: (connectors) => set({ connectors }),
  addOrUpdateConnector: (connector) =>
    set((s) => {
      const idx = s.connectors.findIndex((c) => c.id === connector.id)
      if (idx >= 0) {
        const updated = [...s.connectors]
        updated[idx] = connector
        return { connectors: updated }
      }
      return { connectors: [...s.connectors, connector] }
    }),
  removeConnector: (id) => set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) })),
  updateConnectorStatus: (id, updates) =>
    set((s) => ({
      connectors: s.connectors.map((c) => (c.id === id ? { ...c, ...updates } : c)),
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
  startOAuth: (id) => connection.sendConnectorOAuthStart(id),
  disconnectOAuth: (id) => connection.sendConnectorOAuthDisconnect(id),

  reset: () => set({ connectors: [], connectorRegistry: [] }),
}))
