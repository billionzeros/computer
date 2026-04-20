import { Loader2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { usageStore } from '../../lib/store/usageStore.js'

interface Props {
  open: boolean
  onClose: () => void
}

type Range = '7d' | '30d' | '90d'

const fmt = (n: number) => n.toLocaleString('en-US')

// Color palette for model-breakdown segments, in OKLCH for ink-theme harmony.
const MODEL_COLORS = [
  'oklch(0.72 0.13 30)',
  'oklch(0.72 0.14 150)',
  'oklch(0.70 0.13 260)',
  'oklch(0.75 0.12 90)',
  'oklch(0.68 0.15 330)',
  'var(--text-4)',
]

function modelColor(i: number) {
  return MODEL_COLORS[i] ?? MODEL_COLORS[MODEL_COLORS.length - 1]
}

function periodLabel(byDay: { date: string }[]) {
  if (byDay.length === 0) return '—'
  const first = byDay[0]?.date
  const last = byDay[byDay.length - 1]?.date
  if (!first || !last) return '—'
  const f = new Date(first)
  const l = new Date(last)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${f.toLocaleDateString([], opts)} – ${l.toLocaleDateString([], opts)}`
}

function UsageChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const w = 100
  const h = 100
  const barW = data.length > 0 ? w / data.length : 0
  return (
    <div className="um-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="um-chart__svg"
        role="img"
        aria-label="Daily usage"
      >
        <title>Daily usage</title>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} className="um-chart__grid" />
        ))}
        {data.map((v, i) => {
          const bh = (v / max) * h * 0.92
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional, index is stable
              key={i}
              x={i * barW + barW * 0.18}
              y={h - bh}
              width={barW * 0.64}
              height={bh}
              className="um-chart__bar"
              rx={0.6}
            />
          )
        })}
      </svg>
      <div className="um-chart__axis">
        <span>{data.length}d ago</span>
        <span>today</span>
      </div>
    </div>
  )
}

export function UsageModal({ open, onClose }: Props) {
  const usageStats = usageStore((s) => s.usageStats)
  const loading = usageStore((s) => s.usageStatsLoading)
  const requestUsageStats = usageStore((s) => s.requestUsageStats)

  const [range, setRange] = useState<Range>('30d')

  useEffect(() => {
    if (open) requestUsageStats()
  }, [open, requestUsageStats])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const byDayWindow = useMemo(() => {
    if (!usageStats) return []
    const n = range === '7d' ? 7 : range === '30d' ? 30 : 90
    return usageStats.byDay.slice(-n)
  }, [usageStats, range])

  const modelRows = useMemo(() => {
    if (!usageStats) return []
    const total = usageStats.totals.totalTokens || 1
    return usageStats.byModel
      .slice()
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 6)
      .map((m, i) => ({
        name: m.model,
        credits: m.totalTokens,
        pct: Math.round((m.totalTokens / total) * 1000) / 10,
        color: modelColor(i),
      }))
  }, [usageStats])

  const topSessions = useMemo(() => {
    if (!usageStats) return []
    return usageStats.sessions
      .slice()
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 5)
  }, [usageStats])

  if (!open) return null

  const used = usageStats?.totals.totalTokens ?? 0
  const input = usageStats?.totals.inputTokens ?? 0
  const output = usageStats?.totals.outputTokens ?? 0
  const cache = usageStats?.totals.cacheReadTokens ?? 0
  const avgPerDay =
    byDayWindow.length > 0
      ? Math.round(byDayWindow.reduce((acc, d) => acc + d.totalTokens, 0) / byDayWindow.length)
      : 0
  const dailyMax = byDayWindow.reduce((acc, d) => Math.max(acc, d.totalTokens), 0)
  const pct = dailyMax > 0 ? Math.min(100, Math.round((avgPerDay / dailyMax) * 100)) : 0

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape-to-close handled globally in effect
    <div
      className="um-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: <dialog> requires imperative show/close API; role=dialog keeps a11y without that refactor */}
      <div className="um-modal" role="dialog" aria-modal>
        <div className="um-head">
          <div className="um-head__icon">
            <Zap size={16} strokeWidth={1.5} />
          </div>
          <div className="um-head__text">
            <div className="um-head__title">Token usage</div>
            <div className="um-head__sub">
              Billing period · {periodLabel(byDayWindow)}
              {byDayWindow.length > 0 ? ` (${byDayWindow.length}-day window)` : ''}
            </div>
          </div>
          <button type="button" className="um-iconbtn" onClick={onClose} aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="um-body">
          {loading && !usageStats ? (
            <div className="um-empty">
              <Loader2 size={16} className="animate-spin" /> Loading usage…
            </div>
          ) : !usageStats || used === 0 ? (
            <div className="um-empty">No usage recorded yet for this workspace.</div>
          ) : (
            <>
              {/* Hero */}
              <section className="um-hero">
                <div className="um-hero__left">
                  <div className="um-hero__label">Used this period</div>
                  <div className="um-hero__num">
                    <span className="um-hero__val">{fmt(used)}</span>
                    <span className="um-hero__unit">tokens</span>
                  </div>
                  <div className="um-meter">
                    <div className="um-meter__fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="um-hero__foot">
                    <span>{fmt(input)} in</span>
                    <span className="um-sep">·</span>
                    <span>{fmt(output)} out</span>
                    <span className="um-sep">·</span>
                    <span>{fmt(cache)} cached</span>
                  </div>
                </div>
                <div className="um-hero__right">
                  <div className="um-kpi">
                    <div className="um-kpi__l">Avg / day</div>
                    <div className="um-kpi__n">{fmt(avgPerDay)}</div>
                  </div>
                  <div className="um-kpi">
                    <div className="um-kpi__l">Sessions</div>
                    <div className="um-kpi__n">{fmt(usageStats.sessions.length)}</div>
                  </div>
                </div>
              </section>

              {/* Daily chart */}
              <section className="um-section">
                <div className="um-section__head">
                  <div className="um-section__name">Daily usage</div>
                  <div className="um-tabs">
                    {(['7d', '30d', '90d'] as Range[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`um-tab${range === r ? ' on' : ''}`}
                        onClick={() => setRange(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <UsageChart data={byDayWindow.map((d) => d.totalTokens)} />
              </section>

              {/* By model — full-width when no byFeature data */}
              <div className="um-cols um-cols--single">
                <section className="um-section">
                  <div className="um-section__head">
                    <div className="um-section__name">By model</div>
                    <div className="um-section__hint">{modelRows.length} models</div>
                  </div>
                  <div className="um-stacked">
                    {modelRows.map((m) => (
                      <div
                        key={m.name}
                        className="um-stacked__seg"
                        style={{ width: `${m.pct}%`, background: m.color }}
                        title={`${m.name} — ${m.pct}%`}
                      />
                    ))}
                  </div>
                  <ul className="um-list">
                    {modelRows.map((m) => (
                      <li key={m.name} className="um-list__row">
                        <span className="um-list__dot" style={{ background: m.color }} />
                        <span className="um-list__name">{m.name}</span>
                        <span className="um-list__pct">{m.pct}%</span>
                        <span className="um-list__val">{fmt(m.credits)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              {/* Top sessions */}
              {topSessions.length > 0 && (
                <section className="um-section">
                  <div className="um-section__head">
                    <div className="um-section__name">Highest-cost sessions</div>
                    <div className="um-section__hint">This period</div>
                  </div>
                  <ul className="um-tasks">
                    {topSessions.map((s, i) => (
                      <li key={s.id} className="um-tasks__row">
                        <span className="um-tasks__rank">{i + 1}</span>
                        <span className="um-tasks__title">{s.title || 'Untitled session'}</span>
                        <span className="um-tasks__model">{s.model || '—'}</span>
                        <span className="um-tasks__credits">{fmt(s.totalTokens)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Plan */}
              <section className="um-plan">
                <div className="um-plan__row">
                  <div>
                    <div className="um-plan__label">Current plan</div>
                    <div className="um-plan__name">Anton Pro · BYO provider keys</div>
                  </div>
                  <div className="um-plan__actions">
                    <button type="button" className="um-btn">
                      View invoices
                    </button>
                    <button type="button" className="um-btn um-btn--primary">
                      Manage plan
                    </button>
                  </div>
                </div>
                <div className="um-plan__hint">
                  Token counts are reported by each provider. Pricing depends on the model you use —
                  see each provider's docs for current rates.
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
