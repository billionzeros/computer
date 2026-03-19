import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import type { ChatMessage } from '../../lib/store.js'
import { useAgentStatus } from '../../lib/store.js'
import { AntonLogo } from '../AntonLogo.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import { ToolCallBlock } from './ToolCallBlock.js'

interface Props {
  message: ChatMessage
}

export function MessageBubble({ message }: Props) {
  const agentStatus = useAgentStatus()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={getContainerClass(message)}
    >
      {message.role === 'assistant' && (
        <div className="message__meta">
          <AntonLogo size={24} thinking={agentStatus === 'working'} className="message__anton-logo" />
        </div>
      )}

      {message.role === 'user' && (
        <div className="message__surface message__surface--user">
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
          {message.isError && <AlertTriangle className="system-message__icon" />}
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
