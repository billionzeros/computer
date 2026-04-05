import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import { Bot, Calendar, Clock, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'

interface Props {
  questions: AskUserQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}

function normalizeOption(opt: string | AskUserOption): { label: string; description?: string } {
  if (typeof opt === 'string') return { label: opt }
  return { label: opt.label, description: opt.description }
}

/* ── Agent-create confirmation card ── */

interface AgentCreateMeta {
  type: 'agent_create'
  name: string
  description: string
  schedule: string | null
  cron: string | null
  prompt: string
}

function isAgentCreate(q: AskUserQuestion): AgentCreateMeta | null {
  const m = q.metadata
  if (m && (m as Record<string, unknown>).type === 'agent_create') return m as AgentCreateMeta
  return null
}

function AgentCreateCard({
  meta,
  onConfirm,
  onCancel,
}: { meta: AgentCreateMeta; onConfirm: () => void; onCancel: () => void }) {
  const promptPreview =
    meta.prompt.length > 120 ? `${meta.prompt.slice(0, 120)}...` : meta.prompt

  return (
    <div className="agent-confirm">
      <div className="agent-confirm__header">
        <div className="agent-confirm__icon">
          <Bot size={18} strokeWidth={1.5} />
        </div>
        <div className="agent-confirm__title-group">
          <span className="agent-confirm__title">Create Agent</span>
          <span className="agent-confirm__name">{meta.name}</span>
        </div>
      </div>

      {meta.description && (
        <p className="agent-confirm__desc">{meta.description}</p>
      )}

      <div className="agent-confirm__fields">
        <div className="agent-confirm__field">
          <span className="agent-confirm__field-icon">
            {meta.schedule ? (
              <Calendar size={14} strokeWidth={1.5} />
            ) : (
              <Clock size={14} strokeWidth={1.5} />
            )}
          </span>
          <span className="agent-confirm__field-label">Schedule</span>
          <span className="agent-confirm__field-value">
            {meta.schedule || 'Manual only'}
          </span>
        </div>

        {meta.cron && (
          <div className="agent-confirm__field">
            <span className="agent-confirm__field-icon">
              <Clock size={14} strokeWidth={1.5} />
            </span>
            <span className="agent-confirm__field-label">Cron</span>
            <span className="agent-confirm__field-value agent-confirm__field-value--mono">
              {meta.cron}
            </span>
          </div>
        )}

        {promptPreview && (
          <div className="agent-confirm__field agent-confirm__field--block">
            <span className="agent-confirm__field-icon">
              <FileText size={14} strokeWidth={1.5} />
            </span>
            <span className="agent-confirm__field-label">Prompt</span>
            <span className="agent-confirm__field-value agent-confirm__field-value--prompt">
              {promptPreview}
            </span>
          </div>
        )}
      </div>

      <div className="agent-confirm__actions">
        <button
          type="button"
          className="agent-confirm__btn agent-confirm__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="agent-confirm__btn agent-confirm__btn--confirm"
          onClick={onConfirm}
        >
          Create Agent
        </button>
      </div>
    </div>
  )
}

/* ── Agent-delete confirmation card ── */

interface AgentDeleteMeta {
  type: 'agent_delete'
  name: string
  agentId: string
}

function isAgentDelete(q: AskUserQuestion): AgentDeleteMeta | null {
  const m = q.metadata
  if (m && (m as Record<string, unknown>).type === 'agent_delete') return m as AgentDeleteMeta
  return null
}

function AgentDeleteCard({
  meta,
  onConfirm,
  onCancel,
}: { meta: AgentDeleteMeta; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="agent-confirm">
      <div className="agent-confirm__header">
        <div className="agent-confirm__icon agent-confirm__icon--danger">
          <Trash2 size={18} strokeWidth={1.5} />
        </div>
        <div className="agent-confirm__title-group">
          <span className="agent-confirm__title">Delete Agent</span>
          <span className="agent-confirm__name">{meta.name}</span>
        </div>
      </div>

      <p className="agent-confirm__desc">
        This will permanently remove the agent and its conversation history.
      </p>

      {meta.agentId && meta.agentId !== meta.name && (
        <div className="agent-confirm__fields">
          <div className="agent-confirm__field">
            <span className="agent-confirm__field-icon">
              <Bot size={14} strokeWidth={1.5} />
            </span>
            <span className="agent-confirm__field-label">ID</span>
            <span className="agent-confirm__field-value agent-confirm__field-value--mono">
              {meta.agentId}
            </span>
          </div>
        </div>
      )}

      <div className="agent-confirm__actions">
        <button
          type="button"
          className="agent-confirm__btn agent-confirm__btn--cancel"
          onClick={onCancel}
        >
          Keep it
        </button>
        <button
          type="button"
          className="agent-confirm__btn agent-confirm__btn--danger"
          onClick={onConfirm}
        >
          Delete Agent
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

    const createMeta = isAgentCreate(q)
    if (createMeta) {
      return (
        <div className="ask-inline">
          <AgentCreateCard
            meta={createMeta}
            onConfirm={() => onSubmit({ [q.question]: opts[0]?.label || 'Yes, create it' })}
            onCancel={() => onSubmit({ [q.question]: opts[1]?.label || 'No, cancel' })}
          />
        </div>
      )
    }

    const deleteMeta = isAgentDelete(q)
    if (deleteMeta) {
      return (
        <div className="ask-inline">
          <AgentDeleteCard
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
                {options.map((opt) => (
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
