import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  ImageOff,
  Loader2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { classifyUpload } from '../../lib/artifacts.js'
import { useAttachmentBlobUrl } from '../../lib/attachments.js'
import type { ChatImageAttachment, CitationSource } from '../../lib/store.js'
import { type ChatMessage, useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { useActiveSessionState } from '../../lib/store/sessionStore.js'
import { ImageViewer } from './ImageViewer.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import { SourceCards } from './SourceCards.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { ToolCallBlock } from './ToolCallBlock.js'

interface Props {
  message: ChatMessage
  sessionId?: string
  isLastThinking?: boolean
}

interface ImageAttachmentChipProps {
  attachment: ChatImageAttachment
  sessionId: string | undefined
  onOpen: (src: string, alt: string) => void
}

function ImageAttachmentChip({ attachment, sessionId, onOpen }: ImageAttachmentChipProps) {
  const [hover, setHover] = useState(false)
  const { url, loading, error } = useAttachmentBlobUrl(
    sessionId,
    attachment.storagePath,
    attachment.mimeType,
    attachment.data,
  )

  const leadingIcon = url ? (
    <img src={url} alt={attachment.name} className="message__image-chip-thumb" draggable={false} />
  ) : loading ? (
    <Loader2
      size={14}
      strokeWidth={1.75}
      className="message__image-chip-icon message__image-chip-icon--spin"
    />
  ) : error ? (
    <ImageOff
      size={14}
      strokeWidth={1.5}
      className="message__image-chip-icon message__image-chip-icon--error"
    />
  ) : (
    <FileImage size={14} strokeWidth={1.5} className="message__image-chip-icon" />
  )

  const title = error ? `Image unavailable (${error})` : attachment.name
  const buttonClass = error
    ? 'message__image-chip message__image-chip--error'
    : 'message__image-chip'

  return (
    <span
      className="message__image-chip-wrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className={buttonClass}
        title={title}
        disabled={!url}
        aria-disabled={!url}
        onClick={() => url && onOpen(url, attachment.name)}
      >
        {leadingIcon}
        <span className="message__image-chip-name">{attachment.name}</span>
      </button>
      <AnimatePresence>
        {hover && url && (
          <motion.span
            key="preview"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="message__image-chip-preview"
          >
            <img src={url} alt={attachment.name} draggable={false} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

// Matches [img:id], [file:path], [dir:path] — three marker kinds the composer
// may embed in the outgoing message text. Keeping one combined regex lets the
// interleave walker dispatch per-kind in a single pass.
const MESSAGE_MARKER_RE = /\[(img|file|dir):([^\]]+)\]/g

function fileBasename(p: string): string {
  const clean = p.replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

function fileIconFor(name: string) {
  const renderType = classifyUpload(undefined, name)
  if (renderType === 'image') return ImageIcon
  if (renderType === 'xlsx') return FileSpreadsheet
  if (renderType === 'pdf' || renderType === 'docx' || renderType === 'markdown') return FileText
  if (renderType === 'code') return FileText
  return FileIcon
}

function openFileArtifact(relPath: string) {
  const active = projectStore
    .getState()
    .projects.find((p) => p.id === projectStore.getState().activeProjectId)
  const workspaceRoot = active?.workspacePath
  if (!workspaceRoot) return
  const absPath = relPath.startsWith('/')
    ? relPath
    : `${workspaceRoot.replace(/\/$/, '')}/${relPath}`
  const name = fileBasename(relPath) || relPath
  const renderType = classifyUpload(undefined, relPath) ?? 'code'
  const id = `upload:${absPath}`
  artifactStore.getState().addArtifact({
    id,
    type: 'file',
    source: 'upload',
    renderType,
    filename: name,
    filepath: absPath,
    sourcePath: absPath,
    language: '',
    content: '',
    toolCallId: id,
    timestamp: Date.now(),
  })
  artifactStore.getState().setArtifactPanelOpen(true)
  artifactStore.getState().setActiveArtifact(id)
}

function navigateToFolder(relPath: string) {
  const active = projectStore
    .getState()
    .projects.find((p) => p.id === projectStore.getState().activeProjectId)
  const workspaceRoot = active?.workspacePath
  if (!workspaceRoot) return
  const absPath = relPath.startsWith('/')
    ? relPath
    : `${workspaceRoot.replace(/\/$/, '')}/${relPath}`
  window.dispatchEvent(new CustomEvent('anton:navigate-files', { detail: { path: absPath } }))
}

/** Render user message content with inline chips for image / file / dir markers. */
function UserMessageContent({
  message,
  sessionId,
}: {
  message: ChatMessage
  sessionId: string | undefined
}) {
  const [viewerImage, setViewerImage] = useState<{ src: string; alt: string } | null>(null)
  const openViewer = (src: string, alt: string) => setViewerImage({ src, alt })

  const attachments = message.attachments
  const content = message.content

  const attachmentMap = new Map((attachments ?? []).map((a) => [a.id, a]))

  // Scan for any marker kind. If there are none AND no attachments, it's
  // pure text. If there are legacy attachments without markers, the old
  // "chips appended" branch at the end handles that.
  MESSAGE_MARKER_RE.lastIndex = 0
  const hasAnyMarker = MESSAGE_MARKER_RE.test(content)
  MESSAGE_MARKER_RE.lastIndex = 0

  if (!hasAnyMarker) {
    if (!attachments || attachments.length === 0) {
      return <div className="message__text">{content}</div>
    }
    // Legacy: image attachments, no markers — show chips after the text.
    return (
      <>
        {content && <div className="message__text">{content}</div>}
        <div className="message__inline-chips">
          {attachments.map((attachment) => (
            <ImageAttachmentChip
              key={attachment.id}
              attachment={attachment}
              sessionId={sessionId}
              onOpen={openViewer}
            />
          ))}
        </div>
        {viewerImage && (
          <ImageViewer
            src={viewerImage.src}
            alt={viewerImage.alt}
            open
            onClose={() => setViewerImage(null)}
          />
        )}
      </>
    )
  }

  // Walk the content, emitting text spans + typed chips.
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  for (
    let match = MESSAGE_MARKER_RE.exec(content);
    match !== null;
    match = MESSAGE_MARKER_RE.exec(content)
  ) {
    if (match.index > lastIndex) {
      elements.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>)
    }

    const kind = match[1] as 'img' | 'file' | 'dir'
    const value = match[2] ?? ''

    if (kind === 'img') {
      const attachment = attachmentMap.get(value)
      if (attachment) {
        elements.push(
          <ImageAttachmentChip
            key={`img-${value}`}
            attachment={attachment}
            sessionId={sessionId}
            onOpen={openViewer}
          />,
        )
      }
    } else if (kind === 'file') {
      const name = fileBasename(value) || value
      const Icon = fileIconFor(name)
      elements.push(
        <button
          key={`file-${value}-${match.index}`}
          type="button"
          className="message__file-chip"
          title={value}
          onClick={() => openFileArtifact(value)}
        >
          <Icon size={14} strokeWidth={1.5} className="message__file-chip-icon" />
          <span className="message__file-chip-name">{name}</span>
        </button>,
      )
    } else if (kind === 'dir') {
      const name = fileBasename(value) || value
      elements.push(
        <button
          key={`dir-${value}-${match.index}`}
          type="button"
          className="message__file-chip message__file-chip--folder"
          title={value}
          onClick={() => navigateToFolder(value)}
        >
          <Folder size={14} strokeWidth={1.5} className="message__file-chip-icon" />
          <span className="message__file-chip-name">{name}</span>
        </button>,
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    elements.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex)}</span>)
  }

  return (
    <>
      <div className="message__text message__text--inline">{elements}</div>
      {viewerImage && (
        <ImageViewer
          src={viewerImage.src}
          alt={viewerImage.alt}
          open
          onClose={() => setViewerImage(null)}
        />
      )}
    </>
  )
}

export function MessageBubble({ message, sessionId, isLastThinking }: Props) {
  const citations = useStore((s) => s.citations.get(message.id))
  // For assistant final answers, the model may reference citations across
  // multiple web_search calls in the turn — but only the most-recent batch
  // is attached to this message id. Aggregate all citations stored on the
  // active conversation so any [N] reference in the answer can resolve to
  // a real source. Earlier batches win on index collisions, since later
  // batches typically restart numbering.
  const allCitations = useStore((s) => s.citations)
  const conversationMessages = useStore((s) => s.getActiveConversation()?.messages ?? [])
  const lookupCitations = useMemo<CitationSource[] | undefined>(() => {
    if (message.role !== 'assistant' || message.isThinking) return citations
    const byIndex = new Map<number, CitationSource>()
    for (const m of conversationMessages) {
      const list = allCitations.get(m.id)
      if (!list) continue
      for (const c of list) {
        if (!byIndex.has(c.index)) byIndex.set(c.index, c)
      }
    }
    if (citations) {
      for (const c of citations) byIndex.set(c.index, c)
    }
    if (byIndex.size === 0) return citations
    return Array.from(byIndex.values()).sort((a, b) => a.index - b.index)
  }, [message.role, message.isThinking, citations, allCitations, conversationMessages])
  const isAgentWorking = useActiveSessionState((s) => s.status === 'working')

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={getContainerClass(message)}
    >
      {message.role === 'user' && (
        <div className="message__surface message__surface--user">
          <UserMessageContent message={message} sessionId={sessionId} />
        </div>
      )}

      {message.role === 'assistant' && message.isThinking && (
        <ThinkingBlock content={message.content} isStreaming={isLastThinking && isAgentWorking} />
      )}

      {message.role === 'assistant' && !message.isThinking && (
        <div className="message__surface message__surface--assistant">
          {citations && citations.length > 0 && <SourceCards sources={citations} />}
          <MarkdownRenderer content={message.content} citations={lookupCitations} />
        </div>
      )}

      {message.role === 'tool' && <ToolCallBlock message={message} />}

      {message.role === 'system' && message.askUserAnswers && (
        <div className="ask-user-summary">
          {Object.entries(message.askUserAnswers).map(([question, answer]) => (
            <div key={question} className="ask-user-summary__item">
              <div className="ask-user-summary__question">{question}</div>
              <div className="ask-user-summary__answer">{answer}</div>
            </div>
          ))}
        </div>
      )}

      {message.role === 'system' && !message.askUserAnswers && (
        <div
          className={message.isError ? 'system-message system-message--error' : 'system-message'}
        >
          {message.isError && (
            <AlertTriangle size={14} strokeWidth={1.5} className="system-message__icon" />
          )}
          <span className="system-message__text">{message.content}</span>
        </div>
      )}
    </motion.div>
  )
}

function getContainerClass(msg: ChatMessage): string {
  const base = 'message'

  switch (msg.role) {
    case 'user':
      return `${base} message--user`
    case 'assistant':
      return `${base} message--assistant`
    case 'tool':
      return `${base} message--tool`
    case 'system':
      return `${base} message--system`
    default:
      return base
  }
}
