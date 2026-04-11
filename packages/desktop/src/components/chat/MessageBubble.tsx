import { motion } from 'framer-motion'
import { AlertTriangle, FileImage } from 'lucide-react'
import { useState } from 'react'
import type { ChatImageAttachment } from '../../lib/store.js'
import { type ChatMessage, useStore } from '../../lib/store.js'
import { useActiveSessionState } from '../../lib/store/sessionStore.js'
import { ImageViewer } from './ImageViewer.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import { SourceCards } from './SourceCards.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { ToolCallBlock } from './ToolCallBlock.js'

interface Props {
  message: ChatMessage
  isLastThinking?: boolean
}

function attachmentSrc(attachment: ChatImageAttachment): string | undefined {
  return attachment.data ? `data:${attachment.mimeType};base64,${attachment.data}` : undefined
}

const IMG_MARKER_RE = /\[img:([^\]]+)\]/g

/** Render user message content with inline image chips interleaved with text. */
function UserMessageContent({ message }: { message: ChatMessage }) {
  const [viewerImage, setViewerImage] = useState<{ src: string; alt: string } | null>(null)

  const attachments = message.attachments
  const content = message.content

  // No attachments — plain text
  if (!attachments || attachments.length === 0) {
    return <div className="message__text">{content}</div>
  }

  // Build lookup
  const attachmentMap = new Map(
    attachments.map((a) => [a.id, { attachment: a, src: attachmentSrc(a) }]),
  )

  // Check if content has [img:id] markers
  const hasMarkers = IMG_MARKER_RE.test(content)
  IMG_MARKER_RE.lastIndex = 0 // reset after test

  if (!hasMarkers) {
    // Legacy: no markers, show chips after text
    return (
      <>
        {content && <div className="message__text">{content}</div>}
        <div className="message__inline-chips">
          {attachments.map((attachment) => {
            const src = attachmentMap.get(attachment.id)?.src
            return (
              <button
                key={attachment.id}
                type="button"
                className="message__image-chip"
                onClick={() => src && setViewerImage({ src, alt: attachment.name })}
              >
                <FileImage size={14} strokeWidth={1.5} className="message__image-chip-icon" />
                <span className="message__image-chip-name">{attachment.name}</span>
              </button>
            )
          })}
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

  // Parse content, splitting on [img:id] markers to interleave text + chips
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  for (
    let match = IMG_MARKER_RE.exec(content);
    match !== null;
    match = IMG_MARKER_RE.exec(content)
  ) {
    // Text before the marker
    if (match.index > lastIndex) {
      elements.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>)
    }

    // Image chip
    const id = match[1]
    const entry = attachmentMap.get(id)
    if (entry) {
      elements.push(
        <button
          key={`img-${id}`}
          type="button"
          className="message__image-chip"
          onClick={() =>
            entry.src && setViewerImage({ src: entry.src, alt: entry.attachment.name })
          }
        >
          <FileImage size={14} strokeWidth={1.5} className="message__image-chip-icon" />
          <span className="message__image-chip-name">{entry.attachment.name}</span>
        </button>,
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Trailing text
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

export function MessageBubble({ message, isLastThinking }: Props) {
  const citations = useStore((s) => s.citations.get(message.id))
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
          <UserMessageContent message={message} />
        </div>
      )}

      {message.role === 'assistant' && message.isThinking && (
        <ThinkingBlock content={message.content} isStreaming={isLastThinking && isAgentWorking} />
      )}

      {message.role === 'assistant' && !message.isThinking && (
        <div className="message__surface message__surface--assistant">
          {citations && citations.length > 0 && <SourceCards sources={citations} />}
          <MarkdownRenderer content={message.content} citations={citations} />
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
