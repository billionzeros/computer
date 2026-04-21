/**
 * SessionFilesBar — topbar pill + popover listing files produced by the
 * active conversation. Ported from the design handoff's `session-files.jsx`
 * (SessionFilesBar variant) into the live Anton app.
 *
 * Renders nothing when there are no artifacts for the active conversation.
 */

import {
  ChevronDown,
  Database,
  FileCode,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Artifact } from '../../lib/artifacts.js'
import { useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'

function artifactIcon(a: Artifact) {
  if (a.renderType === 'html') return Globe
  if (a.renderType === 'code') return FileCode
  if (a.renderType === 'markdown') return FileText
  if (a.renderType === 'svg') return ImageIcon
  if (a.renderType === 'mermaid') return Database
  return FileText
}

function artifactExtLabel(a: Artifact): string {
  if (a.renderType === 'html') return 'HTML'
  if (a.renderType === 'svg') return 'SVG'
  if (a.renderType === 'markdown') return 'MD'
  if (a.renderType === 'mermaid') return 'MMD'
  const lang = (a.language || '').toLowerCase()
  if (lang === 'typescript' || lang === 'ts') return 'TS'
  if (lang === 'tsx') return 'TSX'
  if (lang === 'javascript' || lang === 'js') return 'JS'
  if (lang === 'jsx') return 'JSX'
  if (lang === 'python' || lang === 'py') return 'PY'
  if (lang === 'json') return 'JSON'
  if (lang === 'yaml' || lang === 'yml') return 'YAML'
  if (lang === 'sh' || lang === 'bash') return 'SH'
  if (a.renderType === 'code') return 'CODE'
  return 'DOC'
}

function fmtAgoShort(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function artifactTitle(a: Artifact): string {
  return a.title || a.filename || a.filepath || 'Untitled'
}

function SessionFileThumb({ artifact }: { artifact: Artifact }) {
  if (artifact.renderType === 'html') {
    return (
      <div className="sf-thumb sf-thumb--html">
        <iframe
          srcDoc={artifact.content}
          sandbox=""
          tabIndex={-1}
          aria-hidden="true"
          title={artifactTitle(artifact)}
        />
      </div>
    )
  }
  if (artifact.renderType === 'svg') {
    return (
      <div
        className="sf-thumb sf-thumb--svg"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG preview from trusted artifact content
        dangerouslySetInnerHTML={{ __html: artifact.content }}
      />
    )
  }
  if (artifact.renderType === 'code') {
    const peek = (artifact.content || '').split('\n').slice(0, 6).join('\n')
    return (
      <div className="sf-thumb sf-thumb--code">
        <pre>{peek}</pre>
      </div>
    )
  }
  const firstHeading = (
    (artifact.content || '').split('\n').find((l) => /^#+\s/.test(l)) || artifactTitle(artifact)
  ).replace(/^#+\s/, '')
  return (
    <div className="sf-thumb sf-thumb--doc">
      <div className="sf-thumb__doc-title">{firstHeading}</div>
      <div className="sf-thumb__doc-lines">
        <span />
        <span />
        <span style={{ width: '70%' }} />
        <span />
        <span style={{ width: '40%' }} />
      </div>
    </div>
  )
}

export function SessionFilesBar() {
  const activeConversationId = useStore((s) => s.activeConversationId)
  const activeConversation = useStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId),
  )
  const allArtifacts = artifactStore((s) => s.artifacts)
  const activeArtifactId = artifactStore((s) => s.activeArtifactId)
  const setActiveArtifact = artifactStore((s) => s.setActiveArtifact)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const list = useMemo<Artifact[]>(() => {
    const sessionId = activeConversation?.sessionId
    return allArtifacts
      .filter((a) => {
        if (a.conversationId && sessionId) return a.conversationId === sessionId
        if (a.conversationId && activeConversationId) return a.conversationId === activeConversationId
        return true
      })
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [allArtifacts, activeConversation?.sessionId, activeConversationId])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  if (list.length === 0) return null

  const openArtifact = (id: string) => {
    setActiveArtifact(id)
    setArtifactPanelOpen(true)
    setOpen(false)
  }

  return (
    <div className="sfb" ref={ref}>
      <button
        type="button"
        className={`sfb__all${open ? ' sfb__all--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Files in this task"
      >
        <FolderOpen size={12} strokeWidth={1.5} />
        <span>Files</span>
        <span className="sfb__count">{list.length}</span>
        <ChevronDown size={10} strokeWidth={1.5} className="sfb__chev" />
      </button>
      {open && (
        <div className="sfb__pop" role="dialog" aria-label="Files in this task">
          <div className="sfb__pop-head">
            <FolderOpen size={11} strokeWidth={1.5} />
            <span>Files in this task</span>
            <span className="sfb__pop-count">{list.length}</span>
          </div>
          <div className="sfb__pop-list">
            {list.map((a) => {
              const Icn = artifactIcon(a)
              const active = a.id === activeArtifactId
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`sfb__pop-item${active ? ' active' : ''}`}
                  onClick={() => openArtifact(a.id)}
                >
                  <div className="sfb__pop-thumb">
                    <SessionFileThumb artifact={a} />
                  </div>
                  <div className="sfb__pop-body">
                    <div className="sfb__pop-row">
                      <Icn size={11} strokeWidth={1.5} className="sfb__pop-icn" />
                      <span className="sfb__pop-name">{artifactTitle(a)}</span>
                    </div>
                    <div className="sfb__pop-meta">
                      <span>{artifactExtLabel(a)}</span>
                      <span>·</span>
                      <span>{fmtAgoShort(a.timestamp)} ago</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
