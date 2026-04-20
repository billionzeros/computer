/**
 * HarnessProviderSwitch — lets a user swap the active harness
 * (BYOS) session between Codex and Claude Code mid-conversation.
 *
 * Only renders when the current session exists AND its provider is a
 * harness-type provider. For Pi SDK sessions this is a no-op — those
 * use the standard ModelSelector which opens settings.
 *
 * UX: small dropdown, defaults to current provider. Selecting a new
 * one sends `session_provider_switch`; the server destroys the old
 * HarnessSession, rebuilds with a replay seed from messages.jsonl,
 * and acks with `session_provider_switched`. The store handler
 * updates the current session + conversation record so the UI shows
 * the new provider/model immediately.
 */

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProviderInfo } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { ProviderIcon } from './ModelSelector.js'

/**
 * Show the switch control only when the active session is a harness
 * session. Looks up the current provider's type from the providers
 * list (loaded from the server on connect).
 */
function isHarnessProvider(name: string, providers: ProviderInfo[]): boolean {
  const match = providers.find((p) => p.name === name)
  return match?.type === 'harness'
}

export function HarnessProviderSwitch() {
  const currentSessionId = sessionStore((s) => s.currentSessionId)
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const providers = sessionStore((s) => s.providers)
  const switchSessionProvider = sessionStore((s) => s.switchSessionProvider)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click. Effect lives inside the gated render so
  // non-harness sessions don't install listeners.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!currentSessionId) return null
  if (!currentProvider || !isHarnessProvider(currentProvider, providers)) return null

  const harnessProviders = providers.filter((p) => p.type === 'harness')
  // Only show the picker if there's actually somewhere to switch TO.
  if (harnessProviders.length <= 1) return null

  const choose = (provider: string, model: string) => {
    setOpen(false)
    if (provider === currentProvider && model === currentModel) return
    switchSessionProvider(currentSessionId, provider, model)
  }

  return (
    <div ref={rootRef} className="harness-provider-switch" style={{ position: 'relative' }}>
      <button
        type="button"
        className="model-selector__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tooltip="Switch harness provider for this conversation"
      >
        <ProviderIcon provider={currentProvider} size={14} />
        <span className="model-selector__label">Switch</span>
        <ChevronDown size={14} strokeWidth={1.5} className="model-selector__chevron" />
      </button>
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: custom-styled listbox; native <select> can't match design
        <div
          role="listbox"
          tabIndex={-1}
          className="harness-provider-switch__menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--bg-elevated, #1a1a1a)',
            border: '1px solid var(--border, #262626)',
            borderRadius: 6,
            padding: 4,
            minWidth: 180,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            zIndex: 20,
          }}
        >
          {harnessProviders.map((p) => {
            const defaultModel = p.defaultModels?.[0] ?? p.models[0] ?? currentModel ?? ''
            const isCurrent = p.name === currentProvider
            return (
              <button
                key={p.name}
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: custom listbox pattern — native <option> only valid inside <select>
                role="option"
                aria-selected={isCurrent}
                className="harness-provider-switch__item"
                onClick={() => choose(p.name, defaultModel)}
                disabled={!p.installed}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  background: isCurrent ? 'var(--bg-surface, #141414)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: p.installed ? 'var(--text, #e5e5e5)' : 'var(--text-dim, #666)',
                  cursor: p.installed ? 'pointer' : 'not-allowed',
                  textAlign: 'left',
                  fontSize: 13,
                }}
                title={p.installed ? undefined : `${p.name} CLI not installed on this machine`}
              >
                <ProviderIcon provider={p.name} size={14} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {isCurrent && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #999)' }}>current</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
