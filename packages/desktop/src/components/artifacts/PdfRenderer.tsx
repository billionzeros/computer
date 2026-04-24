import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

/**
 * Renders a PDF via Chromium's native viewer. No JS library needed —
 * Electron's renderer handles `<embed type="application/pdf">` natively,
 * including text selection, search (Cmd/Ctrl-F), and pagination.
 */
export function PdfRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error, mimeType } = useWorkspaceBytes(sourcePath)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bytes) {
      setObjectUrl(null)
      return
    }
    const blob = new Blob([bytes.slice().buffer], { type: mimeType || 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes, mimeType])

  if (error) {
    return (
      <div className="art-panel__failure">
        <div className="art-panel__failure-title">Couldn't open this PDF.</div>
        <div className="art-panel__failure-reason">{error}</div>
        <div className="art-panel__failure-hint">{filename || sourcePath.split('/').pop()}</div>
      </div>
    )
  }
  if (loading || !objectUrl) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>Loading PDF…</span>
      </div>
    )
  }
  return (
    <embed
      src={objectUrl}
      type="application/pdf"
      className="art-panel__iframe"
      title={filename || 'PDF'}
    />
  )
}
