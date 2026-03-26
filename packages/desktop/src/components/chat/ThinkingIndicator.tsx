import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store.js'

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`
}

export function ThinkingIndicator() {
  const agentStatus = useStore((s) => s.agentStatus)
  const agentStatusDetail = useStore((s) => s.agentStatusDetail)
  const workingStartedAt = useStore((s) => s.workingStartedAt)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (agentStatus !== 'working' || !workingStartedAt) return
    setElapsed(Date.now() - workingStartedAt)
    const interval = setInterval(() => {
      setElapsed(Date.now() - workingStartedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, workingStartedAt])

  if (agentStatus !== 'working') return null

  const statusText = agentStatusDetail || 'Thinking...'

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="thinking-indicator"
      >
        <div className="thinking-indicator__left">
          <Loader2 size={14} strokeWidth={1.5} className="actions-pill__spin" />
          <span className="thinking-indicator__status">{statusText}</span>
        </div>
        <div className="thinking-indicator__right">
          <span className="thinking-indicator__meta">{formatElapsed(elapsed)}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
