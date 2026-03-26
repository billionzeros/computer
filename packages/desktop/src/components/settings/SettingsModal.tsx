import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Monitor,
  Moon,
  Plug,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  X,
  Cpu,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { type ProviderInfo, useStore } from '../../lib/store.js'
import { formatModelName, providerIcons } from '../chat/model-utils.js'
import { ConnectorsPage } from '../connectors/ConnectorsPage.js'

type SettingsPage = 'general' | 'models' | 'connectors'

interface Props {
  open: boolean
  onClose: () => void
  initialPage?: SettingsPage
}

const NAV_ITEMS: { key: SettingsPage; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'Settings', icon: <Settings size={16} strokeWidth={1.5} /> },
  { key: 'models', label: 'AI Models', icon: <Cpu size={16} strokeWidth={1.5} /> },
  { key: 'connectors', label: 'Connectors', icon: <Plug size={16} strokeWidth={1.5} /> },
]

type AppearanceMode = 'light' | 'dark' | 'system'

// ── General Settings Page ──

function GeneralPage() {
  const [appearance, setAppearance] = useState<AppearanceMode>('dark')

  const appearanceOptions: { key: AppearanceMode; label: string; icon: React.ReactNode }[] = [
    { key: 'light', label: 'Light', icon: <Sun size={16} strokeWidth={1.5} /> },
    { key: 'dark', label: 'Dark', icon: <Moon size={16} strokeWidth={1.5} /> },
    { key: 'system', label: 'Follow System', icon: <Monitor size={16} strokeWidth={1.5} /> },
  ]

  return (
    <div className="settings-page">
      {/* Language */}
      <section className="settings-section">
        <div className="settings-section__label">General</div>
        <div className="settings-section__title">Language</div>
        <div className="settings-select-wrap">
          <select className="settings-select" defaultValue="en">
            <option value="en">English</option>
          </select>
        </div>
      </section>

      <div className="settings-divider" />

      {/* Appearance */}
      <section className="settings-section">
        <div className="settings-section__title">Appearance</div>
        <div className="settings-appearance-grid">
          {appearanceOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`settings-appearance-card${appearance === opt.key ? ' settings-appearance-card--active' : ''}`}
              onClick={() => setAppearance(opt.key)}
            >
              <div className="settings-appearance-card__preview">
                <div className={`settings-appearance-card__mock settings-appearance-card__mock--${opt.key}`}>
                  <div className="settings-appearance-card__mock-line settings-appearance-card__mock-line--long" />
                  <div className="settings-appearance-card__mock-line settings-appearance-card__mock-line--short" />
                  <div className="settings-appearance-card__mock-line settings-appearance-card__mock-line--medium" />
                </div>
              </div>
              <span className="settings-appearance-card__label">{opt.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="settings-divider" />

      {/* Communication preferences */}
      <section className="settings-section">
        <div className="settings-section__label">Communication preferences</div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__info">
            <div className="settings-toggle-row__title">Receive product updates</div>
            <div className="settings-toggle-row__desc">
              Receive early access to feature releases and success stories to optimize your workflow.
            </div>
          </div>
          <ToggleSwitch defaultChecked />
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__info">
            <div className="settings-toggle-row__title">Email me when my queued task starts</div>
            <div className="settings-toggle-row__desc">
              When enabled, we'll send you a timely email once your task finishes queuing and begins processing.
            </div>
          </div>
          <ToggleSwitch defaultChecked />
        </div>
      </section>
    </div>
  )
}

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked)
  return (
    <button
      type="button"
      className={`settings-toggle${checked ? ' settings-toggle--on' : ''}`}
      onClick={() => setChecked(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="settings-toggle__knob" />
    </button>
  )
}

// ── Provider helpers (unchanged) ──

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const icon = providerIcons[provider]
  if (icon) {
    return <img src={icon} alt={provider} width={size} height={size} className="settings-modal__provider-icon" />
  }
  return (
    <span className="settings-modal__provider-icon-fallback" style={{ width: size, height: size }}>
      {provider.charAt(0).toUpperCase()}
    </span>
  )
}

function ProviderPanel({
  provider,
  currentProvider,
  currentModel,
  onSelectModel,
}: {
  provider: ProviderInfo
  currentProvider: string
  currentModel: string
  onSelectModel: (provider: string, model: string) => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([...provider.models])
  const [newModel, setNewModel] = useState('')
  const [modelsSaved, setModelsSaved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const modelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setApiKey('')
    setKeySaved(false)
    setShowKey(false)
    setModels([...provider.models])
    setModelsSaved(false)
    setNewModel('')
    setShowAdvanced(false)
  }, [provider])

  const handleSaveKey = () => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    connection.sendProviderSetKey(provider.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    setTimeout(() => connection.sendProvidersList(), 300)
    setTimeout(() => setKeySaved(false), 2500)
  }

  const handleKeySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSaveKey()
  }

  const handleRemoveModel = (index: number) => {
    setModels((prev) => prev.filter((_, i) => i !== index))
    setModelsSaved(false)
  }

  const handleAddModel = () => {
    const trimmed = newModel.trim()
    if (!trimmed || models.includes(trimmed)) return
    setModels((prev) => [...prev, trimmed])
    setNewModel('')
    setModelsSaved(false)
    modelInputRef.current?.focus()
  }

  const handleResetModels = () => {
    if (provider.defaultModels?.length) {
      setModels([...provider.defaultModels])
      setModelsSaved(false)
    }
  }

  const handleSaveModels = () => {
    connection.sendProviderSetModels(provider.name, models)
    setModelsSaved(true)
    setTimeout(() => connection.sendProvidersList(), 300)
    setTimeout(() => setModelsSaved(false), 2500)
  }

  const modelsChanged =
    models.length !== provider.models.length || models.some((m, i) => m !== provider.models[i])

  return (
    <div className="settings-modal__panel">
      <div className="settings-modal__key-section">
        <form onSubmit={handleKeySubmit} className="settings-modal__key-form">
          <div className="settings-modal__key-input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              className="settings-modal__key-input"
              placeholder={provider.hasApiKey ? 'Replace existing key...' : 'Paste your API key to get started'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="settings-modal__key-toggle"
              onClick={() => setShowKey(!showKey)}
              tabIndex={-1}
            >
              {showKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
            </button>
          </div>
          <button
            type="submit"
            disabled={!apiKey.trim()}
            className={`settings-modal__key-save ${keySaved ? 'settings-modal__key-save--saved' : ''}`}
          >
            {keySaved ? <><Check size={14} strokeWidth={1.5} /> Saved</> : 'Save'}
          </button>
        </form>
      </div>

      {(provider.hasApiKey || keySaved) && (
        <div className="settings-modal__models-section">
          <div className="settings-modal__models-header">
            <span className="settings-modal__models-label">Models</span>
          </div>
          <div className="settings-modal__models-list">
            {provider.models.map((model) => {
              const isActive = currentProvider === provider.name && currentModel === model
              return (
                <button
                  type="button"
                  key={`${provider.name}/${model}`}
                  className={`settings-modal__model-option ${isActive ? 'settings-modal__model-option--active' : ''}`}
                  onClick={() => onSelectModel(provider.name, model)}
                >
                  <span className="settings-modal__model-name">{formatModelName(model)}</span>
                  <code className="settings-modal__model-id">{model}</code>
                  {isActive && <Check size={14} strokeWidth={1.5} className="settings-modal__check" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {(provider.hasApiKey || keySaved) && (
        <div className="settings-modal__advanced">
          <button
            type="button"
            className="settings-modal__advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <ChevronRight
              size={12}
              strokeWidth={1.5}
              className={`settings-modal__advanced-chevron ${showAdvanced ? 'settings-modal__advanced-chevron--open' : ''}`}
            />
            Edit models
          </button>

          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                className="settings-modal__advanced-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div className="settings-modal__edit-models">
                  {models.map((model, index) => (
                    <div key={model} className="settings-modal__edit-model-row">
                      <code className="settings-modal__edit-model-id">{model}</code>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(index)}
                        className="settings-modal__edit-model-delete"
                        title="Remove model"
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleAddModel() }}
                    className="settings-modal__edit-model-add"
                  >
                    <Plus size={14} strokeWidth={1.5} className="settings-modal__edit-model-add-icon" />
                    <input
                      ref={modelInputRef}
                      type="text"
                      className="settings-modal__edit-model-add-input"
                      placeholder="model-id"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      spellCheck={false}
                    />
                  </form>
                </div>
                <div className="settings-modal__edit-actions">
                  {provider.defaultModels && provider.defaultModels.length > 0 && (
                    <button type="button" onClick={handleResetModels} className="settings-modal__edit-reset">
                      <RotateCcw size={12} strokeWidth={1.5} /> Defaults
                    </button>
                  )}
                  {modelsChanged && (
                    <button
                      type="button"
                      onClick={handleSaveModels}
                      className={`settings-modal__edit-save ${modelsSaved ? 'settings-modal__edit-save--saved' : ''}`}
                    >
                      {modelsSaved ? <><Check size={14} strokeWidth={1.5} /> Saved</> : 'Save changes'}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function ModelsPage({ onClose }: { onClose: () => void }) {
  const currentProvider = useStore((s) => s.currentProvider)
  const currentModel = useStore((s) => s.currentModel)
  const providers = useStore((s) => s.providers)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(currentProvider)

  const handleSelect = (provider: string, model: string) => {
    const store = useStore.getState()
    store.setCurrentSession(store.currentSessionId || '', provider, model)
    connection.sendProviderSetDefault(provider, model)
    onClose()
  }

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.name === currentProvider) return -1
    if (b.name === currentProvider) return 1
    if (a.hasApiKey && !b.hasApiKey) return -1
    if (!a.hasApiKey && b.hasApiKey) return 1
    return 0
  })

  return (
    <div className="settings-modal__models">
      {sortedProviders.map((provider) => {
        const isExpanded = expandedProvider === provider.name
        const hasActiveModel = currentProvider === provider.name

        return (
          <div key={provider.name} className={`settings-modal__provider-group ${isExpanded ? 'settings-modal__provider-group--expanded' : ''}`}>
            <button
              type="button"
              className={`settings-modal__provider-header ${hasActiveModel ? 'settings-modal__provider-header--active' : ''}`}
              onClick={() => setExpandedProvider(isExpanded ? null : provider.name)}
            >
              <ProviderIcon provider={provider.name} size={20} />
              <span className="settings-modal__provider-name">
                {provider.name.charAt(0).toUpperCase() + provider.name.slice(1)}
              </span>
              {provider.hasApiKey ? (
                <span className="settings-modal__badge settings-modal__badge--connected">Connected</span>
              ) : (
                <span className="settings-modal__badge settings-modal__badge--setup">Setup required</span>
              )}
              <ChevronRight
                size={14}
                strokeWidth={1.5}
                className={`settings-modal__provider-chevron ${isExpanded ? 'settings-modal__provider-chevron--open' : ''}`}
              />
            </button>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  className="settings-modal__provider-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <ProviderPanel
                    provider={provider}
                    currentProvider={currentProvider}
                    currentModel={currentModel}
                    onSelectModel={handleSelect}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}

      {providers.length === 0 && (
        <div className="settings-modal__empty">No providers available from server.</div>
      )}
    </div>
  )
}

// ── Main Settings Modal ──

export function SettingsModal({ open, onClose, initialPage = 'general' }: Props) {
  const [activePage, setActivePage] = useState<SettingsPage>(initialPage)

  // Reset to initial page when modal opens
  useEffect(() => {
    if (open) setActivePage(initialPage)
  }, [open, initialPage])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="modal-backdrop__overlay"
            role="button"
            tabIndex={0}
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
          />

          <motion.div
            className="settings-modal"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Sidebar */}
            <div className="settings-modal__sidebar">
              <h2 className="settings-modal__sidebar-title">Settings</h2>
              <nav className="settings-modal__nav">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`settings-modal__nav-item${activePage === item.key ? ' settings-modal__nav-item--active' : ''}`}
                    onClick={() => setActivePage(item.key)}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Content */}
            <div className="settings-modal__content">
              <button type="button" onClick={onClose} className="settings-modal__close">
                <X size={18} strokeWidth={1.5} />
              </button>

              <div className="settings-modal__content-body">
                {activePage === 'general' && <GeneralPage />}
                {activePage === 'models' && <ModelsPage onClose={onClose} />}
                {activePage === 'connectors' && <ConnectorsPage />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
