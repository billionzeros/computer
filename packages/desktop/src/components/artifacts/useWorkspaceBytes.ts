import { useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'

export interface WorkspaceBytes {
  /** Decoded bytes, or null while loading / on error. */
  bytes: Uint8Array | null
  /** Sniffed MIME (server-side), or null if unknown / not yet loaded. */
  mimeType: string | null
  /** Total file size in bytes (echoed by server even when bytes are still in flight). */
  size: number | null
  /** Error message if the read failed (path outside workspace, too large, missing). */
  error: string | null
  /** True while a request is in flight for the current `path`. */
  loading: boolean
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Fetch a file's bytes from the workspace via the filesync channel.
 *
 * Responses are correlated by the echoed `path` — the listener ignores
 * responses that weren't for our request, so concurrent renders of
 * different artifacts don't step on each other.
 *
 * Downstream renderers (docx, xlsx, pdf, image) call this exactly once per
 * path and feed the result into their respective libs.
 */
export function useWorkspaceBytes(path: string | null): WorkspaceBytes {
  const [state, setState] = useState<WorkspaceBytes>({
    bytes: null,
    mimeType: null,
    size: null,
    error: null,
    loading: false,
  })

  // Track the currently-requested path so stale responses are ignored even
  // if the caller passes a new path before the old one has resolved.
  const activePathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!path) {
      setState({ bytes: null, mimeType: null, size: null, error: null, loading: false })
      return
    }
    activePathRef.current = path
    setState((prev) => ({ ...prev, loading: true, error: null, bytes: null }))

    const unsub = connection.onFilesystemReadBytesResponse((payload) => {
      if (payload.path !== path) return
      if (activePathRef.current !== path) return // caller already moved on
      if (payload.error) {
        setState({
          bytes: null,
          mimeType: null,
          size: payload.size ?? null,
          error: payload.error,
          loading: false,
        })
        return
      }
      let bytes: Uint8Array | null = null
      try {
        bytes = base64ToBytes(payload.content)
      } catch (e) {
        setState({
          bytes: null,
          mimeType: payload.mimeType ?? null,
          size: payload.size ?? null,
          error: e instanceof Error ? e.message : 'Failed to decode file bytes',
          loading: false,
        })
        return
      }
      setState({
        bytes,
        mimeType: payload.mimeType ?? null,
        size: payload.size ?? bytes.byteLength,
        error: null,
        loading: false,
      })
    })

    // Timeout so a dropped response doesn't pin the spinner forever.
    const timeout = window.setTimeout(() => {
      if (activePathRef.current !== path) return
      setState((prev) =>
        prev.loading
          ? { ...prev, loading: false, error: 'Timed out waiting for file bytes.' }
          : prev,
      )
    }, 30_000)

    connection.sendFilesystemReadBytes(path)

    return () => {
      unsub?.()
      window.clearTimeout(timeout)
    }
  }, [path])

  return state
}
