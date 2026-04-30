import { ArrowRight, Check, ChevronDown, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderInfo } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { Modal } from '../ui/Modal.js'
import {
  classifyModelTag,
  formatModelName,
  providerDisplayName,
  providerIcons,
} from './model-utils.js'

interface Props {
  provider: ProviderInfo | null
  onClose: () => void
}

export function ProviderSettingsModal({ provider, onClose }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsOpen, setModelsOpen] = useState(false)
  const relistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFlagTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live snapshot from the store so that hasApiKey / defaultModels reflect
  // the latest server state, not the frozen prop taken at click-time.
  const storeProviders = sessionStore((s) => s.providers)
  const live = useMemo<ProviderInfo | null>(() => {
    if (!provider) return null
    return storeProviders.find((p) => p.name === provider.name) ?? provider
  }, [storeProviders, provider])

  // Seed local models from the entry prop only when the editor target
  // changes — not every time the store refreshes the providers list, which
  // would clobber in-flight optimistic edits.
  const providerName = provider?.name
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above — deliberate primitive key
  useEffect(() => {
    if (provider) {
      setModels([...provider.models])
      setApiKey('')
      setKeySaved(false)
      setModelsOpen(false)
    }
  }, [providerName])

  useEffect(() => {
    return () => {
      if (relistTimer.current) clearTimeout(relistTimer.current)
      if (savedFlagTimer.current) clearTimeout(savedFlagTimer.current)
    }
  }, [])

  const scheduleRelist = useCallback(() => {
    if (relistTimer.current) clearTimeout(relistTimer.current)
    relistTimer.current = setTimeout(() => {
      sessionStore.getState().sendProvidersList()
      relistTimer.current = null
    }, 300)
  }, [])

  const commitModels = useCallback(
    (next: string[]) => {
      if (!providerName) return
      setModels(next)
      sessionStore.getState().sendProviderSetModels(providerName, next)
      scheduleRelist()
    },
    [providerName, scheduleRelist],
  )

  const defaults = live?.defaultModels
  const defaultsAvailable = (defaults?.length ?? 0) > 0
  const isAtDefaults = useMemo(() => {
    if (!defaults?.length) return false
    return defaults.length === models.length && defaults.every((m, i) => m === models[i])
  }, [defaults, models])

  if (!live) return null

  const icon = providerIcons[live.name]
  const label = providerDisplayName(live.name)
  const connected = live.hasApiKey || keySaved

  const saveKey = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    sessionStore.getState().sendProviderSetKey(live.name, trimmed)
    setApiKey('')
    setKeySaved(true)
    scheduleRelist()
    if (savedFlagTimer.current) clearTimeout(savedFlagTimer.current)
    savedFlagTimer.current = setTimeout(() => {
      setKeySaved(false)
      savedFlagTimer.current = null
    }, 1800)
  }

  const removeModel = (id: string) => {
    commitModels(models.filter((m) => m !== id))
  }

  const resetDefaults = () => {
    if (defaults?.length) commitModels([...defaults])
  }

  return (
    <Modal open={!!provider} onClose={onClose}>
      <div className="pform">
        <header className="pform__head">
          {icon ? (
            <img src={icon} alt="" width={32} height={32} className="pform__icon" />
          ) : (
            <span className="pform__icon pform__icon--fallback">
              {live.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="pform__heading">
            <h2 className="pform__title">{label}</h2>
            <div className={`pform__status${connected ? ' pform__status--ok' : ''}`}>
              <span className="pform__status-dot" />
              {connected ? 'Connected' : 'Not connected'}
              <span className="pform__status-sep">·</span>
              <span>
                {models.length} {models.length === 1 ? 'model' : 'models'}
              </span>
            </div>
          </div>
        </header>

        <div className="pform__section">
          <div className="pform__section-label" id="pform-key-label">
            API key
          </div>
          <form onSubmit={saveKey} className="pform__key" aria-labelledby="pform-key-label">
            <input
              type="password"
              className="pform__key-input"
              placeholder={live.hasApiKey ? 'Replace API key' : 'Paste API key'}
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
                <Check size={14} strokeWidth={2.2} />
              ) : (
                <ArrowRight size={14} strokeWidth={2.2} />
              )}
            </button>
          </form>
          <div className="pform__hint">
            {keySaved
              ? 'Key saved. It replaces the previous one.'
              : live.hasApiKey
                ? 'A key is already stored. Paste a new one to replace it.'
                : 'Stored locally and sent only to this provider.'}
          </div>
        </div>

        <div className="pform__section">
          <button
            type="button"
            className="pform__disclosure"
            onClick={() => setModelsOpen((o) => !o)}
            aria-expanded={modelsOpen}
            aria-controls="pform-models-panel"
          >
            <span className="pform__disclosure-label">Models</span>
            <span className="pform__disclosure-count">{models.length} enabled</span>
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              className={`pform__disclosure-chev${modelsOpen ? ' open' : ''}`}
              aria-hidden="true"
            />
          </button>

          {modelsOpen && (
            <div id="pform-models-panel" className="pform__panel">
              <ul className="pform__list">
                {models.length === 0 && (
                  <li className="pform__empty">No models yet. Reset to defaults to restore them.</li>
                )}
                {models.map((m) => {
                  const tag = classifyModelTag(m)
                  const display = formatModelName(m)
                  return (
                    <li key={m} className="pform__row">
                      <span className="pform__row-name" title={m}>
                        {display}
                      </span>
                      {tag && (
                        <span className={`pform__row-tag pform__row-tag--${tag}`}>{tag}</span>
                      )}
                      <button
                        type="button"
                        className="pform__row-x"
                        onClick={() => removeModel(m)}
                        aria-label={`Remove ${m}`}
                      >
                        <X size={13} strokeWidth={1.8} />
                      </button>
                    </li>
                  )
                })}
              </ul>

              {defaultsAvailable && !isAtDefaults && (
                <button type="button" onClick={resetDefaults} className="pform__reset">
                  <RotateCcw size={11} strokeWidth={1.8} />
                  Reset to defaults
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
