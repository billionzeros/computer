import { Clock, MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'

interface Props {
  sessionId: string
  title: string
  messageCount?: number
  lastActiveAt: number
  isActive?: boolean
  onClick: () => void
  onDelete: () => void
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}

export function SessionCard({ title, messageCount, lastActiveAt, isActive, onClick, onDelete }: Props) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <button
      type="button"
      className={`session-card${isActive ? ' session-card--active' : ''}`}
      onClick={onClick}
    >
      <div className="session-card__content">
        <span className="session-card__title">{title || 'New conversation'}</span>
        <div className="session-card__meta">
          {messageCount !== undefined && (
            <span className="session-card__stat">
              <MessageSquare size={12} strokeWidth={1.5} />
              {messageCount}
            </span>
          )}
          <span className="session-card__stat">
            <Clock size={12} strokeWidth={1.5} />
            {formatRelativeTime(lastActiveAt)}
          </span>
        </div>
      </div>

      <div className="session-card__actions">
        <button
          type="button"
          className="session-card__menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          aria-label="Session options"
        >
          <MoreHorizontal size={14} strokeWidth={1.5} />
        </button>

        {showMenu && (
          <>
            <div className="session-card__menu-backdrop" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
            <div className="session-card__menu">
              <button
                type="button"
                className="session-card__menu-item session-card__menu-item--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                  setShowMenu(false)
                }}
              >
                <Trash2 size={14} strokeWidth={1.5} />
                <span>Delete</span>
              </button>
            </div>
          </>
        )}
      </div>
    </button>
  )
}
