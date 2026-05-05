import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

/**
 * Renders .docx documents with page-aware layout in a sandboxed iframe.
 *
 * This intentionally does not use Mammoth. Mammoth is good for text extraction,
 * but it drops Word pagination, headers/footers, page sizing, and most layout
 * details, which makes formatted legal/commercial documents look broken.
 */
export function DocxRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error } = useWorkspaceBytes(sourcePath)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)

  const srcDoc = useMemo(
    () => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html,body{margin:0;min-height:100%;background:#1f1f1f;color:#111}
      body{overflow:auto}
      #docx-root{min-height:100%;box-sizing:border-box}
      .anton-docx-wrapper{background:transparent!important;padding:28px 16px!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:center!important;overflow-x:hidden!important}
      .anton-docx-page-frame{position:relative;margin:0 auto 28px!important;overflow:visible;flex:0 0 auto}
      .anton-docx-page-frame>section.anton-docx{margin:0!important;box-shadow:0 12px 32px rgba(0,0,0,.28);transform-origin:top left}
      .anton-docx-wrapper>section.anton-docx{margin:0 auto 28px!important;box-shadow:0 12px 32px rgba(0,0,0,.28)}
    </style>
  </head>
  <body>
    <div id="docx-styles"></div>
    <div id="docx-root"></div>
  </body>
</html>`,
    [],
  )

  useEffect(() => {
    if (!bytes || !frameReady) return
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const bodyContainer = doc.getElementById('docx-root')
    const styleContainer = doc.getElementById('docx-styles')
    if (!bodyContainer || !styleContainer) return

    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    let resizeFrame = 0
    let settleTimer = 0
    setRendering(true)
    setRenderError(null)
    bodyContainer.replaceChildren()
    styleContainer.replaceChildren()

    const cleanupFit = () => {
      resizeObserver?.disconnect()
      resizeObserver = null
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame)
        resizeFrame = 0
      }
      if (settleTimer) {
        window.clearTimeout(settleTimer)
        settleTimer = 0
      }
    }

    const fitPagesToPane = () => {
      resizeFrame = 0
      const pages = Array.from(bodyContainer.querySelectorAll<HTMLElement>('section.anton-docx'))
      if (!pages.length) return

      const paneWidth = bodyContainer.clientWidth
      if (!paneWidth) return
      const availableWidth = Math.max(1, paneWidth - 32)
      for (const page of pages) {
        let frame = page.parentElement as HTMLElement | null
        if (!frame?.classList.contains('anton-docx-page-frame')) {
          frame = doc.createElement('div')
          frame.className = 'anton-docx-page-frame'
          page.parentNode?.insertBefore(frame, page)
          frame.appendChild(page)
        }

        const pageWidth = page.offsetWidth || page.getBoundingClientRect().width
        const pageHeight = page.offsetHeight || page.getBoundingClientRect().height
        if (!pageWidth || !pageHeight) continue

        const scale = Math.min(1, availableWidth / pageWidth)
        frame.style.width = `${Math.ceil(pageWidth * scale)}px`
        frame.style.height = `${Math.ceil(pageHeight * scale)}px`
        page.style.transform = scale === 1 ? '' : `scale(${scale})`
        page.style.transformOrigin = 'top left'
      }
    }

    const scheduleFit = () => {
      if (resizeFrame || cancelled) return
      resizeFrame = window.requestAnimationFrame(fitPagesToPane)
    }
    ;(async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelled) return
        await renderAsync(bytes.slice().buffer, bodyContainer, styleContainer, {
          className: 'anton-docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          trimXmlDeclaration: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: false,
          renderChanges: false,
          renderAltChunks: true,
          useBase64URL: false,
        })
        if (cancelled) return
        scheduleFit()
        resizeObserver = new ResizeObserver(scheduleFit)
        resizeObserver.observe(bodyContainer)
        settleTimer = window.setTimeout(scheduleFit, 150)
      } catch (e) {
        if (!cancelled) setRenderError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()

    return () => {
      cancelled = true
      cleanupFit()
      bodyContainer.replaceChildren()
      styleContainer.replaceChildren()
    }
  }, [bytes, frameReady])

  if (error || renderError) {
    return (
      <FailureView
        path={sourcePath}
        filename={filename}
        reason={error || renderError || 'Unknown error'}
      />
    )
  }
  if (loading || !bytes) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>Fetching document…</span>
      </div>
    )
  }
  return (
    <div className="art-panel__docx-shell">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        className="art-panel__docx-frame"
        title={filename || 'Document'}
        onLoad={() => setFrameReady(true)}
      />
      {rendering && (
        <div className="art-panel__docx-overlay">
          <Loader2 size={16} className="art-panel__spin" />
          <span>Rendering document…</span>
        </div>
      )}
    </div>
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
