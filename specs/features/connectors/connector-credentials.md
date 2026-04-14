# Connector Credential System

## Overview

All connector secrets -- OAuth tokens, API keys, bot tokens, wallet addresses -- are stored in a unified encrypted credential store. This replaces the previous split where OAuth tokens were encrypted but API keys were stored plaintext in `config.yaml`.

## Design Principles

1. **One interface** -- `configure(config: ConnectorEnv)` for all connectors, regardless of auth type
2. **Encrypted by default** -- everything from `requiredEnv` and `optionalFields` goes to the encrypted store
3. **config.yaml is secret-free** -- safe to back up, share, or inspect
4. **Declared keys only** -- process.env fallback checks ONLY keys declared in the connector's registry entry, no wildcard scanning

## CredentialStore

**File:** `packages/agent-server/src/credential-store.ts`

Replaces the former `TokenStore` (which lived under `oauth/`). Same encryption, same file location, broader scope.

```ts
interface StoredCredentials {
  provider: string
  // OAuth fields (backward compat with existing .enc files)
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  oauthProvider?: string
  metadata?: Record<string, string>
  // All connector secrets -- API keys, wallet addresses, bot tokens, etc.
  secrets?: Record<string, string>
}

class CredentialStore {
  save(provider: string, creds: StoredCredentials): void
  load(provider: string): StoredCredentials | null
  has(provider: string): boolean    // file existence check, no decryption
  delete(provider: string): void
  list(): string[]
}
```

**Encryption:** AES-256-GCM. Key derived from agent token via HKDF-SHA256.
**Storage:** `~/.anton/tokens/{id}.enc`, file permissions `0o600`.
**Backward compat:** Existing OAuth `.enc` files load fine -- `secrets` is a new optional field, old files just have it as `undefined`.

## ConnectorEnv Resolution

**Method:** `server.ts → resolveConnectorEnv(providerId)`

Resolution priority:

1. **Encrypted secrets** (highest) -- `credentialStore.load(id).secrets`
2. **Legacy OAuth accessToken** -- mapped to `env.ACCESS_TOKEN` for backward compat
3. **process.env fallback** -- checks `{PREFIX}_{KEY}` and bare `{KEY}` for each declared registry key

```
Registry says: requiredEnv: ['TELEGRAM_BOT_TOKEN'], optionalFields: [{ key: 'OWNER_CHAT_ID' }]
Prefix: TELEGRAM

Checks (in order for each key):
  1. credentialStore secrets['TELEGRAM_BOT_TOKEN']
  2. process.env['TELEGRAM_TELEGRAM_BOT_TOKEN']  (prefixed)
  3. process.env['TELEGRAM_BOT_TOKEN']            (bare)
```

For OAuth connectors, the resolver also provides a `refreshToken` callback if the stored credentials contain a refresh token.

## Connector Patterns

### OAuth Connectors (GitHub, Gmail, Slack, etc.)

```ts
configure(config: ConnectorEnv) {
  if (config.env.ACCESS_TOKEN) this.api.setToken(config.env.ACCESS_TOKEN)
  if (config.refreshToken) this.api.setTokenProvider(config.refreshToken)
  this.tools = createTools(this.api)
}
```

OAuth flow stores the token as `accessToken` in `StoredCredentials`. The resolver maps it to `env.ACCESS_TOKEN`.

### API Key Connectors (Telegram, Granola)

```ts
// Telegram
configure(config: ConnectorEnv) {
  this.api.setToken(config.env.TELEGRAM_BOT_TOKEN ?? '')
  const chatId = Number(config.env.OWNER_CHAT_ID)
  this.ownerChatId = Number.isNaN(chatId) ? null : chatId
  this.tools = createTelegramTools(this.api, this.ownerChatId)
}
```

Desktop UI sends all `requiredEnv` + `optionalFields` values in a single `env` bag. Server stores them in `credentialStore.save(id, { provider: id, secrets: env })`. The connector reads them from `config.env`.

### Compound Token Connectors (LinkedIn)

LinkedIn's OAuth proxy returns `apiKey|dsn|accountId` as a single `accessToken`. The connector's `configure()` receives it via `env.ACCESS_TOKEN` and parses internally -- this is a connector-level concern.

## Server Handler Flow

### connector_add (API connectors)

1. Store `msg.connector.env` in credential store as encrypted secrets
2. Strip `env` from config before persisting to `config.yaml`
3. Call `connectorManager.activate(id)` which resolves env from credential store
4. Send `connector_added` with `hasCredentials: true`

### connector_update

1. If `env` values provided, merge into credential store
2. Strip `env` from config changes before persisting
3. Call `connectorManager.reconfigure(id)` on live instance

### connector_remove

1. Run provider-specific cleanup hooks
2. `connectorManager.deactivate(id)`
3. `credentialStore.delete(id)` -- removes `.enc` file
4. Remove from config.yaml

### connector_toggle (enable)

1. `connectorManager.activate(id)` -- resolveEnv handles both OAuth and API

### Startup

Single `startConnectors()` method activates all enabled non-MCP connectors:
- OAuth connectors: only if credential store has an entry (`credentialStore.has(id)`)
- API connectors: if credential store has entry OR matching process.env keys exist

## Security Properties

1. **All connector secrets encrypted at rest** -- AES-256-GCM in `~/.anton/tokens/{id}.enc` with `0o600` permissions
2. **Encryption key derived from agent token** via HKDF-SHA256 -- secrets tied to the agent identity
3. **config.yaml is secret-free** -- `apiKey` and `baseUrl` fields removed from `ConnectorConfig`
4. **Desktop client never receives secrets** -- status messages include only `hasCredentials: boolean`
5. **process.env fallback** -- systemd `EnvironmentFile` works without storing secrets on disk at all
6. **No plaintext secret logging** -- connector receives env bag, framework never logs values
7. **Credential cleanup on disconnect** -- `credentialStore.delete(id)` when connector removed
8. **Agent token rotation** -- existing secrets become unreadable (expected, matches OAuth behavior)

## ConnectorConfig Changes

Removed fields:
- `apiKey` -- secrets now in credential store
- `baseUrl` -- sent via `env` bag if needed

Unchanged:
- `env` -- still used by MCP connectors for non-secret environment variables passed to subprocesses

Protocol changes:
- `ConnectorConfigPayload` -- removed `apiKey`, `baseUrl`
- `ConnectorStatusPayload` -- added `hasCredentials?: boolean`

## Key Files

| File | Purpose |
|------|---------|
| `packages/agent-server/src/credential-store.ts` | CredentialStore class (AES-256-GCM encrypted storage) |
| `packages/connectors/src/types.ts` | `ConnectorEnv`, `DirectConnector` interface with `configure()` |
| `packages/connectors/src/connector-manager.ts` | `EnvResolver` type, `activate()` / `reconfigure()` |
| `packages/agent-server/src/server.ts` | `resolveConnectorEnv()`, `startConnectors()`, handler updates |
| `packages/agent-config/src/config.ts` | `ConnectorConfig` (no `apiKey`/`baseUrl`) |
| `packages/protocol/src/messages.ts` | `ConnectorStatusPayload` (added `hasCredentials`) |
| `packages/desktop/src/components/connectors/ConnectorsPage.tsx` | UI sends all values in single `env` bag |
