import type { ProviderInfo } from './store.js'

type HarnessStatusMap = Record<
  string,
  { installed: boolean; auth?: { loggedIn: boolean } } | undefined
>

// A harness provider is "ready" only when the CLI is installed AND logged in.
// `hasApiKey` is always true for harness providers on the backend (they don't
// need keys) so it cannot be used as a readiness signal.
export function isProviderReady(p: ProviderInfo, harnessStatuses: HarnessStatusMap): boolean {
  if (p.type === 'harness') {
    const s = harnessStatuses[p.name]
    return !!(s?.installed && s?.auth?.loggedIn)
  }
  return p.hasApiKey
}

export function anyProviderReady(
  providers: ProviderInfo[],
  harnessStatuses: HarnessStatusMap,
): boolean {
  return providers.some((p) => isProviderReady(p, harnessStatuses))
}
