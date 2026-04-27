import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import {
  Calendar,
  Clock,
  FileText,
  Globe,
  Hash,
  Play,
  Repeat,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { useState } from 'react'
import { uiStore } from '../../lib/store/uiStore.js'

interface Props {
  questions: AskUserQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}

function normalizeOption(opt: string | AskUserOption): { label: string; description?: string } {
  if (typeof opt === 'string') return { label: opt }
  return { label: opt.label, description: opt.description }
}

/* ── Routine-create confirmation card ── */

interface RoutineCreateMeta {
  type: 'routine_create'
  name: string
  description: string
  schedule: string | null
  cron: string | null
  prompt: string
}

function isRoutineCreate(q: AskUserQuestion): RoutineCreateMeta | null {
  const m = q.metadata
  if (m && (m as Record<string, unknown>).type === 'routine_create')
    return m as unknown as RoutineCreateMeta
  return null
}

/** Compute a simple next-run preview from a cron expression, formatted in the user's timezone. */
function formatNextRun(cron: string | null): string | null {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null

  // Simple forward search (client-side, lightweight)
  const [minSpec, hourSpec] = parts
  const tz = uiStore.getState().timezone

  // For simple daily/hourly crons, compute directly
  const now = new Date()
  const candidate = new Date(now.getTime() + 60_000)
  candidate.setSeconds(0, 0)

  // Search up to 48 hours
  for (let i = 0; i < 48 * 60; i++) {
    const m = candidate.getMinutes()
    const h = candidate.getHours()
    const dom = candidate.getDate()
    const mon = candidate.getMonth() + 1
    const dow = candidate.getDay()

    const matchField = (spec: string, val: number, _min: number, _max: number): boolean => {
      for (const part of spec.split(',')) {
        if (part === '*') return true
        if (part.startsWith('*/')) {
          if (val % Number.parseInt(part.slice(2)) === 0) return true
        } else if (part.includes('-')) {
          const [a, b] = part.split('-').map(Number)
          if (val >= a && val <= b) return true
        } else if (Number.parseInt(part) === val) return true
      }
      return false
    }

    if (
      matchField(minSpec, m, 0, 59) &&
      matchField(hourSpec, h, 0, 23) &&
      matchField(parts[2], dom, 1, 31) &&
      matchField(parts[3], mon, 1, 12) &&
      matchField(parts[4], dow, 0, 6)
    ) {
      try {
        return candidate.toLocaleString('en-US', {
          timeZone: tz,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      } catch {
        return candidate.toLocaleString()
      }
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return null
}

function RoutineCreateCard({
  meta,
  onConfirm,
  onCancel,
}: { meta: RoutineCreateMeta; onConfirm: () => void; onCancel: () => void }) {
  const promptPreview = meta.prompt.length > 120 ? `${meta.prompt.slice(0, 120)}...` : meta.prompt
  const timezone = uiStore((s) => s.timezone)
  const nextRun = meta.cron ? formatNextRun(meta.cron) : null
  const tzCity = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone

  return (
    <div className="routine-confirm">
      <div className="routine-confirm__header">
        <div className="routine-confirm__icon">
          <Repeat size={18} strokeWidth={1.5} />
        </div>
        <div className="routine-confirm__title-group">
          <span className="routine-confirm__title">Create Routine</span>
          <span className="routine-confirm__name">{meta.name}</span>
        </div>
      </div>

      {meta.description && <p className="routine-confirm__desc">{meta.description}</p>}

      <div className="routine-confirm__fields">
        <div className="routine-confirm__field">
          <span className="routine-confirm__field-icon">
            {meta.schedule ? (
              <Calendar size={14} strokeWidth={1.5} />
            ) : (
              <Clock size={14} strokeWidth={1.5} />
            )}
          </span>
          <span className="routine-confirm__field-label">Schedule</span>
          <span className="routine-confirm__field-value">{meta.schedule || 'Manual only'}</span>
        </div>

        {nextRun && (
          <div className="routine-confirm__field">
            <span className="routine-confirm__field-icon">
              <Play size={14} strokeWidth={1.5} />
            </span>
            <span className="routine-confirm__field-label">Next run</span>
            <span className="routine-confirm__field-value">
              {nextRun}
              <span className="routine-confirm__field-tz">{tzCity}</span>
            </span>
          </div>
        )}

        {promptPreview && (
          <div className="routine-confirm__field routine-confirm__field--block">
            <span className="routine-confirm__field-icon">
              <FileText size={14} strokeWidth={1.5} />
            </span>
            <span className="routine-confirm__field-label">Prompt</span>
            <span className="routine-confirm__field-value routine-confirm__field-value--prompt">
              {promptPreview}
            </span>
          </div>
        )}
      </div>

      <div className="routine-confirm__actions">
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--confirm"
          onClick={onConfirm}
        >
          Create Routine
        </button>
      </div>
    </div>
  )
}

/* ── Routine-delete confirmation card ── */

interface RoutineDeleteMeta {
  type: 'routine_delete'
  name: string
  routineId: string
}

function isRoutineDelete(q: AskUserQuestion): RoutineDeleteMeta | null {
  const m = q.metadata
  if (m && (m as Record<string, unknown>).type === 'routine_delete')
    return m as unknown as RoutineDeleteMeta
  return null
}

function RoutineDeleteCard({
  meta,
  onConfirm,
  onCancel,
}: { meta: RoutineDeleteMeta; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="routine-confirm">
      <div className="routine-confirm__header">
        <div className="routine-confirm__icon routine-confirm__icon--danger">
          <Trash2 size={18} strokeWidth={1.5} />
        </div>
        <div className="routine-confirm__title-group">
          <span className="routine-confirm__title">Delete Routine</span>
          <span className="routine-confirm__name">{meta.name}</span>
        </div>
      </div>

      <p className="routine-confirm__desc">
        This will permanently remove the routine and its conversation history.
      </p>

      {meta.routineId && meta.routineId !== meta.name && (
        <div className="routine-confirm__fields">
          <div className="routine-confirm__field">
            <span className="routine-confirm__field-icon">
              <Repeat size={14} strokeWidth={1.5} />
            </span>
            <span className="routine-confirm__field-label">ID</span>
            <span className="routine-confirm__field-value routine-confirm__field-value--mono">
              {meta.routineId}
            </span>
          </div>
        </div>
      )}

      <div className="routine-confirm__actions">
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--cancel"
          onClick={onCancel}
        >
          Keep it
        </button>
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--danger"
          onClick={onConfirm}
        >
          Delete Routine
        </button>
      </div>
    </div>
  )
}

/* ── Publish confirmation card ── */

interface PublishConfirmMeta {
  type: 'publish_confirm'
  title: string
  contentType: string
  language: string | null
  suggestedSlug: string
  domain: string | null
}

function isPublishConfirm(q: AskUserQuestion): PublishConfirmMeta | null {
  const m = q.metadata
  if (m && (m as Record<string, unknown>).type === 'publish_confirm')
    return m as unknown as PublishConfirmMeta
  return null
}

function PublishConfirmCard({
  meta,
  onConfirm,
  onCancel,
}: {
  meta: PublishConfirmMeta
  onConfirm: (finalSlug: string) => void
  onCancel: () => void
}) {
  const [slug, setSlug] = useState(meta.suggestedSlug)
  const slugTrimmed = slug.trim()
  const slugValid = /^[a-zA-Z0-9_-]+$/.test(slugTrimmed)
  const publicUrl = meta.domain
    ? `https://${meta.domain}/a/${slugTrimmed || meta.suggestedSlug}`
    : `/a/${slugTrimmed || meta.suggestedSlug}`
  const typeLabel = (() => {
    const t = meta.contentType.toUpperCase()
    if (t === 'CODE' && meta.language) return meta.language.toUpperCase()
    return t
  })()

  return (
    <div className="routine-confirm">
      <div className="routine-confirm__header">
        <div className="routine-confirm__icon">
          <UploadCloud size={18} strokeWidth={1.5} />
        </div>
        <div className="routine-confirm__title-group">
          <span className="routine-confirm__title">Publish to Anton</span>
          <span className="routine-confirm__name">{meta.title}</span>
        </div>
      </div>

      <div className="routine-confirm__fields">
        <div className="routine-confirm__field">
          <span className="routine-confirm__field-icon">
            <FileText size={14} strokeWidth={1.5} />
          </span>
          <span className="routine-confirm__field-label">Type</span>
          <span className="routine-confirm__field-value">{typeLabel}</span>
        </div>

        {meta.domain && (
          <div className="routine-confirm__field">
            <span className="routine-confirm__field-icon">
              <Globe size={14} strokeWidth={1.5} />
            </span>
            <span className="routine-confirm__field-label">Domain</span>
            <span className="routine-confirm__field-value routine-confirm__field-value--mono">
              {meta.domain}
            </span>
          </div>
        )}

        <div className="routine-confirm__field routine-confirm__field--block">
          <span className="routine-confirm__field-icon">
            <Hash size={14} strokeWidth={1.5} />
          </span>
          <span className="routine-confirm__field-label">Slug</span>
          <input
            type="text"
            className="ix__custom-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && slugValid) onConfirm(slugTrimmed)
              if (e.key === 'Escape') onCancel()
            }}
            // biome-ignore lint/a11y/noAutofocus: inline confirm card — focusing the slug input on mount is the intended UX
            autoFocus
            aria-label="URL slug"
          />
        </div>

        <div className="routine-confirm__field routine-confirm__field--block">
          <span className="routine-confirm__field-icon">
            <Globe size={14} strokeWidth={1.5} />
          </span>
          <span className="routine-confirm__field-label">Will live at</span>
          <span className="routine-confirm__field-value routine-confirm__field-value--mono">
            {publicUrl}
          </span>
        </div>
      </div>

      <div className="routine-confirm__actions">
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="routine-confirm__btn routine-confirm__btn--confirm"
          onClick={() => onConfirm(slugTrimmed)}
          disabled={!slugValid}
        >
          Publish
        </button>
      </div>
    </div>
  )
}

/* ── Generic inline ask-user (unchanged) ── */

export function AskUserInline({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})

  // ── Specialized cards for agent operations ──
  if (questions.length === 1) {
    const q = questions[0]
    const opts = (q.options ?? []).map(normalizeOption)

    const createMeta = isRoutineCreate(q)
    if (createMeta) {
      return (
        <div className="ask-inline">
          <RoutineCreateCard
            meta={createMeta}
            onConfirm={() => onSubmit({ [q.question]: opts[0]?.label || 'Yes, create it' })}
            onCancel={() => onSubmit({ [q.question]: opts[1]?.label || 'No, cancel' })}
          />
        </div>
      )
    }

    const deleteMeta = isRoutineDelete(q)
    if (deleteMeta) {
      return (
        <div className="ask-inline">
          <RoutineDeleteCard
            meta={deleteMeta}
            onConfirm={() => onSubmit({ [q.question]: opts[0]?.label || 'Yes, delete it' })}
            onCancel={() => onSubmit({ [q.question]: opts[1]?.label || 'No, keep it' })}
          />
        </div>
      )
    }

    const publishMeta = isPublishConfirm(q)
    if (publishMeta) {
      return (
        <div className="ask-inline">
          <PublishConfirmCard
            meta={publishMeta}
            // Publish tool interprets the answer string as the slug.
            // Empty string is cancel — see buildPublishTool in publish.ts.
            onConfirm={(finalSlug) => onSubmit({ [q.question]: finalSlug })}
            onCancel={() => onSubmit({ [q.question]: '' })}
          />
        </div>
      )
    }
  }

  // ── Generic rendering ──
  // A question is "answered" only when committed to `answers`. Typing into the
  // custom input is draft state — it does not advance the flow until the user
  // explicitly submits via Enter or the arrow button.

  const answeredCount = questions.filter((q) => answers[q.question]).length

  const commitAnswer = (question: string, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const newAnswers = { ...answers, [question]: trimmed }
    setAnswers(newAnswers)
    const done = questions.every((q) => newAnswers[q.question])
    if (done) {
      onSubmit(newAnswers)
    }
  }

  const handleSelect = (question: string, label: string) => {
    setCustomInputs((prev) => ({ ...prev, [question]: '' }))
    commitAnswer(question, label)
  }

  const handleSubmitCustom = (question: string) => {
    commitAnswer(question, customInputs[question] || '')
  }

  return (
    <div className="ix ix--accent">
      <div className="ix__head">
        <div className="ix__head-left">
          <div className="ix__glyph">?</div>
          <div className="ix__head-text">
            <div className="ix__title">
              {questions.length > 1 ? 'A few quick questions' : 'One quick question'}
            </div>
            <div className="ix__sub">I'll use your answers to keep going.</div>
          </div>
        </div>
        {questions.length > 1 && (
          <div className="ix__progress">
            {questions.map((q, i) => (
              <span
                key={q.question}
                className={`ix__dot${i < answeredCount ? ' ix__dot--done' : i === answeredCount ? ' ix__dot--cur' : ''}`}
              />
            ))}
            <span className="ix__progress-count">
              {Math.min(answeredCount + 1, questions.length)}/{questions.length}
            </span>
          </div>
        )}
      </div>

      <div className="ix__body">
        {(() => {
          const currentIndex = questions.findIndex((q) => !answers[q.question])
          if (currentIndex === -1) return null

          const q = questions[currentIndex]
          const options = (q.options ?? []).map(normalizeOption)
          const customValue = customInputs[q.question] || ''
          const customValid = customValue.trim().length > 0

          return (
            <div key={q.question}>
              <div className="ix__q">
                <div className="ix__q-num">Q{currentIndex + 1}</div>
                <div className="ix__q-text">{q.question}</div>
              </div>

              <div className="ix__opts">
                {options.map((opt, i) => (
                  <button
                    key={opt.label}
                    type="button"
                    className="ix__opt"
                    onClick={() => handleSelect(q.question, opt.label)}
                  >
                    <span className="ix__opt-kbd">{i + 1}</span>
                    <span className="ix__opt-text">{opt.label}</span>
                    {opt.description && <span className="ix__opt-desc">{opt.description}</span>}
                  </button>
                ))}
              </div>

              {q.allowFreeText !== false && (
                <div className="ix__custom">
                  <div className="ix__custom-label">
                    {options.length > 0 ? 'Or write your own answer' : 'Your answer'}
                  </div>
                  <div className="ix__custom-row">
                    <input
                      type="text"
                      className="ix__custom-input"
                      placeholder="Type a different answer…"
                      value={customValue}
                      onChange={(e) => {
                        setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customValid) {
                          e.preventDefault()
                          handleSubmitCustom(q.question)
                        }
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Submit answer"
                      className={`ix__custom-send${customValid ? '' : ' ix__custom-send--off'}`}
                      onClick={() => handleSubmitCustom(q.question)}
                      disabled={!customValid}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 8h10M9 4l4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}
