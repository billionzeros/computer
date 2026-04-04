# Connectors Spec

## Overview

Connectors integrate external services (Slack, Gmail, GitHub, etc.) into the agent. Three connector types:

| Type | How it works | Auth | Example |
|------|-------------|------|---------|
| `oauth` | Direct API calls, one-click OAuth flow | OAuth 2.0 via proxy | Slack, GitHub |
| `mcp` | Spawns MCP server subprocess (stdio JSON-RPC) | Manual env vars | Telegram, custom servers |
| `api` | Simple HTTP calls with API key | Manual API key | SearXNG, Brave Search |

**OAuth connectors are the default for core services.** MCP and API remain as escape hatches for custom/community connectors.

## Architecture

```
Desktop UI                Agent Server (VPS)              OAuth Proxy (CF Worker)
────────────              ──────────────────              ──────────────────────
Click "Connect"           Generate state nonce
  → WS: oauth_start      Build authorize URL
  ← WS: oauth_url        ─────────────────────────────→  302 to provider
Open browser                                              User authorizes
                          POST /_anton/oauth/cb  ←──────  Exchange code → token
                          Encrypt + store token
                          Activate connector
  ← WS: oauth_complete   Tools available in session
```

## OAuth Flow (One-Click Connectors)

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| OAuth Proxy | Separate CF Worker project | Holds client_id/secret, handles code exchange |
| OAuthFlow | `agent-server/src/oauth/oauth-flow.ts` | State management, token refresh |
| TokenStore | `agent-server/src/oauth/token-store.ts` | AES-256-GCM encrypted token storage |
| ConnectorManager | `packages/connectors/connector-manager.ts` | Manages active direct connectors |
| Direct connectors | `packages/connectors/slack/`, `github/` | Typed API clients + tool definitions |

### Token Storage

Tokens are stored encrypted on each user's VPS:

```
~/.anton/tokens/
  slack.enc        # AES-256-GCM encrypted
  github.enc       # AES-256-GCM encrypted
  google.enc       # (future)
```

- Encryption key derived from `config.token` via HKDF (`sha256`, salt: `anton-token-store`)
- Format: `iv (12 bytes) + auth tag (16 bytes) + ciphertext`
- File permissions: `0600`
- Tokens never leave the user's VPS unencrypted

### OAuth Proxy

The proxy is a stateless Cloudflare Worker. It holds OAuth app credentials (client_id/secret) and handles the authorization redirect + code-for-token exchange.

**Key points:**
- Proxy stores NOTHING after the exchange
- Tokens are POSTed to the agent's callback URL, then forgotten
- State parameter is HMAC-signed to prevent CSRF
- Open source — anyone can deploy their own

**Endpoints:**
- `GET /oauth/:provider/authorize` — 302 redirect to provider consent
- `GET /oauth/:provider/callback` — exchange code, POST token to agent
- `POST /oauth/:provider/refresh` — refresh expired tokens
- `GET /providers` — list configured providers

### Environment Variables

Set on the agent server (in `~/.anton/agent.env`):

```
OAUTH_PROXY_URL=https://your-proxy.workers.dev
OAUTH_CALLBACK_BASE_URL=https://yourname.antoncomputer.in
```

Configure via CLI: `sudo anton computer config oauth`

### Direct Connector Tools

OAuth connectors use direct API calls instead of MCP subprocesses:

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

Simple API key-based integrations. The first `requiredEnv` value maps to `apiKey`.

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
   - `api.ts` — typed HTTP client
   - `tools.ts` — AgentTool definitions
   - `index.ts` — DirectConnector implementation

5. **Add to factory** (`packages/connectors/src/index.ts`):
   ```ts
   CONNECTOR_FACTORIES['yourservice'] = () => new YourServiceConnector()
   ```

6. **Add registry entry** (`packages/agent-config/src/config.ts`):
   ```ts
   { id: 'yourservice', type: 'oauth', oauthProvider: 'yourservice', ... }
   ```

7. **Add brand icon** (`packages/desktop/src/components/connectors/ConnectorIcons.tsx`)

### MCP Connector (for community/custom services)

1. Add registry entry with `type: 'mcp'`, `command`, `args`, `requiredEnv`
2. Add brand icon
3. That's it — MCP protocol handles tool discovery automatically

## Protocol Messages

| Direction | Message | Purpose |
|-----------|---------|---------|
| C → S | `connectors_list` | Request all connector statuses |
| C → S | `connector_add` | Add a connector (MCP/API) |
| C → S | `connector_remove` | Remove a connector |
| C → S | `connector_toggle` | Enable/disable a connector |
| C → S | `connector_test` | Test connection, list tools |
| C → S | `connector_registry_list` | Request built-in registry |
| C → S | `connector_oauth_start` | Start OAuth flow for a provider |
| C → S | `connector_oauth_disconnect` | Disconnect OAuth connector |
| S → C | `connectors_list_response` | Full connector status list |
| S → C | `connector_added` | Confirmation with status |
| S → C | `connector_status` | Status update |
| S → C | `connector_test_response` | Test result with tools list |
| S → C | `connector_registry_list_response` | Built-in registry entries |
| S → C | `connector_oauth_url` | Auth URL for desktop to open |
| S → C | `connector_oauth_complete` | OAuth flow result |

## Security

### Token Isolation

- OAuth tokens encrypted at rest (AES-256-GCM) in `~/.anton/tokens/`
- Each user's tokens are on their own VPS, encrypted with their own agent token
- OAuth proxy is stateless — holds app credentials, not user tokens
- Direct API calls use token from encrypted store via closure — never in system prompt

### MCP Credential Handling (Legacy)

MCP connectors still use plaintext env vars in config. This is acceptable for:
- Single-user trust boundary
- User-owned machines
- Connectors the user explicitly installed

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
| `packages/connectors/src/` | Direct API connectors (Slack, GitHub) |
| `packages/connectors/src/connector-manager.ts` | ConnectorManager — activation, tool aggregation |
| `packages/agent-server/src/oauth/token-store.ts` | Encrypted token storage |
| `packages/agent-server/src/oauth/oauth-flow.ts` | OAuth state machine, token refresh |
| `packages/agent-server/src/oauth/oauth-callback.ts` | HTTP callback handler |
| `packages/agent-server/src/server.ts` | WS handlers, HTTP callback route, session wiring |
| `packages/agent-core/src/agent.ts` | `buildTools()` — merges MCP + direct connector tools |
| `packages/agent-core/src/session.ts` | Passes connectorManager to buildTools |
| `packages/protocol/src/messages.ts` | OAuth message types |
| `packages/desktop/src/components/connectors/ConnectorsPage.tsx` | OAuth UI flow |
| `packages/cli/src/commands/computer-config.ts` | `anton computer config oauth` |

## Invariants & Rules

These are hard rules that MUST hold. Violations cause API failures or broken UI.

### Tool Name Uniqueness

**Rule:** All tool names sent to the LLM API MUST be unique. Duplicate names cause `400 invalid_request_error`.

- `buildTools()` in `agent-core/src/agent.ts` deduplicates by name (first definition wins)
- Connector tool names MUST use the `{service}_{action}` prefix convention
- Each connector MUST NOT define the same tool name twice (e.g. two `gsc_inspect_url`)
- MCP tools are namespaced as `mcp_{serverId}_{toolName}` — safe by design

### Connector Type Handling

**Rule:** Server handlers (toggle, test, remove) MUST handle ALL connector types, not just MCP.

Three managers exist for different connector types:

| Manager | Connector Types | Methods |
|---------|----------------|---------|
| `mcpManager` | `mcp` | toggleConnector, testConnector, removeConnector |
| `connectorManager` | `oauth`, `api` | activate, deactivate, testConnection |
| `oauthFlow` | `oauth` (tokens) | hasToken, startFlow, disconnect |

Server handlers MUST check connector type before routing to the correct manager. Pattern:

```ts
if (mcpManager knows about it) → use mcpManager
else if (connectorManager knows about it) → use connectorManager
else → handle gracefully (don't throw)
```

### Error Surfacing

**Rule:** LLM API errors MUST be surfaced to the user, never swallowed silently.

- The pi SDK catches API errors and sets `stopReason: 'error'` + `errorMessage` on the assistant message
- `translateEvent` in `session.ts` checks `turn_end` for `stopReason === 'error'` and emits an error event
- `agent_end` checks ALL messages (not just `[0]`) for `errorMessage`
- Server logs the error with `[session X] LLM ERROR: ...`

### Token Storage

**Rule:** OAuth tokens are stored under `connectorId` (e.g. `google-calendar`), NOT the shared `oauthProvider` (e.g. `google`).

Multiple connectors share one OAuth provider (Google Calendar, Google Drive, Google Docs all use `google`). Tokens MUST be stored per-connector so they can be managed independently.

### Tool Call / Result Distinction (Desktop UI)

**Rule:** Tool calls use `tc_` ID prefix, tool results use `tr_` prefix. Use the prefix to distinguish them.

- Results inherit `toolName` from their matching call (for display purposes)
- `groupMessages.ts` and `ToolCallBlock.tsx` MUST use ID prefix, not `toolName` presence, to tell calls from results
- Pattern: `msg.id.startsWith('tc_')` = call, `msg.id.startsWith('tr_')` = result
