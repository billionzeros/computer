import { Brain, ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface Props {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = content.trim().length > 0
  const isOpen = isStreaming || expanded
  const clickable = hasContent && !isStreaming

  return (
    <div
      className={[
        'conv-chip',
        'conv-chip--thinking',
        isOpen ? 'open' : '',
        hasContent ? 'has-children' : '',
        isStreaming ? 'conv-chip--streaming' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="conv-chip__row"
        onClick={() => clickable && setExpanded((x) => !x)}
        disabled={!clickable}
      >
        <Brain size={13} strokeWidth={1.5} className="conv-chip__icon" />
        <span className="conv-chip__label">{isStreaming ? 'Thinking…' : 'Thinking'}</span>
        {hasContent && !isStreaming && (
          <ChevronRight size={12} strokeWidth={1.5} className="conv-chip__chev" />
        )}
      </button>
      {hasContent && isOpen && (
        <div className="conv-chip__children">
          <div className="conv-chip__child conv-chip__child--thought">{content}</div>
        </div>
      )}
    </div>
  )
}
