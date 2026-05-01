import { Check, FileText, Grid3x3, ImageIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../lib/store.js'
import { connectorStore } from '../../lib/store/connectorStore.js'
import { getPersistedResearchMode, sessionStore } from '../../lib/store/sessionStore.js'
import { ConnectorIcon } from '../connectors/ConnectorIcons.js'

interface Props {
  open: boolean
  onClose: () => void
  onAddImages: () => void
  onAddFiles: () => void
  /** Bounding rect of the trigger button so the menu can anchor above it. */
  anchorRect: DOMRect | null
}

function ResearchIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="7" cy="7" r="5" />
      <line x1="10.7" y1="10.7" x2="14" y2="14" />
      <polyline points="4.6,8 6.2,6.4 7.6,7.6 9.4,5.6" />
    </svg>
  )
}

const PREVIEW_ICON_COUNT = 5

export function ComposerAddMenu({ open, onClose, onAddImages, onAddFiles, anchorRect }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)
  const connectionStatus = useStore((s) => s.connectionStatus)

  // Per-conversation Research toggle. Falls back to the localStorage-persisted
  // value if this session's state map entry hasn't been hydrated yet so the
  // checkmark renders correctly right after a reload. On the hero composer
  // (no active session), reads the root-level `pendingResearchMode` flag so
  // pre-session toggles are reflected immediately.
  const researchMode = sessionStore((s) => {
    const sid = s.currentSessionId
    if (!sid) return s.pendingResearchMode
    const state = s.sessionStates.get(sid)
    return state ? state.researchMode : getPersistedResearchMode(sid)
  })

  // Refresh connector lists when the menu opens (and we have a live link).
  useEffect(() => {
    if (!open) return
    if (connectionStatus !== 'connected') return
    connectorStore.getState().listConnectors()
    connectorStore.getState().listConnectorRegistry()
  }, [open, connectionStatus])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // Defer listener attach so the click that opened the menu doesn't immediately close it.
    const id = window.setTimeout(() => window.addEventListener('mousedown', onClick), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
      window.clearTimeout(id)
    }
  }, [open, onClose])

  if (!open || !anchorRect) return null

  // Anchor below the trigger by default; flip above only if there's not
  // enough room below. Portaled into document.body so a `transform` /
  // `filter` / `will-change` on a composer ancestor (StreamHome's
  // .home-stack uses translateY(-6%)) can't create a containing block
  // that would break `position: fixed`.
  const ESTIMATED_MENU_HEIGHT = 240
  const ESTIMATED_MENU_WIDTH = 360
  const VIEWPORT_PADDING = 8
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const flipAbove = spaceBelow < ESTIMATED_MENU_HEIGHT + 16
  const maxLeft = window.innerWidth - ESTIMATED_MENU_WIDTH - VIEWPORT_PADDING
  const left = Math.max(VIEWPORT_PADDING, Math.min(anchorRect.left, maxLeft))
  const style: React.CSSProperties = flipAbove
    ? {
        position: 'fixed',
        left,
        bottom: window.innerHeight - anchorRect.top + 8,
        zIndex: 50,
      }
    : {
        position: 'fixed',
        left,
        top: anchorRect.bottom + 8,
        zIndex: 50,
      }

  const openConnectorsSettings = () => {
    onClose()
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'connectors' } }))
  }

  const handleToggleResearch = () => {
    // The store's toggle accepts null and stages on pendingResearchMode
    // when there's no active session yet (hero composer).
    const sid = sessionStore.getState().currentSessionId
    sessionStore.getState().toggleResearchMode(sid)
  }

  // Preview strip on the "Manage connectors" row: prefer registry order so
  // the visual is stable across sessions; fall back to whatever connectors
  // the user has configured if the registry hasn't loaded yet.
  const previewSource = registry.length > 0 ? registry : connectors
  const previewIcons = previewSource.slice(0, PREVIEW_ICON_COUNT)

  return createPortal(
    <div ref={menuRef} className="composer-add-menu" style={style} role="menu">
      <div className="composer-add-menu__section">
        <button
          type="button"
          className="composer-add-menu__item"
          role="menuitem"
          onClick={() => {
            onAddImages()
            onClose()
          }}
        >
          <ImageIcon size={16} strokeWidth={1.5} />
          <span>Add Images</span>
        </button>
        <button
          type="button"
          className="composer-add-menu__item"
          role="menuitem"
          onClick={() => {
            onAddFiles()
            onClose()
          }}
        >
          <FileText size={16} strokeWidth={1.5} />
          <span>Add Files</span>
        </button>
      </div>

      <hr className="composer-add-menu__divider" />
      <div className="composer-add-menu__section">
        <button
          type="button"
          className="composer-add-menu__item composer-add-menu__item--connectors"
          role="menuitem"
          onClick={openConnectorsSettings}
        >
          <Grid3x3 size={16} strokeWidth={1.5} />
          <span>Manage connectors</span>
          {previewIcons.length > 0 && (
            <span className="composer-add-menu__icon-strip" aria-hidden="true">
              {previewIcons.map((c) => (
                <span key={c.id} className="composer-add-menu__icon-strip-item">
                  <ConnectorIcon id={c.id} size={16} />
                </span>
              ))}
            </span>
          )}
        </button>
      </div>

      <hr className="composer-add-menu__divider" />
      <div className="composer-add-menu__section">
        <button
          type="button"
          className={`composer-add-menu__item${
            researchMode ? ' composer-add-menu__item--active' : ''
          }`}
          role="menuitemcheckbox"
          aria-checked={researchMode}
          onClick={handleToggleResearch}
        >
          <ResearchIcon />
          <span>Research</span>
          {researchMode && (
            <Check
              size={14}
              strokeWidth={2}
              className="composer-add-menu__check"
              aria-hidden="true"
            />
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}
