import { Check, MessageSquare, X } from 'lucide-react'
import { useState } from 'react'
import { connection } from '../lib/connection.js'
import { useStore } from '../lib/store.js'
import { MarkdownRenderer } from './chat/MarkdownRenderer.js'

export function PlanPanel() {
  const pendingPlan = useStore((s) => s.pendingPlan)
  const setPendingPlan = useStore((s) => s.setPendingPlan)
  const setSidePanelView = useStore((s) => s.setSidePanelView)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  if (!pendingPlan) {
    return (
      <div className="plan-panel__empty">
        <p>No plan pending review.</p>
      </div>
    )
  }

  const handleApprove = () => {
    connection.sendPlanResponse(pendingPlan.id, true)
    setPendingPlan(null)
    setSidePanelView('artifacts')
  }

  const handleReject = () => {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    connection.sendPlanResponse(pendingPlan.id, false, feedback || undefined)
    setPendingPlan(null)
    setSidePanelView('artifacts')
    setShowFeedback(false)
    setFeedback('')
  }

  return (
    <div className="plan-panel">
      <div className="plan-panel__header">
        <h3 className="plan-panel__title">{pendingPlan.title}</h3>
      </div>

      <div className="plan-panel__content">
        <MarkdownRenderer content={pendingPlan.content} />
      </div>

      <div className="plan-panel__actions">
        {showFeedback && (
          <div className="plan-panel__feedback">
            <textarea
              className="plan-panel__feedback-input"
              placeholder="What should be changed? (optional)"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              /* eslint-disable-next-line jsx-a11y/no-autofocus */
            />
          </div>
        )}
        <div className="plan-panel__buttons">
          <button
            type="button"
            className="plan-panel__btn plan-panel__btn--approve"
            onClick={handleApprove}
          >
            <Check size={16} />
            Approve plan
          </button>
          <button
            type="button"
            className="plan-panel__btn plan-panel__btn--reject"
            onClick={handleReject}
          >
            {showFeedback ? <MessageSquare size={16} /> : <X size={16} />}
            {showFeedback ? 'Send feedback' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}
