import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  LogOut,
  Monitor,
  Moon,
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

type SettingsPage = 'general' | 'models' | 'usage'

interface Props {
  open: boolean
  onClose: () => void
  onDisconnect: () => void
  initialPage?: SettingsPage
}

const NAV_ITEMS: { key: SettingsPage; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'Settings', icon: <Settings size={16} strokeWidth={1.5} /> },
  { key: 'models', label: 'AI Models', icon: <Cpu size={16} strokeWidth={1.5} /> },
  { key: 'usage', label: 'Usage', icon: <BarChart3 size={16} strokeWidth={1.5} /> },
]

type AppearanceMode = 'light' | 'dark' | 'system'

// ── General Settings Page ──

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function tzLabel(tz: string): string {
  try {
    const now = new Date()
    const offset =
      new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
    return `${city} (${offset})`
  } catch {
    return tz
  }
}

function GeneralPage({ onDisconnect }: { onDisconnect: () => void }) {
  const theme = uiStore((s) => s.theme)
  const setTheme = uiStore((s) => s.setTheme)
  const devMode = uiStore((s) => s.devMode)
  const setDevMode = uiStore((s) => s.setDevMode)
  const timezone = uiStore((s) => s.timezone)
  const setTimezone = uiStore((s) => s.setTimezone)
  const notificationsEnabled = uiStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = uiStore((s) => s.setNotificationsEnabled)

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

      {/* Timezone */}
      <section className="settings-section">
        <div className="settings-section__title">Timezone</div>
        <div className="settings-section__desc">Used for agent schedules and displaying times.</div>
        <div className="settings-select-wrap">
          <select
            className="settings-select"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {/* Show current timezone first if not in the common list */}
            {!COMMON_TIMEZONES.includes(timezone) && (
              <option value={timezone}>{tzLabel(timezone)}</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tzLabel(tz)}
              </option>
            ))}
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
            <div className="settings-toggle-row__title">Task completion notifications</div>
            <div className="settings-toggle-row__desc">
              Show a desktop notification when Anton finishes a task and the window is not focused.
            </div>
          </div>
          <button
            type="button"
            className={`settings-toggle${notificationsEnabled ? ' settings-toggle--on' : ''}`}
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            role="switch"
            aria-checked={notificationsEnabled}
          >
            <span className="settings-toggle__knob" />
          </button>
        </div>

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

      <div className="settings-divider" />

      {/* Disconnect from machine */}
      <section className="settings-section">
        <button
          type="button"
          className="settings-disconnect-btn"
          onClick={onDisconnect}
        >
          <LogOut size={18} strokeWidth={1.5} />
          Disconnect from machine
        </button>
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

/** Well-known model prefix → group label for providers without slash-based grouping */
const MODEL_PREFIX_GROUPS: [RegExp, string][] = [
  [/^gpt-|^o[34]/i, 'OpenAI'],
  [/^claude-/i, 'Anthropic'],
  [/^gemini-/i, 'Google'],
  [/^deepseek-/i, 'DeepSeek'],
  [/^grok-/i, 'xAI'],
  [/^qwen/i, 'Qwen'],
  [/^minimax-/i, 'MiniMax'],
  [/^kimi-/i, 'Kimi'],
  [/^llama-|^llama\d/i, 'Meta'],
  [/^mistral-|^codestral/i, 'Mistral'],
  [/^glm-/i, 'GLM'],
]

function inferGroup(modelId: string): string {
  for (const [re, label] of MODEL_PREFIX_GROUPS) {
    if (re.test(modelId)) return label
  }
  return 'Other'
}

/** Group models by provider — uses slash prefix (openrouter) or name heuristics (anton) */
function groupModels(modelIds: string[]): { label: string | null; models: string[] }[] {
  if (modelIds.length <= 6) return [{ label: null, models: modelIds }]

  const groups = new Map<string, string[]>()
  const hasSlash = modelIds.some((m) => m.includes('/'))

  for (const m of modelIds) {
    let key: string
    if (hasSlash) {
      const slash = m.indexOf('/')
      key = slash > 0 ? m.slice(0, slash) : '_other'
    } else {
      key = inferGroup(m)
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  return Array.from(groups.entries()).map(([key, models]) => ({
    label: key === '_other' ? 'Other' : hasSlash ? key.charAt(0).toUpperCase() + key.slice(1) : key,
    models,
  }))
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
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [models, setModels] = useState<string[]>([...provider.models])
  const [newModel, setNewModel] = useState('')
  const [modelsSaved, setModelsSaved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const modelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setApiKey('')
    setKeySaved(false)
    setShowKey(false)
    setShowKeyInput(false)
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

  const modelGroups = groupModels(provider.models)

  const keyForm = (
    <form onSubmit={handleKeySubmit} className="provider-detail__key-form">
      <div className="provider-detail__key-input-wrap">
        <input
          type={showKey ? 'text' : 'password'}
          className="provider-detail__key-input"
          placeholder={
            provider.hasApiKey ? 'Enter new API key...' : 'Paste your API key to get started'
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="provider-detail__key-eye"
          onClick={() => setShowKey(!showKey)}
          tabIndex={-1}
        >
          {showKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
        </button>
      </div>
      <button
        type="submit"
        disabled={!apiKey.trim()}
        className={`provider-detail__key-save ${keySaved ? 'provider-detail__key-save--saved' : ''}`}
      >
        {keySaved ? (
          <>
            <Check size={14} strokeWidth={1.5} /> Saved
          </>
        ) : (
          'Save'
        )}
      </button>
      {provider.hasApiKey && showKeyInput && (
        <button
          type="button"
          className="provider-detail__key-cancel"
          onClick={() => {
            setShowKeyInput(false)
            setApiKey('')
          }}
        >
          Cancel
        </button>
      )}
    </form>
  )

  return (
    <div className="provider-detail">
      {/* API Key — collapsed when already configured */}
      {provider.hasApiKey && !showKeyInput ? (
        <div className="provider-detail__key-status">
          <div className="provider-detail__key-status-left">
            <Check size={14} strokeWidth={1.5} className="provider-detail__key-status-icon" />
            <span>API key configured</span>
          </div>
          <button
            type="button"
            className="provider-detail__key-change"
            onClick={() => setShowKeyInput(true)}
          >
            Change key
          </button>
        </div>
      ) : (
        <div className="provider-detail__key">
          {!provider.hasApiKey && <div className="provider-detail__key-label">API Key</div>}
          {keyForm}
        </div>
      )}

      {/* Models */}
      {(provider.hasApiKey || keySaved) && (
        <div className="provider-detail__models">
          <div className="provider-detail__models-top">
            <span className="provider-detail__models-label">
              Select a model
              <span className="provider-detail__models-count">{provider.models.length}</span>
            </span>
          </div>

          <div className="provider-detail__model-groups">
            {modelGroups.map((group) => (
              <div key={group.label || '_'} className="provider-detail__model-group">
                {group.label && <div className="provider-detail__group-label">{group.label}</div>}
                <div className="provider-detail__model-list">
                  {group.models.map((model) => {
                    const isActive = currentProvider === provider.name && currentModel === model
                    return (
                      <button
                        type="button"
                        key={model}
                        className={`provider-detail__model-card${isActive ? ' provider-detail__model-card--active' : ''}`}
                        onClick={() => onSelectModel(provider.name, model)}
                      >
                        <div className="provider-detail__model-info">
                          <span className="provider-detail__model-name">
                            {formatModelName(model)}
                          </span>
                          <code className="provider-detail__model-id">{model}</code>
                        </div>
                        {isActive && (
                          <div className="provider-detail__model-active">
                            <Check size={12} strokeWidth={2} />
                            Active
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit models */}
      {(provider.hasApiKey || keySaved) && (
        <div className="provider-detail__edit">
          <button
            type="button"
            className="provider-detail__edit-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <ChevronRight
              size={12}
              strokeWidth={1.5}
              className={`provider-detail__edit-chevron ${showAdvanced ? 'provider-detail__edit-chevron--open' : ''}`}
            />
            Edit models
          </button>

          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                className="provider-detail__edit-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div className="provider-detail__edit-list">
                  {models.map((model, index) => (
                    <div key={model} className="provider-detail__edit-row">
                      <code className="provider-detail__edit-id">{model}</code>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(index)}
                        className="provider-detail__edit-delete"
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
                    className="provider-detail__edit-add"
                  >
                    <Plus size={14} strokeWidth={1.5} className="provider-detail__edit-add-icon" />
                    <input
                      ref={modelInputRef}
                      type="text"
                      className="provider-detail__edit-add-input"
                      placeholder="model-id"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      spellCheck={false}
                    />
                  </form>
                </div>
                <div className="provider-detail__edit-actions">
                  {provider.defaultModels && provider.defaultModels.length > 0 && (
                    <button
                      type="button"
                      onClick={handleResetModels}
                      className="provider-detail__edit-reset"
                    >
                      <RotateCcw size={12} strokeWidth={1.5} /> Defaults
                    </button>
                  )}
                  {modelsChanged && (
                    <button
                      type="button"
                      onClick={handleSaveModels}
                      className={`provider-detail__edit-save ${modelsSaved ? 'provider-detail__edit-save--saved' : ''}`}
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
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)

  const handleSelect = (provider: string, model: string) => {
    const ss = sessionStore.getState()
    ss.setCurrentSession(ss.currentSessionId || '', provider, model)
    ss.sendProviderSetDefault(provider, model)
    onClose()
  }

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.hasApiKey && !b.hasApiKey) return -1
    if (!a.hasApiKey && b.hasApiKey) return 1
    return 0
  })

  const selected = providers.find((p) => p.name === selectedProvider)

  // Detail view for a selected provider
  if (selected) {
    return (
      <div className="models-detail">
        <button
          type="button"
          className="models-detail__back"
          onClick={() => setSelectedProvider(null)}
        >
          <ChevronRight size={14} strokeWidth={1.5} className="models-detail__back-icon" />
          All Providers
        </button>

        <div className="models-detail__header">
          <div className="models-detail__icon-wrap">
            <ProviderIcon provider={selected.name} size={28} />
          </div>
          <div className="models-detail__header-info">
            <h3 className="models-detail__title">
              {selected.name.charAt(0).toUpperCase() + selected.name.slice(1)}
            </h3>
            <span className="models-detail__subtitle">
              {selected.hasApiKey
                ? `${selected.models.length} models available`
                : 'Add your API key to get started'}
            </span>
          </div>
          {selected.hasApiKey ? (
            <span className="settings-modal__badge settings-modal__badge--connected">
              Connected
            </span>
          ) : (
            <span className="settings-modal__badge settings-modal__badge--setup">
              Setup required
            </span>
          )}
        </div>

        <ProviderPanel
          provider={selected}
          currentProvider={currentProvider}
          currentModel={currentModel}
          onSelectModel={handleSelect}
        />
      </div>
    )
  }

  // Provider grid view
  const connected = sortedProviders.filter((p) => p.hasApiKey)
  const available = sortedProviders.filter((p) => !p.hasApiKey)

  return (
    <div className="models-grid-page">
      {connected.length > 0 && (
        <div className="models-grid-section">
          <div className="models-grid-section__label">Connected</div>
          <div className="models-provider-grid">
            {connected.map((provider) => {
              const isActive = currentProvider === provider.name
              return (
                <button
                  key={provider.name}
                  type="button"
                  className={`models-provider-card${isActive ? ' models-provider-card--active' : ''}`}
                  onClick={() => setSelectedProvider(provider.name)}
                >
                  <div className="models-provider-card__icon-wrap">
                    <ProviderIcon provider={provider.name} size={22} />
                  </div>
                  <div className="models-provider-card__info">
                    <div className="models-provider-card__name">
                      {provider.name.charAt(0).toUpperCase() + provider.name.slice(1)}
                      <span className="models-provider-card__dot" title="Connected" />
                    </div>
                    <div className="models-provider-card__count">
                      {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
                      {isActive && (
                        <span className="models-provider-card__active-badge">Active</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    size={14}
                    strokeWidth={1.5}
                    className="models-provider-card__chevron"
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {available.length > 0 && (
        <div className="models-grid-section">
          <div className="models-grid-section__label">Available</div>
          <div className="models-provider-grid">
            {available.map((provider) => (
              <button
                key={provider.name}
                type="button"
                className="models-provider-card"
                onClick={() => setSelectedProvider(provider.name)}
              >
                <div className="models-provider-card__icon-wrap">
                  <ProviderIcon provider={provider.name} size={22} />
                </div>
                <div className="models-provider-card__info">
                  <div className="models-provider-card__name">
                    {provider.name.charAt(0).toUpperCase() + provider.name.slice(1)}
                  </div>
                  <div className="models-provider-card__count">
                    {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <ChevronRight
                  size={14}
                  strokeWidth={1.5}
                  className="models-provider-card__chevron"
                />
              </button>
            ))}
          </div>
        </div>
      )}

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

export function SettingsModal({ open, onClose, onDisconnect, initialPage = 'general' }: Props) {
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
                {activePage === 'general' && <GeneralPage onDisconnect={() => { onClose(); onDisconnect(); }} />}
                {activePage === 'models' && <ModelsPage onClose={onClose} />}
                {activePage === 'usage' && <UsagePage />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
