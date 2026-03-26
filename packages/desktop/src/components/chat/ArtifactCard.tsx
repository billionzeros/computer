import { motion } from 'framer-motion'
import { Code2, FileText, GitBranch, Globe, Image as ImageIcon, PanelRight } from 'lucide-react'
import type React from 'react'
import type { Artifact } from '../../lib/artifacts.js'
import { useStore } from '../../lib/store.js'

interface Props {
  artifact: Artifact
}

const typeIcons: Record<string, React.ElementType> = {
  html: Globe,
  code: Code2,
  markdown: FileText,
  svg: ImageIcon,
  mermaid: GitBranch,
}

const typeLabels: Record<string, string> = {
  html: 'HTML',
  code: 'Code',
  markdown: 'Markdown',
  svg: 'SVG',
  mermaid: 'Diagram',
}

export function ArtifactCard({ artifact }: Props) {
  const setActiveArtifact = useStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)
  const setSidePanelView = useStore((s) => s.setSidePanelView)

  const Icon = typeIcons[artifact.renderType] || Code2
  const label = typeLabels[artifact.renderType] || 'File'
  const title = artifact.title || artifact.filename || 'Untitled'
  const showPreview = artifact.renderType === 'html' || artifact.renderType === 'svg'

  const handleClick = () => {
    setActiveArtifact(artifact.id)
    setSidePanelView('artifacts')
    setArtifactPanelOpen(true)
  }

  return (
    <motion.button
      type="button"
      className="artifact-card"
      onClick={handleClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Mini preview for HTML/SVG */}
      {showPreview && (
        <div className="artifact-card__preview">
          <iframe
            srcDoc={artifact.content}
            sandbox="allow-scripts"
            title={title}
            className="artifact-card__iframe"
            tabIndex={-1}
          />
          <div className="artifact-card__preview-overlay" />
        </div>
      )}

      {/* Info bar */}
      <div className="artifact-card__info">
        <div className="artifact-card__meta">
          <Icon size={14} strokeWidth={1.5} className="artifact-card__icon" />
          <span className="artifact-card__title">{title}</span>
          <span className="artifact-card__type">{label}</span>
        </div>
        <PanelRight size={14} strokeWidth={1.5} className="artifact-card__open-icon" />
      </div>
    </motion.button>
  )
}
