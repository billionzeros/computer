import {
  Check,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  X,
  Plug,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { connection } from '../../lib/connection.js'
import {
  type ConnectorRegistryInfo,
  type ConnectorStatusInfo,
  useStore,
} from '../../lib/store.js'

type Tab = 'apps' | 'custom-api' | 'custom-mcp'

export function ConnectorsPage() {
  const [tab, setTab] = useState<Tab>('apps')
  const [search, setSearch] = useState('')
  const connectors = useStore((s) => s.connectors)
  const registry = useStore((s) => s.connectorRegistry)

  useEffect(() => {
    connection.sendConnectorsList()
    connection.sendConnectorRegistryList()
  }, [])

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
          />
        )}
        {tab === 'custom-api' && (
          <CustomApiTab connectors={connectors} search={search} />
        )}
        {tab === 'custom-mcp' && (
          <CustomMcpTab connectors={connectors} search={search} />
        )}
      </div>
    </div>
  )
}

// ── Apps Tab ────────────────────────────────────────────────────────

function AppsTab({
  registry,
  connectors,
  search,
}: {
  registry: ConnectorRegistryInfo[]
  connectors: ConnectorStatusInfo[]
  search: string
}) {
  const [setupId, setSetupId] = useState<string | null>(null)

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
        />
      )
    }
  }

  return (
    <div className="connectors-grid">
      {filtered.map((entry) => {
        const existing = connectors.find((c) => c.id === entry.id)
        return (
          <button
            key={entry.id}
            type="button"
            className={`connector-card${existing?.connected ? ' connector-card--connected' : ''}`}
            onClick={() => setSetupId(entry.id)}
          >
            <div className="connector-card__icon">{entry.icon}</div>
            <div className="connector-card__info">
              <div className="connector-card__name">
                {entry.name}
                {existing?.connected && (
                  <span className="connector-card__badge">Connected</span>
                )}
              </div>
              <div className="connector-card__desc">{entry.description}</div>
            </div>
          </button>
        )
      })}
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
}: {
  entry: ConnectorRegistryInfo
  existing?: ConnectorStatusInfo
  onBack: () => void
}) {
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    tools: string[]
    error?: string
  } | null>(null)

  const isConfigured = existing != null
  const allEnvFilled = entry.requiredEnv.every((k) => envValues[k])

  const handleConnect = () => {
    const env: Record<string, string> = {}
    for (const key of entry.requiredEnv) {
      if (envValues[key]) env[key] = envValues[key]
    }

    connection.sendConnectorAdd({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      type: entry.type,
      command: entry.command,
      args: entry.args,
      env,
      enabled: true,
    })

    setTesting(true)
    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_added' || msg.type === 'connector_status') {
        setTesting(false)
        unsub()
        onBack()
      }
    })

    setTimeout(() => {
      setTesting(false)
      unsub()
    }, 20_000)
  }

  const handleDisconnect = () => {
    connection.sendConnectorRemove(entry.id)
    onBack()
  }

  const handleTest = () => {
    setTesting(true)
    setTestResult(null)
    connection.sendConnectorTest(entry.id)

    const unsub = connection.onMessage((_channel, msg) => {
      if (msg.type === 'connector_test_response' && msg.id === entry.id) {
        setTesting(false)
        setTestResult({ success: msg.success, tools: msg.tools || [], error: msg.error })
        unsub()
      }
    })

    setTimeout(() => {
      setTesting(false)
      unsub()
    }, 30_000)
  }

  return (
    <div className="app-detail-overlay" onClick={onBack} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBack() }}>
      <div className="app-detail" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {/* Close */}
        <button type="button" className="app-detail__close" onClick={onBack}>
          <X size={18} strokeWidth={1.5} />
        </button>

        {/* Icon */}
        <div className="app-detail__icon">{entry.icon}</div>

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

        {/* Connect button (not yet configured) */}
        {!isConfigured && !showDetails && (
          <button
            type="button"
            className="app-detail__connect"
            onClick={() => setShowDetails(true)}
          >
            <Plus size={16} strokeWidth={2} />
            Connect
          </button>
        )}

        {/* Env fields (shown after clicking Connect or Show Details) */}
        {!isConfigured && showDetails && (
          <div className="app-detail__fields">
            {entry.requiredEnv.map((envKey) => (
              <div key={envKey} className="app-detail__field">
                <label htmlFor={`env-${envKey}`}>{envKey}</label>
                <input
                  id={`env-${envKey}`}
                  type="password"
                  placeholder={`Paste your ${envKey.toLowerCase().replace(/_/g, ' ')}`}
                  value={envValues[envKey] || ''}
                  onChange={(e) =>
                    setEnvValues((prev) => ({ ...prev, [envKey]: e.target.value }))
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

        {/* Show Details toggle */}
        {!isConfigured && !showDetails && (
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
    (c) =>
      c.type === 'api' &&
      (!search ||
        c.name.toLowerCase().includes(search.toLowerCase())),
  )

  const handleAdd = () => {
    if (!name) return
    const id = `api-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
    connection.sendConnectorAdd({
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
              onClick={() => connection.sendConnectorRemove(c.id)}
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
    (c) =>
      c.type === 'mcp' &&
      (!search || c.name.toLowerCase().includes(search.toLowerCase())),
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
    connection.sendConnectorAdd({
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
      connection.sendConnectorAdd({
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
                  onClick={() => connection.sendConnectorToggle(c.id, !c.enabled)}
                  title={c.enabled ? 'Disable' : 'Enable'}
                >
                  {c.enabled ? <Power size={12} /> : <PowerOff size={12} />}
                </button>
                <button
                  type="button"
                  className="connector-card__remove"
                  onClick={() => connection.sendConnectorRemove(c.id)}
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
                    placeholder={'{\n  "name": "My Server",\n  "command": "npx",\n  "args": ["-y", "@my/mcp-server"],\n  "env": { "API_KEY": "..." }\n}'}
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
