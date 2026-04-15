import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import { Calendar, Clock, FileText, Play, Repeat, Trash2 } from 'lucide-react'
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

      {meta.agentId && meta.agentId !== meta.name && (
        <div className="routine-confirm__fields">
          <div className="routine-confirm__field">
            <span className="routine-confirm__field-icon">
              <Repeat size={14} strokeWidth={1.5} />
            </span>
            <span className="routine-confirm__field-label">ID</span>
            <span className="routine-confirm__field-value routine-confirm__field-value--mono">
              {meta.agentId}
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

/* ── Generic inline ask-user (unchanged) ── */

export function AskUserInline({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({})

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
  }

  // ── Generic rendering ──

  const handleCustom = (question: string) => {
    setShowCustom((prev) => ({ ...prev, [question]: true }))
    setAnswers((prev) => ({ ...prev, [question]: '' }))
  }

  // Auto-submit when all questions have answers (and there are answers)
  const checkAutoSubmit = (
    newAnswers: Record<string, string>,
    newCustom: Record<string, string>,
  ) => {
    const done = questions.every((q) => newAnswers[q.question] || newCustom[q.question]?.trim())
    if (done) {
      const final: Record<string, string> = {}
      for (const q of questions) {
        final[q.question] = newCustom[q.question]?.trim() || newAnswers[q.question] || ''
      }
      // Small delay so user sees their selection
      setTimeout(() => onSubmit(final), 300)
    }
  }

  const handleSelectAndCheck = (question: string, label: string) => {
    const newAnswers = { ...answers, [question]: label }
    const newCustom = { ...customInputs, [question]: '' }
    setAnswers(newAnswers)
    setCustomInputs(newCustom)
    setShowCustom((prev) => ({ ...prev, [question]: false }))
    checkAutoSubmit(newAnswers, newCustom)
  }

  return (
    <div className="ask-inline">
      <div className="ask-inline__card">
        {questions.length > 1 && (
          <div className="ask-inline__intro">Let me clarify a few things:</div>
        )}
        {questions.map((q, qi) => {
          const options = (q.options ?? []).map(normalizeOption)
          const selected = answers[q.question]
          const isCustom = showCustom[q.question]

          return (
            <div key={q.question} className="ask-inline__question">
              <div className="ask-inline__question-header">
                <span className="ask-inline__question-number">{qi + 1}</span>
                <span className="ask-inline__question-text">{q.question}</span>
              </div>
              <div className="ask-inline__pills">
                {options.map((opt: { label: string; description?: string }) => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`ask-inline__pill${selected === opt.label ? ' ask-inline__pill--selected' : ''}`}
                    onClick={() => handleSelectAndCheck(q.question, opt.label)}
                  >
                    {opt.label}
                  </button>
                ))}
                {q.allowFreeText !== false && (
                  <button
                    type="button"
                    className={`ask-inline__pill ask-inline__pill--other${isCustom ? ' ask-inline__pill--selected' : ''}`}
                    onClick={() => handleCustom(q.question)}
                  >
                    Other
                  </button>
                )}
              </div>
              {isCustom && (
                <input
                  type="text"
                  className="ask-inline__custom-input"
                  placeholder="Type your answer..."
                  value={customInputs[q.question] || ''}
                  onChange={(e) => {
                    setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customInputs[q.question]?.trim()) {
                      const newCustom = { ...customInputs }
                      checkAutoSubmit(answers, newCustom)
                    }
                  }}
                  // biome-ignore lint/a11y/noAutofocus: UX requires focus on custom input
                  autoFocus
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
