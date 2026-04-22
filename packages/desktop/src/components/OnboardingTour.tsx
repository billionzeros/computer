import { Check, ChevronLeft, ChevronRight, Clock, Plus, Search } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { uiStore } from '../lib/store/uiStore.js'

const TOUR_KEY = 'anton.tourSeen.v1'

// Kept for backwards-compat with call sites that read the flag synchronously.
// Prefers the hydrated store value (server-authoritative) and falls back to
// localStorage so the first render before server hydration still works.
export function hasSeenTour(): boolean {
  try {
    if (uiStore.getState().tourCompleted) return true
    return localStorage.getItem(TOUR_KEY) === '1'
  } catch {
    return true
  }
}

export function markTourSeen(): void {
  uiStore.getState().setTourCompleted(true)
}

function IllusComputer() {
  return (
    <div className="ob-illus ob-illus--computer">
      <div className="ob-machine">
        <div className="ob-machine__label">itsomg.antoncomputer.in</div>
        <div className="ob-machine__dots">
          <span />
          <span />
          <span />
        </div>
        <div className="ob-machine__body">
          <div className="ob-machine__line" />
          <div className="ob-machine__line ob-machine__line--short" />
          <div className="ob-machine__line" />
          <div className="ob-machine__cursor" />
        </div>
      </div>
      <div className="ob-machine ob-machine--offset">
        <div className="ob-machine__label">studio.antoncomputer.in</div>
        <div className="ob-machine__dots">
          <span />
          <span />
          <span />
        </div>
        <div className="ob-machine__body">
          <div className="ob-machine__line ob-machine__line--short" />
          <div className="ob-machine__line" />
        </div>
      </div>
      <div className="ob-link" />
    </div>
  )
}

function IllusAsk() {
  return (
    <div className="ob-illus ob-illus--ask">
      <div className="ob-bubble ob-bubble--user">Summarize my unread emails from today</div>
      <div className="ob-bubble ob-bubble--tool">
        <span className="ob-bubble__dot" /> gmail.list · 20 threads
      </div>
      <div className="ob-bubble ob-bubble--tool">
        <span className="ob-bubble__dot" /> rank · top 5 flagged
      </div>
      <div className="ob-bubble ob-bubble--asst">
        Top 5 threads flagged. Vendor contract needs a reply today.
      </div>
    </div>
  )
}

function IllusTools() {
  const tools = [
    { bg: '#24292f', char: 'G', name: 'GitHub', fg: '#fff' },
    { bg: '#ea4335', char: 'M', name: 'Gmail', fg: '#fff' },
    { bg: '#4a154b', char: 'S', name: 'Slack', fg: '#fff' },
    { bg: '#1a73e8', char: 'C', name: 'Calendar', fg: '#fff' },
    { bg: '#0f9d58', char: 'S', name: 'Sheets', fg: '#fff' },
    { bg: '#5e6ad2', char: 'L', name: 'Linear', fg: '#fff' },
    { bg: '#0088cc', char: 'T', name: 'Telegram', fg: '#fff' },
    { bg: '#ffffff', char: 'N', name: 'Notion', fg: '#000' },
  ]
  return (
    <div className="ob-illus ob-illus--tools">
      <div className="ob-tools-grid">
        {tools.map((t) => (
          <div key={t.name} className="ob-tool">
            <span className="ob-tool__av" style={{ background: t.bg, color: t.fg }}>
              {t.char}
            </span>
            <span className="ob-tool__name">{t.name}</span>
            <span className="ob-tool__dot" />
          </div>
        ))}
      </div>
    </div>
  )
}

function IllusRoutine() {
  return (
    <div className="ob-illus ob-illus--routine">
      <div className="ob-routine">
        <div className="ob-routine__head">
          <Clock size={13} strokeWidth={1.5} />
          <span>Morning focus</span>
          <span className="ob-routine__sched">Mon–Fri · 8:00</span>
        </div>
        <div className="ob-routine__body">
          <div className="ob-routine__step">
            <span className="ob-routine__n">1</span>Block Slack + Discord
          </div>
          <div className="ob-routine__step">
            <span className="ob-routine__n">2</span>Open today's task list
          </div>
          <div className="ob-routine__step">
            <span className="ob-routine__n">3</span>Summarize yesterday at 10:30
          </div>
        </div>
      </div>
      <div className="ob-clock">
        <div className="ob-clock__ring" />
        <div className="ob-clock__time">8:00</div>
      </div>
    </div>
  )
}

function IllusMemory() {
  return (
    <div className="ob-illus ob-illus--memory">
      <div className="ob-mem">
        <div className="ob-mem__row">
          <Check size={11} strokeWidth={2} />
          <span>
            Prefers <code>journalctl</code> over <code>systemctl</code>
          </span>
        </div>
        <div className="ob-mem__row">
          <Check size={11} strokeWidth={2} />
          <span>Timezone: America/New_York</span>
        </div>
        <div className="ob-mem__row">
          <Check size={11} strokeWidth={2} />
          <span>
            Codebase: <code>huddle/anton</code>
          </span>
        </div>
        <div className="ob-mem__row ob-mem__row--new">
          <Plus size={11} strokeWidth={2} />
          <span className="ob-mem__adding">Learning as you work…</span>
        </div>
      </div>
    </div>
  )
}

function IllusShortcuts() {
  const rows: [string, string, string][] = [
    ['⌘', 'K', 'Command palette'],
    ['⌘', 'N', 'New task'],
    ['⌘', 'L', 'Focus composer'],
    ['⌘', '\\', 'Toggle sidebar'],
    ['⌘', ',', 'Settings'],
  ]
  return (
    <div className="ob-illus ob-illus--shortcuts">
      {rows.map(([mod, key, label]) => (
        <div key={label} className="ob-kbd-row">
          <span className="ob-kbd">{mod}</span>
          <span className="ob-kbd">{key}</span>
          <span className="ob-kbd-label">{label}</span>
        </div>
      ))}
    </div>
  )
}

interface Step {
  key: string
  kicker: string
  title: string
  lede: string
  bullets: string[]
  Illus: () => ReactElement
}

const STEPS: Step[] = [
  {
    key: 'welcome',
    kicker: 'Welcome',
    title: 'This is Anton.',
    lede: 'An agent that actually lives on your computers — not a chat window pretending to.',
    bullets: [
      'Runs real work on real machines (yours or remote).',
      'Holds context across days, not just across messages.',
      'Uses your tools, with your permission, on your terms.',
    ],
    Illus: IllusComputer,
  },
  {
    key: 'ask',
    kicker: 'How it works',
    title: 'Ask in plain language.',
    lede: 'Anton plans, runs tools, and shows its work. You can steer it at any step.',
    bullets: [
      'Transparent: every tool call is visible and inspectable.',
      'Interruptible: stop, redirect, or ask mid-task.',
      'Multi-step: Anton will ask clarifying questions when it needs to.',
    ],
    Illus: IllusAsk,
  },
  {
    key: 'tools',
    kicker: 'Connectors',
    title: 'It plugs into your stack.',
    lede: 'GitHub, Gmail, Slack, Linear, Sheets, Calendar — pick what Anton can reach.',
    bullets: [
      'Per-tool permissions. Read-only, write, or off.',
      'Per-task scoping. Grant tools for one task without lowering global settings.',
      'Bring your own: any MCP server or API works.',
    ],
    Illus: IllusTools,
  },
  {
    key: 'routines',
    kicker: 'Routines',
    title: 'Repeat work runs itself.',
    lede: 'Turn any task into a routine. Anton handles it on schedule, from then on.',
    bullets: [
      '"Every weekday morning" → it just happens.',
      'You approve each run (or leave it on auto).',
      'Every run shows up in your Tasks feed, same as manual.',
    ],
    Illus: IllusRoutine,
  },
  {
    key: 'memory',
    kicker: 'Memory',
    title: 'It learns as you work.',
    lede: 'Preferences, project context, tooling choices — carried forward without you repeating yourself.',
    bullets: [
      'Review and edit everything Anton remembers.',
      'Scope by machine, project, or global.',
      'Export or forget anytime.',
    ],
    Illus: IllusMemory,
  },
  {
    key: 'shortcuts',
    kicker: 'Keyboard-first',
    title: 'Built for the flow state.',
    lede: 'Most of Anton is a keystroke away. Try ⌘K anytime to search everything.',
    bullets: [],
    Illus: IllusShortcuts,
  },
]

interface Props {
  open: boolean
  onClose: () => void
  onOpenPalette?: () => void
}

export function OnboardingTour({ open, onClose, onOpenPalette }: Props) {
  const [i, setI] = useState(0)

  const finish = useCallback(() => {
    markTourSeen()
    onClose()
  }, [onClose])

  const step = STEPS[i]
  const last = i === STEPS.length - 1
  const Illus = step.Illus

  const next = useCallback(() => {
    if (last) finish()
    else setI((v) => v + 1)
  }, [last, finish])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, next])

  // Reset step when re-opening (e.g. replay from palette)
  useEffect(() => {
    if (open) setI(0)
  }, [open])

  if (!open) return null

  return (
    <div className="ob-overlay">
      <div className="ob-card">
        {/* Illustration */}
        <div className="ob-illus-wrap">
          <Illus />
          <div className="ob-illus-gloss" />
        </div>

        {/* Copy */}
        <div className="ob-copy">
          <div className="ob-copy__head">
            <span className="ob-brand__mark">anton</span>
            <button type="button" className="ob-skip" onClick={finish}>
              Skip tour
            </button>
          </div>

          <div className="ob-copy__body">
            <div className="ob-kicker">{step.kicker}</div>
            <h1 className="ob-title" key={step.key}>
              {step.title}
            </h1>
            <p className="ob-lede">{step.lede}</p>
            {step.bullets.length > 0 && (
              <ul className="ob-bullets">
                {step.bullets.map((b) => (
                  <li key={b}>
                    <span className="ob-bullets__bar" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            {step.key === 'shortcuts' && onOpenPalette && (
              <button
                type="button"
                className="ob-try"
                onClick={() => {
                  finish()
                  onOpenPalette()
                }}
              >
                <Search size={12} strokeWidth={1.5} /> Try the command palette
              </button>
            )}
          </div>

          <div className="ob-copy__foot">
            <div className="ob-dots">
              {STEPS.map((s, j) => (
                <button
                  key={s.key}
                  type="button"
                  className={`ob-dot${j === i ? ' on' : ''}${j < i ? ' done' : ''}`}
                  onClick={() => setI(j)}
                  aria-label={`Step ${j + 1}`}
                />
              ))}
              <span className="ob-dots__count">
                {i + 1} / {STEPS.length}
              </span>
            </div>
            <div className="ob-actions">
              {i > 0 && (
                <button
                  type="button"
                  className="ob-btn ob-btn--ghost"
                  onClick={() => setI((v) => v - 1)}
                >
                  <ChevronLeft size={12} strokeWidth={1.5} /> Back
                </button>
              )}
              <button type="button" className="ob-btn ob-btn--primary" onClick={next}>
                {last ? 'Start using Anton' : 'Next'}
                {!last && <ChevronRight size={12} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
