/**
 * AI channel: connector responses.
 */

import type { WsPayload } from '../../connection.js'
import type {
  WsConnectorAdded,
  WsConnectorRegistryListResponse,
  WsConnectorRemoved,
  WsConnectorStatus,
  WsConnectorUpdated,
  WsConnectorsListResponse,
} from '../../ws-messages.js'
import { connectionStore } from '../connectionStore.js'
import { connectorStore } from '../connectorStore.js'

export function handleConnectorMessage(msg: WsPayload): boolean {
  switch (msg.type) {
    case 'connectors_list_response': {
      const m = msg as unknown as WsConnectorsListResponse
      connectorStore.getState().setConnectors(m.connectors)
      connectionStore.getState().markSynced('connectors')
      return true
    }

    case 'connector_added': {
      const m = msg as unknown as WsConnectorAdded
      connectorStore.getState().addOrUpdateConnector(m.connector)
      return true
    }

    case 'connector_updated': {
      const m = msg as unknown as WsConnectorUpdated
      connectorStore.getState().addOrUpdateConnector(m.connector)
      return true
    }

    case 'connector_removed': {
      const m = msg as unknown as WsConnectorRemoved
      connectorStore.getState().removeConnector(m.id)
      return true
    }

    case 'connector_status': {
      const m = msg as unknown as WsConnectorStatus
      connectorStore.getState().updateConnectorStatus(m.id, {
        connected: m.connected,
        toolCount: m.toolCount,
        error: m.error,
      })
      return true
    }

    case 'connector_registry_list_response': {
      const m = msg as unknown as WsConnectorRegistryListResponse
      connectorStore.getState().setConnectorRegistry(m.entries)
      return true
    }

    default:
      return false
  }
}
