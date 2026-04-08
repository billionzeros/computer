/**
 * ConnectorsView — full-page connectors UI.
 *
 * Two-pane layout: a left sidebar lists installed and available connectors
 * (grouped by Connected / Not connected). The right pane shows the selected
 * connector's details and per-tool permissions.
 *
 * Tool permissions are persisted server-side via `connector_set_tool_permission`
 * and enforced at runtime by McpManager (see packages/agent-core/src/mcp/mcp-manager.ts):
 *   - 'auto'  → tool is allowed without confirmation
 *   - 'ask'   → tool routes through Session.confirmHandler before each call
 *   - 'never' → tool is filtered out of getAllTools(), agent never sees it
 */

import { Check, ExternalLink, Loader2, Plug, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { connectorStore } from '../../lib/store/connectorStore.js'
import type { ConnectorRegistryInfo, ConnectorStatusInfo } from '../../lib/store/types.js'
import { ConnectorIcon } from './ConnectorIcons.js'
import { AppSetup } from './ConnectorsPage.js'

type ToolPermission = 'auto' | 'ask' | 'never'

// Heuristic classification of tool names. The protocol doesn't tell us whether
// a tool is read-only or write/delete, so we sniff common verbs from the name.
const READ_ONLY_PATTERNS = [
  'list',
  'get',
  'read',
  'search',
  'find',
  'fetch',
  'view',
  'show',
  'profile',
  'labels',
  'lookup',
  'inspect',
  'count',
]

function isReadOnlyTool(toolName: string): boolean {
  const lower = toolName.toLowerCase()
  return READ_ONLY_PATTERNS.some((p) => lower.includes(p))
}

function getPermission(
  perms: Record<string, ToolPermission> | undefined,
  toolName: string,
): ToolPermission {
  return perms?.[toolName] ?? 'auto'
}

// ── Sidebar item type ─────────────────────────────────────────────────
// For multi-account connectors we group all instances under the registry id.

interface SidebarItem {
  /** The registry id (or connector id for non-registry entries) */
  id: string
  name: string
  /** All connected instances for this connector */
  instances: ConnectorStatusInfo[]
  entry?: ConnectorRegistryInfo
  connected: boolean
}

// ── Main view ──────────────────────────────────────────────────────────

export function ConnectorsView() {
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [connectPopupId, setConnectPopupId] = useState<string | null>(null)

  // Refresh data when connection comes up
  const connectionStatus = useStore((s) => s.connectionStatus)
  useEffect(() => {
    if (connectionStatus === 'connected') {
      connectorStore.getState().listConnectors()
      connectorStore.getState().listConnectorRegistry()
    }
  }, [connectionStatus])

  // Listen for open-connector events (from ConnectorToolbar / App.tsx).
  // The event may carry a UUID instance id, so resolve it to the group id
  // (registryId) that the sidebar uses.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectorId) {
        const rawId: string = detail.connectorId
        const state = connectorStore.getState()
        // Resolve instance UUID → group id
        const inst = state.connectors.find((c) => c.id === rawId)
        const groupId = inst?.registryId ?? rawId

        setSelectedId(groupId)
        // If not connected, show the connect popup
        const isConnected = state.connectors.some(
          (c) => (c.registryId ?? c.id) === groupId && c.connected,
        )
        if (!isConnected) {
          setConnectPopupId(groupId)
        }
      }
    }
    window.addEventListener('open-connector', handler)
    return () => window.removeEventListener('open-connector', handler)
  }, [])

  // Build sidebar list: connected (top), not connected (bottom).
  // Multi-account connectors are grouped under a single entry.
  const { connectedItems, notConnectedItems } = useMemo(() => {
    // Group connectors by their registry id (or own id if no registryId)
    const groupMap = new Map<string, { instances: ConnectorStatusInfo[]; name: string }>()

    for (const c of connectors) {
      const groupId = c.registryId ?? c.id
      const existing = groupMap.get(groupId)
      if (existing) {
        existing.instances.push(c)
      } else {
        groupMap.set(groupId, { instances: [c], name: c.name })
      }
    }

    const connectedIds = new Set<string>()
    const connected: SidebarItem[] = []

    for (const [groupId, group] of groupMap) {
      const anyConnected = group.instances.some((c) => c.connected)
      if (anyConnected) {
        connectedIds.add(groupId)
        const entry = registry.find((r) => r.id === groupId)
        connected.push({
          id: groupId,
          name: entry?.name ?? group.name,
          instances: group.instances,
          entry,
          connected: true,
        })
      }
    }

    const available: SidebarItem[] = []
    for (const entry of registry) {
      if (!connectedIds.has(entry.id)) {
        const group = groupMap.get(entry.id)
        available.push({
          id: entry.id,
          name: entry.name,
          instances: group?.instances ?? [],
          entry,
          connected: false,
        })
      }
    }
    // Configured but disconnected and not in registry
    for (const [groupId, group] of groupMap) {
      if (!connectedIds.has(groupId) && !registry.some((r) => r.id === groupId)) {
        available.push({
          id: groupId,
          name: group.name,
          instances: group.instances,
          connected: false,
        })
      }
    }

    const q = search.trim().toLowerCase()
    const filterFn = (name: string) => !q || name.toLowerCase().includes(q)

    return {
      connectedItems: connected.filter((i) => filterFn(i.name)),
      notConnectedItems: available.filter((i) => filterFn(i.name)),
    }
  }, [connectors, registry, search])

  // Auto-select the first connected connector if nothing is selected
  useEffect(() => {
    if (!selectedId) {
      const first = connectedItems[0] ?? notConnectedItems[0]
      if (first) setSelectedId(first.id)
    }
  }, [connectedItems, notConnectedItems, selectedId])

  const selected = useMemo(() => {
    if (!selectedId) return null
    const all = [...connectedItems, ...notConnectedItems]
    return all.find((i) => i.id === selectedId) ?? null
  }, [selectedId, connectedItems, notConnectedItems])

  return (
    <div className="connectors-view">
      {/* ── Left sidebar ─────────────────────────────────── */}
      <aside className="connectors-view__sidebar">
        <div className="connectors-view__sidebar-header">
          <span className="connectors-view__sidebar-title">Connectors</span>
        </div>

        <div className="connectors-view__search">
          <Search size={14} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search connectors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="connectors-view__sidebar-body">
          {connectedItems.length > 0 && (
            <div className="connectors-view__group">
              <div className="connectors-view__group-label">Connected</div>
              {connectedItems.map((item) => (
                <SidebarRow
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  accountCount={item.instances.filter((i) => i.connected).length}
                  active={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          )}

          {notConnectedItems.length > 0 && (
            <div className="connectors-view__group">
              <div className="connectors-view__group-label">Not connected</div>
              {notConnectedItems.map((item) => (
                <SidebarRow
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  accountCount={0}
                  active={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          )}

          {connectedItems.length === 0 && notConnectedItems.length === 0 && (
            <div className="connectors-view__empty-list">
              {search ? 'No connectors match your search.' : 'No connectors available.'}
            </div>
          )}
        </div>
      </aside>

      {/* ── Right detail pane ────────────────────────────── */}
      <section className="connectors-view__detail">
        {selected ? (
          <ConnectorDetail
            key={selected.id}
            item={selected}
            onConnect={(id) => setConnectPopupId(id)}
          />
        ) : (
          <div className="connectors-view__placeholder">
            <Plug size={32} strokeWidth={1.25} />
            <p>Select a connector to view its tools and permissions.</p>
          </div>
        )}
      </section>

      {/* ── Connect popup (small centered dialog like AppSetup) ── */}
      {connectPopupId &&
        (() => {
          const popupEntry = registry.find((r) => r.id === connectPopupId)
          const popupInstances = connectors.filter((c) => (c.registryId ?? c.id) === connectPopupId)
          if (!popupEntry) return null
          return (
            <AppSetup
              entry={popupEntry}
              instances={popupInstances}
              onBack={() => setConnectPopupId(null)}
              onConnected={() => {
                setConnectPopupId(null)
                setSelectedId(connectPopupId)
              }}
            />
          )
        })()}
    </div>
  )
}

// ── Sidebar row ────────────────────────────────────────────────────────

function SidebarRow({
  id,
  name,
  accountCount,
  active,
  onClick,
}: {
  id: string
  name: string
  accountCount: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`connectors-view__row${active ? ' connectors-view__row--active' : ''}`}
      onClick={onClick}
    >
      <span className="connectors-view__row-icon">
        <ConnectorIcon id={id} size={18} />
      </span>
      <span className="connectors-view__row-name">{name}</span>
      {accountCount > 1 && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          {accountCount}
        </span>
      )}
    </button>
  )
}

// ── Detail pane ────────────────────────────────────────────────────────

function ConnectorDetail({
  item,
  onConnect,
}: {
  item: SidebarItem
  onConnect?: (id: string) => void
}) {
  const [oauthWaiting, setOauthWaiting] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  // Track active OAuth cleanup so we can tear it down on unmount
  const oauthCleanupRef = useRef<(() => void) | null>(null)

  // Listen for OAuth completion to refresh
  useEffect(() => {
    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_oauth_complete' || msg.type === 'connector_added') {
        connectorStore.getState().listConnectors()
      }
    })
    return unsub
  }, [])

  // Clean up any in-flight OAuth on unmount
  useEffect(() => {
    return () => {
      oauthCleanupRef.current?.()
    }
  }, [])

  const { id, name, entry, instances, connected: isConnected } = item
  const description = instances[0]?.description ?? entry?.description
  const isOAuth = entry?.type === 'oauth'
  const isMultiAccount = entry?.multiAccount

  // Aggregate tools from all connected instances
  const allTools = useMemo(() => {
    const toolSet = new Set<string>()
    for (const inst of instances) {
      if (inst.connected) {
        for (const t of inst.tools ?? []) toolSet.add(t)
      }
    }
    return Array.from(toolSet)
  }, [instances])

  // Use first connected instance's permissions as reference
  const permsInstance = instances.find((i) => i.connected)
  const perms = permsInstance?.toolPermissions

  const connectedInstances = instances.filter((i) => i.connected)

  const handleDisconnect = (instanceId: string) => {
    if (isOAuth) {
      connectorStore.getState().disconnectOAuth(instanceId)
    } else {
      connectorStore.getState().removeConnectorRemote(instanceId)
    }
  }

  const handleConnect = () => {
    // OAuth connectors can start the flow inline — no popup needed
    if (isOAuth) {
      startOAuthFlow(id)
      return
    }
    // Non-OAuth needs the AppSetup popup for env var fields / setup guide
    if (onConnect && id) onConnect(id)
  }

  const startOAuthFlow = (instanceId: string, registryId?: string) => {
    setOauthWaiting(true)
    setOauthError(null)
    connectorStore.getState().startOAuth(instanceId, registryId)

    const unsub = connection.onMessage((_channel, msg) => {
      if (
        msg.type === 'connector_oauth_url' &&
        (msg as unknown as { provider: string }).provider === instanceId
      ) {
        const url = (msg as unknown as { url: string }).url
        if ((window as unknown as { __TAURI__?: unknown }).__TAURI__) {
          import('@tauri-apps/plugin-shell').then(({ open }) => open(url))
        } else {
          window.open(url, '_blank')
        }
      }
      if (
        msg.type === 'connector_oauth_complete' &&
        (msg as unknown as { provider: string }).provider === instanceId
      ) {
        const complete = msg as unknown as { success: boolean; error?: string }
        cleanup()
        if (complete.success) {
          connectorStore.getState().listConnectors()
        } else {
          setOauthError(complete.error || 'Authorization failed')
          if (registryId) {
            connectorStore.getState().removeConnectorRemote(instanceId)
          }
        }
      }
    })

    const cleanup = () => {
      clearTimeout(timeoutId)
      setOauthWaiting(false)
      unsub()
      oauthCleanupRef.current = null
    }

    oauthCleanupRef.current = () => {
      cleanup()
      if (registryId) {
        connectorStore.getState().removeConnectorRemote(instanceId)
      }
    }

    const timeoutId = setTimeout(() => {
      setOauthError('Authorization timed out')
      cleanup()
      if (registryId) {
        connectorStore.getState().removeConnectorRemote(instanceId)
      }
    }, 120_000)
  }

  const handleAddAnotherAccount = () => {
    if (!entry) return
    const newId = crypto.randomUUID()
    connectorStore.getState().addConnectorRemote({
      id: newId,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      type: entry.type,
      registryId: entry.id,
      enabled: true,
    })
    startOAuthFlow(newId, entry.id)
  }

  const handleReauthorize = (instanceId: string, registryId?: string) => {
    startOAuthFlow(instanceId, registryId)
  }

  const setPermission = (toolName: string, permission: ToolPermission) => {
    // Set permission on the first connected instance (they share the same tool set)
    const targetId = permsInstance?.id ?? id
    connectorStore.getState().setToolPermission(targetId, toolName, permission)
  }

  // Group tools by read/write classification
  const readOnly = allTools.filter(isReadOnlyTool)
  const writeDelete = allTools.filter((t: string) => !isReadOnlyTool(t))

  return (
    <div className="connectors-view__detail-inner">
      {/* Header row */}
      <div className="connectors-view__detail-header">
        <div className="connectors-view__detail-icon">
          <ConnectorIcon id={id} size={28} />
        </div>
        <div className="connectors-view__detail-title">{name}</div>
        {isConnected && !isMultiAccount ? (
          <button
            type="button"
            className="connectors-view__btn connectors-view__btn--ghost"
            onClick={() => handleDisconnect(connectedInstances[0]?.id ?? id)}
          >
            Disconnect
          </button>
        ) : !isConnected ? (
          <button
            type="button"
            className="connectors-view__btn connectors-view__btn--primary"
            onClick={handleConnect}
            disabled={oauthWaiting}
          >
            {oauthWaiting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Waiting...
              </>
            ) : (
              'Connect'
            )}
          </button>
        ) : null}
      </div>

      {description && <p className="connectors-view__detail-desc">{description}</p>}

      {/* Connected accounts (multi-account or single with account info) */}
      {isConnected && connectedInstances.length > 0 && (
        <div className="connectors-view__accounts">
          <div className="connectors-view__accounts-title">
            Connected account{connectedInstances.length > 1 ? 's' : ''}
          </div>
          {connectedInstances.map((inst) => (
            <div key={inst.id} className="connectors-view__account-row">
              <div className="connectors-view__account-info">
                <span className="connectors-view__account-dot connectors-view__account-dot--connected" />
                <span className="connectors-view__account-label">
                  {inst.accountLabel ?? inst.accountEmail ?? inst.name}
                </span>
                <span className="connectors-view__account-tools">
                  {inst.toolCount ?? inst.tools?.length ?? 0} tools
                </span>
              </div>
              <div className="connectors-view__account-actions">
                {entry?.setupGuide?.reauthorizeHint && (
                  <button
                    type="button"
                    className="connectors-view__btn connectors-view__btn--ghost"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => handleReauthorize(inst.id, inst.registryId)}
                    title={entry.setupGuide.reauthorizeHint}
                  >
                    <ExternalLink size={12} strokeWidth={1.5} /> Re-authorize
                  </button>
                )}
                {isMultiAccount && (
                  <button
                    type="button"
                    className="connectors-view__btn connectors-view__btn--ghost"
                    style={{ fontSize: 11, padding: '3px 8px', color: '#ef4444' }}
                    onClick={() => handleDisconnect(inst.id)}
                  >
                    <Trash2 size={12} strokeWidth={1.5} /> Disconnect
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add another account button */}
          {isMultiAccount && isOAuth && (
            <button
              type="button"
              className="connectors-view__add-account"
              onClick={handleAddAnotherAccount}
              disabled={oauthWaiting}
            >
              {oauthWaiting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} strokeWidth={1.5} />
              )}
              {oauthWaiting ? 'Waiting for authorization...' : 'Add another account'}
            </button>
          )}

          {oauthError && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{oauthError}</div>
          )}
        </div>
      )}

      {!isConnected && !oauthWaiting && !oauthError && (
        <div className="connectors-view__detail-empty">
          <Plug size={20} strokeWidth={1.25} />
          <p>This connector is not connected yet. Click Connect to set it up.</p>
        </div>
      )}

      {!isConnected && oauthWaiting && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          A browser window should open. Authorize the app, then come back here.
        </p>
      )}

      {!isConnected && oauthError && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{oauthError}</div>
      )}

      {isConnected && allTools.length === 0 && (
        <div className="connectors-view__detail-empty">
          <p>No tools reported by this connector yet.</p>
        </div>
      )}

      {isConnected && id === 'slack-bot' && (
        <SlackBotIdentityCard status={instances.find((i) => i.id === 'slack-bot')} />
      )}

      {isConnected && allTools.length > 0 && (
        <div className="connectors-view__perms">
          <div className="connectors-view__perms-header">
            <h3 className="connectors-view__perms-title">Tool permissions</h3>
            <p className="connectors-view__perms-hint">
              Choose when Anton is allowed to use each tool.
            </p>
          </div>

          {readOnly.length > 0 && (
            <ToolGroup
              label="Read-only tools"
              tools={readOnly}
              perms={perms}
              onChange={setPermission}
            />
          )}

          {writeDelete.length > 0 && (
            <ToolGroup
              label="Write/delete tools"
              tools={writeDelete}
              perms={perms}
              onChange={setPermission}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Tool group ─────────────────────────────────────────────────────────

function ToolGroup({
  label,
  tools,
  perms,
  onChange,
}: {
  label: string
  tools: string[]
  perms: Record<string, ToolPermission> | undefined
  onChange: (toolName: string, permission: ToolPermission) => void
}) {
  return (
    <div className="connectors-view__perm-group">
      <div className="connectors-view__perm-group-header">
        <span className="connectors-view__perm-group-label">{label}</span>
        <span className="connectors-view__perm-group-count">{tools.length}</span>
      </div>
      <ul className="connectors-view__perm-list">
        {tools.map((tool) => (
          <li key={tool} className="connectors-view__perm-row">
            <span className="connectors-view__perm-name">{tool}</span>
            <PermissionToggle
              value={getPermission(perms, tool)}
              onChange={(v) => onChange(tool, v)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Slack: bot identity card ──────────────────────────────────────────

function SlackBotIdentityCard({ status }: { status?: ConnectorStatusInfo }) {
  const initialName = status?.metadata?.displayName ?? ''
  const initialIcon = status?.metadata?.iconUrl ?? ''
  const [displayName, setDisplayName] = useState(initialName)
  const [iconUrl, setIconUrl] = useState(initialIcon)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    setDisplayName(status?.metadata?.displayName ?? '')
    setIconUrl(status?.metadata?.iconUrl ?? '')
  }, [status?.metadata?.displayName, status?.metadata?.iconUrl])

  const dirty = displayName !== initialName || iconUrl !== initialIcon

  const handleSave = async () => {
    setSaving(true)
    try {
      const existing = status?.metadata ?? {}
      const merged: Record<string, string> = {}
      for (const [k, v] of Object.entries(existing)) {
        if (k !== 'displayName' && k !== 'iconUrl') merged[k] = v as string
      }
      if (displayName.trim()) merged.displayName = displayName.trim()
      if (iconUrl.trim()) merged.iconUrl = iconUrl.trim()
      connectorStore.getState().updateConnectorRemote('slack-bot', { metadata: merged })
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="connectors-view__perms" style={{ marginBottom: 16 }}>
      <div className="connectors-view__perms-header">
        <h3 className="connectors-view__perms-title">Bot identity</h3>
        <p className="connectors-view__perms-hint">
          How Anton appears when posting in Slack. Leave blank to use the app defaults.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 2px' }}>
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: 0.85 }}
        >
          Display name
          <input
            type="text"
            placeholder="Anton"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="connectors-view__input"
          />
        </label>
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: 0.85 }}
        >
          Avatar URL
          <input
            type="url"
            placeholder="https://example.com/anton.png"
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            className="connectors-view__input"
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="connectors-view__btn connectors-view__btn--primary"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {savedAt && !dirty && <span style={{ fontSize: 11, opacity: 0.6 }}>Saved</span>}
        </div>
      </div>
    </div>
  )
}

// ── Three-state toggle ────────────────────────────────────────────────

function PermissionToggle({
  value,
  onChange,
}: {
  value: ToolPermission
  onChange: (v: ToolPermission) => void
}) {
  const options: { value: ToolPermission; title: string; symbol: string }[] = [
    { value: 'auto', title: 'Always allow', symbol: '✓' },
    { value: 'ask', title: 'Ask before each use', symbol: '?' },
    { value: 'never', title: 'Never allow', symbol: '∅' },
  ]
  return (
    <div className="connectors-view__perm-toggle" aria-label="Tool permission">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          title={opt.title}
          className={`connectors-view__perm-btn${
            value === opt.value ? ` connectors-view__perm-btn--active-${opt.value}` : ''
          }`}
          onClick={() => onChange(opt.value)}
        >
          {value === opt.value && opt.value === 'auto' ? (
            <Check size={12} strokeWidth={2} />
          ) : (
            opt.symbol
          )}
        </button>
      ))}
    </div>
  )
}
