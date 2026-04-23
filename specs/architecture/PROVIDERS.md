# Anton — Supported Providers

> Default source for supported AI providers, auth methods, and available models. Users can extend/override this via `~/.anton/config.yaml` (`providers.<name>`).
> API providers run through [pi SDK](https://github.com/mariozechner/pi) (OpenClaw engine).
> Harness providers run a local CLI subprocess (see [BYOS_HARNESS_PROVIDERS.md](../features/BYOS_HARNESS_PROVIDERS.md) / [HARNESS_ARCHITECTURE.md](../features/HARNESS_ARCHITECTURE.md)).

## Provider Types

Providers fall into two dispatch lanes, discriminated by `providerConfig.type` in `DEFAULT_PROVIDERS` (`packages/agent-config/src/config.ts`):

- **`type: 'api'`** (default) — routes through pi SDK. Model ID must resolve via `resolveModel(provider, model)`.
- **`type: 'harness'`** — spawns a local CLI (codex, claude-code). Model ID must be in the provider's declared `models[]`. Validation is closed-set, not registry-based, because the model catalog is what the vendor CLI happens to support — there's no pi SDK registry entry for it.

Session creation (`handleSessionCreate`) and routine dispatch (`setAgentManager`) both branch on this type.

## Provider Matrix

### API providers (pi SDK)

| Provider | Auth Method | Models | Default Base URL |
|----------|------------|--------|-----------------|
| **anthropic** | API key (`sk-ant-*`) | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | api.anthropic.com |
| **openai** | API key (`sk-*`) | gpt-4o, gpt-4o-mini, o3, o4-mini | api.openai.com |
| **google** | API key (`AIza*`) | gemini-2.5-pro, gemini-2.5-flash | generativelanguage.googleapis.com |
| **ollama** | None (local) | llama3, codellama, mistral, phi3, ... | localhost:11434 |
| **groq** | API key | llama3-70b, mixtral-8x7b | api.groq.com |
| **together** | API key | llama-3-70b, mixtral-8x7b, ... | api.together.xyz |
| **openrouter** | API key | Any model (proxy) | openrouter.ai/api |
| **bedrock** | AWS credentials | claude-*, titan-* | (AWS region endpoint) |
| **mistral** | API key | mistral-large, mistral-medium | api.mistral.ai |

### Harness providers (CLI subprocess)

| Provider | Binary | Models |
|----------|--------|--------|
| **claude-code** | `claude` CLI (Claude Pro/Max sub) | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5 |
| **codex** | `codex` CLI (Codex/ChatGPT Plus sub) | gpt-5.4, gpt-5.4-mini, o3 |

## Per-Routine Provider Override

Routines pin their own `provider`/`model` in `RoutineMetadata` (see [agents.md](../features/agents/agents.md)). This is independent of the desktop conversation's current choice, so one project can have a routine on `codex/gpt-5.4` and another on `anthropic/claude-sonnet-4-6`. Validation lives in `validateRoutineProviderModel()` (server.ts) and runs at create/update time; a lighter pre-flight in the dispatch handler catches drift at run time.

## Auth Methods

### API Key
Set in `~/.anton/config.yaml` under `providers.<name>.apiKey`, or via environment variable.
The agent checks config first, then falls back to env vars.

### AWS Credentials (Bedrock only)
Uses `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` environment variables.

### No Auth (Local)
Providers like Ollama run locally and need no authentication — just the `baseUrl`.

## Environment Variable Fallbacks

| Provider | Environment Variable |
|----------|---------------------|
| anthropic | `ANTHROPIC_API_KEY` |
| openai | `OPENAI_API_KEY` |
| google | `GOOGLE_API_KEY` |
| groq | `GROQ_API_KEY` |
| together | `TOGETHER_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

## Configuration

Providers are configured in `~/.anton/config.yaml`:

```yaml
providers:
  anthropic:
    apiKey: "sk-ant-..."
    models:
      - claude-sonnet-4-6
      - claude-opus-4-6
      - claude-haiku-4-5
  openai:
    apiKey: "sk-..."
    models:
      - gpt-4o
      - gpt-4o-mini
  ollama:
    baseUrl: "http://localhost:11434"
    models:
      - llama3
      - codellama

defaults:
  provider: anthropic
  model: claude-sonnet-4-6
```

## Managing Providers

### From the TUI (recommended)
1. Run `anton connect` or `anton` to enter the TUI
2. Press `Ctrl+P` to open the provider panel
3. Navigate to a provider and press `e` to set its API key
4. Press `Ctrl+M` to switch models

### From the config file
Edit `~/.anton/config.yaml` directly. The agent reads this on startup and when config is updated via the protocol.

### Client-provided keys
Clients can send an `apiKey` in `session_create` to override the server-stored key for that session. This is useful when:
- Multiple users share an agent but have their own API keys
- You want to test a different key without modifying server config

Client-provided keys are **never persisted** on the agent — they exist only for the duration of the session.

## Adding a New Provider

If a provider is supported by pi SDK but not in your config, add it:

```yaml
providers:
  # ... existing providers ...
  newprovider:
    apiKey: "your-key"
    baseUrl: "https://api.newprovider.com"  # if non-standard
    models:
      - model-name-1
      - model-name-2
```

Any provider supported by pi SDK's `getModel()` will work. See [pi SDK docs](https://github.com/mariozechner/pi) for the full list.
