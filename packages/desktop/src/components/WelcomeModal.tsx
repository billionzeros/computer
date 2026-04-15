import {
  ArrowRight,
  Repeat,
  Briefcase,
  Check,
  GraduationCap,
  Link2,
  Megaphone,
  Rocket,
  Settings,
  User,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import anthropicIcon from '../assets/llm/anthropic_light.svg'
import geminiIcon from '../assets/llm/gemini.svg'
import modelSelectorImg from '../assets/onboarding-model-selector.png'
import { AntonLogo } from './AntonLogo.js'
import { ConnectorIcon } from './connectors/ConnectorIcons.js'

interface Props {
  open: boolean
  onClose: (role?: string) => void
  onOpenSettings?: (role?: string) => void
}

type Role = 'founder' | 'marketing' | 'student' | 'everything' | 'other'

const roles = [
  {
    id: 'founder' as Role,
    icon: Briefcase,
    label: 'Founder',
    desc: 'I run a business and need to automate things',
  },
  {
    id: 'marketing' as Role,
    icon: Megaphone,
    label: 'Marketing / Sales',
    desc: 'I need to move fast and break spreadsheets',
  },
  {
    id: 'student' as Role,
    icon: GraduationCap,
    label: 'Student',
    desc: 'I am learning and want a coding companion',
  },
  {
    id: 'everything' as Role,
    icon: Zap,
    label: 'I do everything',
    desc: 'CEO, CTO, CFO, intern... you name it',
  },
]

const rolePrompts: Record<Role, string[]> = {
  founder: [
    'Build a landing page for my startup and deploy it',
    'Create a financial model with revenue projections',
    'Scrape competitor pricing and build a comparison dashboard',
  ],
  marketing: [
    'Scrape 100 leads from LinkedIn and put them in a spreadsheet',
    'Build an SEO-optimized blog with automated posting',
    'Create a dashboard tracking our marketing KPIs',
  ],
  student: [
    'Help me build my first full-stack web application',
    'Explain this codebase and help me contribute to it',
    'Create a study tracker app with reminders and progress charts',
  ],
  everything: [
    'Build and deploy a web app, set up the database, and monitor it',
    'Automate my daily reports and send them to Slack every morning',
    'Scrape competitor data, analyze it, and build a dashboard',
  ],
  other: [
    'Build and deploy a web application from scratch',
    'Automate a repetitive task on my computer',
    'Set up a database and create an API for it',
  ],
}

const connectorShowcase = [
  { id: 'slack', name: 'Slack' },
  { id: 'github', name: 'GitHub' },
  { id: 'gmail', name: 'Gmail' },
  { id: 'notion', name: 'Notion' },
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'airtable', name: 'Airtable' },
  { id: 'google-calendar', name: 'Calendar' },
  { id: 'linear', name: 'Linear' },
  { id: 'google-drive', name: 'Drive' },
  { id: 'telegram', name: 'Telegram' },
]

const steps = [
  { id: 'role', label: 'About You', icon: User },
  { id: 'prompts', label: 'Try These', icon: Rocket },
  { id: 'connectors', label: 'Connect', icon: Link2 },
  { id: 'model', label: 'Setup', icon: Settings },
] as const

type StepId = (typeof steps)[number]['id']

export function WelcomeModal({ open, onClose, onOpenSettings }: Props) {
  const [currentStep, setCurrentStep] = useState<StepId>('role')
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  const stepIndex = steps.findIndex((s) => s.id === currentStep)

  const goNext = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      setCurrentStep(steps[stepIndex + 1].id)
    }
  }, [stepIndex])

  const goBack = useCallback(() => {
    if (stepIndex > 0) {
      setCurrentStep(steps[stepIndex - 1].id)
    }
  }, [stepIndex])

  const handleRoleSelect = useCallback((role: Role) => {
    setSelectedRole(role)
  }, [])

  const handleGetStarted = useCallback(() => {
    const role = selectedRole ?? undefined
    onClose(role)
    onOpenSettings?.(role)
  }, [onClose, onOpenSettings, selectedRole])

  if (!open) return null

  const prompts = rolePrompts[selectedRole ?? 'other']
  const stepTwoHeadings: Record<Role, string> = {
    founder: 'Perfect for Founders',
    marketing: 'Perfect for Marketing & Sales',
    student: 'Perfect for Students',
    everything: 'You do it all? So does Anton.',
    other: 'Try asking Anton',
  }
  const stepTwoHeading = stepTwoHeadings[selectedRole ?? 'other']

  return (
    <div className="welcome-modal">
      <div className="welcome-modal__overlay" />

      <div className="welcome-modal__container">
        {/* Tab navigation */}
        <div className="welcome-modal__tabs">
          {steps.map((step, i) => (
            <button
              key={step.id}
              type="button"
              className={`welcome-modal__tab${i === stepIndex ? ' welcome-modal__tab--active' : ''}${i < stepIndex ? ' welcome-modal__tab--done' : ''}`}
              onClick={() => {
                if (i <= stepIndex) setCurrentStep(step.id)
              }}
            >
              <step.icon size={15} strokeWidth={1.5} />
              <span>{step.label}</span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="welcome-modal__body">
          {/* Step 1: Who are you? */}
          {currentStep === 'role' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__hero">
                <div className="welcome-modal__logo-ring">
                  <AntonLogo size={40} />
                </div>
              </div>

              <h1 className="welcome-modal__title">Welcome to Anton</h1>
              <p className="welcome-modal__subtitle">
                This is your AI-powered computer. Tell us a bit about yourself so we can personalize
                your experience.
              </p>

              <div className="welcome-modal__roles">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    className={`welcome-modal__role${selectedRole === role.id ? ' welcome-modal__role--selected' : ''}`}
                    onClick={() => handleRoleSelect(role.id)}
                  >
                    <div className="welcome-modal__role-icon">
                      <role.icon size={18} strokeWidth={1.5} />
                    </div>
                    <div className="welcome-modal__role-text">
                      <span className="welcome-modal__role-label">{role.label}</span>
                      <span className="welcome-modal__role-desc">{role.desc}</span>
                    </div>
                    {selectedRole === role.id && (
                      <div className="welcome-modal__role-check">
                        <Check size={14} strokeWidth={2} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Try these prompts */}
          {currentStep === 'prompts' && (
            <div className="welcome-modal__step">
              <h1 className="welcome-modal__title">{stepTwoHeading}</h1>
              <p className="welcome-modal__subtitle">
                Here are some things you can ask Anton to do. Just type and it handles the rest.
              </p>

              <div className="welcome-modal__prompts">
                {prompts.map((prompt) => (
                  <div key={prompt} className="welcome-modal__prompt">
                    <Rocket size={14} strokeWidth={1.5} className="welcome-modal__prompt-icon" />
                    <span>{prompt}</span>
                  </div>
                ))}
              </div>

              <div className="welcome-modal__info-block">
                <div className="welcome-modal__info-items">
                  <div className="welcome-modal__info-item">
                    <Repeat size={16} strokeWidth={1.5} />
                    <span>Routines run 24/7, even when you're not looking</span>
                  </div>
                  <div className="welcome-modal__info-item">
                    <Zap size={16} strokeWidth={1.5} />
                    <span>Real execution - not just suggestions, actual deployments</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Connectors */}
          {currentStep === 'connectors' && (
            <div className="welcome-modal__step">
              <h1 className="welcome-modal__title">Connect your tools</h1>
              <p className="welcome-modal__subtitle">
                Anton integrates with the tools you already use. Connect them and Anton can read,
                write, and automate across all of them.
              </p>

              <div className="welcome-modal__connectors-grid">
                {connectorShowcase.map((c) => (
                  <div key={c.id} className="welcome-modal__connector">
                    <ConnectorIcon id={c.id} size={22} />
                    <span>{c.name}</span>
                  </div>
                ))}
              </div>

              <div className="welcome-modal__connector-highlight">
                <ConnectorIcon id="telegram" size={20} />
                <div>
                  <span className="welcome-modal__connector-highlight-title">
                    Talk to Anton from anywhere
                  </span>
                  <span className="welcome-modal__connector-highlight-desc">
                    Connect Telegram and message Anton from your phone. It always works, even when
                    your laptop is closed.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Set up model */}
          {currentStep === 'model' && (
            <div className="welcome-modal__step">
              <h1 className="welcome-modal__title">One last thing</h1>
              <p className="welcome-modal__subtitle">
                Anton needs an AI model to work. Click the model selector in the chat input to
                choose your provider and add your API key.
              </p>

              <div className="welcome-modal__screenshot welcome-modal__screenshot--large">
                <img src={modelSelectorImg} alt="Anton chat input with model selector" />
              </div>

              <div className="welcome-modal__setup-note">
                <div className="welcome-modal__provider-logos">
                  <img src={anthropicIcon} alt="Anthropic" width={16} height={16} />
                  <img src={geminiIcon} alt="Google" width={16} height={16} />
                </div>
                <span>
                  Supports Anthropic, OpenAI, Google, Ollama, and any OpenAI-compatible provider.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="welcome-modal__footer">
          {stepIndex > 0 ? (
            <button
              type="button"
              className="welcome-modal__btn welcome-modal__btn--secondary"
              onClick={goBack}
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              className="welcome-modal__btn welcome-modal__btn--primary"
              onClick={() => {
                if (currentStep === 'role' && selectedRole) {
                  goNext()
                } else if (currentStep !== 'role') {
                  goNext()
                }
              }}
              style={{
                opacity: currentStep === 'role' && !selectedRole ? 0.4 : 1,
                pointerEvents: currentStep === 'role' && !selectedRole ? 'none' : 'auto',
              }}
            >
              <span>Next</span>
              <ArrowRight size={16} strokeWidth={1.5} />
            </button>
          ) : (
            <button
              type="button"
              className="welcome-modal__btn welcome-modal__btn--primary"
              onClick={handleGetStarted}
            >
              <span>Get Started</span>
              <ArrowRight size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
