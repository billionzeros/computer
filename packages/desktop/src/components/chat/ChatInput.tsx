import { ArrowUp, ListChecks, Plus, Square } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Skill } from '../../lib/skills.js'
import { useAgentStatus } from '../../lib/store.js'
import { ModelSelector } from './ModelSelector.js'
import { SlashCommandMenu } from './SlashCommandMenu.js'

interface Props {
  onSend: (text: string) => void
  onSkillSelect: (skill: Skill) => void
  variant?: 'docked' | 'hero'
  initialValue?: string
}

export function ChatInput({ onSend, onSkillSelect, variant = 'docked', initialValue }: Props) {
  const [input, setInput] = useState('')
  const [planFirst, setPlanFirst] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentStatus = useAgentStatus()
  const isHero = variant === 'hero'

  // Sync external initialValue into input (e.g. from suggestion chips)
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== '') {
      setInput(initialValue)
      // Focus the textarea so user can review/edit before sending
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [initialValue])

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
  }, [input])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    if (val.startsWith('/')) {
      setShowSlashMenu(true)
      setSlashFilter(val.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || agentStatus === 'working') return
    const message = planFirst
      ? `Think step by step and create a plan before doing anything. Once I approve the plan, execute it.\n\n${text}`
      : text
    onSend(message)
    setInput('')
    setPlanFirst(false)
    setShowSlashMenu(false)
    textareaRef.current?.focus()
  }, [input, agentStatus, onSend, planFirst])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSkillSelect = (skill: Skill) => {
    setInput('')
    setShowSlashMenu(false)
    onSkillSelect(skill)
  }

  return (
    <div className={`composer${isHero ? ' composer--hero' : ''}`}>
      <div className="composer__anchor">
        <SlashCommandMenu
          filter={slashFilter}
          onSelect={handleSkillSelect}
          onClose={() => setShowSlashMenu(false)}
          visible={showSlashMenu}
        />

        <div className="composer__box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isHero ? 'What should we work on next?' : 'Ask a follow-up'}
            rows={1}
            className="composer__textarea"
          />
          <div className="composer__toolbar">
            <div className="composer__toolbar-left">
              <button type="button" className="composer__btn" aria-label="Attach">
                <Plus />
              </button>
              <button
                type="button"
                className={`composer__btn composer__btn--plan${planFirst ? ' composer__btn--plan-active' : ''}`}
                onClick={() => setPlanFirst(!planFirst)}
                aria-label="Plan first"
                title="Plan before executing"
              >
                <ListChecks />
              </button>
            </div>
            <div className="composer__toolbar-right">
              <ModelSelector />
              {agentStatus === 'working' ? (
                <button
                  type="button"
                  className="composer__btn composer__btn--stop"
                  aria-label="Stop"
                >
                  <Square />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="composer__btn composer__btn--send"
                  aria-label="Send"
                >
                  <ArrowUp />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
