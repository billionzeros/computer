import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

export function VideoRenderer({ sourcePath, filename }: Props) {
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
        <div className="art-panel__failure-title">Couldn't load this video.</div>
        <div className="art-panel__failure-reason">{error}</div>
        <div className="art-panel__failure-hint">{filename || sourcePath.split('/').pop()}</div>
      </div>
    )
  }
  if (loading || !objectUrl) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>Loading video…</span>
      </div>
    )
  }
  return (
    <div className="art-panel__video-wrap">
      {/* biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have companion caption tracks in the workspace model yet. */}
      <video
        src={objectUrl}
        className="art-panel__video"
        controls
        preload="metadata"
        aria-label={filename || 'Uploaded video'}
      />
    </div>
  )
}
