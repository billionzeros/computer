import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Check,
  ChevronRight,
  Cpu,
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
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sessionStore } from '../../lib/store/sessionStore.js'
import type { ProviderInfo } from '../../lib/store/types.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { usageStore } from '../../lib/store/usageStore.js'
import { formatModelName, providerIcons } from '../chat/model-utils.js'
import { ConnectorsPage } from '../connectors/ConnectorsPage.js'

type SettingsPage = 'general' | 'models' | 'connectors' | 'usage'

interface Props {
  open: boolean
  onClose: () => void
  initialPage?: SettingsPage
  initialConnectorId?: string
}

const NAV_ITEMS: { key: SettingsPage; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'Settings', icon: <Settings size={16} strokeWidth={1.5} /> },
  { key: 'models', label: 'AI Models', icon: <Cpu size={16} strokeWidth={1.5} /> },
  { key: 'connectors', label: 'Connectors', icon: <Plug size={16} strokeWidth={1.5} /> },
  { key: 'usage', label: 'Usage', icon: <BarChart3 size={16} strokeWidth={1.5} /> },
]

type AppearanceMode = 'light' | 'dark' | 'system'

// ── General Settings Page ──

function GeneralPage() {
  const theme = uiStore((s) => s.theme)
  const setTheme = uiStore((s) => s.setTheme)
  const devMode = uiStore((s) => s.devMode)
  const setDevMode = uiStore((s) => s.setDevMode)

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
              className={`settings-appearance-card${theme === opt.key ? ' settings-appearance-card--active' : ''}`}
              onClick={() => setTheme(opt.key)}
            >
              <div className="settings-appearance-card__preview">
                <div
                  className={`settings-appearance-card__mock settings-appearance-card__mock--${opt.key}`}
                >
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
              Receive early access to feature releases and success stories to optimize your
              workflow.
            </div>
          </div>
          <ToggleSwitch defaultChecked />
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__info">
            <div className="settings-toggle-row__title">Email me when my queued task starts</div>
            <div className="settings-toggle-row__desc">
              When enabled, we'll send you a timely email once your task finishes queuing and begins
              processing.
            </div>
          </div>
          <ToggleSwitch defaultChecked />
        </div>
      </section>

      <div className="settings-divider" />

      {/* Developer Mode */}
      <section className="settings-section">
        <div className="settings-section__label">Advanced</div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row__info">
            <div className="settings-toggle-row__title">Developer Mode</div>
            <div className="settings-toggle-row__desc">
              Show a developer tools button in the toolbar to inspect the system prompt and
              memories.
            </div>
          </div>
          <button
            type="button"
            className={`settings-toggle${devMode ? ' settings-toggle--on' : ''}`}
            onClick={() => setDevMode(!devMode)}
            role="switch"
            aria-checked={devMode}
          >
            <span className="settings-toggle__knob" />
          </button>
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
    return (
      <img
        src={icon}
        alt={provider}
        width={size}
        height={size}
        className="settings-modal__provider-icon"
      />
    )
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
    sessionStore.getState().sendProviderSetKey(provider.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
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
    sessionStore.getState().sendProviderSetModels(provider.name, models)
    setModelsSaved(true)
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
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
              placeholder={
                provider.hasApiKey ? 'Replace existing key...' : 'Paste your API key to get started'
              }
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
              {showKey ? (
                <EyeOff size={14} strokeWidth={1.5} />
              ) : (
                <Eye size={14} strokeWidth={1.5} />
              )}
            </button>
          </div>
          <button
            type="submit"
            disabled={!apiKey.trim()}
            className={`settings-modal__key-save ${keySaved ? 'settings-modal__key-save--saved' : ''}`}
          >
            {keySaved ? (
              <>
                <Check size={14} strokeWidth={1.5} /> Saved
              </>
            ) : (
              'Save'
            )}
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
                  {isActive && (
                    <Check size={14} strokeWidth={1.5} className="settings-modal__check" />
                  )}
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
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleAddModel()
                    }}
                    className="settings-modal__edit-model-add"
                  >
                    <Plus
                      size={14}
                      strokeWidth={1.5}
                      className="settings-modal__edit-model-add-icon"
                    />
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
                    <button
                      type="button"
                      onClick={handleResetModels}
                      className="settings-modal__edit-reset"
                    >
                      <RotateCcw size={12} strokeWidth={1.5} /> Defaults
                    </button>
                  )}
                  {modelsChanged && (
                    <button
                      type="button"
                      onClick={handleSaveModels}
                      className={`settings-modal__edit-save ${modelsSaved ? 'settings-modal__edit-save--saved' : ''}`}
                    >
                      {modelsSaved ? (
                        <>
                          <Check size={14} strokeWidth={1.5} /> Saved
                        </>
                      ) : (
                        'Save changes'
                      )}
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
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const providers = sessionStore((s) => s.providers)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(currentProvider)

  const handleSelect = (provider: string, model: string) => {
    const ss = sessionStore.getState()
    ss.setCurrentSession(ss.currentSessionId || '', provider, model)
    ss.sendProviderSetDefault(provider, model)
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
          <div
            key={provider.name}
            className={`settings-modal__provider-group ${isExpanded ? 'settings-modal__provider-group--expanded' : ''}`}
          >
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
                <span className="settings-modal__badge settings-modal__badge--connected">
                  Connected
                </span>
              ) : (
                <span className="settings-modal__badge settings-modal__badge--setup">
                  Setup required
                </span>
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

// ── Usage Page ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function UsagePage() {
  const usageStats = usageStore((s) => s.usageStats)
  const usageStatsLoading = usageStore((s) => s.usageStatsLoading)
  const requestUsageStats = usageStore((s) => s.requestUsageStats)

  useEffect(() => {
    requestUsageStats()
  }, [requestUsageStats])

  if (usageStatsLoading && !usageStats) {
    return (
      <div className="settings-page">
        <div className="usage-loading">Loading usage data...</div>
      </div>
    )
  }

  if (!usageStats || usageStats.totals.totalTokens === 0) {
    return (
      <div className="settings-page">
        <div className="usage-empty">
          <BarChart3 size={32} strokeWidth={1} />
          <p>No usage data yet</p>
          <span>Token usage will appear here after your first conversation.</span>
        </div>
      </div>
    )
  }

  const { totals, byModel, byDay, sessions } = usageStats

  return (
    <div className="settings-page usage-page">
      {/* Totals */}
      <section className="settings-section">
        <div className="settings-section__label">Total Usage</div>
        <div className="usage-totals">
          <div className="usage-stat-card">
            <div className="usage-stat-card__value">{formatTokens(totals.totalTokens)}</div>
            <div className="usage-stat-card__label">Total Tokens</div>
          </div>
          <div className="usage-stat-card">
            <div className="usage-stat-card__value">{formatTokens(totals.inputTokens)}</div>
            <div className="usage-stat-card__label">Input</div>
          </div>
          <div className="usage-stat-card">
            <div className="usage-stat-card__value">{formatTokens(totals.outputTokens)}</div>
            <div className="usage-stat-card__label">Output</div>
          </div>
          {totals.cacheReadTokens > 0 && (
            <div className="usage-stat-card">
              <div className="usage-stat-card__value">{formatTokens(totals.cacheReadTokens)}</div>
              <div className="usage-stat-card__label">Cache Read</div>
            </div>
          )}
        </div>
      </section>

      <div className="settings-divider" />

      {/* By Model */}
      {byModel.length > 0 && (
        <section className="settings-section">
          <div className="settings-section__label">By Model</div>
          <div className="usage-table">
            <div className="usage-table__header">
              <span>Model</span>
              <span>Tokens</span>
              <span>Sessions</span>
            </div>
            {byModel.map((m) => (
              <div key={m.model} className="usage-table__row">
                <span className="usage-table__model">
                  <code>{formatModelName(m.model)}</code>
                  <span className="usage-table__provider">{m.provider}</span>
                </span>
                <span className="usage-table__tokens">{formatTokens(m.totalTokens)}</span>
                <span className="usage-table__count">{m.sessionCount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="settings-divider" />

      {/* By Day */}
      {byDay.length > 0 && (
        <section className="settings-section">
          <div className="settings-section__label">By Day</div>
          <div className="usage-table">
            <div className="usage-table__header">
              <span>Date</span>
              <span>Tokens</span>
              <span>Sessions</span>
            </div>
            {byDay.slice(0, 14).map((d) => (
              <div key={d.date} className="usage-table__row">
                <span className="usage-table__date">{d.date}</span>
                <span className="usage-table__tokens">{formatTokens(d.totalTokens)}</span>
                <span className="usage-table__count">{d.sessionCount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="settings-divider" />

      {/* Recent Sessions */}
      {sessions.length > 0 && (
        <section className="settings-section">
          <div className="settings-section__label">Recent Sessions</div>
          <div className="usage-table">
            <div className="usage-table__header">
              <span>Session</span>
              <span>Model</span>
              <span>Tokens</span>
            </div>
            {sessions.slice(0, 20).map((s) => (
              <div key={s.id} className="usage-table__row">
                <span className="usage-table__session-title">{s.title || 'Untitled'}</span>
                <span className="usage-table__model-small">
                  <code>{formatModelName(s.model)}</code>
                </span>
                <span className="usage-table__tokens">{formatTokens(s.totalTokens)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Main Settings Modal ──

export function SettingsModal({
  open,
  onClose,
  initialPage = 'general',
  initialConnectorId,
}: Props) {
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
                {activePage === 'connectors' && (
                  <ConnectorsPage initialConnectorId={initialConnectorId} onConnected={onClose} />
                )}
                {activePage === 'usage' && <UsagePage />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
