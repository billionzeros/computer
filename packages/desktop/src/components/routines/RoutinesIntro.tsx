import { BookOpen, ChevronRight, Clock, Mail, Plus } from 'lucide-react'
import type { RoutineTemplate } from './RoutineCreateForm.js'

type TemplateCard = RoutineTemplate & { icon: React.ReactNode }

const TEMPLATES: TemplateCard[] = [
  {
    id: 'tpl-morning',
    name: 'Morning focus',
    blurb: "Block notifications, surface today's priorities, check in at 10:30.",
    instructions:
      'Block notifications on Slack and Discord. Open my task list for today and surface anything with a deadline this week. At 10:30 share a summary of what I finished.',
    presetId: 'weekday-morn',
    icon: <Clock size={14} strokeWidth={1.5} />,
  },
  {
    id: 'tpl-daily',
    name: 'Daily review',
    blurb: "Pull yesterday's tasks, unread email and calendar changes into a short note.",
    instructions:
      'Pull tasks I worked on yesterday, unread email from the past 24h, and calendar changes. Write a short daily-review note and save it as a Page.',
    presetId: 'daily-morn',
    icon: <BookOpen size={14} strokeWidth={1.5} />,
  },
  {
    id: 'tpl-inbox',
    name: 'Inbox triage',
    blurb: 'Rank the last 20 threads by importance and flag the top 5.',
    instructions:
      'Fetch the last 20 inbox threads from Gmail. Rank by sender signal, unreplied age, and topic. Flag the top 5.',
    presetId: 'weekday-eve',
    icon: <Mail size={14} strokeWidth={1.5} />,
  },
]

function EmptyIllustration() {
  const ticks = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2
    const r1 = i % 3 === 0 ? 56 : 59
    const r2 = 63
    const x1 = 140 + Math.cos(a) * r1
    const y1 = 92 + Math.sin(a) * r1
    const x2 = 140 + Math.cos(a) * r2
    const y2 = 92 + Math.sin(a) * r2
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--border-strong)"
        strokeWidth={i % 3 === 0 ? 1.4 : 0.8}
      />,
    )
  }
  return (
    <svg viewBox="0 0 280 180" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="rtE-dial" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="140" cy="92" r="64" fill="var(--bg-elev-1)" stroke="var(--border)" />
      <circle cx="140" cy="92" r="64" fill="url(#rtE-dial)" />
      {ticks}
      <line
        x1="140"
        y1="92"
        x2="140"
        y2="56"
        stroke="var(--text)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="140"
        y1="92"
        x2="172"
        y2="92"
        stroke="var(--text-2)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="140" cy="92" r="3" fill="var(--accent)" />
      <g transform="translate(60 36)">
        <rect width="60" height="22" rx="5" fill="var(--bg-elev-2)" stroke="var(--border)" />
        <circle cx="10" cy="11" r="3" fill="var(--accent)" />
        <rect x="18" y="7" width="32" height="3" rx="1.5" fill="var(--text-3)" />
        <rect x="18" y="13" width="20" height="2.5" rx="1.2" fill="var(--text-4)" />
      </g>
      <g transform="translate(210 52)">
        <rect width="54" height="22" rx="5" fill="var(--bg-elev-2)" stroke="var(--border)" />
        <circle cx="10" cy="11" r="3" fill="var(--success)" />
        <rect x="18" y="7" width="28" height="3" rx="1.5" fill="var(--text-3)" />
        <rect x="18" y="13" width="16" height="2.5" rx="1.2" fill="var(--text-4)" />
      </g>
      <g transform="translate(40 138)">
        <rect width="70" height="22" rx="5" fill="var(--bg-elev-2)" stroke="var(--border)" />
        <circle cx="10" cy="11" r="3" fill="var(--text-4)" />
        <rect x="18" y="7" width="40" height="3" rx="1.5" fill="var(--text-3)" />
        <rect x="18" y="13" width="22" height="2.5" rx="1.2" fill="var(--text-4)" />
      </g>
      <g transform="translate(200 130)">
        <rect width="54" height="22" rx="5" fill="var(--bg-elev-2)" stroke="var(--border)" />
        <circle cx="10" cy="11" r="3" fill="var(--accent)" />
        <rect x="18" y="7" width="26" height="3" rx="1.5" fill="var(--text-3)" />
        <rect x="18" y="13" width="14" height="2.5" rx="1.2" fill="var(--text-4)" />
      </g>
      <path
        d="M110 50 Q 130 30 140 28"
        fill="none"
        stroke="var(--border-strong)"
        strokeDasharray="2 3"
      />
      <path
        d="M210 62 Q 190 72 180 78"
        fill="none"
        stroke="var(--border-strong)"
        strokeDasharray="2 3"
      />
      <path
        d="M110 148 Q 120 140 126 132"
        fill="none"
        stroke="var(--border-strong)"
        strokeDasharray="2 3"
      />
      <path
        d="M200 140 Q 180 128 172 122"
        fill="none"
        stroke="var(--border-strong)"
        strokeDasharray="2 3"
      />
    </svg>
  )
}

interface Props {
  onCreate: () => void
  onUseTemplate: (template: RoutineTemplate) => void
}

export function RoutinesIntro({ onCreate, onUseTemplate }: Props) {
  return (
    <div className="rt-empty">
      <div className="rt-empty__illus">
        <EmptyIllustration />
      </div>
      <h1 className="rt-empty__title">Teach Anton a routine</h1>
      <p className="rt-empty__blurb">
        Routines are tasks Anton runs on a schedule — every weekday morning, every Friday afternoon,
        whenever. They show up here, run in the background, and drop their output into Pages.
      </p>
      <div className="rt-empty__actions">
        <button type="button" className="btn btn--primary rt-empty__cta" onClick={onCreate}>
          <Plus size={13} strokeWidth={1.5} /> New routine
        </button>
        <span className="rt-empty__or">or start from a template</span>
      </div>
      <div className="rt-empty__templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="rt-tpl"
            onClick={() =>
              onUseTemplate({
                id: t.id,
                name: t.name,
                blurb: t.blurb,
                instructions: t.instructions,
                presetId: t.presetId,
              })
            }
          >
            <div className="rt-tpl__ico">{t.icon}</div>
            <div className="rt-tpl__body">
              <div className="rt-tpl__name">{t.name}</div>
              <div className="rt-tpl__blurb">{t.blurb}</div>
            </div>
            <div className="rt-tpl__arrow">
              <ChevronRight size={12} strokeWidth={1.5} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
