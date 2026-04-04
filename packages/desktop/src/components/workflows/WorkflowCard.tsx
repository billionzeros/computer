import type { WorkflowRegistryEntry } from '@anton/protocol'

const WORKFLOW_ICONS: Record<string, string> = {
  'lead-qualification': '\u{1F3AF}',
  'content-creation-pipeline': '\u{1F3AC}',
  'workflow-creator': '\u{1F527}',
  'customer-support-automation': '\u{1F4E8}',
  'expense-tracking': '\u{1F4B3}',
  'daily-briefing': '\u{2615}',
}

export function WorkflowCard({
  workflow,
  comingSoon,
  onClick,
}: {
  workflow: WorkflowRegistryEntry
  comingSoon?: boolean
  onClick: () => void
}) {
  const icon = WORKFLOW_ICONS[workflow.id] || '\u{26A1}'

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '20px',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.07)',
        background: 'transparent',
        cursor: comingSoon ? 'default' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        opacity: comingSoon ? 0.5 : 1,
        minHeight: '140px',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        if (!comingSoon) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
      }}
    >
      {/* Icon + Title + Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#e4e4e7', lineHeight: 1.3 }}>
            {workflow.name}
          </div>
          <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
            {workflow.author}
            {comingSoon && (
              <span style={{ marginLeft: '8px', color: '#52525b' }}>· Coming soon</span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: '13px',
          lineHeight: '1.5',
          color: '#8b8b8f',
          marginTop: '14px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          flex: 1,
        }}
      >
        {workflow.description}
      </p>
    </button>
  )
}
