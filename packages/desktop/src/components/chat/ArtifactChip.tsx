import { ArrowUpRight, Code, Database, FileText, Globe, Image as ImageIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type ArtifactKind = 'html' | 'code' | 'doc' | 'image' | 'data' | 'svg'

export interface ArtifactChipProps {
  title: string
  kind: ArtifactKind
  onOpen?: () => void
}

const KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'HTML',
  code: 'Code',
  doc: 'Document',
  image: 'Image',
  data: 'JSON',
  svg: 'SVG',
}

function kindIcon(kind: ArtifactKind): ReactNode {
  switch (kind) {
    case 'html':
      return <Globe size={13} strokeWidth={1.5} />
    case 'code':
      return <Code size={13} strokeWidth={1.5} />
    case 'doc':
      return <FileText size={13} strokeWidth={1.5} />
    case 'image':
    case 'svg':
      return <ImageIcon size={13} strokeWidth={1.5} />
    case 'data':
      return <Database size={13} strokeWidth={1.5} />
  }
}

export function ArtifactChip({ title, kind, onOpen }: ArtifactChipProps) {
  return (
    <button type="button" className="art-chip" onClick={onOpen}>
      <span className="art-chip__icon">{kindIcon(kind)}</span>
      <span className="art-chip__title">{title}</span>
      <span className="art-chip__sep">·</span>
      <span className="art-chip__type">{KIND_LABELS[kind]}</span>
      <ArrowUpRight size={11} strokeWidth={1.5} className="art-chip__out" />
    </button>
  )
}
