import { Check, ChevronDown, ChevronRight, Key } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { type ProviderInfo, useStore } from '../../lib/store.js'
import { ProviderSettingsModal } from './ProviderSettingsModal.js'

// Provider icon imports (dark theme variants)
import anthropicIcon from '../../assets/llm/anthropic_light.svg'
import deepseekIcon from '../../assets/llm/deepseek.svg'
import geminiIcon from '../../assets/llm/gemini.svg'
import kimiIcon from '../../assets/llm/kimi_light.svg'
import metaIcon from '../../assets/llm/meta_light.svg'
import mistralIcon from '../../assets/llm/mistral.svg'
import openrouterIcon from '../../assets/llm/openrouter_light.svg'
import xaiIcon from '../../assets/llm/xai_light.svg'

const providerIcons: Record<string, string> = {
  anthropic: anthropicIcon,
  google: geminiIcon,
  openrouter: openrouterIcon,
  mistral: mistralIcon,
  deepseek: deepseekIcon,
  meta: metaIcon,
  xai: xaiIcon,
  kimi: kimiIcon,
}

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const icon = providerIcons[provider]
  if (icon) {
    return <img src={icon} alt={provider} width={size} height={size} className="model-selector__provider-icon" />
  }
  return (
    <span className="model-selector__provider-icon-fallback" style={{ width: size, height: size }}>
      {provider.charAt(0).toUpperCase()}
    </span>
  )
}

/** Format model ID into a clean display name: "claude-sonnet-4-6" → "Sonnet 4.6" */
function formatModelName(model: string): string {
  let name = model.split('/').pop() || model

  // Strip provider prefixes
  name = name.replace(/^claude-/, '').replace(/^gpt-/, 'GPT-').replace(/^o(\d)/, 'O$1')

  // Convert version dashes to dots: "4-6" → "4.6", "4-5" → "4.5"
  name = name.replace(/(\d+)-(\d+)(?=$|-)/g, '$1.$2')

  // Remove "-latest" suffix
  name = name.replace(/-latest$/, '')

  // Replace remaining dashes with spaces
  name = name.replace(/-/g, ' ')

  // Capitalize first letter of each word
  name = name.replace(/\b[a-z]/g, (c) => c.toUpperCase())

  return name
}

export function ModelSelector() {
  const currentProvider = useStore((s) => s.currentProvider)
  const currentModel = useStore((s) => s.currentModel)
  const providers = useStore((s) => s.providers)
  const [open, setOpen] = useState(false)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [settingsProvider, setSettingsProvider] = useState<ProviderInfo | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Auto-expand the current provider when dropdown opens
  useEffect(() => {
    if (open) {
      setExpandedProvider(currentProvider)
    }
  }, [open, currentProvider])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = (provider: string, model: string) => {
    const store = useStore.getState()
    store.setCurrentSession(store.currentSessionId || '', provider, model)
    connection.sendProviderSetDefault(provider, model)
    setOpen(false)
  }

  const toggleProvider = (name: string) => {
    setExpandedProvider(expandedProvider === name ? null : name)
  }

  const handleKeyClick = (e: React.MouseEvent, provider: ProviderInfo) => {
    e.stopPropagation()
    setOpen(false) // close dropdown so modal is unobstructed
    setSettingsProvider(provider)
  }

  const handleSettingsClose = () => {
    setSettingsProvider(null)
    // Refresh providers after modal closes in case changes were made
    connection.sendProvidersList()
  }

  const hasAnyKey = providers.some((p: ProviderInfo) => p.hasApiKey)
  const displayModel = hasAnyKey ? formatModelName(currentModel) : 'Select a model'

  // Sort: active provider first, then providers with keys, then the rest
  const sortedProviders = [...providers].sort((a, b) => {
    if (a.name === currentProvider) return -1
    if (b.name === currentProvider) return 1
    if (a.hasApiKey && !b.hasApiKey) return -1
    if (!a.hasApiKey && b.hasApiKey) return 1
    return 0
  })

  return (
    <div className="model-selector" ref={ref}>
      <button type="button" className="model-selector__trigger" onClick={() => setOpen(!open)}>
        {hasAnyKey && <ProviderIcon provider={currentProvider} size={14} />}
        <span className="model-selector__label">{displayModel}</span>
        <ChevronDown className={`model-selector__chevron ${open ? 'model-selector__chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="model-selector__dropdown">
          {sortedProviders.map((provider: ProviderInfo) => {
            const isExpanded = expandedProvider === provider.name
            const hasActiveModel = currentProvider === provider.name

            return (
              <div key={provider.name} className="model-selector__group">
                <button
                  type="button"
                  className={`model-selector__group-header ${hasActiveModel ? 'model-selector__group-header--active' : ''}`}
                  onClick={() => toggleProvider(provider.name)}
                >
                  <ProviderIcon provider={provider.name} size={16} />
                  <span className="model-selector__group-label">{provider.name}</span>
                  <button
                    type="button"
                    className={`model-selector__key-btn ${provider.hasApiKey ? 'model-selector__key-btn--active' : ''}`}
                    onClick={(e) => handleKeyClick(e, provider)}
                    title={provider.hasApiKey ? 'Provider settings' : 'Add API key'}
                  >
                    <Key size={12} />
                  </button>
                  <ChevronRight
                    size={12}
                    className={`model-selector__group-chevron ${isExpanded ? 'model-selector__group-chevron--open' : ''}`}
                  />
                </button>

                {isExpanded && (
                  <div className="model-selector__models">
                    {provider.models.length === 0 ? (
                      <div className="model-selector__no-models">
                        No models available.{' '}
                        <button
                          type="button"
                          className="model-selector__no-models-link"
                          onClick={(e) => handleKeyClick(e, provider)}
                        >
                          Configure provider
                        </button>
                      </div>
                    ) : (
                      provider.models.map((model: string) => {
                        const isActive = currentProvider === provider.name && currentModel === model
                        return (
                          <button
                            type="button"
                            key={`${provider.name}/${model}`}
                            className={`model-selector__option ${isActive ? 'model-selector__option--active' : ''}`}
                            onClick={() => handleSelect(provider.name, model)}
                          >
                            <span className="model-selector__option-name">{formatModelName(model)}</span>
                            {isActive && <Check size={14} className="model-selector__check" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {providers.length === 0 && (
            <div className="model-selector__empty">
              No providers available from server.
            </div>
          )}
        </div>
      )}

      {/* Provider settings modal */}
      <ProviderSettingsModal
        provider={settingsProvider}
        onClose={handleSettingsClose}
      />
    </div>
  )
}
