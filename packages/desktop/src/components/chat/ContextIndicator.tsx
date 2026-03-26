import { Brain, FolderOpen } from 'lucide-react'
import type { ConversationContextInfo } from '../../lib/conversations.js'
import { useStore } from '../../lib/store.js'

interface ContextIndicatorProps {
  contextInfo?: ConversationContextInfo
  sessionId?: string
}

export function ContextIndicator({ contextInfo, sessionId }: ContextIndicatorProps) {
  const openContextPanel = useStore((s) => s.openContextPanel)

  const totalMemories = contextInfo
    ? contextInfo.globalMemories.length +
      contextInfo.conversationMemories.length +
      contextInfo.crossConversationMemories.length
    : 0

  if (!sessionId && totalMemories === 0) return null

  return (
    <div className="context-indicator">
      <button
        type="button"
        className="context-indicator__badge"
        onClick={openContextPanel}
        title={totalMemories > 0 ? `${totalMemories} memories loaded` : 'Conversation info'}
      >
        {totalMemories > 0 ? (
          <>
            <Brain size={14} strokeWidth={1.5} />
            <span className="context-indicator__count">{totalMemories}</span>
          </>
        ) : (
          <FolderOpen size={14} strokeWidth={1.5} />
        )}
      </button>
    </div>
  )
}
