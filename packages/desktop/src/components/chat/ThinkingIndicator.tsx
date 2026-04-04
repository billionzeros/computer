import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { sessionStore } from '../../lib/store/sessionStore.js'

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

/** Pick a random vibe, avoiding the previous one. */
function pickVibe(prev: string): string {
  const pool = VIBES.filter((v) => v !== prev)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 6-pointed star SVG that spins. */
function SparkStar({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className="thinking-indicator__star"
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
  const agentStatus = sessionStore((s) => s.agentStatus)
  const _agentStatusDetail = sessionStore((s) => s.agentStatusDetail)
  const workingStartedAt = sessionStore((s) => s.workingStartedAt)
  const turnUsage = sessionStore((s) => s.turnUsage)
  const [elapsed, setElapsed] = useState(0)
  const [vibe, setVibe] = useState(() => pickVibe(''))

  // Timer
  useEffect(() => {
    if (agentStatus !== 'working' || !workingStartedAt) return
    setElapsed(Date.now() - workingStartedAt)
    const interval = setInterval(() => {
      setElapsed(Date.now() - workingStartedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, workingStartedAt])

  // Always rotate vibe words every 3s — task-specific info lives in the checklist
  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setVibe((prev) => pickVibe(prev))
    }, 3000)
    return () => clearInterval(interval)
  }, [agentStatus])

  // Reset vibe when agent starts working
  useEffect(() => {
    if (agentStatus === 'working') {
      setVibe(pickVibe(''))
    }
  }, [agentStatus])

  if (agentStatus !== 'working') return null

  const statusText = `${vibe}...`
  const tokenCount = turnUsage?.totalTokens || 0

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="thinking-indicator thinking-indicator--vibe"
      >
        <div className="thinking-indicator__left">
          <SparkStar size={14} />
          <AnimatePresence mode="wait">
            <motion.span
              key={statusText}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="thinking-indicator__status"
            >
              {statusText}
            </motion.span>
          </AnimatePresence>
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
