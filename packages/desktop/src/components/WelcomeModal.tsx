import type React from 'react'
import {
  ArrowRight,
  Bot,
  Briefcase,
  Check,
  FolderOpen,
  GraduationCap,
  Link2,
  Megaphone,
  Plug,
  Rocket,
  Sparkles,
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

const whyAnton = [
  'True agentic AI. Anton doesn\'t just suggest code, it executes, deploys, and manages it.',
  'Always running. Autonomous agents work 24/7 on your server, even when you\'re not looking.',
  'Your server, your data. Everything runs on your machine. No data leaves, no security risks.',
  'Fully open source. No black boxes, no vendor lock-in. You own everything.',
]

const projectFeatures = [
  {
    icon: Bot,
    title: 'Autonomous Agents',
    desc: 'Create agents that run on a schedule. Monitor your servers, scrape data, post reports. They work while you sleep.',
  },
  {
    icon: FolderOpen,
    title: 'Persistent Context',
    desc: 'Every project remembers its files, conversations, and history. Pick up right where you left off.',
  },
  {
    icon: Zap,
    title: 'Real Execution',
    desc: 'Not just suggestions. Projects have real access to your terminal, databases, APIs, and deployment pipelines.',
  },
]

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
  { id: 'role', label: 'About you' },
  { id: 'prompts', label: 'Try these' },
  { id: 'projects', label: 'Projects' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'model', label: 'Setup' },
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
    setTimeout(() => {
      setCurrentStep('prompts')
    }, 200)
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

        {/* Progress dots */}
        <div className="welcome-modal__progress">
          {steps.map((step, i) => (
            <button
              key={step.id}
              type="button"
              className={`welcome-modal__dot${i === stepIndex ? ' welcome-modal__dot--active' : i < stepIndex ? ' welcome-modal__dot--done' : ''}`}
              onClick={() => {
                if (i < stepIndex) setCurrentStep(step.id)
              }}
              aria-label={step.label}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="welcome-modal__body">
          {/* Step 1: Who are you? */}
          {currentStep === 'role' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__hero">
                <div className="welcome-modal__logo-ring">
                  <div className="welcome-modal__logo-glow" />
                  <AntonLogo size={48} />
                </div>

                <h1 className="welcome-modal__title">Welcome to Anton</h1>

                <p className="welcome-modal__subtitle">
                  A computer that thinks. Tell us about yourself so we can personalize your
                  experience.
                </p>
              </div>

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
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Try these prompts + Why Anton */}
          {currentStep === 'prompts' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__section-header">
                <h2>{stepTwoHeading}</h2>
              </div>

              <p className="welcome-modal__section-subtitle">
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

              <div className="welcome-modal__why">
                <span className="welcome-modal__why-title">Why Anton is different</span>
                <div className="welcome-modal__why-items">
                  {whyAnton.map((item) => (
                    <div key={item} className="welcome-modal__why-item">
                      <Check size={14} strokeWidth={2} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Projects */}
          {currentStep === 'projects' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__section-header">
                <FolderOpen size={18} strokeWidth={1.5} />
                <h2>Projects are powerful</h2>
              </div>

              <p className="welcome-modal__section-subtitle">
                Projects are how you organize real work in Anton. Each project gets its own workspace
                with persistent memory, autonomous agents, and full system access.
              </p>

              <div className="welcome-modal__features">
                {projectFeatures.map((feat) => (
                  <div key={feat.title} className="welcome-modal__feature">
                    <div className="welcome-modal__feature-icon">
                      <feat.icon size={18} strokeWidth={1.5} />
                    </div>
                    <div className="welcome-modal__feature-text">
                      <span className="welcome-modal__feature-title">{feat.title}</span>
                      <span className="welcome-modal__feature-desc">{feat.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Connectors */}
          {currentStep === 'connectors' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__section-header">
                <Link2 size={18} strokeWidth={1.5} />
                <h2>Connect your tools</h2>
              </div>

              <p className="welcome-modal__section-subtitle">
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
                  <span className="welcome-modal__connector-highlight-title">Talk to Anton from anywhere</span>
                  <span className="welcome-modal__connector-highlight-desc">
                    Connect Telegram in 2 steps and message Anton from your phone. It always works, even when your laptop is closed.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Set up model */}
          {currentStep === 'model' && (
            <div className="welcome-modal__step">
              <div className="welcome-modal__section-header">
                <User size={18} strokeWidth={1.5} />
                <h2>One last thing</h2>
              </div>

              <p className="welcome-modal__section-subtitle">
                Anton needs an AI model to work. After connecting, click the model selector in the
                chat input to choose your provider and add your API key.
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

        {/* Footer - only show on steps after role selection */}
        {currentStep !== 'role' && (
          <div className="welcome-modal__footer">
            <button
              type="button"
              className="welcome-modal__btn welcome-modal__btn--secondary"
              onClick={goBack}
            >
              Back
            </button>

            {stepIndex < steps.length - 1 ? (
              <button
                type="button"
                className="welcome-modal__btn welcome-modal__btn--primary"
                onClick={goNext}
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
        )}
      </div>
    </div>
  )
}
