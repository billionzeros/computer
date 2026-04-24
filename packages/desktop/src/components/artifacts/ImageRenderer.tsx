import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

/**
 * Renders a raster/vector image uploaded to the project workspace.
 * Fetches bytes via fs_read_bytes (respects the 500MB cap) and wraps
 * them in a Blob + objectURL so the same pipeline works for GIF/WebP/SVG/etc.
 */
export function ImageRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error, mimeType } = useWorkspaceBytes(sourcePath)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bytes) {
      setObjectUrl(null)
      return
    }
    const blob = new Blob([bytes.slice().buffer], {
      type: mimeType || 'application/octet-stream',
    })
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes, mimeType])

  if (error) {
    return (
      <div className="art-panel__failure">
        <div className="art-panel__failure-title">Couldn't load this image.</div>
        <div className="art-panel__failure-reason">{error}</div>
        <div className="art-panel__failure-hint">{filename || sourcePath.split('/').pop()}</div>
      </div>
    )
  }
  if (loading || !objectUrl) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>Loading image…</span>
      </div>
    )
  }
  return (
    <div className="art-panel__image-wrap">
      <img src={objectUrl} alt={filename || 'Image'} className="art-panel__image" />
    </div>
  )
}
