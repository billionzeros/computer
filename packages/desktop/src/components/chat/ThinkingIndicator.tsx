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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function ThinkingIndicator() {
  const agentStatus = useStore((s) => s.agentStatus)
  const agentStatusDetail = useStore((s) => s.agentStatusDetail)
  const workingStartedAt = useStore((s) => s.workingStartedAt)
  const turnUsage = useStore((s) => s.turnUsage)
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
  const tokenCount = turnUsage?.totalTokens || 0

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
          <Loader2 size={14} strokeWidth={1.5} className="tool-tree__spinner" />
          <span className="thinking-indicator__status">{statusText}</span>
        </div>
        <div className="thinking-indicator__right">
          <span className="thinking-indicator__meta">
            {formatElapsed(elapsed)}
            {tokenCount > 0 && ` · ↓${formatTokens(tokenCount)} tokens`}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
