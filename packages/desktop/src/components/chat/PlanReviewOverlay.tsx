import { Check, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'

interface TocEntry {
  id: string
  text: string
  level: number
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = []
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) {
      const text = match[2].replace(/`([^`]+)`/g, '$1').trim()
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
      entries.push({ id, text, level: match[1].length })
    }
  }
  return entries
}

export function PlanReviewOverlay() {
  const pendingPlan = sessionStore((s) => s.pendingPlan)
  const setPendingPlan = sessionStore((s) => s.setPendingPlan)
  const [feedback, setFeedback] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)

  const toc = useMemo(() => {
    if (!pendingPlan) return []
    return extractToc(pendingPlan.content)
  }, [pendingPlan])

  useEffect(() => {
    const container = contentRef.current
    if (!container || toc.length === 0) return

    const handleScroll = () => {
      const headings = container.querySelectorAll('h1[id], h2[id], h3[id]')
      let current: string | null = null
      for (const heading of headings) {
        const el = heading as HTMLElement
        const rect = el.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        if (rect.top - containerRect.top <= 40) current = el.id
      }
      if (current) setActiveSection(current)
    }

    container.addEventListener('scroll', handleScroll)
    if (toc.length > 0 && !activeSection) setActiveSection(toc[0].id)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [toc, activeSection])

  if (!pendingPlan) return null

  const handleApprove = () => {
    sessionStore.getState().sendPlanResponse(pendingPlan.id, true)
    setPendingPlan(null)
  }

  const handleReject = () => {
    if (!feedback.trim()) return
    sessionStore.getState().sendPlanResponse(pendingPlan.id, false, feedback)
    setPendingPlan(null)
    setFeedback('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && feedback.trim()) {
      e.preventDefault()
      handleReject()
    }
  }

  const scrollToSection = (id: string) => {
    const container = contentRef.current
    if (!container) return
    const el = container.querySelector(`#${CSS.escape(id)}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(id)
    }
  }

  return (
    <div className="plan-overlay">
      <div className="plan-overlay__card">
        {/* Header */}
        <div className="plan-overlay__header">
          <span className="plan-overlay__label">Review Plan</span>
          <span className="plan-overlay__title">{pendingPlan.title}</span>
        </div>

        {/* Body: TOC + Content */}
        <div className="plan-overlay__body">
          {toc.length > 0 && (
            <nav className="plan-overlay__toc">
              <ul>
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`plan-overlay__toc-item plan-overlay__toc-item--l${entry.level}${activeSection === entry.id ? ' plan-overlay__toc-item--active' : ''}`}
                      onClick={() => scrollToSection(entry.id)}
                    >
                      {entry.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className="plan-overlay__content" ref={contentRef}>
            <MarkdownRenderer content={pendingPlan.content} />
          </div>
        </div>

        {/* Footer: Approve + Feedback input */}
        <div className="plan-overlay__footer">
          <button type="button" className="plan-overlay__approve" onClick={handleApprove}>
            <Check size={16} strokeWidth={1.5} />
            Approve and start
          </button>
          <div className="plan-overlay__feedback">
            <input
              ref={feedbackRef}
              type="text"
              className="plan-overlay__feedback-input"
              placeholder="Tell anton what to change..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {feedback.trim() && (
              <button
                type="button"
                className="plan-overlay__feedback-send"
                onClick={handleReject}
                aria-label="Send feedback"
              >
                <Send size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
