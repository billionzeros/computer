import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import { useState } from 'react'

interface Props {
  questions: AskUserQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}

function normalizeOption(opt: string | AskUserOption): { label: string; description?: string } {
  if (typeof opt === 'string') return { label: opt }
  return { label: opt.label, description: opt.description }
}

export function AskUserInline({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({})

  const allAnswered = questions.every(
    (q) => answers[q.question] || customInputs[q.question]?.trim(),
  )

  const handleSelect = (question: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [question]: label }))
    setShowCustom((prev) => ({ ...prev, [question]: false }))
    setCustomInputs((prev) => ({ ...prev, [question]: '' }))
  }

  const handleCustom = (question: string) => {
    setShowCustom((prev) => ({ ...prev, [question]: true }))
    setAnswers((prev) => ({ ...prev, [question]: '' }))
  }

  const handleSubmit = () => {
    const final: Record<string, string> = {}
    for (const q of questions) {
      final[q.question] = customInputs[q.question]?.trim() || answers[q.question] || ''
    }
    onSubmit(final)
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
