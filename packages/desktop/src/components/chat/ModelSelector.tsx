import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { type ProviderInfo, useStore } from '../../lib/store.js'
import { SettingsModal } from '../settings/SettingsModal.js'
import { formatModelName, providerIcons } from './model-utils.js'

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const icon = providerIcons[provider]
  if (icon) {
    return (
      <img
        src={icon}
        alt={provider}
        width={size}
        height={size}
        className="model-selector__provider-icon"
      />
    )
  }
  return (
    <span className="model-selector__provider-icon-fallback" style={{ width: size, height: size }}>
      {provider.charAt(0).toUpperCase()}
    </span>
  )
}

export { ProviderIcon }

export function ModelSelector() {
  const currentProvider = useStore((s) => s.currentProvider)
  const currentModel = useStore((s) => s.currentModel)
  const providers = useStore((s) => s.providers)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const hasAnyKey = providers.some((p: ProviderInfo) => p.hasApiKey)
  const displayModel = hasAnyKey ? formatModelName(currentModel) : 'Select a model'

  return (
    <>
      <button type="button" className="model-selector__trigger" onClick={() => setSettingsOpen(true)}>
        {hasAnyKey && <ProviderIcon provider={currentProvider} size={14} />}
        <span className="model-selector__label">{displayModel}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="model-selector__chevron" />
      </button>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialPage="models"
      />
    </>
  )
}
