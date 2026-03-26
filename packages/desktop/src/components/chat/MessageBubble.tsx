import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import type { ChatMessage } from '../../lib/store.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import { ToolCallBlock } from './ToolCallBlock.js'

interface Props {
  message: ChatMessage
}

function attachmentSrc(message: ChatMessage, index: number): string | undefined {
  const attachment = message.attachments?.[index]
  return attachment?.data ? `data:${attachment.mimeType};base64,${attachment.data}` : undefined
}

export function MessageBubble({ message }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={getContainerClass(message)}
    >
      {message.role === 'user' && (
        <div className="message__surface message__surface--user">
          {message.attachments && message.attachments.length > 0 && (
            <div className="message__attachments">
              {message.attachments.map((attachment, index) => {
                const src = attachmentSrc(message, index)
                return src ? (
                  <img
                    key={attachment.id}
                    src={src}
                    alt={attachment.name}
                    className="message__attachment-image"
                  />
                ) : (
                  <div key={attachment.id} className="message__attachment-fallback">
                    {attachment.name}
                  </div>
                )
              })}
            </div>
          )}
          <div className="message__text">{message.content}</div>
        </div>
      )}

      {message.role === 'assistant' && (
        <div className="message__surface message__surface--assistant">
          <MarkdownRenderer content={message.content} />
        </div>
      )}

      {message.role === 'tool' && <ToolCallBlock message={message} />}

      {message.role === 'system' && (
        <div
          className={message.isError ? 'system-message system-message--error' : 'system-message'}
        >
          {message.isError && <AlertTriangle size={14} strokeWidth={1.5} className="system-message__icon" />}
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
