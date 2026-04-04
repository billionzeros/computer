/**
 * AI channel: connector responses.
 */

import type { AiMessage } from '@anton/protocol'
import { connectionStore } from '../connectionStore.js'
import { connectorStore } from '../connectorStore.js'

export function handleConnectorMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'connectors_list_response': {
      connectorStore.getState().setConnectors(msg.connectors)
      connectionStore.getState().markSynced('connectors')
      return true
    }

    case 'connector_added': {
      connectorStore.getState().addOrUpdateConnector(msg.connector)
      return true
    }

    case 'connector_updated': {
      connectorStore.getState().addOrUpdateConnector(msg.connector)
      return true
    }

    case 'connector_removed': {
      connectorStore.getState().removeConnector(msg.id)
      return true
    }

    case 'connector_status': {
      connectorStore.getState().updateConnectorStatus(msg.id, {
        connected: msg.connected,
        toolCount: msg.toolCount,
        error: msg.error,
      })
      return true
    }

    case 'connector_registry_list_response': {
      connectorStore.getState().setConnectorRegistry(msg.entries)
      return true
    }

    default:
      return false
  }
}
