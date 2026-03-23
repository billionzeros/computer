import type { AskUserQuestion } from '@anton/protocol'
import { motion } from 'framer-motion'
import { MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'

interface Props {
  questions: AskUserQuestion[]
  onSubmit: (answers: Record<string, string>) => void
}

export function AskUserDialog({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const q of questions) {
      init[q.question] = ''
    }
    return init
  })
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({})

  const setAnswer = (question: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [question]: value }))
  }

  const allAnswered = questions.every((q) => {
    const answer = answers[q.question]
    if (showCustom[q.question]) return (customInputs[q.question] || '').trim().length > 0
    return answer.length > 0
  })

  const handleSubmit = () => {
    const finalAnswers: Record<string, string> = {}
    for (const q of questions) {
      if (showCustom[q.question]) {
        finalAnswers[q.question] = customInputs[q.question] || ''
      } else {
        finalAnswers[q.question] = answers[q.question]
      }
    }
    onSubmit(finalAnswers)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="ask-user-dialog"
    >
      <div className="ask-user-dialog__surface">
        <div className="ask-user-dialog__header">
          <MessageCircleQuestion className="ask-user-dialog__icon" />
          <span className="ask-user-dialog__title">A few questions</span>
        </div>

        <div className="ask-user-dialog__questions">
          {questions.map((q, _idx) => {
            const hasOptions = q.options && q.options.length > 0
            const allowFreeText = q.allowFreeText !== false

            return (
              <div key={q.question} className="ask-user-dialog__question">
                <span className="ask-user-dialog__label">{q.question}</span>

                {hasOptions && (
                  <div className="ask-user-dialog__options">
                    {q.options!.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`ask-user-dialog__chip ${
                          !showCustom[q.question] && answers[q.question] === opt
                            ? 'ask-user-dialog__chip--selected'
                            : ''
                        }`}
                        onClick={() => {
                          setAnswer(q.question, opt)
                          setShowCustom((prev) => ({ ...prev, [q.question]: false }))
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                    {allowFreeText && (
                      <button
                        type="button"
                        className={`ask-user-dialog__chip ${
                          showCustom[q.question] ? 'ask-user-dialog__chip--selected' : ''
                        }`}
                        onClick={() => {
                          setShowCustom((prev) => ({ ...prev, [q.question]: true }))
                          setAnswer(q.question, '')
                        }}
                      >
                        Other...
                      </button>
                    )}
                  </div>
                )}

                {(showCustom[q.question] || (!hasOptions && allowFreeText)) && (
                  <input
                    type="text"
                    className="ask-user-dialog__input"
                    placeholder="Type your answer..."
                    value={customInputs[q.question] || ''}
                    onChange={(e) =>
                      setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && allAnswered) handleSubmit()
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="ask-user-dialog__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="button button--primary"
          >
            Submit
          </button>
        </div>
      </div>
    </motion.div>
  )
}
