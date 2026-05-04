import { useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'

export interface WorkspaceText {
  content: string | null
  mimeType: string | null
  truncated: boolean
  error: string | null
  loading: boolean
}

export function useWorkspaceText(path: string | null): WorkspaceText {
  const [state, setState] = useState<WorkspaceText>({
    content: null,
    mimeType: null,
    truncated: false,
    error: null,
    loading: false,
  })
  const activePathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!path) {
      setState({ content: null, mimeType: null, truncated: false, error: null, loading: false })
      return
    }

    activePathRef.current = path
    setState((prev) => ({ ...prev, content: null, error: null, loading: true }))

    const unsub = connection.onFilesystemReadResponse(
      (responsePath, content, truncated, error, _encoding, mimeType) => {
        if (responsePath !== path) return
        if (activePathRef.current !== path) return

        if (error) {
          setState({
            content: null,
            mimeType: mimeType ?? null,
            truncated,
            error,
            loading: false,
          })
          return
        }

        setState({
          content,
          mimeType: mimeType ?? null,
          truncated,
          error: null,
          loading: false,
        })
      },
    )

    const timeout = window.setTimeout(() => {
      if (activePathRef.current !== path) return
      setState((prev) =>
        prev.loading
          ? { ...prev, loading: false, error: 'Timed out waiting for file content.' }
          : prev,
      )
    }, 30_000)

    connection.sendFilesystemRead(path)

    return () => {
      unsub?.()
      window.clearTimeout(timeout)
    }
  }, [path])

  return state
}
