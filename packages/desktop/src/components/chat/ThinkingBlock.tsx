import { Brain, ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface Props {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isOpen = isStreaming || expanded

  return (
    <div className={`thinking-block ${isStreaming ? 'thinking-block--streaming' : ''}`}>
      <button
        type="button"
        className="thinking-block__header"
        onClick={() => !isStreaming && setExpanded(!expanded)}
      >
        <Brain size={15} strokeWidth={1.5} className="thinking-block__icon" />
        <span className="thinking-block__label">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        {!isStreaming && (
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={`thinking-block__chevron ${isOpen ? 'thinking-block__chevron--open' : ''}`}
          />
        )}
      </button>
      {isOpen && (
        <div className="thinking-block__content">
          <pre className="thinking-block__text">{content}</pre>
        </div>
      )}
    </div>
  )
}
