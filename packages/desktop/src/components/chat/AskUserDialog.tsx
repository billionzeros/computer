import type { AskUserOption, AskUserQuestion } from '@anton/protocol'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
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
  const [showCustomInput, setShowCustomInput] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setStep(0)
    setShowCustomInput(false)
    const init: Record<string, AnswerState> = {}
    for (const q of questions) init[q.question] = { selectedOption: '', customText: '' }
    setAnswers(init)
  }, [questions])

  useEffect(() => {
    if (showCustomInput) {
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [showCustomInput])

  const q = questions[step]
  if (!q) return null

  const rawOptions = q.options ?? []
  const options = rawOptions.map(normalizeOption)
  const hasOptions = options.length > 0
  const allowFreeText = q.allowFreeText !== false
  const ans = answers[q.question] ?? { selectedOption: '', customText: '' }
  const isLast = step === questions.length - 1
  const total = questions.length

  const selectOption = (label: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], selectedOption: label, customText: '' },
    }))
    setShowCustomInput(false)

    // Auto-advance on select for single question, or submit if last
    if (isLast) {
      const final: Record<string, string> = {}
      for (const question of questions) {
        const a = question.question === q.question
          ? { selectedOption: label, customText: '' }
          : answers[question.question]
        final[question.question] = a?.customText.trim() || a?.selectedOption || ''
      }
      onSubmit(final)
    } else {
      setTimeout(() => setStep((s) => s + 1), 150)
    }
  }

  const setCustomText = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], customText: value, selectedOption: '' },
    }))
  }

  const handleCustomSubmit = () => {
    const text = ans.customText.trim()
    if (!text) return
    if (isLast) {
      const final: Record<string, string> = {}
      for (const question of questions) {
        const a = answers[question.question]
        final[question.question] = a?.customText.trim() || a?.selectedOption || ''
      }
      onSubmit(final)
    } else {
      setStep((s) => s + 1)
      setShowCustomInput(false)
    }
  }

  const handleSkip = () => {
    if (isLast) {
      const final: Record<string, string> = {}
      for (const question of questions) {
        const a = answers[question.question]
        final[question.question] = a?.customText.trim() || a?.selectedOption || ''
      }
      onSubmit(final)
    } else {
      setStep((s) => s + 1)
      setShowCustomInput(false)
    }
  }

  return (
    <div className="ask-dialog">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }}
          className="ask-dialog__card"
        >
          {/* Header: question + step indicator */}
          <div className="ask-dialog__header">
            <span className="ask-dialog__question">{q.question}</span>
            {total > 1 && (
              <span className="ask-dialog__step-badge">{step + 1}/{total}</span>
            )}
          </div>

          {/* Options list */}
          {hasOptions && (
            <div className="ask-dialog__options">
              {options.map((opt, i) => {
                const selected =
                  ans.customText.trim().length === 0 && ans.selectedOption === opt.label
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`ask-dialog__option${selected ? ' ask-dialog__option--selected' : ''}`}
                    onClick={() => selectOption(opt.label)}
                  >
                    <div className="ask-dialog__option-content">
                      <span className="ask-dialog__option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="ask-dialog__option-desc">{opt.description}</span>
                      )}
                    </div>
                    <span className="ask-dialog__option-badge">{i + 1}</span>
                  </button>
                )
              })}

              {/* "Type something else..." as an option */}
              {allowFreeText && (
                <button
                  type="button"
                  className={`ask-dialog__option${showCustomInput ? ' ask-dialog__option--selected' : ''}`}
                  onClick={() => setShowCustomInput(true)}
                >
                  <div className="ask-dialog__option-content">
                    <span className="ask-dialog__option-label ask-dialog__option-label--placeholder">
                      {q.freeTextPlaceholder || 'Type something else...'}
                    </span>
                  </div>
                  <span className="ask-dialog__option-badge">{options.length + 1}</span>
                </button>
              )}
            </div>
          )}

          {/* Free text input (shown when "Type something else" is clicked, or no options) */}
          {(showCustomInput || !hasOptions) && allowFreeText && (
            <div className="ask-dialog__custom-input-wrap">
              <textarea
                ref={inputRef}
                className="ask-dialog__input"
                placeholder={q.freeTextPlaceholder || 'Type your answer...'}
                rows={2}
                value={ans.customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && ans.customText.trim()) {
                    e.preventDefault()
                    handleCustomSubmit()
                  }
                  if (e.key === 'Escape' && hasOptions) {
                    setShowCustomInput(false)
                  }
                }}
              />
            </div>
          )}

          {/* Footer */}
          <div className="ask-dialog__footer">
            {step > 0 ? (
              <button
                type="button"
                className="ask-dialog__btn ask-dialog__btn--back"
                onClick={() => {
                  setStep((s) => Math.max(0, s - 1))
                  setShowCustomInput(false)
                }}
              >
                <ArrowLeft size={14} strokeWidth={1.5} />
                Back
              </button>
            ) : (
              <div />
            )}
            <button
              type="button"
              className="ask-dialog__btn ask-dialog__btn--skip"
              onClick={handleSkip}
            >
              Skip
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
