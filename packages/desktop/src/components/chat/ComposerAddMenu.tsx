import { FileText, ImageIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  onClose: () => void
  onAddImages: () => void
  onAddFiles: () => void
  /** Bounding rect of the trigger button so the menu can anchor above it. */
  anchorRect: DOMRect | null
}

export function ComposerAddMenu({ open, onClose, onAddImages, onAddFiles, anchorRect }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

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
  // enough room below (rare — composer usually has plenty of space below).
  // Left-aligned to the trigger's left edge.
  //
  // Portaled into document.body so a `transform` / `filter` / `will-change`
  // on any composer ancestor (e.g. StreamHome's `.home-stack` uses
  // `translateY(-6%)`) doesn't create a containing block that breaks
  // `position: fixed`. Without this, the menu anchors to the transformed
  // ancestor, not the viewport, and lands in the wrong spot.
  const ESTIMATED_MENU_HEIGHT = 100 // 2 items × ~40px + padding
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const flipAbove = spaceBelow < ESTIMATED_MENU_HEIGHT + 16
  const style: React.CSSProperties = flipAbove
    ? {
        position: 'fixed',
        left: anchorRect.left,
        bottom: window.innerHeight - anchorRect.top + 6,
        zIndex: 50,
      }
    : {
        position: 'fixed',
        left: anchorRect.left,
        top: anchorRect.bottom + 6,
        zIndex: 50,
      }

  return createPortal(
    <div ref={menuRef} className="composer-add-menu" style={style} role="menu">
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
    </div>,
    document.body,
  )
}
