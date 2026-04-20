import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

interface Props {
  label: string
  icon?: typeof ChevronRight
  children?: ReactNode
  startOpen?: boolean
}

export function ConvChip({ label, icon: Icon, children, startOpen = false }: Props) {
  const [open, setOpen] = useState(startOpen)
  const hasChildren = Boolean(children)
  const classes = ['conv-chip', open ? 'open' : '', hasChildren ? 'has-children' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <button
        type="button"
        className="conv-chip__row"
        onClick={() => hasChildren && setOpen((o) => !o)}
        disabled={!hasChildren}
      >
        {Icon && <Icon size={13} strokeWidth={1.5} className="conv-chip__icon" />}
        <span className="conv-chip__label">{label}</span>
        {hasChildren && <ChevronRight size={12} strokeWidth={1.5} className="conv-chip__chev" />}
      </button>
      {hasChildren && open && <div className="conv-chip__children">{children}</div>}
    </div>
  )
}
