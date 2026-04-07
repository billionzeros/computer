import {
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Play,
  Plug,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { connectorStore } from '../../lib/store/connectorStore.js'
import type { ConnectorRegistryInfo, ConnectorStatusInfo } from '../../lib/store/types.js'
import { ConnectorIcon } from './ConnectorIcons.js'

const CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: 'messaging', label: 'Messaging' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'development', label: 'Development' },
  { key: 'social', label: 'Social' },
  { key: 'other', label: 'Other' },
]

type Tab = 'apps' | 'custom-api' | 'custom-mcp'

export function ConnectorsPage({
  initialConnectorId,
  onConnected,
}: { initialConnectorId?: string; onConnected?: () => void } = {}) {
  const [tab, setTab] = useState<Tab>('apps')
  const [search, setSearch] = useState('')
  const connectors = connectorStore((s) => s.connectors)
  const registry = connectorStore((s) => s.connectorRegistry)

  const connectionStatus = useStore((s) => s.connectionStatus)
  useEffect(() => {
    if (connectionStatus === 'connected') {
      connectorStore.getState().listConnectors()
      connectorStore.getState().listConnectorRegistry()
    }
  }, [connectionStatus])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'apps', label: 'Apps' },
    { key: 'custom-api', label: 'Custom API' },
    { key: 'custom-mcp', label: 'Custom MCP' },
  ]

  return (
    <div className="connectors-page">
      {/* Header with tabs and search */}
      <div className="connectors-header">
        <div className="connectors-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`connectors-tab${tab === t.key ? ' connectors-tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="connectors-search">
          <Search size={14} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tab content */}
      <div className="connectors-content">
        {tab === 'apps' && (
          <AppsTab
            registry={registry}
            connectors={connectors}
            search={search}
            initialConnectorId={initialConnectorId}
            onConnected={onConnected}
          />
        )}
        {tab === 'custom-api' && <CustomApiTab connectors={connectors} search={search} />}
        {tab === 'custom-mcp' && <CustomMcpTab connectors={connectors} search={search} />}
      </div>
    </div>
  )
}

// ── Apps Tab ────────────────────────────────────────────────────────

function AppsTab({
  registry,
  connectors,
  search,
  initialConnectorId,
  onConnected,
}: {
  registry: ConnectorRegistryInfo[]
  connectors: ConnectorStatusInfo[]
  search: string
  initialConnectorId?: string
  onConnected?: () => void
}) {
  const [setupId, setSetupId] = useState<string | null>(initialConnectorId ?? null)

  const filtered = registry.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()),
  )

  if (setupId) {
    const entry = registry.find((r) => r.id === setupId)
    if (entry) {
      return (
        <AppSetup
          entry={entry}
          existing={connectors.find((c) => c.id === entry.id)}
          onBack={() => setSetupId(null)}
          onConnected={onConnected}
        />
      )
    }
  }

  // Split into featured and grouped-by-category
  const featured = filtered.filter((r) => r.featured)
  const grouped = CATEGORY_ORDER.map(({ key, label }) => ({
    key,
    label,
    entries: filtered.filter((r) => r.category === key),
  })).filter((g) => g.entries.length > 0)

  const renderCard = (entry: ConnectorRegistryInfo) => {
    const existing = connectors.find((c) => c.id === entry.id)
    return (
      <button
        key={entry.id}
        type="button"
        className={`connector-card${existing?.connected ? ' connector-card--connected' : ''}`}
        onClick={() => setSetupId(entry.id)}
      >
        <div className="connector-card__icon-wrap">
          <ConnectorIcon id={entry.id} size={22} />
        </div>
        <div className="connector-card__info">
          <div className="connector-card__name">
            {entry.name}
            {existing?.connected && <span className="connector-card__dot" title="Connected" />}
          </div>
          <div className="connector-card__desc">{entry.description}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="connectors-categorized">
      {/* Recommended / Featured section */}
      {featured.length > 0 && !search && (
        <div className="connectors-category">
          <h3 className="connectors-category__label">Recommended</h3>
          <div className="connectors-grid">{featured.map(renderCard)}</div>
        </div>
      )}

      {/* Category sections */}
      {grouped.map((group) => (
        <div key={group.key} className="connectors-category">
          <h3 className="connectors-category__label">
            {search ? group.label : `All ${group.label}`}
          </h3>
          <div className="connectors-grid">{group.entries.map(renderCard)}</div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="connectors-empty">No connectors match your search.</div>
      )}
    </div>
  )
}

// ── App Setup (Manus-style centered modal) ─────────────────────────

function AppSetup({
  entry,
  existing,
  onBack,
  onConnected,
}: {
  entry: ConnectorRegistryInfo
  existing?: ConnectorStatusInfo
  onBack: () => void
  onConnected?: () => void
}) {
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [optionalValues, setOptionalValues] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [oauthWaiting, setOauthWaiting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    tools: string[]
    error?: string
  } | null>(null)

  const isConfigured = existing != null
  const isOAuth = entry.type === 'oauth'
  const allEnvFilled = entry.requiredEnv.every((k) => envValues[k])

  const handleOAuthConnect = () => {
    setOauthWaiting(true)
    connectorStore.getState().startOAuth(entry.id)

    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_oauth_url') {
        // Open the authorization URL in the system browser
        const url = (msg as unknown as { url: string }).url
        if ((window as unknown as { __TAURI__?: unknown }).__TAURI__) {
          import('@tauri-apps/plugin-shell').then(({ open }) => open(url))
        } else {
          window.open(url, '_blank')
        }
      }
      if (msg.type === 'connector_oauth_complete') {
        const complete = msg as unknown as { success: boolean; error?: string }
        setOauthWaiting(false)
        unsub()
        if (complete.success) {
          // Refresh the connector list so the new view picks up the change,
          // then close the modal entirely (or pop back if no close handler).
          connectorStore.getState().listConnectors()
          if (onConnected) onConnected()
          else onBack()
        } else {
          setTestResult({
            success: false,
            tools: [],
            error: complete.error || 'Authorization failed',
          })
        }
      }
    })

    // 2-minute timeout for the full OAuth flow
    setTimeout(() => {
      setOauthWaiting(false)
      unsub()
    }, 120_000)
  }

  const handleConnect = () => {
    const env: Record<string, string> = {}
    for (const key of entry.requiredEnv) {
      if (envValues[key]) env[key] = envValues[key]
    }

    // For API-type connectors, map env values to apiKey or baseUrl
    let apiKey: string | undefined
    let baseUrl: string | undefined
    if (entry.type === 'api' && entry.requiredEnv.length > 0) {
      const firstEnv = entry.requiredEnv[0]
      if (firstEnv.toLowerCase().includes('url')) {
        baseUrl = envValues[firstEnv]
      } else {
        apiKey = envValues[firstEnv]
      }
    }

    // Collect optional fields into metadata
    const metadata: Record<string, string> = {}
    for (const field of entry.optionalFields ?? []) {
      if (optionalValues[field.key]) metadata[field.key] = optionalValues[field.key]
    }

    connectorStore.getState().addConnectorRemote({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      type: entry.type,
      command: entry.command,
      args: entry.args,
      env,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      enabled: true,
    })

    setTesting(true)
    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_added' || msg.type === 'connector_status') {
        setTesting(false)
        unsub()
        connectorStore.getState().listConnectors()
        if (onConnected) onConnected()
        else onBack()
      }
    })

    setTimeout(() => {
      setTesting(false)
      unsub()
    }, 20_000)
  }

  const handleDisconnect = () => {
    if (isOAuth) {
      connectorStore.getState().disconnectOAuth(entry.id)
    } else {
      connectorStore.getState().removeConnectorRemote(entry.id)
    }

    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_removed') {
        unsub()
        onBack()
      }
    })

    setTimeout(() => {
      unsub()
      onBack()
    }, 5_000)
  }

  const handleTest = () => {
    setTesting(true)
    setTestResult(null)
    connectorStore.getState().testConnectorRemote(entry.id)

    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_test_response' && msg.id === entry.id) {
        setTesting(false)
        setTestResult({
          success: msg.success as boolean,
          tools: (msg.tools || []) as string[],
          error: msg.error as string | undefined,
        })
        unsub()
      }
    })

    setTimeout(() => {
      setTesting(false)
      unsub()
    }, 30_000)
  }

  return (
    <div
      className="app-detail-overlay"
      onClick={onBack}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onBack()
      }}
    >
      <div
        className="app-detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button type="button" className="app-detail__close" onClick={onBack}>
          <X size={18} strokeWidth={1.5} />
        </button>

        {/* Icon */}
        <div className="app-detail__icon">
          <ConnectorIcon id={entry.id} size={40} />
        </div>

        {/* Name */}
        <h2 className="app-detail__name">{entry.name}</h2>

        {/* Description */}
        <p className="app-detail__desc">{entry.description}</p>

        {/* Status badge for connected */}
        {isConfigured && existing?.connected && (
          <div className="app-detail__status app-detail__status--connected">
            <Check size={14} /> Connected — {existing.toolCount} tools available
          </div>
        )}

        {isConfigured && !existing?.connected && (
          <div className="app-detail__status app-detail__status--error">
            <PowerOff size={14} /> Disconnected
            {existing?.error && ` — ${existing.error}`}
          </div>
        )}

        {/* OAuth one-click connect */}
        {!isConfigured && isOAuth && (
          <button
            type="button"
            className="app-detail__connect"
            onClick={handleOAuthConnect}
            disabled={oauthWaiting}
          >
            {oauthWaiting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} strokeWidth={2} />
            )}
            {oauthWaiting ? 'Waiting for authorization...' : `Connect with ${entry.name}`}
          </button>
        )}

        {oauthWaiting && (
          <p className="app-detail__oauth-hint">
            A browser window should open. Authorize the app, then come back here.
          </p>
        )}

        {/* Connect button for non-OAuth (not yet configured) */}
        {!isConfigured && !isOAuth && !showDetails && (
          <button
            type="button"
            className="app-detail__connect"
            onClick={() => setShowDetails(true)}
          >
            <Plus size={16} strokeWidth={2} />
            Connect
          </button>
        )}

        {/* Setup guide + Env fields (shown after clicking Connect or Show Details) */}
        {!isConfigured && !isOAuth && showDetails && (
          <div className="app-detail__fields">
            {entry.setupGuide && (
              <div className="app-detail__setup-guide">
                <h4 className="app-detail__setup-guide-title">How to get your credentials</h4>
                <ol className="app-detail__setup-guide-steps">
                  {entry.setupGuide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <a
                  href={entry.setupGuide.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="app-detail__setup-guide-link"
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                  {entry.setupGuide.urlLabel || 'Open Dashboard'}
                </a>
              </div>
            )}
            {entry.requiredEnv.map((envKey) => (
              <div key={envKey} className="app-detail__field">
                <label htmlFor={`env-${envKey}`}>{envKey}</label>
                <input
                  id={`env-${envKey}`}
                  type="password"
                  placeholder={`Paste your ${envKey.toLowerCase().replace(/_/g, ' ')}`}
                  value={envValues[envKey] || ''}
                  onChange={(e) => setEnvValues((prev) => ({ ...prev, [envKey]: e.target.value }))}
                />
              </div>
            ))}
            {(entry.optionalFields ?? []).map((field) => (
              <div key={field.key} className="app-detail__field">
                <label htmlFor={`opt-${field.key}`}>
                  {field.label} <span className="app-detail__field-optional">(optional)</span>
                </label>
                {field.hint && <p className="app-detail__field-hint">{field.hint}</p>}
                <input
                  id={`opt-${field.key}`}
                  type="text"
                  placeholder={field.label}
                  value={optionalValues[field.key] || ''}
                  onChange={(e) =>
                    setOptionalValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="app-detail__connect"
              onClick={handleConnect}
              disabled={testing || !allEnvFilled}
            >
              {testing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} strokeWidth={2} />
              )}
              {testing ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}

        {/* Actions for already-configured connector */}
        {isConfigured && (
          <div className="app-detail__configured-actions">
            <button
              type="button"
              className="app-detail__action-btn"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Test Connection
            </button>
            <button
              type="button"
              className="app-detail__action-btn app-detail__action-btn--danger"
              onClick={handleDisconnect}
            >
              <Trash2 size={14} /> Disconnect
            </button>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className={`app-detail__test-result ${testResult.success ? 'app-detail__test-result--success' : 'app-detail__test-result--error'}`}
          >
            {testResult.success ? (
              <>
                <Check size={14} /> Found {testResult.tools.length} tools:{' '}
                {testResult.tools.join(', ')}
              </>
            ) : (
              <>
                <X size={14} /> {testResult.error || 'Connection failed'}
              </>
            )}
          </div>
        )}

        {/* Show Details toggle (only for non-OAuth) */}
        {!isConfigured && !isOAuth && !showDetails && (
          <button
            type="button"
            className="app-detail__show-details"
            onClick={() => setShowDetails(true)}
          >
            Show Details <ChevronDown size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Custom API Tab ─────────────────────────────────────────────────

function CustomApiTab({
  connectors,
  search,
}: {
  connectors: ConnectorStatusInfo[]
  search: string
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')

  const apiConnectors = connectors.filter(
    (c) => c.type === 'api' && (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  )

  const handleAdd = () => {
    if (!name) return
    const id = `api-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
    connectorStore.getState().addConnectorRemote({
      id,
      name,
      type: 'api',
      apiKey,
      baseUrl,
      enabled: true,
    })
    setAdding(false)
    setName('')
    setBaseUrl('')
    setApiKey('')
  }

  return (
    <div className="custom-connectors">
      <p className="custom-connectors__hint">
        Connect to any third-party service using your own API keys.
      </p>

      <div className="connectors-grid">
        <button
          type="button"
          className="connector-card connector-card--add"
          onClick={() => setAdding(true)}
        >
          <Plus size={20} />
          <span>Add custom API</span>
        </button>

        {apiConnectors.map((c) => (
          <div key={c.id} className="connector-card">
            <div className="connector-card__icon">{c.icon || '🔌'}</div>
            <div className="connector-card__info">
              <div className="connector-card__name">{c.name}</div>
              <div className="connector-card__desc">{c.description || 'Custom API'}</div>
            </div>
            <button
              type="button"
              className="connector-card__remove"
              onClick={() => connectorStore.getState().removeConnectorRemote(c.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="connector-form">
          <div className="connector-form__field">
            <label htmlFor="api-name">Name</label>
            <input
              id="api-name"
              type="text"
              placeholder="e.g. OpenAI"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="connector-form__field">
            <label htmlFor="api-base-url">Base URL</label>
            <input
              id="api-base-url"
              type="text"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="connector-form__field">
            <label htmlFor="api-key">API Key</label>
            <input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="connector-form__actions">
            <button
              type="button"
              className="connector-setup__btn connector-setup__btn--primary"
              onClick={handleAdd}
              disabled={!name}
            >
              Add
            </button>
            <button
              type="button"
              className="connector-setup__btn connector-setup__btn--secondary"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Custom MCP Tab ─────────────────────────────────────────────────

function CustomMcpTab({
  connectors,
  search,
}: {
  connectors: ConnectorStatusInfo[]
  search: string
}) {
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [envStr, setEnvStr] = useState('')
  const [jsonConfig, setJsonConfig] = useState('')

  const mcpConnectors = connectors.filter(
    (c) => c.type === 'mcp' && (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  )

  const handleAddForm = () => {
    if (!name || !command) return
    const id = `mcp-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
    const parsedEnv: Record<string, string> = {}
    for (const line of envStr.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) {
        parsedEnv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
      }
    }
    connectorStore.getState().addConnectorRemote({
      id,
      name,
      type: 'mcp',
      command,
      args: args
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean),
      env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
      enabled: true,
    })
    resetForm()
  }

  const handleAddJson = () => {
    try {
      const parsed = JSON.parse(jsonConfig)
      if (!parsed.name || !parsed.command) {
        alert('JSON must include "name" and "command" fields')
        return
      }
      const id = `mcp-${parsed.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
      connectorStore.getState().addConnectorRemote({
        id: parsed.id || id,
        name: parsed.name,
        description: parsed.description,
        type: 'mcp',
        command: parsed.command,
        args: parsed.args || [],
        env: parsed.env,
        enabled: true,
      })
      resetForm()
    } catch {
      alert('Invalid JSON')
    }
  }

  const resetForm = () => {
    setAdding(false)
    setName('')
    setCommand('')
    setArgs('')
    setEnvStr('')
    setJsonConfig('')
  }

  return (
    <div className="custom-connectors">
      {mcpConnectors.length === 0 && !adding && (
        <div className="connectors-empty-mcp">
          <Plug size={32} strokeWidth={1} />
          <p>No custom MCP added yet.</p>
        </div>
      )}

      {mcpConnectors.length > 0 && (
        <div className="connectors-grid">
          {mcpConnectors.map((c) => (
            <div
              key={c.id}
              className={`connector-card${c.connected ? ' connector-card--connected' : ''}`}
            >
              <div className="connector-card__icon">{c.icon || '🔧'}</div>
              <div className="connector-card__info">
                <div className="connector-card__name">
                  {c.name}
                  {c.connected && (
                    <span className="connector-card__badge">{c.toolCount} tools</span>
                  )}
                </div>
                <div className="connector-card__desc">{c.description || 'Custom MCP'}</div>
              </div>
              <div className="connector-card__actions">
                <button
                  type="button"
                  className="connector-card__toggle"
                  onClick={() => connectorStore.getState().toggleConnectorRemote(c.id, !c.enabled)}
                  title={c.enabled ? 'Disable' : 'Enable'}
                >
                  {c.enabled ? <Power size={12} /> : <PowerOff size={12} />}
                </button>
                <button
                  type="button"
                  className="connector-card__remove"
                  onClick={() => connectorStore.getState().removeConnectorRemote(c.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="custom-mcp-add">
        {!adding ? (
          <div className="custom-mcp-add__buttons">
            <button
              type="button"
              className="connector-setup__btn connector-setup__btn--secondary"
              onClick={() => {
                setAdding(true)
                setMode('form')
              }}
            >
              <Plus size={14} /> Add custom MCP
            </button>
          </div>
        ) : (
          <div className="connector-form">
            <div className="connector-form__tabs">
              <button
                type="button"
                className={mode === 'form' ? 'active' : ''}
                onClick={() => setMode('form')}
              >
                Direct configuration
              </button>
              <button
                type="button"
                className={mode === 'json' ? 'active' : ''}
                onClick={() => setMode('json')}
              >
                Import by JSON
              </button>
            </div>

            {mode === 'form' ? (
              <>
                <div className="connector-form__field">
                  <label htmlFor="mcp-name">Name</label>
                  <input
                    id="mcp-name"
                    type="text"
                    placeholder="e.g. My MCP Server"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="connector-form__field">
                  <label htmlFor="mcp-command">Command</label>
                  <input
                    id="mcp-command"
                    type="text"
                    placeholder="e.g. npx"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                  />
                </div>
                <div className="connector-form__field">
                  <label htmlFor="mcp-args">Arguments (space-separated)</label>
                  <input
                    id="mcp-args"
                    type="text"
                    placeholder="e.g. -y @anthropic/mcp-server-slack"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </div>
                <div className="connector-form__field">
                  <label htmlFor="mcp-env">Environment Variables (one per line: KEY=VALUE)</label>
                  <textarea
                    id="mcp-env"
                    placeholder={'SLACK_BOT_TOKEN=xoxb-...\nSLACK_TEAM_ID=T...'}
                    value={envStr}
                    onChange={(e) => setEnvStr(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="connector-form__actions">
                  <button
                    type="button"
                    className="connector-setup__btn connector-setup__btn--primary"
                    onClick={handleAddForm}
                    disabled={!name || !command}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="connector-setup__btn connector-setup__btn--secondary"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="connector-form__field">
                  <label htmlFor="mcp-json-config">MCP Server Config (JSON)</label>
                  <textarea
                    id="mcp-json-config"
                    placeholder={
                      '{\n  "name": "My Server",\n  "command": "npx",\n  "args": ["-y", "@my/mcp-server"],\n  "env": { "API_KEY": "..." }\n}'
                    }
                    value={jsonConfig}
                    onChange={(e) => setJsonConfig(e.target.value)}
                    rows={8}
                    className="connector-form__json"
                  />
                </div>
                <div className="connector-form__actions">
                  <button
                    type="button"
                    className="connector-setup__btn connector-setup__btn--primary"
                    onClick={handleAddJson}
                    disabled={!jsonConfig.trim()}
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    className="connector-setup__btn connector-setup__btn--secondary"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
