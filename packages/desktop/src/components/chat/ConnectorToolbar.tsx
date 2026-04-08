import { Plug, Plus, Unplug, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../lib/store.js'
import { connectorStore } from '../../lib/store/connectorStore.js'
import type { ConnectorStatusInfo } from '../../lib/store/types.js'
import { ConnectorIcon } from '../connectors/ConnectorIcons.js'

/**
 * ConnectorPill — sits in the composer toolbar row, inline with + and plan buttons.
 * Shows connected tool icons as a pill group. Clicking opens a portal-based dropdown
 * that auto-positions above or below the trigger to avoid clipping.
 */
export function ConnectorPill() {
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; direction: 'up' | 'down' }>({
    top: 0,
    left: 0,
    direction: 'up',
  })

  const connectionStatus = useStore((s) => s.connectionStatus)
  useEffect(() => {
    if (connectionStatus === 'connected') {
      connectorStore.getState().listConnectors()
      connectorStore.getState().listConnectorRegistry()
    }
  }, [connectionStatus])

  // Compute position when opening
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 460 // max-height of dropdown
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom

    if (spaceAbove >= dropdownHeight || spaceAbove > spaceBelow) {
      // Open above
      setPos({ top: rect.top - 8, left: rect.left, direction: 'up' })
    } else {
      // Open below
      setPos({ top: rect.bottom + 8, left: rect.left, direction: 'down' })
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const enabledOnes = connectors.filter((c) => c.enabled)
  const connectedIds = new Set(connectors.map((c) => c.id))
  const allUnconnected = registry.filter((r) => !connectedIds.has(r.id))
  const unconnectedRegistry = allUnconnected.slice(0, 5)
  const totalAvailable = allUnconnected.length

  const handleToggle = (connector: ConnectorStatusInfo) => {
    const newEnabled = !connector.enabled
    connectorStore.getState().updateConnectorStatus(connector.id, { enabled: newEnabled })
    connectorStore.getState().toggleConnectorRemote(connector.id, newEnabled)
  }

  const openSettings = () => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'connectors' } }))
  }

  const handleTriggerClick = () => {
    if (!open) updatePosition()
    setOpen(!open)
  }

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="connector-dropdown"
          style={{
            position: 'fixed',
            left: Math.min(pos.left, window.innerWidth - 330),
            ...(pos.direction === 'up'
              ? { bottom: window.innerHeight - pos.top }
              : { top: pos.top }),
            zIndex: 9999,
          }}
        >
          {/* Configured connectors with toggles (show all, not just connected) */}
          {connectors.map((c) => (
            <div key={c.id} className="connector-dropdown__item">
              <div className="connector-dropdown__item-left">
                <ConnectorIcon id={c.id} size={20} />
                <span className="connector-dropdown__item-name">{c.name}</span>
              </div>
              <label className="connector-dropdown__toggle">
                <input type="checkbox" checked={c.enabled} onChange={() => handleToggle(c)} />
                <span className="connector-dropdown__toggle-track" />
              </label>
            </div>
          ))}

          {/* Unconnected from registry */}
          {unconnectedRegistry.map((r) => (
            <button
              type="button"
              key={r.id}
              className="connector-dropdown__item connector-dropdown__item--unconnected"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(
                  new CustomEvent('open-settings', {
                    detail: { tab: 'connectors', connectorId: r.id },
                  }),
                )
              }}
            >
              <div className="connector-dropdown__item-left">
                <ConnectorIcon id={r.id} size={20} />
                <span className="connector-dropdown__item-name">{r.name}</span>
              </div>
              <span className="connector-dropdown__item-connect">Connect</span>
            </button>
          ))}

          {/* Footer */}
          <div className="connector-dropdown__footer">
            <button type="button" className="connector-dropdown__footer-btn" onClick={openSettings}>
              <Plus size={16} strokeWidth={1.5} />
              <span>Add connectors</span>
              {totalAvailable - unconnectedRegistry.length > 0 && (
                <span className="connector-dropdown__footer-count">
                  +{totalAvailable - unconnectedRegistry.length}
                </span>
              )}
            </button>
            <button type="button" className="connector-dropdown__footer-btn" onClick={openSettings}>
              <Plug size={16} strokeWidth={1.5} />
              <span>Manage connectors</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="connector-pill-wrap">
      {/* Connected icons pill */}
      {enabledOnes.length > 0 && (
        <button
          type="button"
          className="connector-pill"
          onClick={handleTriggerClick}
          aria-label="Connected tools"
        >
          {enabledOnes.slice(0, 4).map((c) => (
            <span key={c.id} className="connector-pill__icon">
              <ConnectorIcon id={c.id} size={16} />
            </span>
          ))}
          {enabledOnes.length > 4 && (
            <span className="connector-pill__more">+{enabledOnes.length - 4}</span>
          )}
        </button>
      )}

      {/* Connect apps icon */}
      <button
        ref={triggerRef}
        type="button"
        className="composer__btn"
        aria-label="Connect apps"
        data-tooltip="Connect apps"
        onClick={handleTriggerClick}
      >
        <Unplug size={18} strokeWidth={1.5} />
      </button>

      {dropdown}
    </div>
  )
}

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
