# Connectors Spec

## Overview

Connectors integrate external services (Slack, Gmail, GitHub, etc.) into the agent. Three connector types:

| Type | How it works | Auth | Example |
|------|-------------|------|---------|
| `oauth` | Direct API calls, one-click OAuth flow | OAuth 2.0 via proxy | Slack, GitHub |
| `mcp` | Spawns MCP server subprocess (stdio JSON-RPC) | Manual env vars | Custom servers |
| `api` | Direct API calls with user-provided credentials | Encrypted credential store | Telegram, Granola |

**OAuth connectors are the default for core services.** MCP and API remain as escape hatches for custom/community connectors.

> **Inbound traffic / bots.** Some connectors don't just *call* services
> outward -- they receive events too (Slack `@mentions`, Telegram messages,
> GitHub webhooks). All of those plug into a single unified webhook
> abstraction. See:
>
> - `specs/architecture/WEBHOOK_ROUTER.md` -- the `WebhookProvider` /
>   `WebhookRouter` pattern under `/_anton/webhooks/{slug}` that every
>   inbound integration shares.
> - `specs/features/SLACK_BOT.md` -- the Slack-specific design:
>   two connectors (`slack` user delegate + `slack-bot` workspace bot),
>   developer-owned Cloudflare Worker fan-out, per-install `forward_secret`,
>   and the ownership-transfer UX that lets multiple Antons coexist on the
>   same Slack app.

## Architecture

```
Desktop UI                Agent Server (VPS)              OAuth Proxy (CF Worker)
--------------            ------------------              ----------------------
Click "Connect"           Generate state nonce
  -> WS: oauth_start      Build authorize URL
  <- WS: oauth_url        -------------------------------->  302 to provider
Open browser                                              User authorizes
                          POST /_anton/oauth/cb  <--------  Exchange code -> token
                          Encrypt + store in CredentialStore
                          Activate connector via configure()
  <- WS: oauth_complete   Tools available in session
```

## Credential System

All connector secrets (OAuth tokens, API keys, bot tokens, wallet addresses) are stored in a unified encrypted credential store. See `specs/features/connector-credentials.md` for the full design.

**Key properties:**
- All secrets encrypted at rest (AES-256-GCM) in `~/.anton/tokens/{id}.enc`
- `config.yaml` is secret-free -- safe to back up, share, or inspect
- Desktop client never receives secrets -- only `hasCredentials: boolean`
- Single `configure(config: ConnectorEnv)` interface for all connector types

## OAuth Flow (One-Click Connectors)

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| OAuth Proxy | Separate CF Worker project | Holds client_id/secret, handles code exchange |
| OAuthFlow | `agent-server/src/oauth/oauth-flow.ts` | State management, token refresh |
| CredentialStore | `agent-server/src/credential-store.ts` | AES-256-GCM encrypted credential storage |
| ConnectorManager | `packages/connectors/connector-manager.ts` | Manages active direct connectors |
| Direct connectors | `packages/connectors/slack/`, `github/` | Typed API clients + tool definitions |

### Credential Storage

All connector credentials are stored encrypted on each user's VPS:

```
~/.anton/tokens/
  slack.enc              # AES-256-GCM encrypted (OAuth token)
  github.enc             # AES-256-GCM encrypted (OAuth token)
  telegram.enc           # AES-256-GCM encrypted (API secrets)
  granola.enc            # AES-256-GCM encrypted (API key)
```

- Encryption key derived from `config.token` via HKDF (`sha256`, salt: `anton-token-store`)
- Format: `iv (12 bytes) + auth tag (16 bytes) + ciphertext`
- File permissions: `0600`
- Tokens never leave the user's VPS unencrypted
- `StoredCredentials` type supports both OAuth fields (`accessToken`, `refreshToken`, `expiresAt`) and arbitrary secrets (`secrets: Record<string, string>`)
- Existing `.enc` files are backward compatible -- `secrets` is an optional field

### OAuth Proxy

The proxy is a stateless Cloudflare Worker. It holds OAuth app credentials (client_id/secret) and handles the authorization redirect + code-for-token exchange.

**Key points:**
- Proxy stores NOTHING after the exchange
- Tokens are POSTed to the agent's callback URL, then forgotten
- State parameter is HMAC-signed to prevent CSRF
- Open source -- anyone can deploy their own

**Endpoints:**
- `GET /oauth/:provider/authorize` -- 302 redirect to provider consent
- `GET /oauth/:provider/callback` -- exchange code, POST token to agent
- `POST /oauth/:provider/refresh` -- refresh expired tokens
- `GET /providers` -- list configured providers

### Environment Variables

Set on the agent server (in `~/.anton/agent.env`):

```
OAUTH_PROXY_URL=https://your-proxy.workers.dev
OAUTH_CALLBACK_BASE_URL=https://yourname.antoncomputer.in
```

Configure via CLI: `sudo anton computer config oauth`

### Direct Connector Interface

All connectors implement `DirectConnector` with a single `configure()` method:

```ts
interface ConnectorEnv {
  env: Record<string, string>       // All config values resolved from credential store + process.env
  refreshToken?: () => Promise<string>  // Lazy OAuth token refresh (API connectors don't get this)
}

interface DirectConnector {
  readonly id: string
  readonly name: string
  readonly surfaces?: ConnectorSurface[]
  configure(config: ConnectorEnv): void
  getTools(): AgentTool[]
  testConnection(): Promise<{ success: boolean; error?: string; info?: string }>
}
```

**Connector patterns:**

| Pattern | Connectors | How configure() works |
|---------|-----------|----------------------|
| OAuth | GitHub, Gmail, Notion, Linear, Airtable, Slack, Google Calendar/Drive/Docs/Sheets/Search Console | Reads `env.ACCESS_TOKEN`, sets `refreshToken` provider |
| API key | Telegram, Granola | Reads key from `env` (e.g. `TELEGRAM_BOT_TOKEN`, `GRANOLA_API_KEY`) |
| Compound token | LinkedIn, Exa | Reads `env.ACCESS_TOKEN` (compound format parsed internally) |

### ConnectorManager

```ts
type EnvResolver = (providerId: string) => Promise<ConnectorEnv>

class ConnectorManager {
  constructor(factories: Record<string, ConnectorFactory>, resolveEnv: EnvResolver)
  activate(id, opts?): Promise<boolean>   // resolveEnv -> configure
  deactivate(id): void
  reconfigure(id): Promise<void>          // re-resolve env on a live instance
  getAllTools(surface?): AgentTool[]
  testConnection(id): Promise<{...}>
}
```

### Direct Connector Tools

**Slack** (`packages/connectors/src/slack/`):
- `slack_list_channels`, `slack_send_message`, `slack_get_history`
- `slack_get_thread`, `slack_list_users`, `slack_search`, `slack_add_reaction`

**GitHub** (`packages/connectors/src/github/`):
- `github_list_repos`, `github_get_repo`, `github_list_issues`, `github_get_issue`
- `github_create_issue`, `github_add_comment`, `github_list_prs`, `github_get_pr`
- `github_search_code`, `github_search_issues`

Tool naming: `{service}_{action}` (no `mcp_` prefix).

## MCP Connectors (`type: 'mcp'`)

Run an MCP server process. The agent communicates via JSON-RPC 2.0 over stdio.

- Requires `command` and `args` fields
- `requiredEnv` values are passed as environment variables to the spawned process
- Tool naming: `mcp_{serverId}_{toolName}`
- Auto-reconnect on process crash (5s delay)
- Health checks every 60s

## API Connectors (`type: 'api'`)

API key-based integrations. All credentials from `requiredEnv` and `optionalFields` are stored encrypted in the credential store. The connector reads them from the `env` bag passed to `configure()`.

The server resolves env for API connectors using:
1. Encrypted secrets from credential store (highest priority)
2. `process.env` fallback using declared registry keys (e.g. `TELEGRAM_BOT_TOKEN`)

## Adding a New Built-in Connector

### OAuth Connector (recommended for core services)

1. **Add provider to OAuth proxy** (`oauth-proxy/src/providers/`):
   ```ts
   export const yourservice: OAuthProviderConfig = {
     authorizeUrl: 'https://...',
     tokenUrl: 'https://...',
     scopes: ['read', 'write'],
     pkce: false,
   }
   ```

2. **Register OAuth app** with the provider, set redirect URL to `https://<proxy>/oauth/yourservice/callback`

3. **Set CF Worker secrets**: `wrangler secret put YOURSERVICE_CLIENT_ID`, etc.

4. **Add direct connector** (`packages/connectors/src/yourservice/`):

   **`api.ts`** -- typed HTTP client:
   ```ts
   export class YourServiceAPI {
     private token = ''
     private refreshFn?: () => Promise<string>

     setToken(token: string): void { this.token = token }
     setRefreshToken(fn: () => Promise<string>): void { this.refreshFn = fn }

     private async getToken(): Promise<string> {
       // If a refreshFn is set, always call it (handles expiry internally)
       if (this.refreshFn) return this.refreshFn()
       return this.token
     }

     async listItems(): Promise<Item[]> {
       const token = await this.getToken()
       const res = await fetch('https://api.yourservice.com/items', {
         headers: { Authorization: `Bearer ${token}` },
       })
       if (!res.ok) throw new Error(`YourService API error: ${res.status}`)
       return res.json()
     }
   }
   ```

   **`tools.ts`** -- AgentTool definitions:
   ```ts
   import type { AgentTool } from '@mariozechner/pi-agent-core'
   import type { YourServiceAPI } from './api.js'

   export function createYourServiceTools(api: YourServiceAPI): AgentTool[] {
     return [
       {
         name: 'yourservice_list_items',           // {service}_{action} convention
         description: 'List items from YourService',
         parameters: { type: 'object', properties: {}, required: [] },
         execute: async () => {
           const items = await api.listItems()
           return JSON.stringify(items)
         },
       },
     ]
   }
   ```

   **`index.ts`** -- DirectConnector (OAuth pattern):
   ```ts
   import type { AgentTool } from '@mariozechner/pi-agent-core'
   import type { ConnectorEnv, DirectConnector } from '../types.js'
   import { YourServiceAPI } from './api.js'
   import { createYourServiceTools } from './tools.js'

   export class YourServiceConnector implements DirectConnector {
     readonly id = 'yourservice'
     readonly name = 'YourService'

     private api = new YourServiceAPI()
     private tools: AgentTool[] = []

     configure(config: ConnectorEnv): void {
       this.api.setToken(config.env.ACCESS_TOKEN ?? '')
       if (config.refreshToken) this.api.setRefreshToken(config.refreshToken)
       this.tools = createYourServiceTools(this.api)
     }

     getTools(): AgentTool[] { return this.tools }

     async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
       try {
         const items = await this.api.listItems()
         return { success: true, info: `Connected — ${items.length} item(s)` }
       } catch (err) {
         return { success: false, error: (err as Error).message }
       }
     }
   }
   ```

5. **Add to factory** (`packages/connectors/src/index.ts`):
   ```ts
   CONNECTOR_FACTORIES['yourservice'] = () => new YourServiceConnector()
   ```

6. **Add registry entry** (`packages/agent-config/src/config.ts`):
   ```ts
   {
     id: 'yourservice',
     name: 'YourService',
     description: 'What the connector does in one sentence',
     icon: '🔧',
     category: 'productivity',            // messaging | productivity | development | social | other
     type: 'oauth',
     oauthProvider: 'yourservice',         // must match the OAuth proxy provider key
     oauthScopes: ['read', 'write'],       // display-only, actual scopes set in proxy
     requiredEnv: [],                       // OAuth connectors usually have no requiredEnv
     featured: true,                        // show on the main connector page
     multiAccount: false,                   // set true if users can connect multiple accounts
     setupGuide: {
       steps: ['Click Connect to authorize with YourService'],
       url: 'https://yourservice.com/docs/oauth',
       urlLabel: 'YourService Docs',
     },
   }
   ```

7. **Add brand icon** (`packages/desktop/src/components/connectors/ConnectorIcons.tsx`)

### API Connector (for key-based services)

1. **Add direct connector** (`packages/connectors/src/yourservice/`):

   **`api.ts`** -- typed HTTP client:
   ```ts
   export class YourServiceAPI {
     private apiKey = ''

     setApiKey(key: string): void { this.apiKey = key }

     async listItems(): Promise<Item[]> {
       const res = await fetch('https://api.yourservice.com/items', {
         headers: { 'X-Api-Key': this.apiKey },
       })
       if (!res.ok) throw new Error(`YourService API error: ${res.status}`)
       return res.json()
     }
   }
   ```

   **`index.ts`** -- DirectConnector (API pattern):
   ```ts
   import type { ConnectorEnv, DirectConnector } from '../types.js'
   import { YourServiceAPI } from './api.js'
   import { createYourServiceTools } from './tools.js'

   export class YourServiceConnector implements DirectConnector {
     readonly id = 'yourservice'
     readonly name = 'YourService'

     private api = new YourServiceAPI()
     private tools: AgentTool[] = []

     configure(config: ConnectorEnv): void {
       // Read the EXACT key names declared in requiredEnv / optionalFields
       this.api.setApiKey(config.env.YOURSERVICE_API_KEY ?? '')
       this.tools = createYourServiceTools(this.api)
     }

     getTools(): AgentTool[] { return this.tools }

     async testConnection(): Promise<{ success: boolean; error?: string; info?: string }> {
       try {
         const items = await this.api.listItems()
         return { success: true, info: `Connected — ${items.length} item(s)` }
       } catch (err) {
         return { success: false, error: (err as Error).message }
       }
     }
   }
   ```

2. **Add to factory and registry**:
   ```ts
   // packages/connectors/src/index.ts
   CONNECTOR_FACTORIES['yourservice'] = () => new YourServiceConnector()

   // packages/agent-config/src/config.ts — CONNECTOR_REGISTRY
   {
     id: 'yourservice',
     name: 'YourService',
     description: 'What the connector does',
     icon: '🔧',
     category: 'productivity',
     type: 'api',
     requiredEnv: ['YOURSERVICE_API_KEY'],       // user MUST provide these to connect
     optionalFields: [                            // shown in UI but not required
       {
         key: 'YOURSERVICE_WORKSPACE',
         label: 'Workspace ID',
         hint: 'Found in Settings → Workspace → ID',
       },
     ],
     featured: false,
     setupGuide: {
       steps: [
         'Go to YourService → Settings → API Keys',
         'Generate a new key with read+write scope',
         'Paste the key below',
       ],
       url: 'https://yourservice.com/docs/api-keys',
       urlLabel: 'API Key Docs',
     },
   }
   ```

   **Important:** The key names in `requiredEnv` and `optionalFields[].key` MUST exactly match what the connector reads from `config.env` in its `configure()` method. The server resolves env by iterating these declared keys.

3. All credentials are encrypted automatically via the credential store -- no special handling needed.

### MCP Connector (for community/custom services)

1. Add registry entry with `type: 'mcp'`, `command`, `args`, `requiredEnv`
2. Add brand icon
3. That's it -- MCP protocol handles tool discovery automatically

### Common Mistakes When Adding Connectors

| Mistake | What happens | Fix |
|---------|-------------|-----|
| Key name in `requiredEnv` doesn't match `config.env.XXX` in `configure()` | Connector gets empty string, `testConnection` fails | Use identical key names in registry and connector code |
| Forgot to add factory in `index.ts` | `activate()` silently fails, no tools appear | Always register `CONNECTOR_FACTORIES['id'] = () => new Connector()` |
| Tool name doesn't follow `{service}_{action}` | Risk of name collision with other connectors | Prefix every tool with the service name |
| Duplicate tool names within one connector | LLM API returns `400 invalid_request_error` | Each tool name must be unique across all active connectors |
| `testConnection()` doesn't catch errors | Unhandled rejection crashes the connection test handler | Always wrap in try/catch, return `{ success: false, error }` |

## Per-Tool Permissions

Every connector's tools support per-tool permission overrides. Users configure these in the desktop UI on a per-tool basis.

### Permission Levels

| Level | Behavior |
|-------|----------|
| `auto` | Tool runs without confirmation (default) |
| `ask` | Agent pauses and asks the user for confirmation before calling |
| `never` | Tool is hidden from the agent -- it never sees it in the tool list |

### How Permissions Are Stored

Permissions are saved in `config.yaml` under each connector's config:

```yaml
connectors:
  - id: github
    type: oauth
    enabled: true
    toolPermissions:
      github_create_issue: ask      # require confirmation before creating issues
      github_add_comment: ask
      github_search_code: auto      # search is safe, auto-approve
```

On startup and after any update, `server.ts` calls `connectorManager.setToolPermissions(id, perms)` (or `mcpManager.setToolPermissions(id, perms)` for MCP connectors) to load these into memory.

### Enforcement

Permissions are enforced at two layers (defense-in-depth):

1. **Tool list filtering** -- `connectorManager.getAllTools()` strips tools marked `never` before the list reaches the agent. The model never sees hidden tools.

2. **`session.beforeToolCall` gate** -- even if a tool somehow gets through, the session checks both `mcpManager.getToolPermission(toolName)` and `connectorManager.getToolPermission(toolName)` before execution. `never` blocks the call; `ask` routes through the user confirmation handler.

### Adding Permissions for a New Connector

No special code needed. Permissions work automatically for any connector whose tools are registered via `getTools()`. The desktop UI reads the tool list from `connector_test_response` and renders permission toggles for each tool.

To set sensible defaults for a new connector, consider which tools have side effects:

| Tool type | Suggested default | Example |
|-----------|------------------|---------|
| Read-only queries | `auto` | `github_list_repos`, `slack_get_history` |
| Write operations | `ask` (or `auto` if low-risk) | `github_create_issue`, `slack_send_message` |
| Destructive actions | `ask` or `never` | Deleting resources, revoking access |

Defaults are `auto` unless the user changes them. The UI lets users override any tool to any level.

## Validation & Testing

### Quick Smoke Test (Manual)

After adding or modifying a connector, verify the full lifecycle:

1. **Add connector via UI**
   - Open desktop → Connectors → find your connector → click Connect
   - For OAuth: complete the authorization flow in the browser
   - For API: fill in `requiredEnv` fields and any `optionalFields`, click Save
   - **Verify:** `connector_added` message appears in WS, connector shows as enabled

2. **Check credential storage**
   ```bash
   # Verify the .enc file was created
   ls -la ~/.anton/tokens/yourservice.enc
   # Should exist with 0600 permissions

   # Verify config.yaml has NO secrets
   cat ~/.anton/config.yaml | grep -i "key\|token\|secret"
   # Should return nothing for your connector (only id, type, enabled, toolPermissions)
   ```

3. **Test connection**
   - Click "Test" in the UI (or send `connector_test` via WS)
   - **Verify:** returns `success: true` with info string, plus a tool list

4. **Use a tool in a session**
   - Start a session and ask the agent to use one of the connector's tools
   - **Verify:** tool call succeeds and returns expected data

5. **Test credential update**
   - Edit the connector in the UI, change a field, save
   - **Verify:** `reconfigure()` is called, existing sessions pick up the new credentials
   - **Verify:** `.enc` file is updated (check modified timestamp)

6. **Test disconnect/remove**
   - Remove the connector via UI
   - **Verify:** `.enc` file is deleted
   - **Verify:** tools disappear from active sessions immediately
   - **Verify:** `config.yaml` entry is removed

### Process.env Fallback Test

For headless deployments without the UI:

```bash
# 1. Add the env var to agent.env
echo 'YOURSERVICE_API_KEY=sk-test-123' >> ~/.anton/agent.env

# 2. Manually add connector to config.yaml (no secrets here)
# connectors:
#   - id: yourservice
#     type: api
#     enabled: true

# 3. Restart the agent server
sudo systemctl restart anton-agent

# 4. Check logs for activation
journalctl -u anton-agent --since "1 min ago" | grep yourservice
# Should see: "activated { connector: 'YourService', toolCount: N }"
```

The server resolves env in this order:
1. Encrypted secrets from `~/.anton/tokens/yourservice.enc` (highest priority)
2. `process.env` values for keys declared in the connector's `requiredEnv` + `optionalFields`

If both exist, credential store wins.

### OAuth Token Refresh Test

For OAuth connectors, verify token refresh works:

1. Connect the OAuth connector normally
2. Wait for the token to expire (or manually set `expiresAt` to a past timestamp in a dev build)
3. Make a tool call that requires authentication
4. **Verify:** the `refreshToken` callback fires, fetches a new access token from the proxy, and the call succeeds
5. **Verify:** logs show the refresh happening (debug level): `token refreshed { provider: 'yourservice' }`

### `hasCredentials` Status Test

The desktop UI shows credential status without ever receiving secret values:

1. Connect a connector → **Verify:** `connectors_list_response` includes `hasCredentials: true` for that connector
2. Disconnect it → **Verify:** `hasCredentials` becomes `false` (or the connector is removed from the list)
3. **Verify at no point** does the WS payload contain `accessToken`, `refreshToken`, `apiKey`, or any secret value

### Build Verification

After any connector changes, verify compilation:

```bash
# Type-check the affected packages (run from repo root)
cd packages/connectors && npx tsc --noEmit
cd packages/agent-server && npx tsc --noEmit
cd packages/agent-config && npx tsc --noEmit
cd packages/protocol && npx tsc --noEmit
```

All four must pass cleanly. Pre-existing errors in `@anton/agent-core` (unrelated to connectors) can be ignored.

## Protocol Messages

| Direction | Message | Purpose |
|-----------|---------|---------|
| C -> S | `connectors_list` | Request all connector statuses |
| C -> S | `connector_add` | Add a connector (sends `env` bag for API connectors) |
| C -> S | `connector_update` | Update a connector (can include `env` for credential updates) |
| C -> S | `connector_remove` | Remove a connector (deletes credentials) |
| C -> S | `connector_toggle` | Enable/disable a connector |
| C -> S | `connector_test` | Test connection, list tools |
| C -> S | `connector_registry_list` | Request built-in registry |
| C -> S | `connector_oauth_start` | Start OAuth flow for a provider |
| C -> S | `connector_oauth_disconnect` | Disconnect OAuth connector (drops token then delegates to full removal -- see invariant below) |
| S -> C | `connectors_list_response` | Full connector status list (includes `hasCredentials`) |
| S -> C | `connector_added` | Confirmation with status |
| S -> C | `connector_status` | Status update |
| S -> C | `connector_test_response` | Test result with tools list |
| S -> C | `connector_registry_list_response` | Built-in registry entries |
| S -> C | `connector_oauth_url` | Auth URL for desktop to open |
| S -> C | `connector_oauth_complete` | OAuth flow result |

## Security

### Credential Isolation

- All connector secrets (OAuth tokens AND API keys) encrypted at rest (AES-256-GCM) in `~/.anton/tokens/`
- Each user's credentials are on their own VPS, encrypted with their own agent token via HKDF
- `config.yaml` contains NO secrets -- safe to inspect, backup, or share
- Desktop client receives `hasCredentials: boolean`, never actual secret values
- OAuth proxy is stateless -- holds app credentials, not user tokens
- Direct API calls use credentials from encrypted store via closure -- never in system prompt

### process.env Fallback

For headless / systemd deployments, connectors can be configured via environment variables without the UI:
- Set `TELEGRAM_BOT_TOKEN` in `~/.anton/agent.env` and Telegram activates on startup
- The server checks `process.env` as a fallback, but ONLY for keys declared in the connector's registry entry
- No wildcard env scanning -- only `requiredEnv` and `optionalFields` keys are checked

### Credential Cleanup

- `connector_remove` deletes the `.enc` file via `credentialStore.delete(id)`
- `connector_oauth_disconnect` runs full removal (token + config + tools + cleanup hooks)
- Agent token rotation makes existing secrets unreadable (expected -- same as OAuth behavior)

### Caddy Routing

The `/_anton/oauth/callback` route MUST go to the agent (port 9876), not the sidecar:

```
handle /_anton/oauth/* {
    reverse_proxy localhost:9876
}
handle_path /_anton/* {
    reverse_proxy localhost:9878
}
```

## Environment File Path

**Canonical path:** `~/.anton/agent.env` (same as Ansible)

The CLI auto-detects the path by reading the systemd service's `EnvironmentFile` directive. Falls back to `~/.anton/agent.env`.

## Key Files

| File | Purpose |
|------|---------|
| `packages/agent-config/src/config.ts` | ConnectorConfig, ConnectorRegistryEntry, CONNECTOR_REGISTRY |
| `packages/connectors/src/` | Direct API connectors (Slack, GitHub, Telegram, etc.) |
| `packages/connectors/src/types.ts` | `DirectConnector`, `ConnectorEnv`, `ConnectorFactory` types |
| `packages/connectors/src/connector-manager.ts` | ConnectorManager -- activation, env resolution, tool aggregation |
| `packages/agent-server/src/credential-store.ts` | CredentialStore -- encrypted credential storage for all connector types |
| `packages/agent-server/src/oauth/oauth-flow.ts` | OAuth state machine, token refresh |
| `packages/agent-server/src/oauth/oauth-callback.ts` | HTTP callback handler |
| `packages/agent-server/src/server.ts` | WS handlers, `resolveConnectorEnv()`, HTTP callback route, session wiring |
| `packages/agent-core/src/agent.ts` | `buildTools()` -- merges MCP + direct connector tools |
| `packages/agent-core/src/session.ts` | Passes connectorManager to buildTools |
| `packages/protocol/src/messages.ts` | Connector message types (includes `hasCredentials` on status) |
| `packages/desktop/src/components/connectors/ConnectorsPage.tsx` | Connector UI -- sends all values in single `env` bag |

## Invariants & Rules

These are hard rules that MUST hold. Violations cause API failures or broken UI.

### Tool Name Uniqueness

**Rule:** All tool names sent to the LLM API MUST be unique. Duplicate names cause `400 invalid_request_error`.

- `buildTools()` in `agent-core/src/agent.ts` deduplicates by name (first definition wins)
- Connector tool names MUST use the `{service}_{action}` prefix convention
- Each connector MUST NOT define the same tool name twice (e.g. two `gsc_inspect_url`)
- MCP tools are namespaced as `mcp_{serverId}_{toolName}` -- safe by design

### Connector Type Handling

**Rule:** Server handlers (toggle, test, remove) MUST handle ALL connector types, not just MCP.

Three managers exist for different connector types:

| Manager | Connector Types | Methods |
|---------|----------------|---------|
| `mcpManager` | `mcp` | toggleConnector, testConnector, removeConnector, setToolPermissions, getToolPermission |
| `connectorManager` | `oauth`, `api` | activate, deactivate, reconfigure, testConnection, setToolPermissions, getToolPermission |
| `oauthFlow` | `oauth` (tokens) | hasToken, startFlow, disconnect |

Server handlers MUST check connector type before routing to the correct manager. Pattern:

```ts
if (mcpManager knows about it) -> use mcpManager
else if (connectorManager knows about it) -> use connectorManager
else -> handle gracefully (don't throw)
```

### Unified Activation

**Rule:** All direct connector activation goes through `connectorManager.activate()`. There is no separate `activateWithToken()` path.

The `activate()` method calls `resolveConnectorEnv(id)` which handles the difference between OAuth and API connectors internally:
- OAuth connectors get `env.ACCESS_TOKEN` + `refreshToken` callback
- API connectors get their declared keys from the credential store or process.env

Server startup uses a single `startConnectors()` method for both OAuth and API connectors. No branching by type.

### Secrets Never in config.yaml

**Rule:** `config.yaml` MUST NOT contain any secrets (API keys, tokens, passwords).

- `handleConnectorAdd()` strips `env` from the config before persisting to YAML
- All secrets go to `credentialStore.save()` as encrypted `.enc` files
- The `apiKey` and `baseUrl` fields have been removed from `ConnectorConfig`
- MCP connectors still use `env` in config for non-secret environment variables passed to subprocesses

### Per-tool Permissions

**Rule:** Per-tool `never`/`ask` permissions MUST be enforced uniformly for
both MCP connectors and direct (oauth/api) connectors. The UI exposes the
toggles for every connector type, and the agent must honour them regardless
of how the tool is implemented.

Two enforcement layers, mirrored across both managers:

1. **`getAllTools()` filtering** -- tools marked `never` are stripped from
   the list before it reaches the agent, so the model never sees them.
2. **`session.beforeToolCall` gate** -- defence-in-depth. Looks up the tool
   name in *both* `mcpManager.getToolPermission()` and
   `connectorManager.getToolPermission()` and combines them (`never` wins
   over `ask` wins over `auto`). `never` blocks; `ask` routes through the
   confirm handler before the call runs.

Lifecycle wiring (server.ts) -- every place that touches a connector's
permissions must update the matching manager:

| Event | MCP path | Direct path |
|---|---|---|
| Server startup restore | `mcpManager.setToolPermissions` | `connectorManager.setToolPermissions` |
| `connector_add` | `mcpManager.setToolPermissions` | `connectorManager.setToolPermissions` |
| `connector_update` | `mcpManager.setToolPermissions` | `connectorManager.setToolPermissions` + `refreshAllSessionTools()` |
| `connector_set_tool_permission` | `mcpManager.setToolPermissions` | `connectorManager.setToolPermissions` (both, always) |
| `connector_remove` | (handled via removeConnector) | `connectorManager.setToolPermissions(id, undefined)` |

### Error Surfacing

**Rule:** LLM API errors MUST be surfaced to the user, never swallowed silently.

- The pi SDK catches API errors and sets `stopReason: 'error'` + `errorMessage` on the assistant message
- `translateEvent` in `session.ts` checks `turn_end` for `stopReason === 'error'` and emits an error event
- `agent_end` checks ALL messages (not just `[0]`) for `errorMessage`
- Server logs the error with `[session X] LLM ERROR: ...`

### OAuth Disconnect = Full Removal

**Rule:** `connector_oauth_disconnect` MUST run the same teardown sequence as
`connector_remove`. There is no separate "just delete the token" path.

The handler clears the encrypted token first (so no further outbound calls
can be made), then delegates to `handleConnectorRemove({ id })`. This
guarantees that for every OAuth connector -- and especially `slack-bot` -- the
disconnect:

- runs provider-specific cleanup hooks (e.g. `notifyProxySlackBotDisconnect`)
- calls `connectorManager.deactivate(id)` so the active client is dropped
- calls `connectorManager.setToolPermissions(id, undefined)` so a fresh
  re-install starts clean
- calls `credentialStore.delete(id)` so the `.enc` file is removed
- calls `refreshAllSessionTools()` so live sessions immediately lose the
  connector's tools (instead of attempting calls that 401 because the token
  was just deleted)
- emits `connector_removed` to the desktop

### Credential Storage Key

**Rule:** Credentials are stored under `connectorId` (e.g. `google-calendar`), NOT the shared `oauthProvider` (e.g. `google`).

Multiple connectors share one OAuth provider (Google Calendar, Google Drive, Google Docs all use `google`). Credentials MUST be stored per-connector so they can be managed independently.

### Tool Call / Result Distinction (Desktop UI)

**Rule:** Tool calls use `tc_` ID prefix, tool results use `tr_` prefix. Use the prefix to distinguish them.

- Results inherit `toolName` from their matching call (for display purposes)
- `groupMessages.ts` and `ToolCallBlock.tsx` MUST use ID prefix, not `toolName` presence, to tell calls from results
- Pattern: `msg.id.startsWith('tc_')` = call, `msg.id.startsWith('tr_')` = result
