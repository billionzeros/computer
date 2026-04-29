import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mentionRegistry } from '../../lib/mentions/registry.js'
import type { MentionContext, MentionItem, MentionSectionResult } from '../../lib/mentions/types.js'

/**
 * Given a drill-in query like `scripts/sub/foo`, return the parent scope —
 * i.e. the prefix one folder shallower. Returns null if there's no `/` in
 * the query (we're at the top-level listing, nothing to go back to).
 *
 *   `scripts/`           → ''           (root)
 *   `scripts/sub/`       → 'scripts/'
 *   `scripts/sub/foo`    → 'scripts/'   (trailing partial leaf is discarded)
 *   `scripts`            → null         (no scope, no back)
 */
function parentScope(query: string): string | null {
  const lastSlash = query.lastIndexOf('/')
  if (lastSlash < 0) return null
  const withoutLeaf = query.slice(0, lastSlash)
  const prevSlash = withoutLeaf.lastIndexOf('/')
  if (prevSlash < 0) return ''
  return withoutLeaf.slice(0, prevSlash + 1)
}

/** Display label for the back row — the name of the parent folder, or
 *  'All files' when going back to root. */
function backLabel(parent: string): string {
  if (!parent) return 'All files'
  const clean = parent.replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

/** Flat row for keyboard navigation — maps `(section, item)` to one index. */
interface FlatRow {
  sectionIndex: number
  itemIndex: number
  providerId: string
  item: MentionItem
}

interface Props {
  /** Whether the dropdown should be visible. */
  open: boolean
  /** Current query (text after `@`, before cursor). */
  query: string
  /** Resolved mention context (project, conversation). */
  context: MentionContext
  /** Trigger anchor rect in viewport coords — dropdown positions above this. */
  anchorRect: DOMRect | null
  /** Called when user confirms a selection (Enter / click / Tab). */
  onSelect: (providerId: string, item: MentionItem) => void
  /**
   * Called when the user wants to browse *inside* a folder rather than select
   * it. Fires on Right-arrow or chevron click. Item is always a folder. Parent
   * is expected to rewrite the composer's active @-query to drill into that
   * folder (e.g. `@email` → `@email/`), which re-runs the search.
   */
  onDrillInto?: (providerId: string, item: MentionItem) => void
  /**
   * Called when user wants to navigate up a level from the current drill-in.
   * Fires on the back-row click, Left-arrow, or Backspace when the leaf is
   * empty. `parentQuery` is the new `@<...>` query to set (empty string = root).
   */
  onNavigateUp?: (parentQuery: string) => void
  /** Called when user dismisses (Esc, outside click, empty-space). */
  onClose: () => void
}

export function MentionDropdown({
  open,
  query,
  context,
  anchorRect,
  onSelect,
  onDrillInto,
  onNavigateUp,
  onClose,
}: Props) {
  const [sections, setSections] = useState<MentionSectionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // Debounced search. The leading-edge call happens on the first keystroke
  // so the dropdown feels instant; subsequent edits are coalesced.
  useEffect(() => {
    if (!open) {
      setSections([])
      setActiveIndex(0)
      return
    }
    let cancelled = false
    setLoading(true)
    const handle = window.setTimeout(async () => {
      const results = await mentionRegistry.searchAll(query, context)
      if (cancelled) return
      setSections(results)
      setActiveIndex(0)
      setLoading(false)
    }, 60)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query, context])

  // Flatten sections → one array for index-based arrow nav.
  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = []
    sections.forEach((section, si) => {
      section.items.forEach((item, ii) => {
        rows.push({ sectionIndex: si, itemIndex: ii, providerId: section.provider.id, item })
      })
    })
    return rows
  }, [sections])

  // Keyboard handling is bound to window while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!flatRows.length) {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
        return
      }
      // Keys the dropdown owns while open must also stopPropagation, not just
      // preventDefault — otherwise the event bubbles to React's delegated
      // keydown handler on the composer, which would fire handleSend on
      // Enter (sending the half-typed `@query` as a message). capture-phase
      // ensures we run first; stopImmediatePropagation ensures nobody else
      // sees it, including React's synthetic-event bubble listener.
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
      if (e.key === 'ArrowDown') {
        consume()
        setActiveIndex((i) => Math.min(i + 1, flatRows.length - 1))
      } else if (e.key === 'ArrowUp') {
        consume()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'ArrowRight') {
        // Finder-style: Right-arrow on a folder drills in, rewriting the
        // composer's @-query to include the folder path + trailing slash.
        // No-op on non-folder items so text-editor right-arrow (caret move)
        // still works on the file pill itself — but the dropdown is open,
        // so caret moves are already suppressed by the composer.
        const row = flatRows[activeIndex]
        if (row && row.item.kind === 'dir' && onDrillInto) {
          consume()
          onDrillInto(row.providerId, row.item)
        }
      } else if (e.key === 'ArrowLeft') {
        // Finder-style: Left-arrow pops one level up when drilled in.
        const parent = parentScope(query)
        if (parent !== null && onNavigateUp) {
          consume()
          onNavigateUp(parent)
        }
      } else if (e.key === 'Backspace') {
        // Terminal-style: Backspace with no partial leaf pops one level up
        // instead of the composer handling it as text deletion. Only when
        // query ends with `/` (no typed leaf) so we don't hijack character
        // deletion while the user is narrowing results.
        if (onNavigateUp && query.endsWith('/')) {
          const parent = parentScope(query)
          if (parent !== null) {
            consume()
            onNavigateUp(parent)
          }
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const row = flatRows[activeIndex]
        if (row) {
          consume()
          onSelect(row.providerId, row.item)
        }
      } else if (e.key === 'Escape') {
        consume()
        onClose()
      }
    }
    // Use capture so we intercept before composer / RichInput handlers.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // `query` is read by Backspace/Left handlers to compute parentScope;
    // `onDrillInto` and `onNavigateUp` are read for arrow-key + back ops.
    // All must be in deps or the handler closes over stale values after the
    // user drills in to a folder (the callback itself changes, but more
    // critically `query` changes).
  }, [open, flatRows, activeIndex, query, onSelect, onDrillInto, onNavigateUp, onClose])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const id = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.clearTimeout(id)
    }
  }, [open, onClose])

  // Scroll active row into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIndex is not read directly, but the effect must re-run when it changes so the freshly-activated row scrolls into view.
  useEffect(() => {
    if (!open) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-mention-active="true"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  if (!open || !anchorRect) return null

  // Dynamic vertical placement: choose whichever side of the anchor has more
  // room. Composer at top-of-viewport (hero home) → open below. Composer
  // docked at the bottom → open above (the traditional chat-dropdown layout).
  //
  // maxHeight is also capped to the available space so a long results list
  // never gets clipped by the viewport edge.
  const MARGIN = 16
  const spaceAbove = anchorRect.top - MARGIN
  const spaceBelow = window.innerHeight - anchorRect.bottom - MARGIN
  const openBelow = spaceBelow >= spaceAbove
  const maxHeight = Math.max(120, Math.min(360, openBelow ? spaceBelow : spaceAbove))
  const style: React.CSSProperties = openBelow
    ? {
        position: 'fixed',
        left: Math.max(8, anchorRect.left),
        top: anchorRect.bottom + 6,
        maxHeight,
        maxWidth: 420,
        minWidth: 280,
        zIndex: 60,
      }
    : {
        position: 'fixed',
        left: Math.max(8, anchorRect.left),
        bottom: window.innerHeight - anchorRect.top + 6,
        maxHeight,
        maxWidth: 420,
        minWidth: 280,
        zIndex: 60,
      }

  // Render.
  //
  // Portaled into document.body so a `transform` on any ancestor (e.g.
  // StreamHome's `.home-stack` uses translateY) doesn't create a
  // containing block that breaks `position: fixed` positioning.
  const parent = onNavigateUp ? parentScope(query) : null
  let globalIndex = 0
  return createPortal(
    // biome-ignore lint/a11y/useSemanticElements: native <select> can't be portaled with custom item rendering
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the editor; arrow keys are handled there
    <div ref={rootRef} className="mention-dropdown" style={style} role="listbox" tabIndex={-1}>
      {parent !== null && (
        <button
          type="button"
          className="mention-dropdown__back"
          aria-label={`Back to ${backLabel(parent)}`}
          title="Go back (← / Backspace)"
          onMouseDown={(e) => {
            e.preventDefault()
            onNavigateUp?.(parent)
          }}
        >
          <ArrowLeft size={13} strokeWidth={1.5} />
          <span>Back to {backLabel(parent)}</span>
        </button>
      )}
      {loading && sections.length === 0 ? (
        <div className="mention-dropdown__empty">
          <Loader2 size={13} className="mention-dropdown__spin" /> Searching…
        </div>
      ) : sections.length === 0 ? (
        <div className="mention-dropdown__empty">
          {query ? 'No matches' : 'Start typing to search'}
        </div>
      ) : (
        sections.map((section, si) => (
          <div key={section.provider.id} className="mention-dropdown__section">
            <div className="mention-dropdown__section-label">{section.provider.label}</div>
            {section.items.map((item, ii) => {
              const myIndex = globalIndex++
              const isActive = myIndex === activeIndex
              const Icon = item.icon
              const isFolder = item.kind === 'dir' && !!onDrillInto
              // Folder rows get a trailing chevron affordance for drill-in —
              // a button-inside-button isn't legal, so we make the row a div
              // with role=option and split the two click targets.
              return (
                <div
                  key={item.id}
                  // biome-ignore lint/a11y/useSemanticElements: <option> can't host nested buttons for the split row
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  data-mention-active={isActive || undefined}
                  className={`mention-dropdown__row${isActive ? ' mention-dropdown__row--active' : ''}${isFolder ? ' mention-dropdown__row--folder' : ''}`}
                  onMouseEnter={() => {
                    // Keep index in sync with pointer hover for tight kb+mouse UX.
                    const flat =
                      sections.slice(0, si).reduce((acc, s) => acc + s.items.length, 0) + ii
                    setActiveIndex(flat)
                  }}
                >
                  <button
                    type="button"
                    className="mention-dropdown__row-main"
                    // mouseDown so focus doesn't leave the editor before we select.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onSelect(section.provider.id, item)
                    }}
                    title={isFolder ? 'Use this folder' : undefined}
                  >
                    <Icon size={14} strokeWidth={1.5} className="mention-dropdown__row-icon" />
                    <span className="mention-dropdown__row-label">{item.label}</span>
                    {item.secondary && (
                      <span className="mention-dropdown__row-secondary">{item.secondary}</span>
                    )}
                  </button>
                  {isFolder && (
                    <button
                      type="button"
                      className="mention-dropdown__row-drill"
                      aria-label={`Browse ${item.label}`}
                      title="Browse folder (→)"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onDrillInto?.(section.provider.id, item)
                      }}
                    >
                      <ChevronRight size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>,
    document.body,
  )
}
