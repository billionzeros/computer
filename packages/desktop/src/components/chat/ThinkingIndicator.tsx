import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useActiveSessionState } from '../../lib/store/sessionStore.js'

const VIBES = [
  'Thinking',
  'Computing',
  'Cerebrating',
  'Antoning',
  'Cooking',
  'Conjuring',
  'Pondering',
  'Manifesting',
  'Brewing',
  'Assembling',
  'Weaving',
  'Forging',
  'Composing',
  'Dreaming',
  'Sculpting',
  'Channeling',
]

function pickVibe(prev: string): string {
  const pool = VIBES.filter((v) => v !== prev)
  return pool[Math.floor(Math.random() * pool.length)]
}

function SparkStar({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className="thinking-ind__star"
      aria-hidden="true"
    >
      <path d="M8 0l1.8 5.2L16 8l-6.2 2.8L8 16l-1.8-5.2L0 8l6.2-2.8z" />
    </svg>
  )
}

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
  const agentStatus = useActiveSessionState((s) => s.status)
  const workingStartedAt = useActiveSessionState((s) => s.workingStartedAt)
  const turnUsage = useActiveSessionState((s) => s.turnUsage)
  const [elapsed, setElapsed] = useState(0)
  const [vibe, setVibe] = useState(() => pickVibe(''))

  useEffect(() => {
    if (agentStatus !== 'working' || !workingStartedAt) return
    setElapsed(Date.now() - workingStartedAt)
    const interval = setInterval(() => {
      setElapsed(Date.now() - workingStartedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, workingStartedAt])

  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setVibe((prev) => pickVibe(prev))
    }, 3000)
    return () => clearInterval(interval)
  }, [agentStatus])

  useEffect(() => {
    if (agentStatus === 'working') {
      setVibe(pickVibe(''))
    }
  }, [agentStatus])

  if (agentStatus !== 'working') return null

  const statusText = `${vibe}…`
  const tokenCount = turnUsage?.outputTokens || 0
  const timeStr = formatElapsed(elapsed)

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="thinking-ind"
    >
      <SparkStar size={13} />
      <AnimatePresence mode="wait">
        <motion.span
          key={statusText}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.2 }}
          className="thinking-ind__status"
        >
          {statusText}
        </motion.span>
      </AnimatePresence>
      <span className="thinking-ind__meta">
        {timeStr}
        {tokenCount > 0 && ` · ${formatTokens(tokenCount)}`}
      </span>
    </motion.div>
  )
}
