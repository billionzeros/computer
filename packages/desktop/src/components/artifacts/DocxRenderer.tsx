import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

/**
 * Renders a .docx document by converting to HTML via mammoth (lazy-loaded)
 * and displaying in a sandboxed iframe. Mammoth drops complex layout
 * (tracked changes, embedded images inside tables, footnotes) — fine for
 * a preview; users can download the raw file for full fidelity.
 */
export function DocxRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error } = useWorkspaceBytes(sourcePath)
  const [html, setHtml] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    if (!bytes) {
      setHtml(null)
      return
    }
    let cancelled = false
    setConverting(true)
    setConvertError(null)
    ;(async () => {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: mammoth types ship as any in some builds
        const mammoth: any = await import('mammoth')
        const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml
        if (typeof convert !== 'function') {
          throw new Error('mammoth.convertToHtml not available')
        }
        // Copy into a standalone ArrayBuffer so mammoth doesn't see a view
        // that could straddle a shared buffer boundary.
        const buf = bytes.slice().buffer
        const result = await convert({ arrayBuffer: buf })
        if (cancelled) return
        setHtml(result.value ?? '')
      } catch (e) {
        if (!cancelled) setConvertError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setConverting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bytes])

  const srcDoc = useMemo(() => {
    if (html === null) return ''
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#fff;color:#111;padding:32px 48px;line-height:1.55}
  h1,h2,h3,h4,h5,h6{margin:1.2em 0 0.4em;line-height:1.25}
  h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}
  p{margin:0.6em 0}
  ul,ol{margin:0.6em 0;padding-left:2em}
  table{border-collapse:collapse;margin:0.8em 0}
  td,th{border:1px solid #ddd;padding:6px 10px}
  a{color:#2b6cb0}
</style></head><body>${html}</body></html>`
  }, [html])

  if (error || convertError) {
    return (
      <FailureView
        path={sourcePath}
        filename={filename}
        reason={error || convertError || 'Unknown error'}
      />
    )
  }
  if (loading || converting || html === null) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>{loading ? 'Fetching document…' : 'Rendering…'}</span>
      </div>
    )
  }
  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="art-panel__iframe"
      title={filename || 'Document'}
    />
  )
}

function FailureView({
  path,
  filename,
  reason,
}: { path: string; filename?: string; reason: string }) {
  return (
    <div className="art-panel__failure">
      <div className="art-panel__failure-title">Couldn't render this document.</div>
      <div className="art-panel__failure-reason">{reason}</div>
      <div className="art-panel__failure-hint">
        {filename || path.split('/').pop()} — try downloading and opening externally.
      </div>
      <div className="art-panel__failure-actions">
        <button
          type="button"
          className="art-panel__btn"
          onClick={() => {
            // Trigger download via the artifact panel's existing flow if reachable,
            // otherwise fall through to the browser default.
            window.dispatchEvent(
              new CustomEvent('anton:request-download', { detail: { path, filename } }),
            )
          }}
        >
          <Download size={13} strokeWidth={1.5} /> Download raw file
        </button>
      </div>
    </div>
  )
}
