# anton.computer — Connection Spec

> **Spec Version: 0.1.0**
>
> Single source of truth for ports, protocols, and connection behavior.
> All clients (desktop, CLI) and the agent server MUST honor this spec.
>
> Bump this version when protocol or behavior changes. The agent reports
> this version in `auth_ok.specVersion` so clients know what to expect.

---

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| **9876** | `ws://` | Primary WebSocket (plain, no TLS) |
| **9877** | `wss://` | TLS WebSocket (self-signed or CA cert) |

- The agent server MUST listen on **both** ports simultaneously.
- Port 9876 (plain WS) is the **default** for all clients.
- Port 9877 (TLS) is optional — used when security is required over untrusted networks.
- Both ports use the same binary framing protocol and auth flow.

## Authentication

| Step | Direction | Channel | Message |
|------|-----------|---------|---------|
| 1 | Client → Agent | CONTROL (0x00) | `{ type: "auth", token: "<token>" }` |
| 2a | Agent → Client | CONTROL (0x00) | `{ type: "auth_ok", agentId, version }` |
| 2b | Agent → Client | CONTROL (0x00) | `{ type: "auth_error", reason }` |

- Token format: `ak_<48 hex chars>` (24 random bytes)
- Auth timeout: 10 seconds — server closes connection if no auth received
- One active client at a time — new connection replaces the old one

## Wire Protocol

Single WebSocket connection, multiplexed into 5 logical channels via binary framing:

```
Frame: [1 byte channel] [N bytes JSON payload]
```

| Channel | ID | Purpose |
|---------|-----|---------|
| CONTROL | 0x00 | Auth, ping/pong, lifecycle |
| TERMINAL | 0x01 | PTY data (base64-encoded) |
| AI | 0x02 | Chat messages, tool calls, confirmations |
| FILESYNC | 0x03 | File sync (reserved, v0.2) |
| EVENTS | 0x04 | Status updates, notifications |

## Client Connection Defaults

| Setting | Default | Notes |
|---------|---------|-------|
| Port | 9876 | Plain WS |
| TLS | Off | Self-signed certs cause issues in WebViews |
| Reconnect delay | 3 seconds | Auto-reconnect on disconnect |
| Auth timeout | 10 seconds | Client-side timeout for auth response |

## Firewall / Security Groups

The following ports MUST be open inbound (TCP):

| Port | Required |
|------|----------|
| 9876 | Yes — primary connection |
| 9877 | Yes — TLS fallback |
| 22 | Yes — SSH for deployment |
| 80 | Optional — HTTP for hosted services |
| 443 | Optional — HTTPS for hosted services |

## Agent Server Startup

The agent server starts two listeners:

1. **Plain HTTP + WebSocket** on port from config (default 9876)
2. **HTTPS + WebSocket** on config port + 1 (default 9877) — uses self-signed cert from `~/.anton/certs/`

If cert generation fails, only the plain server starts.

## Config File

Location: `~/.anton/config.yaml`

```yaml
agentId: anton-<hostname>-<random>
token: ak_<48 hex chars>
port: 9876                          # plain WS port (TLS = port + 1)
ai:
  provider: anthropic
  apiKey: ""
  model: claude-sonnet-4-6
security:
  confirmPatterns: [...]
  forbiddenPaths: [...]
  networkAllowlist: [...]
skills: []
```

## Changelog

| Date | Change |
|------|--------|
| 2026-03-19 | Initial spec. Plain WS on 9876 as default, TLS on 9877. |
