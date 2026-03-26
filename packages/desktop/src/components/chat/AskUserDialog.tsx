import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface Props {
  questions: AskUserQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}

interface AnswerState {
  selectedOption: string
  customText: string
}

interface NormalizedOption {
  label: string
  description?: string
}

function normalizeOption(opt: string | AskUserOption): NormalizedOption {
  if (typeof opt === 'string') return { label: opt }
  return { label: opt.label, description: opt.description }
}

export function AskUserDialog({ questions, onSubmit }: Props) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const init: Record<string, AnswerState> = {}
    for (const q of questions) init[q.question] = { selectedOption: '', customText: '' }
    return init
  })
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setStep(0)
    const init: Record<string, AnswerState> = {}
    for (const q of questions) init[q.question] = { selectedOption: '', customText: '' }
    setAnswers(init)
  }, [questions])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60)
  }, [step])

  const q = questions[step]
  if (!q) return null

  const rawOptions = q.options ?? []
  const options = rawOptions.map(normalizeOption)
  const hasOptions = options.length > 0
  const hasDescriptions = options.some((o) => o.description)
  const allowFreeText = q.allowFreeText !== false
  const ans = answers[q.question] ?? { selectedOption: '', customText: '' }
  const isLast = step === questions.length - 1
  const total = questions.length

  const isAnswered = ans.customText.trim().length > 0 || ans.selectedOption.length > 0

  const selectOption = (label: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], selectedOption: label, customText: '' },
    }))
  }

  const setCustomText = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], customText: value },
    }))
  }

  const handleContinue = () => {
    if (!isAnswered) return
    if (isLast) {
      const final: Record<string, string> = {}
      for (const question of questions) {
        const a = answers[question.question]
        final[question.question] = a?.customText.trim() || a?.selectedOption || ''
      }
      onSubmit(final)
    } else {
      setStep((s) => s + 1)
    }
  }

  return (
    <div className="ask-dialog">
      {/* Progress bar (multi-question only) */}
      {total > 1 && (
        <div className="ask-dialog__progress-track">
          <div
            className="ask-dialog__progress-fill"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
      )}

      {/* Question body */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }}
          className="ask-dialog__body"
        >
          <div className="ask-dialog__question-section">
            <span className="ask-dialog__question">{q.question}</span>
            {q.description && (
              <span className="ask-dialog__description">{q.description}</span>
            )}
          </div>

          {/* Option cards — full width, with optional descriptions */}
          {hasOptions && (
            <div className={`ask-dialog__options${hasDescriptions ? ' ask-dialog__options--rich' : ''}`}>
              {options.map((opt) => {
                const selected =
                  ans.customText.trim().length === 0 && ans.selectedOption === opt.label
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`ask-dialog__option${selected ? ' ask-dialog__option--selected' : ''}`}
                    onClick={() => selectOption(opt.label)}
                  >
                    <div className="ask-dialog__option-radio">
                      {selected && <Check className="ask-dialog__option-check" />}
                    </div>
                    <div className="ask-dialog__option-content">
                      <span className="ask-dialog__option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="ask-dialog__option-desc">{opt.description}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Free text input */}
          {allowFreeText && (
            <textarea
              ref={inputRef}
              className="ask-dialog__input"
              placeholder={
                q.freeTextPlaceholder ||
                (hasOptions ? 'Or type your own answer...' : 'Type your answer...')
              }
              rows={2}
              value={ans.customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && isAnswered) {
                  e.preventDefault()
                  handleContinue()
                }
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <div className="ask-dialog__footer">
        {step > 0 ? (
          <button
            type="button"
            className="ask-dialog__btn ask-dialog__btn--back"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ArrowLeft size={14} strokeWidth={1.5} className="ask-dialog__btn-icon" />
            Back
          </button>
        ) : (
          <span className="ask-dialog__step-label">
            {total > 1 ? `${step + 1} of ${total}` : ''}
          </span>
        )}
        <button
          type="button"
          className="ask-dialog__btn ask-dialog__btn--next"
          disabled={!isAnswered}
          onClick={handleContinue}
        >
          {isLast ? 'Submit' : 'Next'}
          {!isLast && <ArrowRight size={14} strokeWidth={1.5} className="ask-dialog__btn-icon" />}
        </button>
      </div>
    </div>
  )
}
