import { useStore } from '../lib/store.js'

const MODES = [
  { key: 'chat' as const, label: 'Chat' },
  { key: 'projects' as const, label: 'Projects' },
  { key: 'terminal' as const, label: 'Terminal' },
]

export function ModeSelector() {
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)

  return (
    <div className="mode-selector">
      {MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          className={`mode-selector__tab${activeView === mode.key ? ' mode-selector__tab--active' : ''}`}
          onClick={() => setActiveView(mode.key)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}
