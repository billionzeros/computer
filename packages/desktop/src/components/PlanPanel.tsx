import { Check, ChevronRight, MessageSquare, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sessionStore } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import { MarkdownRenderer } from './chat/MarkdownRenderer.js'

interface TocEntry {
  id: string
  text: string
  level: number
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = []
  const lines = markdown.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = match[2].replace(/`([^`]+)`/g, '$1').trim()
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
      entries.push({ id, text, level })
    }
  }
  return entries
}

export function PlanPanel() {
  const pendingPlan = sessionStore((s) => s.pendingPlan)
  const setPendingPlan = sessionStore((s) => s.setPendingPlan)
  const setSidePanelView = uiStore((s) => s.setSidePanelView)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const toc = useMemo(() => {
    if (!pendingPlan) return []
    return extractToc(pendingPlan.content)
  }, [pendingPlan])

  // Track active section on scroll
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
        if (rect.top - containerRect.top <= 40) {
          current = el.id
        }
      }
      if (current) setActiveSection(current)
    }

    container.addEventListener('scroll', handleScroll)
    // Set initial active section
    if (toc.length > 0 && !activeSection) {
      setActiveSection(toc[0].id)
    }
    return () => container.removeEventListener('scroll', handleScroll)
  }, [toc, activeSection])

  if (!pendingPlan) {
    return (
      <div className="plan-panel__empty">
        <p>No plan pending review.</p>
      </div>
    )
  }

  const handleApprove = () => {
    sessionStore.getState().sendPlanResponse(pendingPlan.id, true)
    setPendingPlan(null)
    setSidePanelView('artifacts')
  }

  const handleReject = () => {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    sessionStore.getState().sendPlanResponse(pendingPlan.id, false, feedback || undefined)
    setPendingPlan(null)
    setSidePanelView('artifacts')
    setShowFeedback(false)
    setFeedback('')
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
    <div className="plan-panel">
      <div className="plan-panel__header">
        <h3 className="plan-panel__title">{pendingPlan.title || "Review Claude's plan"}</h3>
      </div>

      <div className="plan-panel__body">
        {toc.length > 0 && (
          <nav className="plan-panel__sidebar">
            <ul className="plan-panel__toc">
              {toc.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`plan-panel__toc-item plan-panel__toc-item--l${entry.level}${activeSection === entry.id ? ' plan-panel__toc-item--active' : ''}`}
                    onClick={() => scrollToSection(entry.id)}
                  >
                    <span className="plan-panel__toc-text">{entry.text}</span>
                    {activeSection === entry.id && (
                      <ChevronRight size={12} strokeWidth={2} className="plan-panel__toc-arrow" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="plan-panel__content" ref={contentRef}>
          <MarkdownRenderer content={pendingPlan.content} />
        </div>
      </div>

      <div className="plan-panel__actions">
        {showFeedback && (
          <div className="plan-panel__feedback">
            <textarea
              className="plan-panel__feedback-input"
              placeholder="Tell Claude what to do instead..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
            />
          </div>
        )}
        <div className="plan-panel__buttons">
          <button
            type="button"
            className="plan-panel__btn plan-panel__btn--approve"
            onClick={handleApprove}
          >
            <Check size={16} strokeWidth={1.5} />
            Approve Claude's plan and start coding
          </button>
          <button
            type="button"
            className="plan-panel__btn plan-panel__btn--reject"
            onClick={handleReject}
          >
            {showFeedback ? (
              <MessageSquare size={16} strokeWidth={1.5} />
            ) : (
              <X size={16} strokeWidth={1.5} />
            )}
            {showFeedback ? 'Send feedback' : 'Tell Claude what to do instead'}
          </button>
        </div>
      </div>
    </div>
  )
}
