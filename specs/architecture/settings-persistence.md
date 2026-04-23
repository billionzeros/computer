# Settings Persistence

How desktop settings and user-level preferences are stored on the Anton computer.

## Problem

The desktop app has many toggles, choices, and flags. Some are cosmetic (theme,
sidebar width), some are load-bearing (model defaults, security rules,
onboarding completion). Over time more are being added — logging preferences,
feature flags, experiment opt-ins, notification rules, etc. We need a single
story for where each kind of preference lives so new settings don't reinvent
the wheel or silently lose data across machines.

## Three tiers of state

Anton currently stores user state in three distinct places. Pick the tier that
matches the semantics of the setting.

### Tier 1 — Client-only (`localStorage`)

**Where**: browser `localStorage` in the desktop renderer.
**Scope**: per-installation, per-machine. Never syncs.
**Use for**: UI-only preferences that are meaningful only to the device you
set them on. Theme, sidebar width, which tab was open last, whether dev mode
is on in this install.

Keys are prefixed `anton-` (e.g. `anton-theme`, `anton-timezone`,
`anton-restore`) or `anton.*` for newer namespaced keys (e.g.
`anton.tourSeen.v1`, `anton.selectedModel`).

Pattern:

```ts
const [value, setValue] = useState(() => localStorage.getItem('anton-foo') === 'true')
const persist = (v: boolean) => {
  localStorage.setItem('anton-foo', String(v))
  setValue(v)
}
```

### Tier 2 — Agent-level (`~/.anton/config.yaml`)

**Where**: YAML file at `~/.anton/config.yaml`, owned by the `@anton/agent-config`
package. Read on server start into `AgentConfig`; written via `saveConfig()`.
**Scope**: per-agent (per-machine Anton install). Any client that connects to
this agent sees the same config.
**Use for**: state the agent itself needs at runtime (API keys, model
defaults, security rules, skill/connector definitions), and user-level flags
that should survive desktop reinstalls or be visible to non-desktop clients
(Telegram, Slack, etc.).

Write path:

1. Client sends `config_update` over `Channel.CONTROL`:
   ```ts
   connection.send(Channel.CONTROL, {
     type: 'config_update',
     key: 'onboarding',
     value: { tourCompleted: true, tourCompletedAt: new Date().toISOString() },
   })
   ```
2. Server dispatches to `handleConfigUpdate(key, value)` in
   `packages/agent-server/src/server.ts`. Each supported key has an explicit
   branch — unknown keys return an error.
3. Handler mutates `this.config` and calls `saveConfig(this.config)`.
4. Server replies with `config_update_response` (success or error).

**Merge, don't overwrite.** For nested objects like `onboarding`, the handler
spreads the existing value so partial updates (e.g. just `tourCompleted`)
don't clobber sibling fields (`completed`, `role`).

Read path: fields surface back to the client either by being embedded in an
existing response (e.g. `providers_list_response.onboarding` is sent on every
connect) or by an explicit `config_query` with `key: '<topic>'`.

Today this tier holds: providers, defaults, security, onboarding (welcome +
tour completion), skills, connectors, optional compaction/braintrust config.

### Tier 3 — Project preferences

**Where**: `~/.anton/conversations/{projectId}/preferences.json` (per-project).
**Scope**: one Anton project. Not global.
**Use for**: things the user taught the agent about a specific project
("prefer rg over grep in this repo", "deploy target is Fly").
**API**: `addProjectPreference()`, `loadProjectPreferences()` in
`@anton/agent-config`. Reached from the desktop via the
`add_project_preference` protocol message, not `config_update`.

Do not put global or UI preferences here — they'll be invisible outside the
project.

## Choosing the right tier

| Question | Answer |
| --- | --- |
| Does another device / other client need to know this? | Tier 2 |
| Is this about one project only? | Tier 3 |
| Is this purely a rendering choice for this one desktop install? | Tier 1 |
| Would losing this be annoying after a reinstall? | Tier 2 |
| Does the agent need it at runtime (even when desktop isn't open)? | Tier 2 |

Rule of thumb: **default to Tier 2** for any new user-level setting. Demote to
Tier 1 only if the setting genuinely has no meaning off this specific desktop.

## Adding a new Tier 2 setting — checklist

1. **Schema**: add the field to `AgentConfig` in
   `packages/agent-config/src/config.ts`. Keep it optional; migrations for
   `~/.anton/config.yaml` are "append-only" — we never error on missing keys.
2. **Protocol**: if the field needs to land on the client at connect time,
   extend the response it rides on (e.g. `ProvidersListResponse`) in
   `packages/protocol/src/messages.ts`. If it needs on-demand reads, add it to
   the `ConfigQueryMessage.key` union.
3. **Server handler**: add a `case '<key>':` to `handleConfigUpdate` in
   `packages/agent-server/src/server.ts`. Merge for nested objects; call
   `saveConfig(this.config)` at the end.
4. **Client store**: add state + a setter to `uiStore` (or a feature-specific
   store). The setter should both `set({...})` locally *and* call
   `connection.send(Channel.CONTROL, { type: 'config_update', key, value })`.
5. **Hydrate on connect**: read the field from the response that carries it
   (usually in `providerHandler.ts`) and push it into the store.
6. **Build protocol first**: `pnpm -C packages/protocol build` — desktop
   imports the compiled `.d.ts`, so schema changes don't propagate until the
   protocol is rebuilt.

## Worked example — tour completion

Before: `anton.tourSeen.v1` lived only in localStorage. A user who finished
the tour on their laptop saw it again on their desktop.

After:

- Schema: `AgentConfig.onboarding.tourCompleted?: boolean` +
  `tourCompletedAt?: string` (`packages/agent-config/src/config.ts`).
- Protocol: `ProvidersListResponse.onboarding` extended with the same fields.
- Server: the `onboarding` case in `handleConfigUpdate` merges partial
  updates instead of overwriting the full onboarding blob.
- Client: `uiStore.tourCompleted` + `setTourCompleted(completed)`. Hydrated
  from `providers_list_response.onboarding.tourCompleted` in
  `providerHandler.ts`. `OnboardingTour.finish()` calls the setter.
  localStorage is still written as a fallback so `hasSeenTour()` works before
  the connect round-trip completes.
- Settings: a "Replay tour" button in Settings > General calls
  `setTourCompleted(false)` and dispatches an `anton:replay-tour` window
  event that `App.tsx` listens for.

## Future: logging and diagnostic settings

Logging/debug preferences (log level, file sinks, redaction rules, what gets
sent to Braintrust) belong in Tier 2. The agent itself needs them even when
the desktop isn't connected — for example, a Telegram-only session still
needs to know the user's redaction policy. Expected shape when added:

```ts
// In AgentConfig
logging?: {
  level?: 'debug' | 'info' | 'warn' | 'error'
  fileSink?: { enabled: boolean; path?: string }
  redact?: { patterns: string[] }
  braintrustSampleRate?: number
}
```

Wire it through the same 6-step checklist above. Don't scatter logging flags
across localStorage — they need to survive desktop reinstalls and apply to
non-desktop surfaces.

## Anti-patterns to avoid

- **Writing to two tiers at once without marking one authoritative.** If a
  field lives in both localStorage and the server, document which wins on
  conflict. The current rule: server wins on hydrate, localStorage is a
  pre-hydration fallback only.
- **Overwriting nested config objects on partial updates.** Always merge.
- **Adding new `config_update` keys without updating the server switch.** The
  server rejects unknown keys with "Unknown config key" — the client will
  silently log an error and the setting won't persist.
- **Skipping the protocol rebuild.** Desktop typecheck uses the compiled
  `packages/protocol/dist/*.d.ts`; editing the source `.ts` alone looks like
  it works in the editor but breaks at build time.
