import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import type { ProviderInfo } from '../../lib/store.js'
import { Modal } from '../ui/Modal.js'

// Provider icon imports
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

interface Props {
  provider: ProviderInfo | null
  onClose: () => void
}

export function ProviderSettingsModal({ provider, onClose }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [newModel, setNewModel] = useState('')
  const [modelsSaved, setModelsSaved] = useState(false)
  const modelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (provider) {
      setModels([...provider.models])
      setApiKey('')
      setKeySaved(false)
      setModelsSaved(false)
      setNewModel('')
    }
  }, [provider])

  if (!provider) return null

  const icon = providerIcons[provider.name]
  const providerLabel = provider.name.charAt(0).toUpperCase() + provider.name.slice(1)

  const handleSaveKey = () => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    connection.sendProviderSetKey(provider.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    // Refresh providers to pick up new key status
    setTimeout(() => connection.sendProvidersList(), 300)
    setTimeout(() => setKeySaved(false), 2000)
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

  const handleAddModelSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleAddModel()
  }

  const handleResetModels = () => {
    const defaults = provider.defaultModels
    if (defaults && defaults.length > 0) {
      setModels([...defaults])
      setModelsSaved(false)
    }
  }

  const handleSaveModels = () => {
    connection.sendProviderSetModels(provider.name, models)
    setModelsSaved(true)
    // Refresh providers so the dropdown picks up the new models
    setTimeout(() => connection.sendProvidersList(), 300)
    setTimeout(() => setModelsSaved(false), 2000)
  }

  const modelsChanged =
    models.length !== provider.models.length ||
    models.some((m, i) => m !== provider.models[i])

  return (
    <Modal open={!!provider} onClose={onClose}>
      <div className="prov-modal">
        {/* Title bar with icon */}
        <div className="prov-modal__titlebar">
          <div className="prov-modal__titlebar-left">
            {icon ? (
              <img src={icon} alt="" width={20} height={20} className="prov-modal__provider-icon" />
            ) : (
              <span className="prov-modal__provider-icon-fallback">
                {provider.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="prov-modal__provider-name">{providerLabel}</span>
            {provider.baseUrl && (
              <span className="prov-modal__provider-url">{provider.baseUrl}</span>
            )}
          </div>
          {(provider.hasApiKey || keySaved) && (
            <span className="prov-modal__connected-badge">
              <span className="prov-modal__connected-dot" />
              Connected
            </span>
          )}
        </div>

        {/* API Key */}
        <div className="prov-modal__section">
          <label className="prov-modal__field-label">API Key</label>
          <form onSubmit={handleKeySubmit} className="prov-modal__key-row">
            <input
              type="password"
              className="prov-modal__key-input"
              placeholder={provider.hasApiKey ? 'Replace existing key...' : 'sk-or-v1-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={!apiKey.trim()}
              className={`prov-modal__key-btn ${keySaved ? 'prov-modal__key-btn--saved' : ''}`}
            >
              {keySaved ? <><Check size={14} /> Saved</> : 'Save key'}
            </button>
          </form>
        </div>

        {/* Models */}
        <div className="prov-modal__section">
          <div className="prov-modal__field-header">
            <label className="prov-modal__field-label">Models</label>
            {(provider.defaultModels && provider.defaultModels.length > 0) && (
              <button type="button" onClick={handleResetModels} className="prov-modal__reset">
                <RotateCcw size={11} /> Defaults
              </button>
            )}
          </div>

          <div className="prov-modal__models">
            {models.length === 0 && (
              <div className="prov-modal__models-empty">
                No models. Add one below or click Defaults.
              </div>
            )}
            {models.map((model, index) => (
              <div key={model} className="prov-modal__model-row">
                <code className="prov-modal__model-id">{model}</code>
                <button
                  type="button"
                  onClick={() => handleRemoveModel(index)}
                  className="prov-modal__model-delete"
                  title="Remove model"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <form onSubmit={handleAddModelSubmit} className="prov-modal__model-add-row">
              <Plus size={13} className="prov-modal__model-add-plus" />
              <input
                ref={modelInputRef}
                type="text"
                className="prov-modal__model-add-input"
                placeholder="model-id or provider/model-id"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                spellCheck={false}
              />
            </form>
          </div>
        </div>

        {/* Footer */}
        {modelsChanged && (
          <div className="prov-modal__footer">
            <button
              type="button"
              onClick={handleSaveModels}
              className={`prov-modal__save-btn ${modelsSaved ? 'prov-modal__save-btn--saved' : ''}`}
            >
              {modelsSaved ? <><Check size={14} /> Models saved</> : 'Save model changes'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
