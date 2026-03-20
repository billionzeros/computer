import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { AntonLogo } from '../AntonLogo.js'

const STATUS_PHRASES = [
  'Thinking',
  'Reasoning',
  'Analyzing',
  'Musing',
  'Considering',
  'Contemplating',
  'Piecing it together',
  'Formulating',
  'Mulling it over',
  'Working through it',
]

export function ThinkingIndicator() {
  const agentStatus = useStore((s) => s.agentStatus)
  const agentStatusDetail = useStore((s) => s.agentStatusDetail)
  const [phraseIdx, setPhraseIdx] = useState(0)

  useEffect(() => {
    if (agentStatus !== 'working') return
    const interval = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % STATUS_PHRASES.length)
    }, 2800)
    return () => clearInterval(interval)
  }, [agentStatus])

  if (agentStatus !== 'working') return null

  const statusText = agentStatusDetail || STATUS_PHRASES[phraseIdx]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
        className="thinking-indicator"
      >
        <div className="thinking-indicator__header">
          <AntonLogo size={20} thinking className="thinking-indicator__anton" />
          <span className="thinking-indicator__status">
            {statusText}
            <span className="thinking-indicator__dots">
              <span className="thinking-indicator__dot" />
              <span className="thinking-indicator__dot" />
              <span className="thinking-indicator__dot" />
            </span>
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
