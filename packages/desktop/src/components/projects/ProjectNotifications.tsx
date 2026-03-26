import { Bell } from 'lucide-react'

interface Props {
  count?: number
}

export function ProjectNotifications({ count = 0 }: Props) {
  return (
    <div className="config-section-inline">
      <div className="config-section-inline__header">
        <Bell size={14} strokeWidth={1.5} />
        <span>Notifications</span>
        {count > 0 && (
          <span className="config-section-inline__badge config-section-inline__badge--warn">{count}</span>
        )}
      </div>
      {count > 0 ? (
        <p className="config-section-inline__value">
          {count} new notification{count !== 1 ? 's' : ''}
        </p>
      ) : (
        <p className="config-section-inline__hint">
          Job results, errors, and things that need your attention will show up here.
        </p>
      )}
    </div>
  )
}
