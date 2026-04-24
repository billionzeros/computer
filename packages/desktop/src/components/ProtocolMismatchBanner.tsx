import { PROTOCOL_VERSION } from '@anton/protocol'
import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import { connectionStore } from '../lib/store/connectionStore.js'

/**
 * Warns the user when the agent-server's wire-protocol version doesn't match
 * what this desktop was compiled against. Two cases trigger it:
 *   - Server older: features the client assumes may be missing server-side.
 *   - Server newer: client may not understand some server messages.
 *
 * Soft-warn by design — we don't block usage because the product is
 * single-user and most flows remain functional. Dismissal is scoped to the
 * specific version observed, so connecting to a different server with a
 * different skew surfaces the warning again.
 */
export function ProtocolMismatchBanner() {
  const serverVersion = connectionStore((s) => s.serverProtocolVersion)
  const initPhase = connectionStore((s) => s.initPhase)
  // Track which server version the user has dismissed. Re-warns on any
  // change (including null → number or number → number).
  const [dismissedForVersion, setDismissedForVersion] = useState<number | null | undefined>(
    undefined,
  )

  // Wait until we've actually authenticated — before that, null just means
  // "haven't heard from the server yet", not "server predates handshake".
  const hasAuthenticated = initPhase === 'syncing' || initPhase === 'ready'
  if (!hasAuthenticated) return null
  if (serverVersion === PROTOCOL_VERSION) return null
  if (dismissedForVersion === serverVersion) return null

  const serverOlder = serverVersion === null || serverVersion < PROTOCOL_VERSION
  const title = serverOlder
    ? 'Your Anton server is out of date'
    : 'This Anton desktop is out of date'
  const detail = serverOlder
    ? `The server speaks protocol v${serverVersion ?? '?'}; this app expects v${PROTOCOL_VERSION}. Update the server to restore full functionality.`
    : `The server speaks protocol v${serverVersion}; this app only understands v${PROTOCOL_VERSION}. Update the desktop app.`

  return (
    <div className="protocol-mismatch-banner" role="alert">
      <AlertTriangle size={16} strokeWidth={1.5} />
      <div className="protocol-mismatch-banner__body">
        <div className="protocol-mismatch-banner__title">{title}</div>
        <div className="protocol-mismatch-banner__detail">{detail}</div>
      </div>
      <button
        type="button"
        className="protocol-mismatch-banner__dismiss"
        onClick={() => setDismissedForVersion(serverVersion)}
        aria-label="Dismiss"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
