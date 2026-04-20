import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { sanitizeTitle } from '../lib/conversations.js'
import { useStore } from '../lib/store.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return `${m}m ${r}s`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}

function fmtDuration(msStart: number, msEnd: number): string {
  const d = Math.max(0, msEnd - msStart)
  const s = Math.floor(d / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

interface Props {
  onCompose: () => void
}

export function ActivityDock({ onCompose }: Props) {
  const conversations = useStore((s) => s.conversations)
  const switchConversation = useStore((s) => s.switchConversation)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const setActiveView = uiStore((s) => s.setActiveView)

  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)

  const { working, recent } = useMemo(() => {
    const inProject = conversations.filter((c) => !c.projectId || c.projectId === activeProjectId)
    const now = Date.now()
    const w = inProject
      .filter((c) => {
        const ss = c.sessionId ? sessionStates.get(c.sessionId) : undefined
        return ss?.status === 'working'
      })
      .slice(0, 4)
      .map((c) => ({
        id: c.id,
        title: sanitizeTitle(c.title || 'New task'),
        elapsedMs: now - (c.updatedAt || c.createdAt),
      }))
    const r = [...inProject]
      .filter((c) => {
        if (c.messages.length === 0) return false
        const ss = c.sessionId ? sessionStates.get(c.sessionId) : undefined
        return ss?.status !== 'working'
      })
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 3)
      .map((c) => ({
        id: c.id,
        title: sanitizeTitle(c.title || 'New task'),
        durationLabel: fmtDuration(c.createdAt, c.updatedAt || c.createdAt),
      }))
    return { working: w, recent: r }
  }, [conversations, activeProjectId, sessionStates])

  const handleOpen = useCallback(
    (id: string) => {
      switchConversation(id)
      setActiveView('home')
    },
    [switchConversation, setActiveView],
  )

  const open = expanded || hovered || working.length > 0

  return (
    <div
      className={`act-dock${open ? ' act-dock--open' : ''}${
        working.length > 0 ? ' act-dock--live' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!open && (
        <button type="button" className="act-pill" onClick={() => setExpanded(true)}>
          <span className="act-pill__glyph">✻</span>
          <span className="act-pill__label">
            {recent.length > 0 ? 'Activity' : 'Anton is idle'}
          </span>
          <span className="act-pill__kbd">⌘K</span>
        </button>
      )}

      {open && (
        <div className="act-card">
          <div className="act-card__head">
            <div className="act-card__title">
              <span className="act-card__glyph">✻</span>
              <span>Activity</span>
              {working.length > 0 && (
                <span className="act-card__badge">
                  <span className="act-card__badge-dot" />
                  {working.length} running
                </span>
              )}
            </div>
            <button
              type="button"
              className="act-card__close"
              onClick={() => {
                setExpanded(false)
                setHovered(false)
              }}
              aria-label="Collapse"
            >
              <ChevronDown size={12} strokeWidth={1.5} />
            </button>
          </div>

          {working.length > 0 && (
            <div className="act-card__section">
              <div className="act-card__slabel">Running</div>
              {working.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="act-row act-row--working"
                  onClick={() => handleOpen(t.id)}
                >
                  <span className="act-row__pulse" />
                  <span className="act-row__title">{t.title}</span>
                  <span className="act-row__elapsed">{fmtElapsed(t.elapsedMs)}</span>
                  <span className="act-row__chev">
                    <ChevronRight size={11} strokeWidth={1.5} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <div className="act-card__section">
              <div className="act-card__slabel">Just finished</div>
              {recent.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="act-row"
                  onClick={() => handleOpen(t.id)}
                >
                  <span className="act-row__check">
                    <Check size={10} strokeWidth={2} />
                  </span>
                  <span className="act-row__title">{t.title}</span>
                  <span className="act-row__elapsed act-row__elapsed--quiet">
                    {t.durationLabel}
                  </span>
                </button>
              ))}
            </div>
          )}

          {working.length === 0 && recent.length === 0 && (
            <div className="act-card__empty">
              <div className="act-card__empty-title">All quiet.</div>
              <div className="act-card__empty-sub">Start a task and watch it stream here.</div>
              <button type="button" className="act-card__empty-cta" onClick={onCompose}>
                <Plus size={11} strokeWidth={1.5} /> New task
              </button>
            </div>
          )}

          <div className="act-card__foot">
            <span>
              <span className="act-card__kbd">⌘K</span> Command palette
            </span>
            <span>
              <span className="act-card__kbd">⌘N</span> New task
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
