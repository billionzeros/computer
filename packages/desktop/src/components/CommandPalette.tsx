import {
  BarChart3,
  CirclePlus,
  Clock,
  Code,
  Folder,
  Globe,
  Link2,
  type LucideIcon,
  Monitor,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareCheck,
  Terminal as TerminalIcon,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeTitle } from '../lib/conversations.js'
import { useStore } from '../lib/store.js'
import { projectStore } from '../lib/store/projectStore.js'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'

function fuzzyScore(q: string, s: string): number {
  if (!q) return 0
  const ql = q.toLowerCase()
  const sl = s.toLowerCase()
  const idx = sl.indexOf(ql)
  if (idx !== -1) return 1000 - idx
  let qi = 0
  let score = 0
  let last = -1
  for (let i = 0; i < sl.length && qi < ql.length; i++) {
    if (sl[i] === ql[qi]) {
      score += last === i - 1 ? 5 : 1
      last = i
      qi++
    }
  }
  return qi === ql.length ? score : -1
}

type ItemKind = 'action' | 'view' | 'task' | 'project'

interface Item {
  kind: ItemKind
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: (page?: 'general' | 'models' | 'usage') => void
  onNewProject: () => void
}

const GROUP_ORDER: ItemKind[] = ['action', 'view', 'task', 'project']
const GROUP_LABEL: Record<ItemKind, string> = {
  action: 'Actions',
  view: 'Go to',
  task: 'Recent tasks',
  project: 'Projects',
}

export function CommandPalette({ open, onClose, onOpenSettings, onNewProject }: Props) {
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const conversations = useStore((s) => s.conversations)
  const switchConversation = useStore((s) => s.switchConversation)
  const newConversation = useStore((s) => s.newConversation)
  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const setActiveView = uiStore((s) => s.setActiveView)

  useEffect(() => {
    if (!open) return
    setQ('')
    setCur(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 20)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])

  const handleNewTask = useCallback(() => {
    const sessionId = `sess_${Date.now().toString(36)}`
    const ss = sessionStore.getState()
    const ps = projectStore.getState()
    const projectId = ps.activeProjectId ?? undefined
    newConversation(undefined, sessionId, projectId)
    sessionStore.getState().createSession(sessionId, {
      provider: ss.currentProvider,
      model: ss.currentModel,
      projectId,
    })
    setActiveView('home')
  }, [newConversation, setActiveView])

  const items: Item[] = useMemo(() => {
    if (!open) return []

    const actions: Item[] = [
      {
        kind: 'action',
        id: 'a:new',
        label: 'New task',
        hint: '⌘N',
        icon: Plus,
        run: handleNewTask,
      },
      {
        kind: 'action',
        id: 'a:settings',
        label: 'Open settings',
        hint: '⌘,',
        icon: Settings,
        run: () => onOpenSettings('general'),
      },
      {
        kind: 'action',
        id: 'a:models',
        label: 'AI models & providers',
        icon: Sparkles,
        run: () => onOpenSettings('models'),
      },
      {
        kind: 'action',
        id: 'a:usage',
        label: 'Usage & billing',
        icon: BarChart3,
        run: () => onOpenSettings('usage'),
      },
      {
        kind: 'action',
        id: 'a:newproject',
        label: 'New project',
        hint: '⇧⌘P',
        icon: Plus,
        run: () => onNewProject(),
      },
      {
        kind: 'action',
        id: 'a:terminal',
        label: 'Open terminal',
        icon: TerminalIcon,
        run: () => setActiveView('terminal'),
      },
      {
        kind: 'action',
        id: 'a:connectors',
        label: 'Manage connectors',
        icon: Link2,
        run: () => setActiveView('connectors'),
      },
    ]

    const views: Item[] = [
      {
        kind: 'view',
        id: 'v:home',
        label: 'Home',
        hint: 'New task',
        icon: SquareCheck,
        run: () => setActiveView('home'),
      },
      {
        kind: 'view',
        id: 'v:tasks',
        label: 'Tasks',
        hint: 'All runs',
        icon: SquareCheck,
        run: () => setActiveView('tasks'),
      },
      {
        kind: 'view',
        id: 'v:memory',
        label: 'Memory',
        hint: 'What Anton knows',
        icon: CirclePlus,
        run: () => setActiveView('memory'),
      },
      {
        kind: 'view',
        id: 'v:routines',
        label: 'Routines',
        hint: 'Scheduled work',
        icon: RefreshCw,
        run: () => setActiveView('routines'),
      },
      {
        kind: 'view',
        id: 'v:files',
        label: 'Files',
        hint: 'Browse project files',
        icon: Folder,
        run: () => setActiveView('files'),
      },
      {
        kind: 'view',
        id: 'v:pages',
        label: 'Pages',
        hint: 'Generated docs',
        icon: Globe,
        run: () => setActiveView('pages'),
      },
      {
        kind: 'view',
        id: 'v:customize',
        label: 'Customize',
        hint: 'Skills & tools',
        icon: Zap,
        run: () => setActiveView('customize'),
      },
      {
        kind: 'view',
        id: 'v:workflows',
        label: 'Workflows',
        hint: 'Reusable recipes',
        icon: Network,
        run: () => setActiveView('workflows'),
      },
      {
        kind: 'view',
        id: 'v:skills',
        label: 'Patterns',
        hint: 'Interaction refs',
        icon: Sparkles,
        run: () => setActiveView('skills'),
      },
      {
        kind: 'view',
        id: 'v:projects',
        label: 'Projects',
        hint: 'Manage machines',
        icon: Monitor,
        run: () => setActiveView('projects'),
      },
      {
        kind: 'view',
        id: 'v:developer',
        label: 'Developer',
        hint: 'System prompt & logs',
        icon: Code,
        run: () => setActiveView('developer'),
      },
    ]

    const tasks: Item[] = [...conversations]
      .filter((c) => !c.projectId || c.projectId === activeProjectId)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 24)
      .map((c) => ({
        kind: 'task',
        id: `task:${c.id}`,
        label: sanitizeTitle(c.title || 'New task'),
        hint: new Date(c.updatedAt || c.createdAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        icon: Clock,
        run: () => {
          switchConversation(c.id)
          setActiveView('home')
        },
      }))

    const projectItems: Item[] = projects.map((p) => ({
      kind: 'project',
      id: `proj:${p.id}`,
      label: p.name,
      hint: p.isDefault ? 'This Mac' : (p.description ?? 'Project'),
      icon: p.isDefault ? Monitor : Folder,
      run: () => {
        setActiveProject(p.id)
        setActiveView('home')
      },
    }))

    return [...actions, ...views, ...tasks, ...projectItems]
  }, [
    open,
    conversations,
    projects,
    activeProjectId,
    handleNewTask,
    onOpenSettings,
    onNewProject,
    setActiveView,
    setActiveProject,
    switchConversation,
  ])

  const filtered = useMemo(() => {
    if (!q.trim()) {
      const def = items.filter((i) => i.kind === 'action' || i.kind === 'view')
      const recents = items.filter((i) => i.kind === 'task').slice(0, 5)
      return [...def, ...recents]
    }
    return items
      .map((i) => {
        const score = Math.max(fuzzyScore(q, i.label), i.hint ? fuzzyScore(q, i.hint) * 0.6 : -1)
        return { item: i, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((x) => x.item)
  }, [items, q])

  useEffect(() => {
    setCur(0)
  }, [q])

  const run = useCallback(
    (it: Item | undefined) => {
      if (!it) return
      onClose()
      // defer so the close animation doesn't fight the next view mount
      window.setTimeout(() => it.run(), 30)
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCur((c) => Math.min(filtered.length - 1, c + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCur((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        run(filtered[cur])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, filtered, cur, run, onClose])

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('.cp-row.on') as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [cur, filtered])

  if (!open) return null

  const groups: Partial<Record<ItemKind, Item[]>> = {}
  filtered.forEach((it) => {
    const arr = groups[it.kind] ?? []
    arr.push(it)
    groups[it.kind] = arr
  })

  const flat: Item[] = []
  GROUP_ORDER.forEach((g) => {
    const arr = groups[g]
    if (arr) flat.push(...arr)
  })

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp" onClick={(e) => e.stopPropagation()}>
        <div className="cp__search">
          <Search size={14} strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, actions, settings…"
            spellCheck={false}
          />
          <span className="cp__esc">esc</span>
        </div>
        <div className="cp__list" ref={listRef}>
          {flat.length === 0 && (
            <div className="cp__empty">
              <div className="cp__empty-title">No matches for "{q}"</div>
              <div className="cp__empty-sub">Try a task title, view, or action verb.</div>
            </div>
          )}
          {GROUP_ORDER.map((g) => {
            const arr = groups[g]
            if (!arr) return null
            return (
              <div key={g} className="cp-group">
                <div className="cp-group__label">{GROUP_LABEL[g]}</div>
                {arr.map((it) => {
                  const Icon = it.icon
                  const idx = flat.indexOf(it)
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`cp-row${idx === cur ? ' on' : ''}`}
                      onMouseEnter={() => setCur(idx)}
                      onClick={() => run(it)}
                    >
                      <span className="cp-row__icon">
                        <Icon size={14} strokeWidth={1.5} />
                      </span>
                      <span className="cp-row__label">{it.label}</span>
                      {it.hint && <span className="cp-row__hint">{it.hint}</span>}
                      {idx === cur && <span className="cp-row__enter">↵</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="cp__foot">
          <span>
            <span className="cp-kbd">↑</span>
            <span className="cp-kbd">↓</span> navigate
          </span>
          <span>
            <span className="cp-kbd">↵</span> open
          </span>
          <span>
            <span className="cp-kbd">esc</span> close
          </span>
          <span className="cp__foot-tip">Tip: type to fuzzy-search everything</span>
        </div>
      </div>
    </div>
  )
}
