import { ArrowRight, Check, Plus, RotateCcw, X } from 'lucide-react'
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
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (provider) {
      setModels([...provider.models])
      setApiKey('')
      setKeySaved(false)
      setNewModel('')
    }
  }, [provider])

  if (!provider) return null

  const icon = providerIcons[provider.name]
  const label = provider.name.charAt(0).toUpperCase() + provider.name.slice(1)
  const connected = provider.hasApiKey || keySaved

  const commitModels = (next: string[]) => {
    setModels(next)
    sessionStore.getState().sendProviderSetModels(provider.name, next)
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
  }

  const saveKey = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    sessionStore.getState().sendProviderSetKey(provider.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    setTimeout(() => sessionStore.getState().sendProvidersList(), 300)
    setTimeout(() => setKeySaved(false), 1800)
  }

  const addModel = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newModel.trim()
    if (!trimmed || models.includes(trimmed)) return
    commitModels([...models, trimmed])
    setNewModel('')
    addInputRef.current?.focus()
  }

  const removeModel = (id: string) => {
    commitModels(models.filter((m) => m !== id))
  }

  const resetDefaults = () => {
    const defaults = provider.defaultModels
    if (defaults?.length) commitModels([...defaults])
  }

  const defaultsAvailable = (provider.defaultModels?.length ?? 0) > 0
  const isAtDefaults =
    defaultsAvailable &&
    provider.defaultModels!.length === models.length &&
    provider.defaultModels!.every((m, i) => m === models[i])

  return (
    <Modal open={!!provider} onClose={onClose}>
      <div className="pform">
        <header className="pform__head">
          {icon ? (
            <img src={icon} alt="" width={22} height={22} className="pform__icon" />
          ) : (
            <span className="pform__icon pform__icon--fallback">
              {provider.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="pform__title">{label}</span>
          {connected && <span className="pform__dot" title="Connected" />}
        </header>

        <form onSubmit={saveKey} className="pform__key">
          <input
            type="password"
            className="pform__key-input"
            placeholder={provider.hasApiKey ? 'Replace API key…' : 'Paste API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={!apiKey.trim() && !keySaved}
            className="pform__key-btn"
            aria-label={keySaved ? 'Saved' : 'Save key'}
          >
            {keySaved ? (
              <Check size={14} strokeWidth={2} />
            ) : (
              <ArrowRight size={14} strokeWidth={2} />
            )}
          </button>
        </form>

        <ul className="pform__list">
          {models.map((m) => (
            <li key={m} className="pform__row">
              <span className="pform__row-id">{m}</span>
              <button
                type="button"
                className="pform__row-x"
                onClick={() => removeModel(m)}
                aria-label={`Remove ${m}`}
              >
                <X size={13} strokeWidth={1.8} />
              </button>
            </li>
          ))}
          <li className="pform__row pform__row--add">
            <Plus size={12} strokeWidth={2} className="pform__row-plus" />
            <form onSubmit={addModel} className="pform__row-form">
              <input
                ref={addInputRef}
                type="text"
                className="pform__row-input"
                placeholder="add model"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                spellCheck={false}
              />
            </form>
          </li>
        </ul>

        {defaultsAvailable && !isAtDefaults && (
          <button type="button" onClick={resetDefaults} className="pform__reset">
            <RotateCcw size={11} strokeWidth={1.8} />
            Reset to defaults
          </button>
        )}
      </div>
    </Modal>
  )
}
