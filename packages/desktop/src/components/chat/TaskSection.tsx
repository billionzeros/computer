import { motion } from 'framer-motion'
import { ListTree } from 'lucide-react'
import { useMemo } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { ActionChip, GroupChip } from './ActionsGroup.js'
import { ArtifactCard } from './ArtifactCard.js'
import type { ToolAction } from './groupMessages.js'

interface Props {
  title: string
  actions: ToolAction[]
  done?: boolean
  defaultExpanded?: boolean
}

export function TaskSection({ title, actions, defaultExpanded = false }: Props) {
  const artifacts = artifactStore((s) => s.artifacts)

  const actionCallIds = useMemo(() => new Set(actions.map((a) => a.call.id)), [actions])
  const groupArtifacts = useMemo(
    () => artifacts.filter((a) => actionCallIds.has(a.toolCallId)),
    [artifacts, actionCallIds],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="conv-actions"
    >
      <GroupChip label={title} icon={ListTree} defaultOpen={defaultExpanded}>
        {actions.map((action) => (
          <div key={action.call.id} className="conv-chip__child">
            <ActionChip action={action} />
          </div>
        ))}
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
