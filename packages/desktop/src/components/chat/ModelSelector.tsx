import { Check, ChevronDown, ChevronRight, Search, Settings } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderInfo } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
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

type ModelTag = 'fast' | 'balanced' | 'reasoning'

function classifyModelTag(model: string): ModelTag | null {
  const m = model.toLowerCase()
  if (/haiku|mini|flash|nano|lite|small|8b|7b|3b|groq/.test(m)) return 'fast'
  if (/opus|reason|o1|o3|o4|thinking|deepseek-r|405b|70b/.test(m)) return 'reasoning'
  if (/sonnet|gpt|claude|gemini|pro|medium|mistral|llama/.test(m)) return 'balanced'
  return null
}

function modelNote(model: string, tag: ModelTag | null): string {
  const m = model.toLowerCase()
  if (/opus/.test(m)) return 'Deep reasoning · best for complex work'
  if (/sonnet/.test(m)) return 'Balanced default · fast + smart'
  if (/haiku/.test(m)) return 'Snappy replies for light tasks'
  if (/gpt-5.*mini|mini/.test(m)) return 'Cheaper + faster · short tasks'
  if (/gpt/.test(m)) return 'Long context · flagship'
  if (/gemini.*flash/.test(m)) return 'Fast + cheap'
  if (/gemini/.test(m)) return 'Long context'
  if (/deepseek/.test(m)) return 'Strong on math + code'
  if (/groq/.test(m)) return '1000+ tok/s'
  if (tag === 'fast') return 'Fast + cheap'
  if (tag === 'reasoning') return 'Multi-step reasoning'
  if (tag === 'balanced') return 'Everyday default'
  return ''
}

function providerDisplayName(name: string): string {
  if (name === 'claude-code') return 'Claude Code'
  if (name === 'codex') return 'ChatGPT Codex'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

type Group = 'subscription' | 'api' | 'unconfigured'

function groupFor(p: ProviderInfo): Group {
  if (p.type === 'harness') {
    const hs = sessionStore.getState().harnessStatuses[p.name]
    const ready = hs?.installed && hs?.auth?.loggedIn
    return ready ? 'subscription' : 'unconfigured'
  }
  return p.hasApiKey ? 'api' : 'unconfigured'
}

const SECTION_LABEL: Record<Group, string> = {
  subscription: 'Subscriptions',
  api: 'Your API keys',
  unconfigured: 'Not configured',
}

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>
  providers: ProviderInfo[]
  currentProvider: string
  currentModel: string
  onSelect: (provider: string, model: string) => void
  onClose: () => void
  onManage: () => void
}

const POPOVER_WIDTH = 380
const POPOVER_MAX_HEIGHT = 440
const VIEWPORT_MARGIN = 12
const GAP = 8

type PopoverPosition = {
  top: number
  left: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

function computePosition(rect: DOMRect): PopoverPosition {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const spaceAbove = rect.top - VIEWPORT_MARGIN - GAP
  const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN - GAP
  const placement: 'top' | 'bottom' =
    spaceAbove >= Math.min(POPOVER_MAX_HEIGHT, spaceBelow) || spaceAbove >= 260 ? 'top' : 'bottom'
  const available = placement === 'top' ? spaceAbove : spaceBelow
  const maxHeight = Math.max(220, Math.min(POPOVER_MAX_HEIGHT, available))

  // Align right edge of popover to right edge of anchor, clamp to viewport.
  let left = rect.right - POPOVER_WIDTH
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - POPOVER_WIDTH - VIEWPORT_MARGIN))

  const top = placement === 'top' ? rect.top - GAP - maxHeight : rect.bottom + GAP

  return { top, left, maxHeight, placement }
}

function ModelPopover({
  anchorRef,
  providers,
  currentProvider,
  currentModel,
  onSelect,
  onClose,
  onManage,
}: PopoverProps) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      setPos(computePosition(el.getBoundingClientRect()))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose, anchorRef])

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups: Group[] = ['subscription', 'api', 'unconfigured']
    return groups
      .map((g) => {
        const inGroup = providers.filter((p) => groupFor(p) === g)
        const withModels = inGroup
          .map((p) => ({
            provider: p,
            models: p.models.filter(
              (m) =>
                !q ||
                m.toLowerCase().includes(q) ||
                p.name.toLowerCase().includes(q) ||
                (classifyModelTag(m) || '').includes(q),
            ),
          }))
          .filter((x) => x.models.length > 0)
        return { group: g, providers: withModels }
      })
      .filter((s) => s.providers.length > 0)
  }, [providers, query])

  if (!pos) return null

  const popover = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: absorbs bubbled clicks to preserve popover dismiss pattern
    <div
      className={`mdl-pop mdl-pop--${pos.placement}`}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        top: pos.top,
        left: pos.left,
        width: POPOVER_WIDTH,
        maxHeight: pos.maxHeight,
      }}
    >
      <div className="mdl-pop__search">
        <Search size={12} strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          // biome-ignore lint/a11y/noAutofocus: search input in modal popover — focus on open is expected UX
          autoFocus
        />
      </div>
      <div className="mdl-pop__list">
        {sections.map(({ group, providers: provs }) => (
          <div key={group} className="mdl-sec">
            <div className="mdl-sec__label">{SECTION_LABEL[group]}</div>
            {provs.map(({ provider: p, models }) => (
              <div key={p.name} className="mdl-prov">
                <div className="mdl-prov__head">
                  <span className="mdl-prov__av">
                    <ProviderIcon provider={p.name} size={14} />
                  </span>
                  <span className="mdl-prov__name">{providerDisplayName(p.name)}</span>
                  {group === 'unconfigured' && (
                    <button
                      type="button"
                      className="mdl-prov__connect"
                      onClick={() => {
                        onClose()
                        window.dispatchEvent(
                          new CustomEvent('open-settings', {
                            detail: { tab: 'models', provider: p.name },
                          }),
                        )
                      }}
                    >
                      Connect →
                    </button>
                  )}
                </div>
                <div className="mdl-prov__models">
                  {models.map((m) => {
                    const locked = group === 'unconfigured'
                    const selected = p.name === currentProvider && m === currentModel
                    const tag = classifyModelTag(m)
                    const note = modelNote(m, tag)
                    return (
                      <button
                        type="button"
                        key={m}
                        className={`mdl-row${selected ? ' sel' : ''}${locked ? ' locked' : ''}`}
                        onClick={() => !locked && onSelect(p.name, m)}
                        disabled={locked}
                      >
                        <span className="mdl-row__name">{formatModelName(m)}</span>
                        {tag && <span className={`mdl-row__tag mdl-row__tag--${tag}`}>{tag}</span>}
                        <span className="mdl-row__note">{note}</span>
                        {selected && <Check size={12} strokeWidth={2} className="mdl-row__check" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
        {sections.length === 0 && <div className="mdl-empty">No models match "{query}"</div>}
      </div>
      <button type="button" className="mdl-pop__foot" onClick={onManage}>
        <Settings size={12} strokeWidth={1.8} />
        <span>Manage models</span>
        <ChevronRight size={11} strokeWidth={1.8} className="mdl-pop__foot-chev" />
      </button>
    </div>
  )

  return createPortal(popover, document.body)
}

export function ModelSelector() {
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const providers = sessionStore((s) => s.providers)
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const hasAnyProvider = providers.length > 0
  const hasAnyKey = providers.some((p) => p.hasApiKey || p.type === 'harness')
  const displayModel = hasAnyKey ? formatModelName(currentModel) : 'Select a model'
  const tag = hasAnyKey ? classifyModelTag(currentModel) : null

  const handleSelect = (provider: string, model: string) => {
    const ss = sessionStore.getState()
    ss.setCurrentSession(ss.currentSessionId || '', provider, model)
    ss.sendProviderSetDefault(provider, model)
    setOpen(false)
  }

  return (
    <>
      <div className="composer__model-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="composer__model"
          onClick={() => {
            if (hasAnyProvider) setOpen((o) => !o)
            else setSettingsOpen(true)
          }}
        >
          {hasAnyKey && (
            <span className="composer__model-av">
              <ProviderIcon provider={currentProvider} size={14} />
            </span>
          )}
          <span className="composer__model-name">{displayModel}</span>
          {tag && <span className={`composer__model-tag composer__model-tag--${tag}`}>{tag}</span>}
          <ChevronDown size={12} strokeWidth={1.8} className="composer__model-chev" />
        </button>
        {open && (
          <ModelPopover
            anchorRef={buttonRef}
            providers={providers}
            currentProvider={currentProvider}
            currentModel={currentModel}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
            onManage={() => {
              setOpen(false)
              setSettingsOpen(true)
            }}
          />
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDisconnect={() => setSettingsOpen(false)}
        initialPage="models"
      />
    </>
  )
}
