import {
  ArrowLeft,
  Code,
  CornerDownLeft,
  FileText,
  FolderOpen,
  MapPin,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'

type TemplateId = 'blank' | 'essay' | 'research' | 'code' | 'trip'

interface Template {
  id: TemplateId
  name: string
  sub: string
  instructions: string
  icon: typeof FileText
}

const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    sub: 'Start from scratch',
    instructions: '',
    icon: FolderOpen,
  },
  {
    id: 'essay',
    name: 'Essay',
    sub: 'Drafting, editing, citations',
    instructions: `You are helping me write an essay.

· Keep my voice — casual, direct, opinionated.
· Cite sources with a short tag like [WSJ, 2024].
· Default to plain prose over bullets.
· When I share notes, organize them into a clean outline before drafting.`,
    icon: FileText,
  },
  {
    id: 'research',
    name: 'Research',
    sub: 'Gather, summarize, compare',
    instructions: `You are helping me with a research project.

· Summarize findings, don't rephrase.
· Compare options in short tables when useful.
· Cite sources inline with a short tag.
· Flag anything uncertain or contradictory rather than papering over it.`,
    icon: Search,
  },
  {
    id: 'code',
    name: 'Code',
    sub: 'Review, refactor, ship',
    instructions: `You are helping me build software.

· Prefer small, reviewable changes. Don't refactor opportunistically.
· Match existing conventions in the codebase.
· When uncertain, read the code before guessing.
· Run the type checker and tests before declaring a task done.`,
    icon: Code,
  },
  {
    id: 'trip',
    name: 'Trip',
    sub: 'Itinerary, bookings, notes',
    instructions: `You are helping me plan a trip.

· Keep itinerary items concrete: dates, times, addresses.
· Surface trade-offs (price, distance, walk-time) when I'm deciding.
· Remember constraints I share once — don't re-ask.`,
    icon: MapPin,
  },
]

const DEFAULT_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
]

export function NewProjectView() {
  const [templateId, setTemplateId] = useState<TemplateId>('blank')
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [creating, setCreating] = useState(false)

  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]

  const pickTemplate = (id: TemplateId) => {
    const next = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
    setTemplateId(id)
    if (!name.trim() || TEMPLATES.some((t) => t.name === name.trim())) {
      setName(next.id === 'blank' ? '' : next.name)
    }
    if (!instructions.trim() || TEMPLATES.some((t) => t.instructions === instructions)) {
      setInstructions(next.instructions)
    }
  }

  const suggestName = () => {
    if (template.id === 'blank') return
    setName(template.name)
  }

  const goBack = () => uiStore.getState().setActiveView('projects')

  const canCreate = name.trim().length > 0 && !creating

  const handleCreate = () => {
    if (!canCreate) return
    setCreating(true)
    const color = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
    projectStore.getState().createProject({
      name: name.trim(),
      description: instructions.trim().split('\n')[0]?.slice(0, 140) || '',
      icon: '📁',
      color,
    })
    uiStore.getState().setActiveView('projects')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        e.preventDefault()
        goBack()
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        handleCreate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const firstLine = instructions.trim().split('\n')[0] || ''

  return (
    <div className="np-main">
      <div className="np-topbar">
        <button type="button" className="np-back" onClick={goBack}>
          <ArrowLeft size={13} strokeWidth={1.5} />
          Projects
        </button>
        <div className="np-actions">
          <span className="np-shortcut">
            <kbd>Esc</kbd> cancel
          </span>
          <span className="np-shortcut">
            <kbd>⌘</kbd>
            <kbd>
              <CornerDownLeft size={10} strokeWidth={2} />
            </kbd>
            create
          </span>
          <button
            type="button"
            className="pr-btn pr-btn--primary"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>

      <div>
        <h1 className="np-head__title">New project</h1>
        <p className="np-head__sub">
          A named workspace with its own instructions, files, and task history.
        </p>
      </div>

      <div className="np-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="np-section">
            <div className="np-section__label">Start from</div>
            <div className="np-templates">
              {TEMPLATES.map((t) => {
                const Icon = t.icon
                const selected = t.id === templateId
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`np-template${selected ? ' selected' : ''}`}
                    onClick={() => pickTemplate(t.id)}
                  >
                    <div className="np-template__icon">
                      <Icon size={14} strokeWidth={1.5} />
                    </div>
                    <div className="np-template__name">{t.name}</div>
                    <div className="np-template__sub">{t.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="np-section">
            <div className="np-section__label">Name</div>
            <div className="np-name">
              <input
                type="text"
                className="np-input"
                placeholder="e.g. Essay, Telegram Bots, Home ops"
                value={name}
                onChange={(e) => setName(e.target.value)}
                // biome-ignore lint/a11y/noAutofocus: new-project view expects the name field focused
                autoFocus
              />
              <button type="button" className="np-suggest" onClick={suggestName}>
                <Sparkles size={11} strokeWidth={1.5} />
                Suggest
              </button>
            </div>
          </div>

          <div className="np-section">
            <div className="np-section__label">
              Instructions
              <span className="np-section__hint">How Anton should behave in this project</span>
            </div>
            <textarea
              className="np-textarea"
              placeholder="Describe the purpose of this project and how Anton should approach it..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="np-section">
            <div className="np-section__label">
              Files & context
              <span className="np-section__hint">Anything Anton should always have on hand</span>
            </div>
            <div className="np-dropzone">
              <Upload size={16} strokeWidth={1.5} />
              <span>
                Drop files here, or{' '}
                <span className="np-dropzone__link">pick from your computer</span>
              </span>
            </div>
          </div>
        </div>

        <aside className="np-preview">
          <div className="np-section__label">Preview</div>
          <div className="np-preview-card">
            <div className="np-preview-card__head">
              <div className="np-preview-card__icon">
                <FolderOpen size={14} strokeWidth={1.5} />
              </div>
              <div className="np-preview-card__files">0 files</div>
            </div>
            <div className="np-preview-card__name">{name.trim() || 'Untitled project'}</div>
            <div className="np-preview-card__blurb">
              {firstLine || 'Add instructions to describe how Anton should behave here.'}
            </div>
            <div className="np-preview-card__meta">Last used Just now</div>
          </div>
          <div className="np-preview__note">
            This is how your project will appear in the grid. You can change anything later.
          </div>
        </aside>
      </div>
    </div>
  )
}
