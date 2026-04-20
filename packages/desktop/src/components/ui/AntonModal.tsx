import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

type Size = 'sm' | 'md' | 'lg'

interface AntonModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: ReactNode
  footer?: ReactNode
  size?: Size
  children?: ReactNode
}

const SIZE_WIDTHS: Record<Size, number> = { sm: 380, md: 460, lg: 560 }

export function AntonModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  footer,
  size = 'md',
  children,
}: AntonModalProps) {
  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close handled globally in effect
    <div
      className="am-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="am-modal"
        style={{ width: SIZE_WIDTHS[size] }}
        // biome-ignore lint/a11y/useSemanticElements: <dialog> requires imperative show/close API; role=dialog keeps a11y without that refactor
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="am-modal__head">
          {icon && <div className="am-modal__icon">{icon}</div>}
          <div className="am-modal__titles">
            <div className="am-modal__title">{title}</div>
            {subtitle && <div className="am-modal__subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="am-iconbtn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="am-modal__body">{children}</div>
        {footer && <div className="am-modal__foot">{footer}</div>}
      </div>
    </div>
  )
}

interface AntonModalRowProps {
  label: string
  hint?: string
  children: ReactNode
}

export function AntonModalRow({ label, hint, children }: AntonModalRowProps) {
  return (
    <div className="am-row">
      <div className="am-row__text">
        <div className="am-row__label">{label}</div>
        {hint && <div className="am-row__hint">{hint}</div>}
      </div>
      <div className="am-row__control">{children}</div>
    </div>
  )
}

interface AntonToggleProps {
  on: boolean
  onChange: (next: boolean) => void
  label?: string
}

export function AntonToggle({ on, onChange, label }: AntonToggleProps) {
  return (
    <button
      type="button"
      className={`am-toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={label}
    >
      <span className="am-toggle__dot" />
    </button>
  )
}
