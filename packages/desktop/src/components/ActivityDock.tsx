import { AlertCircle, Check, ChevronDown, ChevronRight, FileUp, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { sanitizeTitle } from '../lib/conversations.js'
import { useStore } from '../lib/store.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import { type UploadItem, uploadStore } from '../lib/store/uploadStore.js'

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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function uploadStatusLabel(upload: UploadItem): string {
  switch (upload.status) {
    case 'queued':
      return 'Queued'
    case 'preparing':
      return 'Preparing'
    case 'uploading':
      return 'Uploading'
    case 'finishing':
      return 'Finishing'
    case 'complete':
      return 'Uploaded'
    case 'error':
      return upload.error || 'Failed'
  }
}

interface Props {
  onCompose: () => void
}

export function ActivityDock({ onCompose }: Props) {
  const conversations = useStore((s) => s.conversations)
  const switchConversation = useStore((s) => s.switchConversation)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const uploads = uploadStore((s) => s.uploads)
  const setActiveView = uiStore((s) => s.setActiveView)

  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    uploadStore.getState().clearFinished()
    const timer = window.setInterval(() => uploadStore.getState().clearFinished(), 60_000)
    return () => window.clearInterval(timer)
  }, [])

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

  const { activeUploads, recentUploads } = useMemo(() => {
    const active = uploads
      .filter((u) => u.status !== 'complete' && u.status !== 'error')
      .slice(-4)
      .reverse()
    const recentDone = uploads
      .filter((u) => u.status === 'complete' || u.status === 'error')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
    return { activeUploads: active, recentUploads: recentDone }
  }, [uploads])

  const handleOpen = useCallback(
    (id: string) => {
      switchConversation(id)
      setActiveView('home')
    },
    [switchConversation, setActiveView],
  )

  const handleUploadOpen = useCallback(
    (upload: UploadItem) => {
      const lastSlash = upload.path.lastIndexOf('/')
      const folder = lastSlash > 0 ? upload.path.slice(0, lastSlash) : upload.path
      setActiveView('files')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('anton:navigate-files', { detail: { path: folder } }))
      }, 0)
    },
    [setActiveView],
  )

  const activeCount = working.length + activeUploads.length
  const open = expanded || hovered || working.length > 0 || activeUploads.length > 0

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
            {activeUploads.length > 0
              ? activeUploads.length === 1
                ? `Uploading ${activeUploads[0]?.name ?? 'file'}`
                : `Uploading ${activeUploads.length} files`
              : recent.length > 0 || recentUploads.length > 0
                ? 'Activity'
                : 'Anton is idle'}
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
              {activeCount > 0 && (
                <span className="act-card__badge">
                  <span className="act-card__badge-dot" />
                  {activeCount} active
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

          {activeUploads.length > 0 && (
            <div className="act-card__section">
              <div className="act-card__slabel">Uploads</div>
              {activeUploads.map((upload) => (
                <button
                  key={upload.id}
                  type="button"
                  className="act-upload"
                  onClick={() => handleUploadOpen(upload)}
                >
                  <span className="act-upload__icon">
                    <FileUp size={13} strokeWidth={1.6} />
                  </span>
                  <span className="act-upload__body">
                    <span className="act-upload__top">
                      <span className="act-upload__name">{upload.name}</span>
                      <span className="act-upload__percent">{upload.percent}%</span>
                    </span>
                    <span className="act-upload__meta">
                      {uploadStatusLabel(upload)} · {fmtBytes(upload.uploadedBytes)} /{' '}
                      {fmtBytes(upload.sizeBytes)}
                    </span>
                    <span className="act-upload__bar" aria-hidden="true">
                      <span style={{ width: `${upload.percent}%` }} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

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

          {recentUploads.length > 0 && activeUploads.length === 0 && (
            <div className="act-card__section">
              <div className="act-card__slabel">Recent uploads</div>
              {recentUploads.map((upload) => (
                <button
                  key={upload.id}
                  type="button"
                  className={`act-upload act-upload--${upload.status}`}
                  onClick={() => handleUploadOpen(upload)}
                >
                  <span className="act-upload__icon">
                    {upload.status === 'error' ? (
                      <AlertCircle size={13} strokeWidth={1.7} />
                    ) : (
                      <Check size={12} strokeWidth={2} />
                    )}
                  </span>
                  <span className="act-upload__body">
                    <span className="act-upload__top">
                      <span className="act-upload__name">{upload.name}</span>
                      <span className="act-upload__percent">
                        {upload.status === 'error' ? 'Failed' : 'Done'}
                      </span>
                    </span>
                    <span className="act-upload__meta">
                      {uploadStatusLabel(upload)} · {fmtBytes(upload.sizeBytes)}
                    </span>
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

          {working.length === 0 &&
            recent.length === 0 &&
            activeUploads.length === 0 &&
            recentUploads.length === 0 && (
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
