import { BookOpen, Code2, Mail, Pencil, Sparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { sanitizeTitle } from '../../lib/conversations.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { type PersonalizedSuggestion, generateSuggestions } from '../../lib/suggestions.js'
import { ChatInput } from '../chat/ChatInput.js'

interface Props {
  onSkillSelect: (skill: Skill) => void
}

const categories = [
  { id: 'write', label: 'Write', icon: Pencil, prompt: 'Help me write ' },
  { id: 'learn', label: 'Learn', icon: BookOpen, prompt: 'Teach me about ' },
  { id: 'code', label: 'Code', icon: Code2, prompt: 'Help me with code: ' },
  { id: 'life', label: 'Life stuff', icon: Mail, prompt: "Here's something I'm figuring out: " },
  {
    id: 'spark',
    label: "Anton's choice",
    icon: Sparkles,
    prompt: 'Surprise me with something useful to work on.',
  },
] as const

function greetingForHour(h: number): string {
  if (h < 5) return "It's late-night"
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return "It's late-night"
}

const TAIL_PHRASES = [
  'ready to build?',
  'what are we making today?',
  "what's on your mind?",
  'what shall we tackle?',
  "let's ship something.",
  'ready when you are.',
  "what's next?",
  'got a spark?',
  'what are we exploring?',
  "let's dig in.",
  "what's cooking?",
  'shall we begin?',
  "what's the move?",
  'got something in motion?',
  'ready to create?',
  'what are we solving?',
  "let's make something good.",
  'what feels exciting today?',
  'where are we headed?',
  'pick up where you left off?',
  'ready for a fresh start?',
  "what's the mission?",
  "let's get into it.",
  "what's calling you today?",
  'time to make a dent.',
]

function pickTail(): string {
  return TAIL_PHRASES[Math.floor(Math.random() * TAIL_PHRASES.length)] ?? ''
}

export function StreamHome({ onSkillSelect }: Props) {
  const [draft, setDraft] = useState('')
  const newConversation = useStore((s) => s.newConversation)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const setActiveView = uiStore((s) => s.setActiveView)

  const greeting = useMemo(() => greetingForHour(new Date().getHours()), [])
  const tail = useMemo(() => pickTail(), [])

  // Generate suggestions once on mount — avoid regenerating when conversations mutate.
  const forYouRef = useRef<PersonalizedSuggestion[] | null>(null)
  if (forYouRef.current === null) {
    forYouRef.current = generateSuggestions(useStore.getState().conversations)
  }
  const suggestions = forYouRef.current

  const startNewTask = (text: string, attachments?: ChatImageAttachment[]) => {
    const store = useStore.getState()
    const activeConv = store.getActiveConversation()
    let sessionId = activeConv?.sessionId
    let convId = activeConv?.id

    // Reuse active conversation if it's empty; otherwise create a fresh one.
    // This lets "New task" (Sidebar / CommandPalette) pre-create a session and
    // have the first message land on it, avoiding leaked empty conversations.
    if (!activeConv || (activeConv.messages?.length ?? 0) > 0 || !sessionId) {
      sessionId = `sess_${Date.now().toString(36)}`
      const ps = projectStore.getState()
      const projectId =
        activeConv?.projectId ??
        ps.projects.find((p) => p.isDefault)?.id ??
        ps.activeProjectId ??
        undefined
      newConversation(undefined, sessionId, projectId)
      const ss = sessionStore.getState()
      sessionStore.getState().createSession(sessionId, {
        provider: ss.currentProvider,
        model: ss.currentModel,
        projectId,
      })
      convId = useStore.getState().findConversationBySession(sessionId)?.id
    }

    if (!convId || !sessionId) return
    // Sync currentSessionId directly — do NOT call switchConversation here.
    // switchConversation triggers a history fetch on empty conversations once the
    // session_created ack has cleared pendingCreation, and the empty server
    // response races with the addMessage below and wipes the user's message.
    const ss = sessionStore.getState()
    const targetConv = useStore.getState().conversations.find((c) => c.id === convId)
    if (ss.currentSessionId !== sessionId) {
      ss.setCurrentSession(
        sessionId,
        targetConv?.provider || ss.currentProvider,
        targetConv?.model || ss.currentModel,
      )
    }
    useStore.setState({ activeConversationId: convId })
    useStore.getState().addMessage({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    })
    const outbound = attachments?.flatMap((a) =>
      a.data
        ? [{ id: a.id, name: a.name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes }]
        : [],
    )
    sessionStore.getState().sendAiMessageToSession(text, sessionId, outbound)
    // Navigate to the chat view so the topbar/breadcrumb reflect the conversation.
    setActiveView('chat')
  }

  return (
    <div className="home-scroll">
      <div className="home home--centered">
        <div className="home-stack">
          <div className="home-welcome">
            <span className="home-welcome__glyph">✻</span>
            <span className="home-welcome__greet">
              {greeting}, {tail}
            </span>
          </div>

          <div className="home-composer">
            <ChatInput
              onSend={startNewTask}
              onSkillSelect={onSkillSelect}
              variant="hero"
              placeholder="How can I help you today?"
              initialValue={draft}
              ignoreWorkingState
              conversationId={activeConversationId ?? undefined}
            />
          </div>

          <div className="home-cats">
            {categories.map((c) => {
              const Icon = c.icon
              return (
                <button
                  type="button"
                  key={c.id}
                  className="home-cat"
                  onClick={() => setDraft(c.prompt)}
                >
                  <Icon size={13} strokeWidth={1.5} />
                  <span>{c.label}</span>
                </button>
              )
            })}
          </div>

          {suggestions.length > 0 && (
            <div className="home-foryou">
              <div className="home-section__head">
                <span className="home-section__title">For you</span>
              </div>
              <div className="home-foryou__list">
                {suggestions.map((s) => (
                  <button
                    type="button"
                    key={s.text}
                    className="home-foryou__item"
                    onClick={() => {
                      if (s.projectId) {
                        const exists = projectStore
                          .getState()
                          .projects.some((p) => p.id === s.projectId)
                        if (exists) {
                          projectStore.getState().setActiveProject(s.projectId)
                          setActiveView('home')
                          return
                        }
                      }
                      setDraft(sanitizeTitle(s.text))
                    }}
                  >
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
