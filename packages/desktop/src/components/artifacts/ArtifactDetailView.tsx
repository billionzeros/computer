import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, Code2, Copy, Download, Eye, Globe, Link, Settings2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { Artifact } from '../../lib/artifacts.js'
import { getArtifactFileExtension, getArtifactTypeLabel } from '../../lib/artifacts.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { HighlightedBlock, MarkdownRenderer } from '../chat/MarkdownRenderer.js'
import { PublishModal } from './PublishModal.js'

// ── Sub-renderers ──────────────────────────────────────────────────

function HtmlRenderer({ content }: { content: string }) {
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
      className="artifact-detail__iframe"
      title="Artifact preview"
    />
  )
}

function SvgRenderer({ content }: { content: string }) {
  return (
    <div
      className="artifact-detail__svg"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from agent tool is trusted
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}

function MermaidRenderer({ content }: { content: string }) {
  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<style>body{margin:16px;background:#fff;display:flex;justify-content:center}</style>
</head><body>
<pre class="mermaid">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
<script>mermaid.initialize({startOnLoad:true,theme:'default'})<\/script>
</body></html>`
  }, [content])

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="artifact-detail__iframe"
      title="Mermaid diagram"
    />
  )
}

// ── Content renderer ───────────────────────────────────────────────

function ArtifactContent({
  artifact,
  viewMode,
}: { artifact: Artifact; viewMode: 'preview' | 'source' }) {
  if (viewMode === 'source') {
    const lang =
      artifact.renderType === 'html'
        ? 'html'
        : artifact.renderType === 'svg'
          ? 'xml'
          : artifact.renderType === 'mermaid'
            ? 'text'
            : artifact.language
    return <HighlightedBlock code={artifact.content} lang={lang} />
  }

  switch (artifact.renderType) {
    case 'html':
      return <HtmlRenderer content={artifact.content} />
    case 'svg':
      return <SvgRenderer content={artifact.content} />
    case 'mermaid':
      return <MermaidRenderer content={artifact.content} />
    case 'markdown':
      return <MarkdownRenderer content={artifact.content} />
    default:
      return <HighlightedBlock code={artifact.content} lang={artifact.language} />
  }
}

// ── Detail view ───────────────────────────────────────────────────

export function ArtifactDetailView() {
  const artifacts = artifactStore((s) => s.artifacts)
  const activeArtifactId = artifactStore((s) => s.activeArtifactId)
  const setViewMode = artifactStore((s) => s.setArtifactViewMode)

  const artifact = artifacts.find((a) => a.id === activeArtifactId)

  const [copied, setCopied] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [viewMode, setContentViewMode] = useState<'preview' | 'source'>('preview')
  const openPublishModal = artifactStore((s) => s.openPublishModal)

  const canToggleView =
    artifact && ['html', 'svg', 'mermaid', 'markdown'].includes(artifact.renderType)

  const handleCopy = useCallback(() => {
    if (!artifact) return
    navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [artifact])

  const domain = connectionStore((s) => s.domain)

  // Build full published URL
  const fullPublishedUrl = useMemo(() => {
    if (!artifact?.publishedUrl) return ''
    if (artifact.publishedUrl.startsWith('http')) return artifact.publishedUrl
    if (domain) return `https://${domain}${artifact.publishedUrl}`
    return artifact.publishedUrl
  }, [artifact?.publishedUrl, domain])

  const handleCopyUrl = useCallback(() => {
    if (!fullPublishedUrl) return
    navigator.clipboard.writeText(fullPublishedUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }, [fullPublishedUrl])

  const handleDownload = useCallback(() => {
    if (!artifact) return
    const ext = getArtifactFileExtension(artifact.renderType, artifact.language)
    const filename = artifact.filename || `${artifact.title || 'artifact'}.${ext}`
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [artifact])

  if (!artifact) {
    setViewMode('list')
    return null
  }

  return (
    <div className="artifact-detail">
      {/* Header */}
      <div className="artifact-detail__header">
        <button type="button" className="artifact-detail__back" onClick={() => setViewMode('list')}>
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="artifact-detail__title-group">
          <span className="artifact-detail__title">
            {artifact.title || artifact.filename || 'Untitled'}
          </span>
          <span className="artifact-detail__type-badge">
            {getArtifactTypeLabel(artifact.renderType)}
          </span>
        </div>
      </div>

      {/* Published banner */}
      {artifact.publishedUrl && (
        <div className="artifact-detail__published">
          <Globe size={12} strokeWidth={1.5} />
          <a
            href={fullPublishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="artifact-detail__published-url"
          >
            {fullPublishedUrl}
          </a>
          <button type="button" className="artifact-detail__copy-url" onClick={handleCopyUrl}>
            {copiedUrl ? <Check size={12} /> : <Link size={12} />}
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="artifact-detail__actions">
        {canToggleView && (
          <button
            type="button"
            className={`artifact-detail__action ${viewMode === 'source' ? 'artifact-detail__action--active' : ''}`}
            onClick={() => setContentViewMode(viewMode === 'preview' ? 'source' : 'preview')}
          >
            {viewMode === 'preview' ? <Code2 size={14} /> : <Eye size={14} />}
            <span>{viewMode === 'preview' ? 'Source' : 'Preview'}</span>
          </button>
        )}

        <button type="button" className="artifact-detail__action" onClick={handleCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>

        <button type="button" className="artifact-detail__action" onClick={handleDownload}>
          <Download size={14} />
          <span>Download</span>
        </button>

        <button
          type="button"
          className={`artifact-detail__action ${artifact.publishedUrl ? 'artifact-detail__action--manage' : 'artifact-detail__action--publish'}`}
          onClick={() => openPublishModal(artifact.id)}
        >
          {artifact.publishedUrl ? (
            <Settings2 size={14} strokeWidth={1.5} />
          ) : (
            <Globe size={14} strokeWidth={1.5} />
          )}
          <span>{artifact.publishedUrl ? 'Manage' : 'Publish'}</span>
        </button>
      </div>

      {/* Content */}
      <div className="artifact-detail__content">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${artifact.id}-${viewMode}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="artifact-detail__content-inner"
          >
            <ArtifactContent artifact={artifact} viewMode={viewMode} />
          </motion.div>
        </AnimatePresence>
      </div>

      <PublishModal />
    </div>
  )
}
