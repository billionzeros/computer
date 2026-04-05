import {
  Activity,
  Brain,
  Clock,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
} from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'

export function ContextPanelContent() {
  const activeConv = useStore((s) => s.getActiveConversation())
  const sessionUsage = sessionStore((s) => s.sessionUsage)
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const sessionStates = sessionStore((s) => s.sessionStates)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const agentStatus = sessionStore((s) => s.agentStatus)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const currentSessionId = sessionStore((s) => s.currentSessionId)
  const workingSessionId = sessionStore((s) => s.workingSessionId)
  const sessionAssistantMsgIds = useStore((s) => s._sessionAssistantMsgIds)

  const contextInfo = activeConv?.contextInfo
  const sessionId = activeConv?.sessionId

  const totalMemories = contextInfo
    ? contextInfo.globalMemories.length +
      contextInfo.conversationMemories.length +
      contextInfo.crossConversationMemories.length
    : 0

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  return (
    <div className="context-panel">
      {/* Workspace */}
      {sessionId && (
        <Section icon={FolderOpen} title="Workspace">
          <div className="context-panel__path">~/.anton/conversations/{sessionId}/</div>
          <div className="context-panel__file-list">
            <FileRow name="workspace/" desc="Scratch files for this conversation" />
            <FileRow
              name="memory/"
              desc={`${contextInfo?.conversationMemories.length ?? 0} memory files`}
            />
            <FileRow name="context.json" desc="Assembled context snapshot" />
          </div>
        </Section>
      )}

      {/* Model & Provider */}
      {(currentProvider || currentModel) && (
        <Section icon={Cpu} title="Model">
          <div className="context-panel__kv">
            {currentProvider && <KVRow label="Provider" value={currentProvider} />}
            {currentModel && <KVRow label="Model" value={currentModel} />}
          </div>
        </Section>
      )}

      {/* Session Usage */}
      {sessionUsage && (
        <Section icon={Clock} title="Session Usage">
          <div className="context-panel__kv">
            <KVRow label="Total tokens" value={formatTokens(sessionUsage.totalTokens)} />
            {sessionUsage.inputTokens > 0 && (
              <KVRow label="Input" value={formatTokens(sessionUsage.inputTokens)} />
            )}
            {sessionUsage.outputTokens > 0 && (
              <KVRow label="Output" value={formatTokens(sessionUsage.outputTokens)} />
            )}
          </div>
        </Section>
      )}

      {/* Memory Overview */}
      {totalMemories > 0 && (
        <Section icon={Brain} title={`Memory \u00b7 ${totalMemories}`}>
          <div className="context-panel__memory-summary">
            {contextInfo!.globalMemories.length > 0 && (
              <MemoryBadge label="Global" count={contextInfo!.globalMemories.length} />
            )}
            {contextInfo!.conversationMemories.length > 0 && (
              <MemoryBadge label="Conversation" count={contextInfo!.conversationMemories.length} />
            )}
            {contextInfo!.crossConversationMemories.length > 0 && (
              <MemoryBadge
                label="Cross-conv"
                count={contextInfo!.crossConversationMemories.length}
              />
            )}
          </div>
        </Section>
      )}

      {/* Global Memories */}
      {contextInfo && contextInfo.globalMemories.length > 0 && (
        <Section icon={Database} title="Global Memory">
          <div className="context-panel__memory-list">
            {contextInfo.globalMemories.map((key) => (
              <div key={key} className="context-panel__memory-item">
                <FileText size={12} strokeWidth={1.5} />
                <span>{key}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Conversation Memories */}
      {contextInfo && contextInfo.conversationMemories.length > 0 && (
        <Section icon={Layers} title="Conversation Memory">
          <div className="context-panel__memory-list">
            {contextInfo.conversationMemories.map((key) => (
              <div key={key} className="context-panel__memory-item">
                <FileText size={12} strokeWidth={1.5} />
                <span>{key}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Cross-Conversation Memories */}
      {contextInfo && contextInfo.crossConversationMemories.length > 0 && (
        <Section icon={GitBranch} title="From Other Conversations">
          <div className="context-panel__memory-list">
            {contextInfo.crossConversationMemories.map((ref) => (
              <div
                key={`${ref.fromConversation}-${ref.memoryKey}`}
                className="context-panel__memory-item context-panel__memory-item--cross"
              >
                <FileText size={12} strokeWidth={1.5} />
                <div>
                  <span>{ref.memoryKey}</span>
                  <span className="context-panel__memory-source">from {ref.conversationTitle}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Project */}
      {contextInfo?.projectId && (
        <Section icon={FolderOpen} title="Project">
          <div className="context-panel__kv">
            <KVRow label="ID" value={contextInfo.projectId} />
          </div>
        </Section>
      )}

      {/* IDs & Debug */}
      <Section icon={Activity} title="IDs & Routing">
        <div className="context-panel__kv">
          <KVRow label="Conv ID" value={activeConversationId ?? 'null'} />
          <KVRow label="Conv sessionId" value={sessionId ?? 'null'} />
          <KVRow label="currentSessionId" value={currentSessionId ?? 'null'} />
          <KVRow label="workingSessionId" value={workingSessionId ?? 'null'} />
          <KVRow
            label="_sessionAssistantMsgId"
            value={sessionId ? (sessionAssistantMsgIds.get(sessionId) ?? 'null') : 'n/a'}
          />
          <KVRow
            label="Last msg role"
            value={activeConv?.messages[activeConv.messages.length - 1]?.role ?? 'none'}
          />
          <KVRow
            label="Last msg id"
            value={activeConv?.messages[activeConv.messages.length - 1]?.id ?? 'none'}
          />
        </div>
      </Section>

      {/* Sync & Debug */}
      <Section icon={Activity} title="Sync Status">
        <div className="context-panel__kv">
          <KVRow label="Connection" value={connectionStatus} />
          <KVRow label="Agent" value={agentStatus} />
          <KVRow
            label="Session syncing"
            value={sessionId ? (sessionStates.get(sessionId)?.isSyncing ? 'yes' : 'no') : 'no'}
          />
          <KVRow
            label="Streaming"
            value={sessionId ? (sessionStates.get(sessionId)?.isStreaming ? 'yes' : 'no') : 'no'}
          />
          <KVRow label="Local messages" value={String(activeConv?.messages.length ?? 0)} />
          <KVRow
            label="Queued (sync)"
            value={String(
              sessionId ? (sessionStates.get(sessionId)?.pendingSyncMessages?.length ?? 0) : 0,
            )}
          />
          <KVRow
            label="Syncing sessions"
            value={String(Array.from(sessionStates.values()).filter((s) => s.isSyncing).length)}
          />
          <KVRow
            label="Streaming sessions"
            value={String(Array.from(sessionStates.values()).filter((s) => s.isStreaming).length)}
          />
        </div>
      </Section>

      {/* Empty state */}
      {!sessionId && totalMemories === 0 && (
        <div className="context-panel__empty">
          <Brain size={24} strokeWidth={1.5} />
          <p>No context loaded yet</p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="context-panel__section">
      <div className="context-panel__section-header">
        <Icon size={14} strokeWidth={1.5} />
        <span>{title}</span>
      </div>
      <div className="context-panel__section-body">{children}</div>
    </div>
  )
}

function FileRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="context-panel__file-row">
      <span className="context-panel__file-name">{name}</span>
      <span className="context-panel__file-desc">{desc}</span>
    </div>
  )
}

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="context-panel__kv-row">
      <span className="context-panel__kv-label">{label}</span>
      <span className="context-panel__kv-value">{value}</span>
    </div>
  )
}

function MemoryBadge({ label, count }: { label: string; count: number }) {
  return (
    <span className="context-panel__memory-badge">
      {label} <strong>{count}</strong>
    </span>
  )
}
