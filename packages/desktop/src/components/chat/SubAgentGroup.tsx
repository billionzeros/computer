import { AnimatePresence, motion } from 'framer-motion'
import { Bot } from 'lucide-react'
import { useMemo } from 'react'
import type { ChatMessage } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { ActionChip, GroupChip } from './ActionsGroup.js'
import { ArtifactCard } from './ArtifactCard.js'
import type { ToolAction } from './groupMessages.js'

const AGENT_TYPE_LABELS: Record<string, string> = {
  research: 'Research Agent',
  execute: 'Execute Agent',
  verify: 'Verify Agent',
}

interface Props {
  toolCallId: string
  task: string
  agentType?: 'research' | 'execute' | 'verify'
  actions: ToolAction[]
  progressContent: string | null
  result: ChatMessage | null
  defaultExpanded?: boolean
}

export function SubAgentGroup({
  task,
  agentType,
  actions,
  progressContent,
  result,
  defaultExpanded = false,
}: Props) {
  const artifacts = artifactStore((s) => s.artifacts)

  const actionCallIds = useMemo(() => new Set(actions.map((a) => a.call.id)), [actions])
  const groupArtifacts = useMemo(
    () => artifacts.filter((a) => actionCallIds.has(a.toolCallId)),
    [artifacts, actionCallIds],
  )

  const isPending = !result
  const errorCount = actions.filter((a) => a.result?.isError).length
  const taskPreview = task.length > 80 ? `${task.slice(0, 77)}...` : task
  const label = `${agentType ? AGENT_TYPE_LABELS[agentType] : 'Agent'}: ${taskPreview}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="conv-actions"
    >
      <GroupChip
        label={label}
        icon={Bot}
        defaultOpen={defaultExpanded || isPending}
        errorCount={errorCount}
      >
        {actions.map((action) => (
          <div key={action.call.id} className="conv-chip__child">
            <ActionChip action={action} />
          </div>
        ))}
        <AnimatePresence>
          {progressContent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="conv-chip__child conv-chip__child--progress"
            >
              {progressContent}
            </motion.div>
          )}
        </AnimatePresence>
      </GroupChip>

      {groupArtifacts.length > 0 && (
        <div className="conv-artifacts">
          {groupArtifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </motion.div>
  )
}
