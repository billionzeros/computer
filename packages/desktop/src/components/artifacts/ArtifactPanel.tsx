import { AnimatePresence, motion } from 'framer-motion'
import { Check, Code2, Copy, Eye, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { Artifact } from '../../lib/artifacts.js'
import { useStore } from '../../lib/store.js'
import { HighlightedBlock } from '../chat/MarkdownRenderer.js'
import { MarkdownRenderer } from '../chat/MarkdownRenderer.js'

// ── Sub-renderers ──────────────────────────────────────────────────

function HtmlRenderer({ content }: { content: string }) {
  const srcDoc = useMemo(() => {
    // Inject a base style reset for consistent rendering
    if (content.includes('<html') || content.includes('<!DOCTYPE')) {
      return content
    }
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#fff;color:#111}</style>
</head><body>${content}</body></html>`
  }, [content])

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      className="artifact-panel__iframe"
      title="Artifact preview"
    />
  )
}

function SvgRenderer({ content }: { content: string }) {
  return (
    <div
      className="artifact-panel__svg"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from agent tool is trusted
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}

function MermaidRenderer({ content }: { content: string }) {
  // Render mermaid diagrams via an iframe with mermaid CDN
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
      className="artifact-panel__iframe"
      title="Mermaid diagram"
    />
  )
}

// ── Content renderer ───────────────────────────────────────────────

function ArtifactContent({ artifact, viewMode }: { artifact: Artifact; viewMode: 'preview' | 'source' }) {
  if (viewMode === 'source') {
    const lang = artifact.renderType === 'html' ? 'html'
      : artifact.renderType === 'svg' ? 'xml'
      : artifact.renderType === 'mermaid' ? 'text'
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
    case 'code':
    default:
      return <HighlightedBlock code={artifact.content} lang={artifact.language} />
  }
}

// ── Artifact panel content (used inside SidePanel) ────────────────

export function ArtifactPanelContent() {
  const artifacts = useStore((s) => s.artifacts)
  const activeArtifactId = useStore((s) => s.activeArtifactId)
  const setActiveArtifact = useStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId) || artifacts[artifacts.length - 1]

  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')

  const handleCopy = useCallback(() => {
    if (!activeArtifact) return
    navigator.clipboard.writeText(activeArtifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [activeArtifact])

  // Show source toggle only for renderable types (not code which is already source)
  const canToggleView = activeArtifact && ['html', 'svg', 'mermaid', 'markdown'].includes(activeArtifact.renderType)

  if (!activeArtifact) return null

  return (
    <>
      {/* Header with artifact tabs and close button */}
      <div className="artifact-panel__header">
        <div className="artifact-panel__tabs">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className={`artifact-panel__tab ${
                artifact.id === activeArtifact.id ? 'artifact-panel__tab--active' : ''
              }`}
              onClick={() => {
                setActiveArtifact(artifact.id)
                setViewMode('preview')
              }}
            >
              {artifact.title || artifact.filename || 'Output'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="artifact-panel__close"
          onClick={() => setArtifactPanelOpen(false)}
          aria-label="Close artifacts"
        >
          <X size={16} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="artifact-panel__toolbar">
        <span className="artifact-panel__filepath">
          {activeArtifact.filepath || activeArtifact.title || activeArtifact.filename || 'Output'}
        </span>
        <span className="artifact-panel__language">{activeArtifact.renderType}</span>

        {canToggleView && (
          <button
            type="button"
            className={`artifact-panel__viewToggle ${viewMode === 'source' ? 'artifact-panel__viewToggle--active' : ''}`}
            onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
            aria-label={viewMode === 'preview' ? 'View source' : 'View preview'}
          >
            {viewMode === 'preview' ? <Code2 size={12} /> : <Eye size={12} />}
            <span>{viewMode === 'preview' ? 'Source' : 'Preview'}</span>
          </button>
        )}

        <button type="button" className="artifact-panel__copy" onClick={handleCopy}>
          {copied ? (
            <>
              <Check size={12} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="artifact-panel__content">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeArtifact.id}-${viewMode}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="artifact-panel__content-inner"
          >
            <ArtifactContent artifact={activeArtifact} viewMode={viewMode} />
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
