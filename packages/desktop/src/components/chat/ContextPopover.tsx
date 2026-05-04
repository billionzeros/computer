import type { ContextBreakdown } from '@anton/protocol'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../lib/store.js'

interface Props {
  open: boolean
  onClose: () => void
  anchorRect: DOMRect | null
  breakdown: ContextBreakdown
  /**
   * Trigger button that opens this popover. Used to skip outside-click
   * close when the user clicks the trigger again — without this, the
   * mousedown on the trigger fires onClose, then the click toggles the
   * gauge back open. Net effect: the popover never closes via the
   * gauge.
   */
  triggerRef?: RefObject<HTMLElement | null>
}

interface Row {
  key: string
  label: string
  tokens: number
  /** Solid hue for the stacked bar segment + row legend dot. */
  className: string
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.max(0, Math.round(n)))
}

const ESTIMATED_POPOVER_HEIGHT = 360
const ESTIMATED_POPOVER_WIDTH = 320
const VIEWPORT_PADDING = 8

/**
 * Floating per-category breakdown of the active session's context-window
 * usage. Rendered in a portal so a transformed ancestor can't break the
 * fixed positioning. Anchored above the gauge by default; flips below
 * when there isn't enough room above.
 *
 * Pi-SDK sessions render every category. Harness sessions
 * (`breakdown.source === 'harness'`) only carry `messages` + `contextWindow`,
 * so we collapse to a 2-row breakdown plus a footnote.
 */
export function ContextPopover({ open, onClose, anchorRect, breakdown, triggerRef }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const openContextPanel = useStore((s) => s.openContextPanel)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      // Don't close on the trigger button — the trigger's own click
      // handler will toggle `open` to false a beat later, and closing
      // here would race with that and re-open the popover.
      if (triggerRef?.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => window.addEventListener('mousedown', onClick), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
      window.clearTimeout(id)
    }
  }, [open, onClose, triggerRef])

  const rows: Row[] = useMemo(() => {
    if (breakdown.source === 'harness') {
      return [
        {
          key: 'messages',
          label: 'Messages',
          tokens: breakdown.messages,
          className: 'context-popover__seg--messages',
        },
      ]
    }
    return [
      {
        key: 'messages',
        label: 'Messages',
        tokens: breakdown.messages,
        className: 'context-popover__seg--messages',
      },
      {
        key: 'systemPrompt',
        label: 'System prompt',
        tokens: breakdown.systemPrompt,
        className: 'context-popover__seg--system-prompt',
      },
      {
        key: 'systemTools',
        label: 'System tools',
        tokens: breakdown.systemTools,
        className: 'context-popover__seg--system-tools',
      },
      {
        key: 'mcpTools',
        label: 'MCP tools',
        tokens: breakdown.mcpTools,
        className: 'context-popover__seg--mcp-tools',
      },
      {
        key: 'skills',
        label: 'Skills',
        tokens: breakdown.skills,
        className: 'context-popover__seg--skills',
      },
      {
        key: 'memoryFiles',
        label: 'Memory files',
        tokens: breakdown.memoryFiles,
        className: 'context-popover__seg--memory',
      },
    ]
  }, [breakdown])

  const usedTokens = rows.reduce((sum, r) => sum + r.tokens, 0)
  const reserved = breakdown.autocompactBuffer
  const free = Math.max(0, breakdown.contextWindow - usedTokens - reserved)

  if (!open || !anchorRect) return null

  const spaceAbove = anchorRect.top
  const placeAbove = spaceAbove >= ESTIMATED_POPOVER_HEIGHT + 16
  // Center the popover horizontally on the trigger so the visual
  // pointer always reads "this comes from that button". Clamp to the
  // viewport so a gauge near the right edge can't push the popover
  // off-screen.
  const anchorCenter = anchorRect.left + anchorRect.width / 2
  const idealLeft = anchorCenter - ESTIMATED_POPOVER_WIDTH / 2
  const maxLeft = window.innerWidth - ESTIMATED_POPOVER_WIDTH - VIEWPORT_PADDING
  const left = Math.max(VIEWPORT_PADDING, Math.min(idealLeft, maxLeft))
  const style: React.CSSProperties = placeAbove
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

  // Stacked bar uses percentage widths so totals stay stable across resizes.
  const window_ = breakdown.contextWindow
  const pct = (n: number) => (window_ > 0 ? (n / window_) * 100 : 0)

  return createPortal(
    <div
      ref={popoverRef}
      className="context-popover"
      aria-label="Context window breakdown"
      style={style}
    >
      <div className="context-popover__head">
        <span className="context-popover__title">Context</span>
        <span className="context-popover__counter">
          {formatTokens(usedTokens)}/{formatTokens(window_)}
        </span>
      </div>

      <div className="context-popover__bar" aria-hidden>
        {rows
          .filter((r) => r.tokens > 0)
          .map((r) => (
            <span
              key={r.key}
              className={`context-popover__seg ${r.className}`}
              style={{ width: `${pct(r.tokens)}%` }}
            />
          ))}
        {reserved > 0 && (
          <span
            className="context-popover__seg context-popover__seg--reserved"
            style={{ width: `${pct(reserved)}%` }}
          />
        )}
      </div>

      <ul className="context-popover__rows">
        {rows.map((r) => (
          <li key={r.key} className="context-popover__row">
            <span className={`context-popover__dot ${r.className}`} />
            <span className="context-popover__label">{r.label}</span>
            <span className="context-popover__value">
              {window_ > 0 ? `${pct(r.tokens).toFixed(1)}%` : '—'}
            </span>
          </li>
        ))}
        {reserved > 0 && (
          <li className="context-popover__row">
            <span className="context-popover__dot context-popover__seg--reserved" />
            <span className="context-popover__label">Autocompact buffer</span>
            <span className="context-popover__value">{pct(reserved).toFixed(1)}%</span>
          </li>
        )}
        <li className="context-popover__row context-popover__row--free">
          <span className="context-popover__dot context-popover__dot--free" />
          <span className="context-popover__label">Free space</span>
          <span className="context-popover__value">{pct(free).toFixed(1)}%</span>
        </li>
      </ul>

      {breakdown.source === 'harness' && (
        <div className="context-popover__footnote">
          Per-section detail is not available for harness sessions.
        </div>
      )}

      <button
        type="button"
        className="context-popover__details-link"
        onClick={() => {
          openContextPanel()
          onClose()
        }}
      >
        View memory details →
      </button>
    </div>,
    document.body,
  )
}
