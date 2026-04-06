import { AnimatePresence, motion } from 'framer-motion'
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  alt: string
  open: boolean
  onClose: () => void
}

export function ImageViewer({ src, alt, open, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setScale(1)
      setTranslate({ x: 0, y: 0 })
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => Math.min(5, Math.max(0.25, s - e.deltaY * 0.002)))
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return
      dragging.current = true
      lastPos.current = { x: e.clientX, y: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [scale],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }))
  }, [])

  const handlePointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const zoomIn = () => setScale((s) => Math.min(5, s + 0.5))
  const zoomOut = () => {
    setScale((s) => {
      const next = Math.max(0.25, s - 0.5)
      if (next <= 1) setTranslate({ x: 0, y: 0 })
      return next
    })
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = src
    a.download = alt || 'image'
    a.click()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="image-viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div
            className="image-viewer__backdrop"
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onClose()
            }}
            role="button"
            tabIndex={0}
          />

          {/* Toolbar */}
          <div className="image-viewer__toolbar">
            <button type="button" onClick={zoomOut} className="image-viewer__btn" title="Zoom out">
              <ZoomOut size={18} strokeWidth={1.5} />
            </button>
            <span className="image-viewer__zoom-label">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={zoomIn} className="image-viewer__btn" title="Zoom in">
              <ZoomIn size={18} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="image-viewer__btn"
              title="Download"
            >
              <Download size={18} strokeWidth={1.5} />
            </button>
            <button type="button" onClick={onClose} className="image-viewer__btn" title="Close">
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>

          {/* Image */}
          <motion.div
            className="image-viewer__container"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <img
              src={src}
              alt={alt}
              className="image-viewer__image"
              draggable={false}
              style={{
                transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
                cursor: scale > 1 ? 'grab' : 'default',
              }}
            />
          </motion.div>

          {/* Filename */}
          {alt && <div className="image-viewer__filename">{alt}</div>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Inline clickable image thumbnail used in messages and composer */
interface ImageThumbnailProps {
  src: string
  alt: string
  className?: string
}

export function ImageThumbnail({ src, alt, className }: ImageThumbnailProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="image-thumbnail__button" onClick={() => setOpen(true)}>
        <img src={src} alt={alt} className={`${className || ''} image-thumbnail--clickable`} />
      </button>
      <ImageViewer src={src} alt={alt} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
