import { motion } from 'framer-motion'
import { Braces, ChevronDown, ChevronUp, FileCode, Network, Sparkles, SquareCode, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import type { Artifact } from '../../lib/artifacts.js'
import { useStore } from '../../lib/store.js'

interface Props {
  artifact: Artifact
}

const typeIcons: Record<string, React.ElementType> = {
  html: Sparkles,
  code: Braces,
  markdown: FileCode,
  svg: SquareCode,
  mermaid: Network,
}

const typeLabels: Record<string, string> = {
  html: 'HTML',
  code: 'Code',
  markdown: 'Markdown',
  svg: 'SVG',
  mermaid: 'Diagram',
}

export function ArtifactCard({ artifact }: Props) {
  const [expanded, setExpanded] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const setActiveArtifact = useStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)
  const setArtifactViewMode = useStore((s) => s.setArtifactViewMode)

  const Icon = typeIcons[artifact.renderType] || Braces
  const label = typeLabels[artifact.renderType] || 'File'
  const title = artifact.title || artifact.filename || 'Untitled'
  const showPreview = artifact.renderType === 'html' || artifact.renderType === 'svg'

  if (dismissed) return null

  return (
    <motion.div
      className="artifact-card"
      data-artifact-id={artifact.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Info bar */}
      <div className="artifact-card__info">
        <button
          type="button"
          className="artifact-card__meta"
          onClick={() => {
            setActiveArtifact(artifact.id)
            setArtifactViewMode('detail')
            setArtifactPanelOpen(true)
          }}
        >
          <Icon size={14} strokeWidth={1.5} className="artifact-card__icon" />
          <span className="artifact-card__title">{title}</span>
          <span className="artifact-card__type">{label}</span>
          {artifact.publishedUrl && (
            <span className="artifact-card__published-dot" title="Published" />
          )}
        </button>
        <div className="artifact-card__actions">
          {showPreview && (
            <button
              type="button"
              className="artifact-card__action-btn"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp size={14} strokeWidth={1.5} /> : <ChevronDown size={14} strokeWidth={1.5} />}
            </button>
          )}
          <button
            type="button"
            className="artifact-card__action-btn"
            onClick={() => setDismissed(true)}
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Inline preview for HTML/SVG */}
      {showPreview && expanded && (
        <div className="artifact-card__preview">
          <iframe
            srcDoc={artifact.content}
            sandbox="allow-scripts"
            title={title}
            className="artifact-card__iframe"
            tabIndex={-1}
          />
        </div>
      )}
    </motion.div>
  )
}
