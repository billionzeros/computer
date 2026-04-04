import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProviderInfo } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { Modal } from '../ui/Modal.js'
import { providerIcons } from './model-utils.js'

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
    sessionStore.getState().sendProviderSetKey(provider.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    // Refresh providers to pick up new key status
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
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
    sessionStore.getState().sendProviderSetModels(provider.name, models)
    setModelsSaved(true)
    // Refresh providers so the dropdown picks up the new models
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
    setTimeout(() => setModelsSaved(false), 2000)
  }

  const modelsChanged =
    models.length !== provider.models.length || models.some((m, i) => m !== provider.models[i])

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
          <label className="prov-modal__field-label" htmlFor="prov-api-key">
            API Key
          </label>
          <form onSubmit={handleKeySubmit} className="prov-modal__key-row">
            <input
              id="prov-api-key"
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
              {keySaved ? (
                <>
                  <Check size={14} strokeWidth={1.5} /> Saved
                </>
              ) : (
                'Save key'
              )}
            </button>
          </form>
        </div>

        {/* Models */}
        <div className="prov-modal__section">
          <div className="prov-modal__field-header">
            <span className="prov-modal__field-label">Models</span>
            {provider.defaultModels && provider.defaultModels.length > 0 && (
              <button type="button" onClick={handleResetModels} className="prov-modal__reset">
                <RotateCcw size={12} strokeWidth={1.5} /> Defaults
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
                  <Trash2 size={12} strokeWidth={1.5} />
                </button>
              </div>
            ))}
            <form onSubmit={handleAddModelSubmit} className="prov-modal__model-add-row">
              <Plus size={14} strokeWidth={1.5} className="prov-modal__model-add-plus" />
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
              {modelsSaved ? (
                <>
                  <Check size={14} strokeWidth={1.5} /> Models saved
                </>
              ) : (
                'Save model changes'
              )}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
