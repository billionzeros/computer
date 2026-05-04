import { useCallback, useMemo, useRef, useState } from 'react'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { ContextPopover } from './ContextPopover.js'

const SIZE = 16
const STROKE = 1.6
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Compose-toolbar context-window gauge. Click toggles the breakdown
 * popover. Color states track the autocompaction threshold:
 *   < 70%  → idle (muted ring)
 *   70–80% → warning (amber)
 *   ≥ 80%  → critical (matches `--accent`; compaction will fire on the
 *           next turn at the default 0.80 threshold).
 *
 * Hidden when no `contextBreakdown` is in the store (fresh session before
 * the first `context_update`, or harness path that hasn't reported yet).
 */
export function ContextGauge() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  const breakdown = sessionStore((s) => {
    const sid = s.currentSessionId
    if (!sid) return null
    return s.sessionStates.get(sid)?.contextBreakdown ?? null
  })

  const used = useMemo(() => {
    if (!breakdown) return 0
    return (
      breakdown.systemPrompt +
      breakdown.systemTools +
      breakdown.mcpTools +
      breakdown.skills +
      breakdown.memoryFiles +
      breakdown.messages
    )
  }, [breakdown])

  const fillRatio =
    breakdown && breakdown.contextWindow > 0
      ? Math.min(1, Math.max(0, used / breakdown.contextWindow))
      : 0
  const percentLabel = Math.round(fillRatio * 100)

  const colorClass =
    fillRatio >= 0.8
      ? 'context-gauge--critical'
      : fillRatio >= 0.7
        ? 'context-gauge--warning'
        : 'context-gauge--idle'

  const handleToggle = useCallback(() => {
    setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null)
    setOpen((v) => !v)
  }, [])

  const handleClose = useCallback(() => setOpen(false), [])

  if (!breakdown) return null

  const dashOffset = CIRCUMFERENCE * (1 - fillRatio)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`context-gauge ${colorClass}${open ? ' context-gauge--open' : ''}`}
        aria-label={`Context window ${percentLabel}% used`}
        aria-haspopup="true"
        aria-expanded={open}
        data-tooltip={`${percentLabel}% of context used`}
        onClick={handleToggle}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Context ${percentLabel}% used`}
          focusable="false"
        >
          <title>Context {percentLabel}% used</title>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="context-gauge__track"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className="context-gauge__fill"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
      </button>
      <ContextPopover
        open={open}
        onClose={handleClose}
        anchorRect={anchorRect}
        breakdown={breakdown}
        triggerRef={buttonRef}
      />
    </>
  )
}
