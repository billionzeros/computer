import { Unplug, X } from 'lucide-react'
import { useState } from 'react'
import { connectorStore } from '../../lib/store/connectorStore.js'
import { ConnectorIcon } from '../connectors/ConnectorIcons.js'

/**
 * ConnectorBanner — sits BELOW the composer box.
 * Shows "Connect your tools" with registry icons when no connectors are connected.
 */
export function ConnectorBanner() {
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('connector-banner-dismissed') === '1',
  )

  const dismiss = () => {
    setDismissed(true)
    localStorage.setItem('connector-banner-dismissed', '1')
  }

  const connectedOnes = connectors.filter((c) => c.connected)
  const showBanner = connectedOnes.length === 0 && !dismissed && registry.length > 0

  if (!showBanner) return null

  const openConnectors = () => {
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'connectors' } }))
  }

  return (
    <div className="connector-banner">
      <button type="button" className="connector-banner__main" onClick={openConnectors}>
        <div className="connector-banner__left">
          <Unplug size={16} strokeWidth={1.5} />
          <span>Connect your tools</span>
        </div>
        <div className="connector-banner__right">
          {registry.slice(0, 6).map((r) => (
            <span key={r.id} className="connector-banner__icon">
              <ConnectorIcon id={r.id} size={20} />
            </span>
          ))}
        </div>
      </button>
      <button
        type="button"
        className="connector-banner__dismiss"
        onClick={(e) => {
          e.stopPropagation()
          dismiss()
        }}
        aria-label="Dismiss"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
