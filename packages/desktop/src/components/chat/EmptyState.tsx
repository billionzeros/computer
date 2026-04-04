import { motion } from 'framer-motion'
import { BriefcaseBusiness, Code2, ListChecks, Sparkles } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { type PersonalizedSuggestion, generateSuggestions } from '../../lib/suggestions.js'
import { AntonLogo } from '../AntonLogo.js'
import { ChatInput } from './ChatInput.js'

interface Props {
  onSend: (text: string, attachments?: ChatImageAttachment[]) => void
  onSkillSelect: (skill: Skill) => void
}

type Category = 'for-you' | 'business' | 'prototype' | 'organize'

const categories: { id: Category; label: string; Icon?: typeof Sparkles }[] = [
  { id: 'for-you', label: 'For you', Icon: Sparkles },
  { id: 'business', label: 'Build a business', Icon: BriefcaseBusiness },
  { id: 'prototype', label: 'Create a prototype', Icon: Code2 },
  { id: 'organize', label: 'Organize my life', Icon: ListChecks },
]

const staticSuggestions: Record<Exclude<Category, 'for-you'>, string[]> = {
  business: [
    'Build a 2026 founder operating system with lender-ready financials and B Corp analysis',
    'Create a competitive analysis dashboard for my market',
    'Build a financial model with revenue projections and burn rate tracking',
  ],
  prototype: [
    'Create an interactive market-map filtering site for the YC W26 batch',
    'Build a real-time dashboard with WebSocket data streaming',
    'Create a drag-and-drop kanban board with persistence',
  ],
  organize: [
    'Build a weekly operating plan that balances work, health, and admin',
    'Set up automated daily reports for my projects',
    'Create a personal CRM to track relationships and follow-ups',
  ],
}

export function EmptyState({ onSend, onSkillSelect }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>('for-you')
  const [draft, setDraft] = useState('')
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const setActiveView = uiStore((s) => s.setActiveView)

  // Generate suggestions once on mount — avoid regenerating every time
  // a new conversation is created (which mutates the conversations array).
  const forYouRef = useRef<PersonalizedSuggestion[] | null>(null)
  if (forYouRef.current === null) {
    const conversations = useStore.getState().conversations
    forYouRef.current = generateSuggestions(conversations)
  }
  const forYouSuggestions = forYouRef.current

  const handleSuggestionClick = useCallback(
    (suggestion: PersonalizedSuggestion | string) => {
      const text = typeof suggestion === 'string' ? suggestion : suggestion.text
      const projectId = typeof suggestion === 'string' ? undefined : suggestion.projectId

      if (projectId) {
        // Verify project still exists before navigating
        const ps = projectStore.getState()
        if (ps.projects.some((p) => p.id === projectId)) {
          setActiveProject(projectId)
          setActiveView('home')
          ps.listProjectSessions(projectId)
          return
        }
      }
      // Fallback: just set the draft text
      setDraft(text)
    },
    [setActiveProject, setActiveView],
  )

  const activeSuggestions: (PersonalizedSuggestion | string)[] =
    activeCategory === 'for-you' ? forYouSuggestions : staticSuggestions[activeCategory]

  return (
    <div className="empty-state">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="empty-state__inner"
      >
        <h1 className="empty-state__heading">
          <AntonLogo size={28} className="empty-state__heading-logo" />
          <span>anton.computer</span>
        </h1>

        <div className="empty-state__input-wrap">
          <ChatInput
            onSend={onSend}
            onSkillSelect={onSkillSelect}
            variant="hero"
            initialValue={draft}
          />
        </div>

        <div className="empty-state__tabs">
          {categories.map((cat) => (
            <button
              type="button"
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`empty-state__tab${activeCategory === cat.id ? ' empty-state__tab--active' : ''}`}
            >
              {cat.Icon && (
                <cat.Icon size={14} strokeWidth={1.5} className="empty-state__tab-icon" />
              )}
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        <div className="empty-state__suggestions">
          {activeSuggestions.map((suggestion) => {
            const text = typeof suggestion === 'string' ? suggestion : suggestion.text
            const projectId = typeof suggestion === 'string' ? undefined : suggestion.projectId
            return (
              <button
                type="button"
                key={text}
                onClick={() => handleSuggestionClick(suggestion)}
                className={`empty-state__suggestion${projectId ? ' empty-state__suggestion--project' : ''}`}
              >
                {text}
              </button>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
