import { Check, Clock } from 'lucide-react'
import { useState } from 'react'

type Variant = 'minimal' | 'medium'
type State = 'pending' | 'accepted' | 'declined'

interface RoutineOfferAccept {
  name: string
  schedule: string
}

interface Props {
  variant?: Variant
  suggestion?: string
  name?: string
  schedule?: string
  onAccept?: (next: RoutineOfferAccept) => void
  onDecline?: () => void
}

export function RoutineOfferBlock({
  variant = 'medium',
  suggestion = 'Run this every weekday at 8:00am',
  name: initialName = 'Morning briefing',
  schedule: initialSchedule = 'Mon–Fri · 8:00am',
  onAccept,
  onDecline,
}: Props) {
  const [state, setState] = useState<State>('pending')
  const [name, setName] = useState(initialName)
  const [schedule, setSchedule] = useState(initialSchedule)

  if (state === 'accepted') {
    return (
      <div className="ix-summary">
        <span className="ix-summary__icon ix-summary__icon--ok">
          <Clock size={11} strokeWidth={1.8} />
        </span>
        <span className="ix-summary__label">Routine scheduled</span>
        <span className="ix-summary__sep">·</span>
        <span className="ix-summary__val">
          {name} — {schedule}
        </span>
      </div>
    )
  }

  if (state === 'declined') {
    return (
      <div className="ix-summary">
        <span className="ix-summary__icon">
          <Check size={11} strokeWidth={1.8} />
        </span>
        <span className="ix-summary__label">Declined to schedule</span>
      </div>
    )
  }

  const accept = () => {
    setState('accepted')
    onAccept?.({ name, schedule })
  }
  const decline = () => {
    setState('declined')
    onDecline?.()
  }

  if (variant === 'minimal') {
    return (
      <div className="ix ix--routine-min">
        <div className="ix__glyph">
          <Clock size={12} strokeWidth={1.5} />
        </div>
        <div className="ix__routine-text">
          <span className="ix__routine-q">Make this a routine?</span>
          <span className="ix__routine-sub">{suggestion}</span>
        </div>
        <button type="button" className="ix-btn ix-btn--ghost" onClick={decline}>
          Not now
        </button>
        <button type="button" className="ix-btn ix-btn--primary" onClick={accept}>
          Schedule
        </button>
      </div>
    )
  }

  // medium variant — inline editable fields
  return (
    <div className="ix ix--bordered">
      <div className="ix__head">
        <div className="ix__head-left">
          <div className="ix__glyph">
            <Clock size={13} strokeWidth={1.5} />
          </div>
          <div className="ix__head-text">
            <div className="ix__title">Turn this into a routine?</div>
            <div className="ix__sub">I noticed this is something you could run on a schedule.</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '6px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <LabeledField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ix__custom-input"
            style={{ padding: '6px 9px' }}
          />
        </LabeledField>
        <LabeledField label="When">
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="ix__custom-input"
            style={{ padding: '6px 9px' }}
          />
        </LabeledField>
      </div>

      <div className="ix__actions">
        <button type="button" className="ix-btn ix-btn--ghost" onClick={decline}>
          Not now
        </button>
        <button type="button" className="ix-btn ix-btn--primary" onClick={accept}>
          <Check size={11} strokeWidth={1.8} /> Create routine
        </button>
      </div>
    </div>
  )
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-3)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}
