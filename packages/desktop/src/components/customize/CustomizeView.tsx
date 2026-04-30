import { Plug, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ConnectorsView } from '../connectors/ConnectorsView.js'
import { SkillsPanel } from '../skills/SkillsPanel.js'

type Tab = 'skills' | 'connectors'

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'connectors', label: 'Connectors', icon: Plug },
]

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
    </div>
  )
}
