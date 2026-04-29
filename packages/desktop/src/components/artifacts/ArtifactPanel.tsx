import {
  Braces,
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Globe,
  ImageIcon,
  Link,
  Network,
  Settings2,
  SquareCode,
  X,
} from 'lucide-react'
import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react'
import type { Artifact, ArtifactRenderType } from '../../lib/artifacts.js'
import {
  getArtifactFileExtension,
  getArtifactTypeLabel,
  isBinaryRenderType,
} from '../../lib/artifacts.js'
import { connection } from '../../lib/connection.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { HighlightedBlock, MarkdownRenderer } from '../chat/MarkdownRenderer.js'
import { ArtifactEmptyState } from './ArtifactEmptyState.js'
import { DocxRenderer } from './DocxRenderer.js'
import { ImageRenderer } from './ImageRenderer.js'
import { PdfRenderer } from './PdfRenderer.js'
import { PublishModal } from './PublishModal.js'
import { XlsxRenderer } from './XlsxRenderer.js'

type IconCmp = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const TYPE_ICONS: Record<ArtifactRenderType, IconCmp> = {
  html: Globe,
  code: Braces,
  markdown: FileText,
  svg: SquareCode,
  mermaid: Network,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pdf: FileText,
  image: ImageIcon,
}

function iconFor(type: ArtifactRenderType): IconCmp {
  return TYPE_ICONS[type] || Braces
}

// ── Content renderers ─────────────────────────────────────────────

function HtmlIframe({ content, title }: { content: string; title: string }) {
  const srcDoc = useMemo(() => {
    if (content.includes('<html') || content.includes('<!DOCTYPE')) return content
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#fff;color:#111}</style>
</head><body>${content}</body></html>`
  }, [content])
  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      className="art-panel__iframe"
      title={title}
    />
  )
}

function SvgFrame({ content }: { content: string }) {
  return (
    <div
      className="art-panel__svg"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from agent tool is trusted
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}

function MermaidIframe({ content, title }: { content: string; title: string }) {
  const srcDoc = useMemo(
    () => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<style>body{margin:16px;background:#fff;display:flex;justify-content:center}</style>
</head><body>
<pre class="mermaid">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
<script>mermaid.initialize({startOnLoad:true,theme:'default'})<\/script>
</body></html>`,
    [content],
  )
  return (
    <iframe srcDoc={srcDoc} sandbox="allow-scripts" className="art-panel__iframe" title={title} />
  )
}

function ArtifactBody({
  artifact,
  mode,
}: {
  artifact: Artifact
  mode: 'preview' | 'source'
}) {
  if (mode === 'source') {
    const lang =
      artifact.renderType === 'html'
        ? 'html'
        : artifact.renderType === 'svg'
          ? 'xml'
          : artifact.renderType === 'mermaid'
            ? 'text'
            : artifact.language
    return (
      <div className="art-panel__code">
        <HighlightedBlock code={artifact.content} lang={lang} />
      </div>
    )
  }
  const title = artifact.title || artifact.filename || 'Artifact'
  switch (artifact.renderType) {
    case 'html':
      return <HtmlIframe content={artifact.content} title={title} />
    case 'svg':
      return <SvgFrame content={artifact.content} />
    case 'mermaid':
      return <MermaidIframe content={artifact.content} title={title} />
    case 'markdown':
      return (
        <div className="art-panel__doc">
          <MarkdownRenderer content={artifact.content} />
        </div>
      )
    case 'docx':
      return artifact.sourcePath ? (
        <DocxRenderer sourcePath={artifact.sourcePath} filename={artifact.filename} />
      ) : (
        <MissingSourcePath />
      )
    case 'xlsx':
      return artifact.sourcePath ? (
        <XlsxRenderer sourcePath={artifact.sourcePath} filename={artifact.filename} />
      ) : (
        <MissingSourcePath />
      )
    case 'pdf':
      return artifact.sourcePath ? (
        <PdfRenderer sourcePath={artifact.sourcePath} filename={artifact.filename} />
      ) : (
        <MissingSourcePath />
      )
    case 'image':
      return artifact.sourcePath ? (
        <ImageRenderer sourcePath={artifact.sourcePath} filename={artifact.filename} />
      ) : (
        <MissingSourcePath />
      )
    default:
      return (
        <div className="art-panel__code">
          <HighlightedBlock code={artifact.content} lang={artifact.language} />
        </div>
      )
  }
}

function MissingSourcePath() {
  return (
    <div className="art-panel__failure">
      <div className="art-panel__failure-title">This artifact is missing a source path.</div>
      <div className="art-panel__failure-hint">
        Binary artifacts require a workspace path to fetch bytes.
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────

export function ArtifactPanelContent() {
  const artifacts = artifactStore((s) => s.artifacts)
  const tabs = artifactStore((s) => s.artifactTabs)
  const activeArtifactId = artifactStore((s) => s.activeArtifactId)
  const setActiveArtifact = artifactStore((s) => s.setActiveArtifact)
  const closeArtifactTab = artifactStore((s) => s.closeArtifactTab)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)
  const openPublishModal = artifactStore((s) => s.openPublishModal)
  const domain = connectionStore((s) => s.domain)

  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [copied, setCopied] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const visibleTabs = useMemo(
    () =>
      tabs.map((id) => artifacts.find((a) => a.id === id)).filter((a): a is Artifact => Boolean(a)),
    [tabs, artifacts],
  )

  const active = useMemo(
    () => artifacts.find((a) => a.id === activeArtifactId) ?? visibleTabs[visibleTabs.length - 1],
    [artifacts, activeArtifactId, visibleTabs],
  )

  // Reset mode when the active artifact changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs on active-id change, not on setter identity
  useEffect(() => {
    setMode('preview')
    setCopied(false)
    setCopiedUrl(false)
  }, [active?.id])

  const fullPublishedUrl = useMemo(() => {
    if (!active?.publishedUrl) return ''
    if (active.publishedUrl.startsWith('http')) return active.publishedUrl
    if (domain) return `https://${domain}${active.publishedUrl}`
    return active.publishedUrl
  }, [active?.publishedUrl, domain])

  const isBinary = active ? isBinaryRenderType(active.renderType) : false

  const handleCopy = useCallback(() => {
    if (!active) return
    if (isBinary) {
      // For binary artifacts (docx/xlsx/pdf/image), copy the workspace path —
      // copying raw bytes to the clipboard as text isn't useful.
      if (active.sourcePath) {
        navigator.clipboard?.writeText(active.sourcePath)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      return
    }
    navigator.clipboard?.writeText(active.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [active, isBinary])

  const handleCopyUrl = useCallback(() => {
    if (!fullPublishedUrl) return
    navigator.clipboard?.writeText(fullPublishedUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 1500)
  }, [fullPublishedUrl])

  const handleDownload = useCallback(() => {
    if (!active) return
    const ext = getArtifactFileExtension(active.renderType, active.language)
    const filename = active.filename || `${active.title || 'artifact'}.${ext}`

    // Binary artifacts (docx/xlsx/pdf/image): fetch bytes from the workspace
    // and serve via Blob URL. Text artifacts retain the existing fast path.
    if (isBinary) {
      if (!active.sourcePath) return
      const sub: { off?: () => void } = {}
      const timeout = window.setTimeout(() => {
        sub.off?.()
      }, 30_000)
      sub.off = connection.onFilesystemReadBytesResponse((payload) => {
        if (payload.path !== active.sourcePath) return
        window.clearTimeout(timeout)
        sub.off?.()
        if (payload.error || !payload.content) return
        try {
          const binary = atob(payload.content)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const blob = new Blob([bytes.buffer], {
            type: payload.mimeType || active.mimeType || 'application/octet-stream',
          })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          a.click()
          URL.revokeObjectURL(url)
        } catch {
          // Best-effort: ignore decode errors; user can open via artifact panel directly.
        }
      })
      connection.sendFilesystemReadBytes(active.sourcePath)
      return
    }

    const blob = new Blob([active.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [active, isBinary])

  // Renderer failure states dispatch `anton:request-download` so the user
  // can fall back to a raw-file download. Wire to the existing handler.
  useEffect(() => {
    const onDownload = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; filename?: string }
      if (!detail?.path || !active || detail.path !== active.sourcePath) return
      handleDownload()
    }
    window.addEventListener('anton:request-download', onDownload)
    return () => window.removeEventListener('anton:request-download', onDownload)
  }, [active, handleDownload])

  if (visibleTabs.length === 0 || !active) {
    return <ArtifactEmptyState />
  }

  const ActiveIcon = iconFor(active.renderType)
  const canToggle = ['html', 'svg', 'mermaid', 'markdown'].includes(active.renderType)
  const activeTitle = active.title || active.filename || 'Untitled'

  return (
    <aside className="art-panel">
      {/* Unified header — title on the left, actions + close on the right */}
      <header className="art-panel__bar">
        <div className="art-panel__bar-left">
          <ActiveIcon size={15} strokeWidth={1.5} className="art-panel__icon" />
          <span className="art-panel__title" title={activeTitle}>
            {activeTitle}
          </span>
          <span className="art-panel__type">{getArtifactTypeLabel(active.renderType)}</span>
        </div>
        <div className="art-panel__bar-right">
          {canToggle && (
            <button
              type="button"
              className={`art-panel__icn${mode === 'source' ? ' on' : ''}`}
              onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}
              aria-label={mode === 'preview' ? 'View source' : 'View preview'}
              title={mode === 'preview' ? 'View source' : 'View preview'}
            >
              {mode === 'preview' ? (
                <Code2 size={14} strokeWidth={1.5} />
              ) : (
                <Eye size={14} strokeWidth={1.5} />
              )}
            </button>
          )}
          <button
            type="button"
            className="art-panel__icn"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy'}
            title={copied ? 'Copied' : 'Copy'}
          >
            {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            className="art-panel__icn"
            onClick={handleDownload}
            aria-label="Download"
            title="Download"
          >
            <Download size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className={`art-panel__icn${active.publishedUrl ? '' : ' art-panel__icn--accent'}`}
            onClick={() => openPublishModal(active.id)}
            aria-label={active.publishedUrl ? 'Manage publication' : 'Publish'}
            title={active.publishedUrl ? 'Manage publication' : 'Publish'}
          >
            {active.publishedUrl ? (
              <Settings2 size={14} strokeWidth={1.5} />
            ) : (
              <Globe size={14} strokeWidth={1.5} />
            )}
          </button>
          <span className="art-panel__bar-divider" aria-hidden="true" />
          <button
            type="button"
            className="art-panel__icn"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close panel"
            title="Close panel"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/* Tab strip — only shown when multiple artifacts are open */}
      {visibleTabs.length > 1 && (
        <div className="art-panel__tabs">
          {visibleTabs.map((a) => {
            const Tab = iconFor(a.renderType)
            const title = a.title || a.filename || 'Untitled'
            const isActive = a.id === active.id
            return (
              <button
                key={a.id}
                type="button"
                className={`art-tab${isActive ? ' active' : ''}`}
                onClick={() => setActiveArtifact(a.id)}
                title={title}
              >
                <Tab size={12} strokeWidth={1.5} />
                <span className="art-tab__name">{title}</span>
                <span
                  className="art-tab__close"
                  // biome-ignore lint/a11y/useSemanticElements: can't nest a <button> inside the outer tab <button>; role=button + keydown gives the same a11y
                  role="button"
                  tabIndex={0}
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeArtifactTab(a.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      e.preventDefault()
                      closeArtifactTab(a.id)
                    }
                  }}
                >
                  <X size={10} strokeWidth={2} />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Published banner */}
      {active.publishedUrl && (
        <div className="art-panel__published">
          <Globe size={12} strokeWidth={1.5} />
          <a
            href={fullPublishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="art-panel__published-url"
          >
            {fullPublishedUrl}
          </a>
          <button
            type="button"
            className="art-panel__published-copy"
            onClick={handleCopyUrl}
            title={copiedUrl ? 'Copied' : 'Copy URL'}
          >
            {copiedUrl ? (
              <Check size={12} strokeWidth={1.5} />
            ) : (
              <Link size={12} strokeWidth={1.5} />
            )}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="art-panel__content" key={`${active.id}-${mode}`}>
        <ArtifactBody artifact={active} mode={mode} />
      </div>

      <PublishModal />
    </aside>
  )
}
