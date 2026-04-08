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

import { Check, Plug, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { connectorStore } from '../../lib/store/connectorStore.js'
import type { ConnectorRegistryInfo, ConnectorStatusInfo } from '../../lib/store/types.js'
import { ConnectorIcon } from './ConnectorIcons.js'
import { AppSetup, ConnectorsPage } from './ConnectorsPage.js'

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

// ── Main view ──────────────────────────────────────────────────────────

export function ConnectorsView() {
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [connectPopupId, setConnectPopupId] = useState<string | null>(null)

  // Refresh data when connection comes up
  const connectionStatus = useStore((s) => s.connectionStatus)
  useEffect(() => {
    if (connectionStatus === 'connected') {
      connectorStore.getState().listConnectors()
      connectorStore.getState().listConnectorRegistry()
    }
  }, [connectionStatus])

  // Listen for open-connector events (from ConnectorToolbar / App.tsx)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectorId) {
        setSelectedId(detail.connectorId)
        // If not connected, show the connect popup
        const isConnected = connectorStore.getState().connectors.some(
          (c) => c.id === detail.connectorId && c.connected,
        )
        if (!isConnected) {
          setConnectPopupId(detail.connectorId)
        }
      }
    }
    window.addEventListener('open-connector', handler)
    return () => window.removeEventListener('open-connector', handler)
  }, [])

  // Auto-select the first connected connector if nothing is selected
  useEffect(() => {
    if (!selectedId && connectors.length > 0) {
      const firstConnected = connectors.find((c) => c.connected)
      setSelectedId(firstConnected?.id ?? connectors[0]?.id ?? null)
    }
  }, [connectors, selectedId])

  // Build sidebar list: connected (top), not connected (bottom).
  // Connected = anything in `connectors` with connected=true.
  // Not connected = registry entries that are not yet configured/connected,
  // plus configured-but-disconnected entries.
  const { connectedItems, notConnectedItems } = useMemo(() => {
    const connectedIds = new Set<string>()
    const connected: Array<{ id: string; name: string; status: ConnectorStatusInfo }> = []
    for (const c of connectors) {
      if (c.connected) {
        connectedIds.add(c.id)
        connected.push({ id: c.id, name: c.name, status: c })
      }
    }

    const available: Array<{ id: string; name: string; entry?: ConnectorRegistryInfo }> = []
    for (const entry of registry) {
      if (!connectedIds.has(entry.id)) {
        available.push({ id: entry.id, name: entry.name, entry })
      }
    }
    // Configured but disconnected — show in "not connected" too
    for (const c of connectors) {
      if (!c.connected && !registry.some((r) => r.id === c.id)) {
        available.push({ id: c.id, name: c.name })
      }
    }

    const q = search.trim().toLowerCase()
    const filterFn = (name: string) => !q || name.toLowerCase().includes(q)

    return {
      connectedItems: connected.filter((i) => filterFn(i.name)),
      notConnectedItems: available.filter((i) => filterFn(i.name)),
    }
  }, [connectors, registry, search])

  const selected = useMemo(() => {
    if (!selectedId) return null
    const status = connectors.find((c) => c.id === selectedId)
    const entry = registry.find((r) => r.id === selectedId)
    return { status, entry }
  }, [selectedId, connectors, registry])

  return (
    <div className="connectors-view">
      {/* ── Left sidebar ─────────────────────────────────── */}
      <aside className="connectors-view__sidebar">
        <div className="connectors-view__sidebar-header">
          <span className="connectors-view__sidebar-title">Connectors</span>
          <button
            type="button"
            className="connectors-view__sidebar-add"
            onClick={() => setShowAddModal(true)}
            title="Add a connector"
            aria-label="Add a connector"
          >
            +
          </button>
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
            status={selected.status}
            entry={selected.entry}
            onConnect={(id) => setConnectPopupId(id)}
          />
        ) : (
          <div className="connectors-view__placeholder">
            <Plug size={32} strokeWidth={1.25} />
            <p>Select a connector to view its tools and permissions.</p>
          </div>
        )}
      </section>

      {/* ── Add-connector modal (reuses existing setup flow) ── */}
      {showAddModal && (
        <div
          className="connectors-view__modal-backdrop"
          onClick={() => setShowAddModal(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowAddModal(false)
          }}
          role="presentation"
        >
          <div
            className="connectors-view__modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="connectors-view__modal-close"
              onClick={() => setShowAddModal(false)}
              aria-label="Close"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
            <ConnectorsPage
              onConnected={(connectedId) => {
                setShowAddModal(false)
                if (connectedId) setSelectedId(connectedId)
              }}
            />
          </div>
        </div>
      )}

      {/* ── Connect popup (small centered dialog like AppSetup) ── */}
      {connectPopupId && (() => {
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
  active,
  onClick,
}: {
  id: string
  name: string
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
    </button>
  )
}

// ── Detail pane ────────────────────────────────────────────────────────

function ConnectorDetail({
  status,
  entry,
  onConnect,
}: {
  status?: ConnectorStatusInfo
  entry?: ConnectorRegistryInfo
  onConnect?: (id: string) => void
}) {
  // Listen for OAuth completion to refresh
  useEffect(() => {
    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_oauth_complete' || msg.type === 'connector_added') {
        connectorStore.getState().listConnectors()
      }
    })
    return unsub
  }, [])

  const id = status?.id ?? entry?.id
  const name = status?.name ?? entry?.name ?? 'Unknown'
  const description = status?.description ?? entry?.description
  const isConnected = !!status?.connected
  const tools = status?.tools ?? []
  const perms = status?.toolPermissions

  if (!id) return null

  const handleDisconnect = () => {
    if (entry?.type === 'oauth') {
      connectorStore.getState().disconnectOAuth(id)
    } else {
      connectorStore.getState().removeConnectorRemote(id)
    }
  }

  const handleConnect = () => {
    if (onConnect && id) onConnect(id)
  }

  const setPermission = (toolName: string, permission: ToolPermission) => {
    connectorStore.getState().setToolPermission(id, toolName, permission)
  }

  // Group tools by read/write classification
  const readOnly = tools.filter(isReadOnlyTool)
  const writeDelete = tools.filter((t: string) => !isReadOnlyTool(t))

  return (
    <div className="connectors-view__detail-inner">
      {/* Header row */}
      <div className="connectors-view__detail-header">
        <div className="connectors-view__detail-icon">
          <ConnectorIcon id={id} size={28} />
        </div>
        <div className="connectors-view__detail-title">{name}</div>
        {isConnected ? (
          <button
            type="button"
            className="connectors-view__btn connectors-view__btn--ghost"
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="connectors-view__btn connectors-view__btn--primary"
            onClick={handleConnect}
          >
            Connect
          </button>
        )}
      </div>

      {description && <p className="connectors-view__detail-desc">{description}</p>}

      {!isConnected && (
        <div className="connectors-view__detail-empty">
          <Plug size={20} strokeWidth={1.25} />
          <p>This connector is not connected yet. Click Connect to set it up.</p>
        </div>
      )}

      {isConnected && tools.length === 0 && (
        <div className="connectors-view__detail-empty">
          <p>No tools reported by this connector yet.</p>
        </div>
      )}

      {isConnected && id === 'slack-bot' && <SlackBotIdentityCard status={status} />}

      {isConnected && tools.length > 0 && (
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
//
// Slack's `chat:write.customize` scope (which we request on install) lets us
// override the username + avatar on every chat.postMessage call. This card
// lets the user pick what Anton looks like in their workspace without ever
// touching api.slack.com. Values are persisted as connector metadata via
// the existing connector_update message.

function SlackBotIdentityCard({ status }: { status?: ConnectorStatusInfo }) {
  const initialName = status?.metadata?.displayName ?? ''
  const initialIcon = status?.metadata?.iconUrl ?? ''
  const [displayName, setDisplayName] = useState(initialName)
  const [iconUrl, setIconUrl] = useState(initialIcon)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // If the metadata changes from elsewhere (refresh after save), pick it up.
  useEffect(() => {
    setDisplayName(status?.metadata?.displayName ?? '')
    setIconUrl(status?.metadata?.iconUrl ?? '')
  }, [status?.metadata?.displayName, status?.metadata?.iconUrl])

  const dirty = displayName !== initialName || iconUrl !== initialIcon

  const handleSave = async () => {
    setSaving(true)
    try {
      // Merge with existing metadata so we don't clobber bot_user_id, team_id, etc.
      const existing = status?.metadata ?? {}
      const merged: Record<string, string> = {}
      for (const [k, v] of Object.entries(existing)) {
        if (k !== 'displayName' && k !== 'iconUrl') merged[k] = v as string
      }
      if (displayName.trim()) merged.displayName = displayName.trim()
      if (iconUrl.trim()) merged.iconUrl = iconUrl.trim()
      // Save against the bot connector — `chat:write.customize` lives on the
      // xoxb token, and the SlackWebhookProvider's getBotIdentity() reads from
      // the slack-bot connector's metadata. The previous version of this card
      // wrote to id 'slack' (the user-token connector), which (a) never
      // applied to bot replies and (b) clobbered the wrong connector's
      // metadata if both were installed.
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
            {saving ? 'Saving…' : 'Save'}
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
