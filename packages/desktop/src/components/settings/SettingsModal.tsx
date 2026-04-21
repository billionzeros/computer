import {
  Book,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Globe,
  HelpCircle,
  LogOut,
  MoreHorizontal,
  PlayCircle,
  Search,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderInfo } from '../../lib/store.js'
import {
  ACCOUNT_COLORS,
  accountColorValue,
  accountStore,
  avatarInitial,
} from '../../lib/store/accountStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { HarnessSetupModal } from '../chat/HarnessSetupModal.js'
import { ModelPopover } from '../chat/ModelSelector.js'
import { ProviderSettingsModal } from '../chat/ProviderSettingsModal.js'
import { formatModelName, providerIcons } from '../chat/model-utils.js'

// ── Types ─────────────────────────────────────────────────────────

type SectionId =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'notifications'
  | 'models'
  | 'behavior'
  | 'memory'
  | 'privacy'
  | 'advanced'
  | 'about'

type SettingsPage = 'general' | 'models'

interface Props {
  open: boolean
  onClose: () => void
  onDisconnect: () => void
  onOpenUsage?: () => void
  initialPage?: SettingsPage
}

const SECTIONS: { id: SectionId; label: string; group: 'Settings' | 'Agent' | 'Account' }[] = [
  { id: 'general', label: 'General', group: 'Settings' },
  { id: 'appearance', label: 'Appearance', group: 'Settings' },
  { id: 'shortcuts', label: 'Keyboard', group: 'Settings' },
  { id: 'notifications', label: 'Notifications', group: 'Settings' },
  { id: 'models', label: 'AI Models', group: 'Agent' },
  { id: 'behavior', label: 'Behavior', group: 'Agent' },
  { id: 'memory', label: 'Memory', group: 'Agent' },
  { id: 'privacy', label: 'Data & privacy', group: 'Account' },
  { id: 'advanced', label: 'Advanced', group: 'Account' },
  { id: 'about', label: 'About', group: 'Account' },
]

const GROUPS: ('Settings' | 'Agent' | 'Account')[] = ['Settings', 'Agent', 'Account']

// ── Primitives ────────────────────────────────────────────────────

function Row({
  title,
  desc,
  compact,
  children,
}: {
  title: string
  desc?: string
  compact?: boolean
  children: ReactNode
}) {
  return (
    <div className={`srow${compact ? ' srow--compact' : ''}`}>
      <div className="srow__text">
        <div className="srow__title">{title}</div>
        {desc ? <div className="srow__desc">{desc}</div> : null}
      </div>
      <div className="srow__control">{children}</div>
    </div>
  )
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`sm-toggle${on ? ' sm-toggle--on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="sm-toggle__knob" />
    </button>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="sm-select-wrap">
      <select className="sm-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={1.5} />
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="sseg">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          className={`sseg__opt${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Group({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="sm-section">
      <div className="sm-section__head">
        <div className="sm-section__title">{label}</div>
        {hint ? <div className="sm-section__desc">{hint}</div> : null}
      </div>
      <div className="sm-section__body">{children}</div>
    </section>
  )
}

function Divider() {
  return <div className="sm-divider" />
}

// ── Timezone helpers ──────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

function tzLabel(tz: string): string {
  try {
    const offset =
      new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
    return offset ? `${city} (${offset})` : city
  } catch {
    return tz
  }
}

// ── Accent persistence ────────────────────────────────────────────

type Accent = 'amber' | 'blue' | 'teal'

function readAccent(): Accent {
  const saved = localStorage.getItem('anton-accent')
  if (saved === 'blue' || saved === 'teal') return saved
  return 'amber'
}

function writeAccent(a: Accent) {
  localStorage.setItem('anton-accent', a)
  document.documentElement.setAttribute('data-accent', a)
}

// ── Sections ──────────────────────────────────────────────────────

function GeneralSection({
  onDisconnect,
  onClose,
}: {
  onDisconnect: () => void
  onClose: () => void
}) {
  const timezone = uiStore((s) => s.timezone)
  const setTimezone = uiStore((s) => s.setTimezone)

  const tzOptions = useMemo(() => {
    const unique = new Set<string>([timezone, ...COMMON_TIMEZONES])
    return Array.from(unique).map((tz) => ({ value: tz, label: tzLabel(tz) }))
  }, [timezone])

  return (
    <>
      <Group label="Language" hint="Interface language for Anton.">
        <Select value="en" onChange={() => {}} options={[{ value: 'en', label: 'English' }]} />
      </Group>
      <Divider />
      <Group label="Timezone" hint="Used for agent schedules and displayed times.">
        <Select value={timezone} onChange={setTimezone} options={tzOptions} />
      </Group>
      <Divider />
      <Group label="Start behavior" hint="What Anton opens to when you launch the app.">
        <StartBehaviorRows />
      </Group>
      <Divider />
      <Group label="Welcome tour" hint="The 6-step introduction to Anton shown on first connect.">
        <ReplayTourRow onReplayTour={onClose} />
      </Group>
      <Divider />
      <Group label="Profile" hint="How you appear in Anton. Stored on this machine only.">
        <ProfileEditor />
      </Group>
      <Divider />
      <Group
        label="Session"
        hint="Sign out of this machine. You'll need to reconnect to use Anton again."
      >
        <button
          type="button"
          className="sm-btn sm-btn--danger sm-btn--inline"
          onClick={onDisconnect}
        >
          <LogOut size={14} strokeWidth={1.5} />
          <span>Disconnect from machine</span>
        </button>
      </Group>
    </>
  )
}

function ProfileEditor() {
  const displayName = accountStore((s) => s.displayName)
  const avatarColor = accountStore((s) => s.avatarColor)
  const setDisplayName = accountStore((s) => s.setDisplayName)
  const setAvatarColor = accountStore((s) => s.setAvatarColor)
  const reset = accountStore((s) => s.reset)
  const [draft, setDraft] = useState(displayName)

  useEffect(() => {
    setDraft(displayName)
  }, [displayName])

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === displayName) return
    setDisplayName(trimmed)
  }

  return (
    <div className="sprofile">
      <div className="sprofile__av" style={{ color: accountColorValue(avatarColor) }}>
        {avatarInitial(draft || displayName)}
      </div>
      <div className="sprofile__body">
        <input
          className="sprofile__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(displayName)
          }}
          placeholder="Anton"
          maxLength={40}
          aria-label="Display name"
        />
        <div className="sprofile__colors">
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`sprofile__color${avatarColor === c.id ? ' is-active' : ''}`}
              style={{ background: c.value }}
              onClick={() => setAvatarColor(c.id)}
              aria-label={`${c.id} avatar color`}
              aria-pressed={avatarColor === c.id}
            />
          ))}
        </div>
      </div>
      <button type="button" className="sm-btn sm-btn--quiet" onClick={reset}>
        Reset
      </button>
    </div>
  )
}

function StartBehaviorRows() {
  const [restore, setRestore] = useState(() => localStorage.getItem('anton-restore') !== 'false')
  const [resume, setResume] = useState(() => localStorage.getItem('anton-resume') !== 'false')
  const [welcome, setWelcome] = useState(
    () => localStorage.getItem('anton-show-welcome') === 'true',
  )
  const persist = (k: string, v: boolean) => localStorage.setItem(k, String(v))
  return (
    <>
      <Row title="Restore last view" desc="Reopen whichever surface you had when quitting." compact>
        <Toggle
          on={restore}
          onChange={(v) => {
            setRestore(v)
            persist('anton-restore', v)
          }}
        />
      </Row>
      <Row
        title="Resume running tasks"
        desc="Pick up streaming tasks that were mid-flight."
        compact
      >
        <Toggle
          on={resume}
          onChange={(v) => {
            setResume(v)
            persist('anton-resume', v)
          }}
        />
      </Row>
      <Row
        title="Show welcome on new machine"
        desc="Display the onboarding sheet on first connect."
        compact
      >
        <Toggle
          on={welcome}
          onChange={(v) => {
            setWelcome(v)
            persist('anton-show-welcome', v)
          }}
        />
      </Row>
    </>
  )
}

function ReplayTourRow({ onReplayTour }: { onReplayTour: () => void }) {
  const tourCompleted = uiStore((s) => s.tourCompleted)
  const setTourCompleted = uiStore((s) => s.setTourCompleted)
  return (
    <Row
      title={tourCompleted ? 'You finished the welcome tour' : "You haven't finished the tour"}
      desc="Replays the 6-step introduction. We'll remember when you finish it."
      compact
    >
      <button
        type="button"
        className="sm-btn"
        onClick={() => {
          setTourCompleted(false)
          onReplayTour()
          window.dispatchEvent(new CustomEvent('anton:replay-tour'))
        }}
      >
        <PlayCircle size={15} strokeWidth={1.5} /> Replay tour
      </button>
    </Row>
  )
}

function AppearanceSection() {
  const theme = uiStore((s) => s.theme)
  const setTheme = uiStore((s) => s.setTheme)
  const [accent, setAccent] = useState<Accent>(() => readAccent())

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  const themes: {
    id: 'light' | 'dark' | 'system'
    label: string
    bg: string
    side: string
    card: string
    fg: string
    border: string
  }[] = [
    {
      id: 'light',
      label: 'Paper',
      bg: '#FAF9F5',
      side: '#F4F2EA',
      card: '#FFFFFF',
      fg: '#1F1E1B',
      border: 'rgba(0,0,0,0.08)',
    },
    {
      id: 'dark',
      label: 'Ink',
      bg: '#0E1414',
      side: '#141B1B',
      card: '#1A2222',
      fg: '#E8EDEC',
      border: 'rgba(255,255,255,0.08)',
    },
    {
      id: 'system',
      label: 'System',
      bg: 'linear-gradient(135deg, #FAF9F5 0%, #FAF9F5 50%, #0E1414 50%, #0E1414 100%)',
      side: '#1A2222',
      card: '#FFFFFF',
      fg: '#767676',
      border: 'rgba(120,120,120,0.18)',
    },
  ]

  const accents: { id: Accent; swatch: string }[] = [
    { id: 'amber', swatch: 'oklch(0.80 0.11 70)' },
    { id: 'blue', swatch: 'oklch(0.80 0.09 200)' },
    { id: 'teal', swatch: 'oklch(0.82 0.09 195)' },
  ]

  return (
    <>
      <Group label="Theme" hint="Choose how Anton looks. Ink is tuned for long sessions.">
        <div className="sm-appearance-grid">
          {themes.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`sm-appearance-card${theme === t.id ? ' sm-appearance-card--active' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <div
                className="sm-appearance-card__preview"
                style={{ background: t.bg, borderColor: t.border }}
              >
                <div
                  className="sth-sb"
                  style={{ background: t.side, borderRight: `1px solid ${t.border}` }}
                >
                  <div className="sth-sb__brand" style={{ background: t.fg, opacity: 0.65 }} />
                  <div className="sth-sb__row" style={{ background: t.fg, opacity: 0.22 }} />
                  <div className="sth-sb__row" style={{ background: t.fg, opacity: 0.22 }} />
                  <div
                    className="sth-sb__row sth-sb__row--on"
                    style={{ background: t.fg, opacity: 0.45 }}
                  />
                </div>
                <div className="sth-main">
                  <div className="sth-msg" style={{ background: t.card, borderColor: t.border }}>
                    <div
                      className="sth-line"
                      style={{ background: t.fg, opacity: 0.9, width: '60%' }}
                    />
                    <div
                      className="sth-line"
                      style={{ background: t.fg, opacity: 0.45, width: '85%' }}
                    />
                    <div
                      className="sth-line"
                      style={{ background: t.fg, opacity: 0.45, width: '50%' }}
                    />
                  </div>
                  <div className="sth-dock" style={{ background: t.card, borderColor: t.border }} />
                </div>
              </div>
              <div className="sm-appearance-card__label">
                <span>{t.label}</span>
                {theme === t.id ? <Check size={12} strokeWidth={2} /> : null}
              </div>
            </button>
          ))}
        </div>
      </Group>
      <Divider />
      <Group label="Accent">
        <div className="saccent">
          {accents.map((a) => (
            <button
              type="button"
              key={a.id}
              className={`saccent__sw${accent === a.id ? ' on' : ''}`}
              onClick={() => {
                setAccent(a.id)
                writeAccent(a.id)
              }}
              title={a.id}
            >
              <span className="saccent__dot" style={{ background: a.swatch }} />
              <span className="saccent__lbl">{a.id}</span>
            </button>
          ))}
        </div>
      </Group>
      <Divider />
      <Group label="Typography">
        <Row title="Interface font" desc="Applied to UI chrome; prose remains consistent.">
          <Select
            value="inter"
            onChange={() => {}}
            options={[
              { value: 'inter', label: 'Inter (default)' },
              { value: 'system', label: 'System UI' },
              { value: 'spectral', label: 'Spectral — serif accents' },
            ]}
          />
        </Row>
        <Row title="Text size" desc="Base size for messages and chat history.">
          <Segmented
            value="md"
            onChange={() => {}}
            options={[
              { value: 'sm', label: 'Compact' },
              { value: 'md', label: 'Cozy' },
              { value: 'lg', label: 'Spacious' },
            ]}
          />
        </Row>
      </Group>
    </>
  )
}

const SHORTCUT_GROUPS: { label: string; items: { name: string; keys: string[] }[] }[] = [
  {
    label: 'Global',
    items: [
      { name: 'New task', keys: ['⌘', 'N'] },
      { name: 'Command palette', keys: ['⌘', 'K'] },
      { name: 'Toggle terminal', keys: ['⌘', 'T'] },
      { name: 'Toggle sidebar', keys: ['⌘', '\\'] },
      { name: 'Focus composer', keys: ['⌘', 'L'] },
      { name: 'Open settings', keys: ['⌘', ','] },
    ],
  },
  {
    label: 'Navigation',
    items: [
      { name: 'Go to Tasks', keys: ['G', 'T'] },
      { name: 'Go to Memory', keys: ['G', 'M'] },
      { name: 'Go to Routines', keys: ['G', 'R'] },
      { name: 'Go to Files', keys: ['G', 'F'] },
      { name: 'Go to Pages', keys: ['G', 'P'] },
    ],
  },
  {
    label: 'In a task',
    items: [
      { name: 'Send message', keys: ['⏎'] },
      { name: 'New line', keys: ['⇧', '⏎'] },
      { name: 'Stop generation', keys: ['⌘', '.'] },
      { name: 'Switch model', keys: ['⌘', 'M'] },
    ],
  },
]

function ShortcutsSection() {
  const [q, setQ] = useState('')
  const filter = q.trim().toLowerCase()
  return (
    <>
      <div className="skeys-head">
        <div className="sinput-search">
          <Search size={12} strokeWidth={1.5} />
          <input placeholder="Search shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="sm-btn sm-btn--quiet">
          Reset defaults
        </button>
      </div>
      {SHORTCUT_GROUPS.map((g) => {
        const items = filter
          ? g.items.filter((it) => it.name.toLowerCase().includes(filter))
          : g.items
        if (items.length === 0) return null
        return (
          <Group key={g.label} label={g.label}>
            {items.map((it) => (
              <div key={it.name} className="skey">
                <span className="skey__name">{it.name}</span>
                <div className="skey__combo">
                  {it.keys.map((k, i) => (
                    <span key={`${it.name}-${i}-${k}`} className="skey__combo-key">
                      {i > 0 ? <span className="skey__plus">+</span> : null}
                      <kbd className="skey__k">{k}</kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Group>
        )
      })}
    </>
  )
}

const NOTIF_ROWS: {
  id: string
  title: string
  desc: string
  email: boolean
  push: boolean
  desktop: boolean
}[] = [
  {
    id: 'task_done',
    title: 'Task completed',
    desc: 'When a long-running task finishes.',
    email: true,
    push: true,
    desktop: true,
  },
  {
    id: 'task_fail',
    title: 'Task failed or stuck',
    desc: 'Errors, timeouts, and rate limits.',
    email: true,
    push: true,
    desktop: true,
  },
  {
    id: 'question',
    title: 'Question from Anton',
    desc: 'When a task needs input to continue.',
    email: false,
    push: true,
    desktop: true,
  },
  {
    id: 'routine_ran',
    title: 'Routine finished',
    desc: 'Scheduled routines that completed.',
    email: false,
    push: false,
    desktop: true,
  },
  {
    id: 'usage_warn',
    title: 'Usage warnings',
    desc: 'Approaching spend cap or plan limit.',
    email: true,
    push: false,
    desktop: false,
  },
]

function NotificationsSection() {
  const notificationsEnabled = uiStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = uiStore((s) => s.setNotificationsEnabled)
  const [rows, setRows] = useState(NOTIF_ROWS)
  const toggle = (id: string, key: 'email' | 'push' | 'desktop') =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: !r[key] } : r)))
  return (
    <>
      <Group label="Channels">
        <Row
          title="Desktop notifications"
          desc="Show system notifications when Anton needs you."
          compact
        >
          <Toggle on={notificationsEnabled} onChange={setNotificationsEnabled} />
        </Row>
        <Row title="Sound" desc="Play a short chime when Anton finishes.">
          <Select
            value="subtle"
            onChange={() => {}}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'subtle', label: 'Subtle' },
              { value: 'distinct', label: 'Distinct' },
            ]}
          />
        </Row>
      </Group>
      <Divider />
      <div className="snotif">
        <div className="snotif__head">
          <div className="snotif__htitle">Event</div>
          <div className="snotif__hcol">Email</div>
          <div className="snotif__hcol">Push</div>
          <div className="snotif__hcol">Desktop</div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="snotif__row">
            <div className="snotif__text">
              <div className="snotif__title">{r.title}</div>
              <div className="snotif__desc">{r.desc}</div>
            </div>
            <div className="snotif__cell">
              <Toggle on={r.email} onChange={() => toggle(r.id, 'email')} />
            </div>
            <div className="snotif__cell">
              <Toggle on={r.push} onChange={() => toggle(r.id, 'push')} />
            </div>
            <div className="snotif__cell">
              <Toggle on={r.desktop} onChange={() => toggle(r.id, 'desktop')} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function ProviderMark({ provider, size = 18 }: { provider: string; size?: number }) {
  const icon = providerIcons[provider.toLowerCase()]
  if (icon) {
    return <img src={icon} alt={provider} width={size} height={size} />
  }
  return <span className="sprov__av-fallback">{provider.charAt(0).toUpperCase()}</span>
}

function ProviderRow({
  provider,
  onOpen,
}: {
  provider: ProviderInfo
  onOpen: (p: ProviderInfo) => void
}) {
  const isHarness = provider.type === 'harness'
  const connected = provider.hasApiKey || provider.installed === true
  const meta = isHarness
    ? connected
      ? 'CLI installed'
      : 'Install to connect'
    : connected
      ? 'API key configured'
      : 'Not connected'
  return (
    <div className="sprov">
      <div className="sprov__av">
        <ProviderMark provider={provider.name} size={18} />
      </div>
      <div className="sprov__body">
        <div className="sprov__name">{provider.name}</div>
        <div className="sprov__meta">{meta}</div>
      </div>
      {connected ? (
        <span className="stag stag--ok">
          <span className="stag__dot" /> Connected
        </span>
      ) : (
        <button type="button" className="sm-btn sm-btn--quiet" onClick={() => onOpen(provider)}>
          Connect
        </button>
      )}
      <button
        type="button"
        className="sicon"
        title={isHarness ? 'Manage CLI' : 'Manage API key'}
        onClick={() => onOpen(provider)}
      >
        <MoreHorizontal size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function ModelsSection({ onOpenUsage }: { onOpenUsage?: () => void }) {
  const providers = sessionStore((s) => s.providers)
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const sendProvidersList = sessionStore((s) => s.sendProvidersList)
  const sendDetectHarnesses = sessionStore((s) => s.sendDetectHarnesses)
  const sendProviderSetDefault = sessionStore((s) => s.sendProviderSetDefault)
  const setCurrentSession = sessionStore((s) => s.setCurrentSession)
  const currentSessionId = sessionStore((s) => s.currentSessionId)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [apiProvider, setApiProvider] = useState<ProviderInfo | null>(null)
  const [harnessProvider, setHarnessProvider] = useState<ProviderInfo | null>(null)
  const changeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    sendProvidersList()
    sendDetectHarnesses()
  }, [sendProvidersList, sendDetectHarnesses])

  const { harnesses, apis } = useMemo(() => {
    const h: ProviderInfo[] = []
    const a: ProviderInfo[] = []
    for (const p of providers) {
      if (p.type === 'harness') h.push(p)
      else a.push(p)
    }
    return { harnesses: h, apis: a }
  }, [providers])

  const openProvider = useCallback((p: ProviderInfo) => {
    if (p.type === 'harness') setHarnessProvider(p)
    else setApiProvider(p)
  }, [])

  const handleSelectModel = useCallback(
    (provider: string, model: string) => {
      setCurrentSession(currentSessionId || '', provider, model)
      sendProviderSetDefault(provider, model)
      setPickerOpen(false)
    },
    [currentSessionId, sendProviderSetDefault, setCurrentSession],
  )

  return (
    <>
      <Group label="Default model" hint="Used when you start a new task without specifying one.">
        <div className="smodel">
          <div className="smodel__av">
            <ProviderMark provider={currentProvider} size={20} />
          </div>
          <div className="smodel__body">
            <div className="smodel__name">{formatModelName(currentModel) || currentModel}</div>
            <div className="smodel__meta">{currentProvider}</div>
          </div>
          <button
            ref={changeBtnRef}
            type="button"
            className="sm-btn sm-btn--quiet"
            onClick={() => setPickerOpen((o) => !o)}
          >
            Change
          </button>
        </div>
      </Group>
      <Divider />
      <Group label="CLIs" hint="Use your ChatGPT / Claude / Anton subscription via installed CLIs.">
        {harnesses.length === 0 ? (
          <Row title="No CLI providers" desc="Harness-backed providers will appear here.">
            <span className="stag">Empty</span>
          </Row>
        ) : (
          harnesses.map((p) => <ProviderRow key={p.name} provider={p} onOpen={openProvider} />)
        )}
      </Group>
      <Divider />
      <Group label="API keys" hint="Bring your own key to route requests directly.">
        {apis.length === 0 ? (
          <Row title="No API providers" desc="API-key-based providers will appear here.">
            <span className="stag">Empty</span>
          </Row>
        ) : (
          apis.map((p) => <ProviderRow key={p.name} provider={p} onOpen={openProvider} />)
        )}
      </Group>
      <Divider />
      <Group label="Costs & limits">
        <Row title="Token usage" desc="See a breakdown of usage by model and session.">
          <button type="button" className="sm-btn sm-btn--quiet" onClick={() => onOpenUsage?.()}>
            View usage
          </button>
        </Row>
      </Group>

      {pickerOpen && (
        <ModelPopover
          anchorRef={changeBtnRef}
          providers={providers}
          currentProvider={currentProvider}
          currentModel={currentModel}
          onSelect={handleSelectModel}
          onClose={() => setPickerOpen(false)}
          onManage={() => setPickerOpen(false)}
        />
      )}
      <ProviderSettingsModal provider={apiProvider} onClose={() => setApiProvider(null)} />
      <HarnessSetupModal provider={harnessProvider} onClose={() => setHarnessProvider(null)} />
    </>
  )
}

function BehaviorSection() {
  const [autonomy, setAutonomy] = useState<'strict' | 'ask' | 'auto'>('ask')
  const [writeTools, setWriteTools] = useState(false)
  const [destructive, setDestructive] = useState(false)
  const [retry, setRetry] = useState(true)
  const [citation, setCitation] = useState<'inline' | 'foot' | 'off'>('inline')
  const [toolInline, setToolInline] = useState(true)
  const disconnectMode = uiStore((s) => s.disconnectMode)
  const setDisconnectMode = uiStore((s) => s.setDisconnectMode)
  return (
    <>
      <Group label="Autonomy">
        <Row title="Default mode" desc="How much Anton can do before asking.">
          <Segmented
            value={autonomy}
            onChange={setAutonomy}
            options={[
              { value: 'strict', label: 'Strict' },
              { value: 'ask', label: 'Ask' },
              { value: 'auto', label: 'Auto' },
            ]}
          />
        </Row>
        <Row
          title="Allow write tools by default"
          desc="Email drafts, file edits, issue creation."
          compact
        >
          <Toggle on={writeTools} onChange={setWriteTools} />
        </Row>
        <Row
          title="Allow destructive tools"
          desc="Delete, overwrite, drop — always asks first."
          compact
        >
          <Toggle on={destructive} onChange={setDestructive} />
        </Row>
        <Row
          title="Auto-retry transient errors"
          desc="Retry network + rate-limit failures up to 3×."
          compact
        >
          <Toggle on={retry} onChange={setRetry} />
        </Row>
        <Row
          title="Keep running when I close the tab"
          desc="Detached turns finish in the background. Hard-cancelled after 10 minutes without a client."
          compact
        >
          <Toggle
            on={disconnectMode === 'detached'}
            onChange={(on) => setDisconnectMode(on ? 'detached' : 'attached')}
          />
        </Row>
      </Group>
      <Divider />
      <Group label="Output">
        <Row title="Citation style" desc="How Anton links to sources in answers.">
          <Segmented
            value={citation}
            onChange={setCitation}
            options={[
              { value: 'inline', label: 'Inline' },
              { value: 'foot', label: 'Footnotes' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
        <Row
          title="Show tool calls inline"
          desc="Render tool-call chips in the transcript."
          compact
        >
          <Toggle on={toolInline} onChange={setToolInline} />
        </Row>
      </Group>
    </>
  )
}

function MemorySection() {
  const [learn, setLearn] = useState(true)
  const [ask, setAsk] = useState(false)
  const [share, setShare] = useState(true)
  return (
    <>
      <Group label="Memory collection">
        <Row
          title="Learn from tasks"
          desc="Anton may save facts it discovers while working."
          compact
        >
          <Toggle on={learn} onChange={setLearn} />
        </Row>
        <Row
          title="Ask before saving"
          desc="Confirm each new memory entry before it's stored."
          compact
        >
          <Toggle on={ask} onChange={setAsk} />
        </Row>
        <Row
          title="Share across projects"
          desc="Reuse memory in other projects on this account."
          compact
        >
          <Toggle on={share} onChange={setShare} />
        </Row>
      </Group>
      <Divider />
      <Group label="Maintenance">
        <Row title="Export memory" desc="Download everything Anton remembers as JSON.">
          <button type="button" className="sm-btn sm-btn--quiet">
            <Download size={13} strokeWidth={1.5} /> Export
          </button>
        </Row>
        <Row title="Review memory" desc="Open the Memory surface to browse entries.">
          <button
            type="button"
            className="sm-btn sm-btn--quiet"
            onClick={() => {
              uiStore.getState().setActiveView('memory')
            }}
          >
            Open Memory
          </button>
        </Row>
        <Row
          title="Clear all memory"
          desc="Permanently delete every learned fact for this account."
        >
          <button type="button" className="sm-btn sm-btn--danger">
            Clear memory
          </button>
        </Row>
      </Group>
    </>
  )
}

function PrivacySection() {
  const [improve, setImprove] = useState(false)
  const [crash, setCrash] = useState(true)
  const [analytics, setAnalytics] = useState(true)
  const [retention, setRetention] = useState<'7d' | '30d' | '90d' | '1y' | 'forever'>('forever')
  return (
    <>
      <Group label="Training & telemetry">
        <Row
          title="Improve Anton with my data"
          desc="Allow anonymized traces for model improvements."
          compact
        >
          <Toggle on={improve} onChange={setImprove} />
        </Row>
        <Row title="Share crash reports" desc="Automatic error reports from the app." compact>
          <Toggle on={crash} onChange={setCrash} />
        </Row>
        <Row title="Usage analytics" desc="Product metrics that help us prioritize." compact>
          <Toggle on={analytics} onChange={setAnalytics} />
        </Row>
      </Group>
      <Divider />
      <Group label="History">
        <Row title="Retain task history" desc="How long Anton keeps conversations locally.">
          <Select
            value={retention}
            onChange={setRetention}
            options={[
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: '90d', label: '90 days' },
              { value: '1y', label: '1 year' },
              { value: 'forever', label: 'Forever' },
            ]}
          />
        </Row>
        <Row title="Clear task history" desc="Delete all conversations on this device.">
          <button type="button" className="sm-btn sm-btn--danger">
            Clear history
          </button>
        </Row>
      </Group>
    </>
  )
}

function AdvancedSection() {
  const devMode = uiStore((s) => s.devMode)
  const setDevMode = uiStore((s) => s.setDevMode)
  const [channel, setChannel] = useState<'stable' | 'beta' | 'nightly'>('stable')
  const [checkUpdates, setCheckUpdates] = useState(true)
  return (
    <>
      <Group label="Developer">
        <Row
          title="Developer Mode"
          desc="Show a developer tools button to inspect prompts and memories."
          compact
        >
          <Toggle on={devMode} onChange={setDevMode} />
        </Row>
      </Group>
      <Divider />
      <Group label="Updates">
        <Row title="Update channel" desc="Stable is recommended.">
          <Segmented
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'beta', label: 'Beta' },
              { value: 'nightly', label: 'Nightly' },
            ]}
          />
        </Row>
        <Row
          title="Check for updates on start"
          desc="Notify me when a new version is available."
          compact
        >
          <Toggle on={checkUpdates} onChange={setCheckUpdates} />
        </Row>
      </Group>
      <Divider />
      <Group label="Reset">
        <Row title="Reset layout" desc="Restore panels and sidebar to defaults.">
          <button type="button" className="sm-btn sm-btn--quiet">
            Reset layout
          </button>
        </Row>
        <Row title="Reset all settings" desc="Returns every preference to its default value.">
          <button type="button" className="sm-btn sm-btn--danger">
            Reset all
          </button>
        </Row>
      </Group>
    </>
  )
}

function AboutSection() {
  return (
    <div className="sabout">
      <div className="sabout__logo">
        <span className="sabout__word">anton</span>
      </div>
      <div className="sabout__ver">Desktop preview</div>
      <div className="sabout__lines">
        <div>
          Tauri · Vite · React <span className="smono">SPA</span>
        </div>
        <div>
          Runtime <span className="smono">node 22 · swift 6.1</span>
        </div>
      </div>
      <div className="sabout__links">
        <button type="button" className="sm-btn sm-btn--quiet">
          <Book size={13} strokeWidth={1.5} /> Docs
        </button>
        <button type="button" className="sm-btn sm-btn--quiet">
          <Globe size={13} strokeWidth={1.5} /> Changelog
        </button>
        <button type="button" className="sm-btn sm-btn--quiet">
          <HelpCircle size={13} strokeWidth={1.5} /> Support
        </button>
      </div>
      <div className="sabout__foot">© 2026 Anton</div>
    </div>
  )
}

// ── Modal shell ───────────────────────────────────────────────────

export function SettingsModal({
  open,
  onClose,
  onDisconnect,
  onOpenUsage,
  initialPage = 'general',
}: Props) {
  const initialSection: SectionId = initialPage === 'models' ? 'models' : 'general'
  const [section, setSection] = useState<SectionId>(initialSection)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setSection(initialSection)
  }, [open, initialSection])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const matchesSearch = useCallback(
    (s: SectionId) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      const label = SECTIONS.find((x) => x.id === s)?.label?.toLowerCase() ?? ''
      return label.includes(q)
    },
    [query],
  )

  if (!open) return null

  const activeLabel = SECTIONS.find((s) => s.id === section)?.label ?? 'General'

  const renderSection = () => {
    switch (section) {
      case 'general':
        return <GeneralSection onDisconnect={onDisconnect} onClose={onClose} />
      case 'appearance':
        return <AppearanceSection />
      case 'shortcuts':
        return <ShortcutsSection />
      case 'notifications':
        return <NotificationsSection />
      case 'models':
        return <ModelsSection onOpenUsage={onOpenUsage} />
      case 'behavior':
        return <BehaviorSection />
      case 'memory':
        return <MemorySection />
      case 'privacy':
        return <PrivacySection />
      case 'advanced':
        return <AdvancedSection />
      case 'about':
        return <AboutSection />
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close handled globally in effect
    <div
      className="um-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: <dialog> requires imperative show/close API; role=dialog keeps a11y without that refactor */}
      <div className="sm-modal" role="dialog" aria-modal aria-label="Settings">
        <div className="sm-head">
          <div className="sm-head__title">Settings</div>
          <div className="sm-head__path">
            <ChevronRight size={10} strokeWidth={1.5} />
            <span>{activeLabel}</span>
          </div>
          <div className="sm-head__spacer" />
          <div className="sm-head__search">
            <Search size={12} strokeWidth={1.5} />
            <input
              placeholder="Search settings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="sm-head__kbd">⌘K</span>
          </div>
          <button
            type="button"
            className="um-iconbtn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="sm-split">
          <aside className="sm-rail">
            {GROUPS.map((g) => {
              const items = SECTIONS.filter((s) => s.group === g && matchesSearch(s.id))
              if (items.length === 0) return null
              return (
                <div key={g} className="sm-rail__group">
                  <div className="sm-rail__grouplabel">{g}</div>
                  {items.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`sm-rail__item${section === s.id ? ' on' : ''}`}
                      onClick={() => setSection(s.id)}
                    >
                      <span>{s.label}</span>
                      {section === s.id ? <ChevronRight size={11} strokeWidth={1.5} /> : null}
                    </button>
                  ))}
                </div>
              )
            })}
            <div className="sm-rail__footer">
              <button
                type="button"
                className="sm-rail__disconnect"
                onClick={onDisconnect}
                title="Disconnect from machine"
              >
                <LogOut size={13} strokeWidth={1.5} />
                <span>Disconnect from machine</span>
              </button>
              <div className="sm-rail__meta">
                <div className="sm-rail__build">Anton</div>
                <div className="sm-rail__ver">preview</div>
              </div>
            </div>
          </aside>
          <main className="sm-content">
            <div className="sm-content__inner">
              <h2 className="sm-page__title">{activeLabel}</h2>
              {renderSection()}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
