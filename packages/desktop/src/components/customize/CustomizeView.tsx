import { Plug, Puzzle, Settings2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ConnectorsView } from '../connectors/ConnectorsView.js'
import { SkillsPanel } from '../skills/SkillsPanel.js'

type Tab = 'skills' | 'connectors' | 'plugins'

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
]

function PluginsEmpty() {
  return (
    <div className="cust-detail">
      <div className="cust-detail__head">
        <div className="cust-detail__glyph">
          <Puzzle size={18} strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="cust-detail__title">Plugins</h1>
          <p className="cust-detail__desc">
            Extend Anton with community plugins. This area is reserved — plugin distribution isn't
            wired up yet.
          </p>
        </div>
      </div>
      <div className="cust-detail__empty">
        <Settings2 size={22} strokeWidth={1.2} />
        <div style={{ marginTop: 10 }}>No plugins installed.</div>
      </div>
    </div>
  )
}

export function CustomizeView() {
  const [tab, setTab] = useState<Tab>('skills')

  return (
    <div className="cust-wrap" style={{ gridTemplateColumns: '200px 1fr' }}>
      <aside className="cust-subnav">
        <div className="cust-subnav__label">Customize</div>
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              type="button"
              key={t.id}
              className={`cust-subnav__item${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} strokeWidth={1.5} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </aside>

      {tab === 'skills' && <SkillsPanel />}
      {tab === 'connectors' && <ConnectorsView />}
      {tab === 'plugins' && <PluginsEmpty />}
    </div>
  )
}
