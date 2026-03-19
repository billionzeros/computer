import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type React from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop click to close */}
          <div className="modal-backdrop__overlay" onClick={onClose} />

          {/* Content */}
          <motion.div
            className="modal-content"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {title && (
              <div className="modal-content__header">
                <h2 className="modal-content__title">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="modal-content__close"
                >
                  <X className="modal-content__close-icon" />
                </button>
              </div>
            )}
            <div className="modal-content__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
