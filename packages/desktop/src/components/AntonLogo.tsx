import { useEffect, useState } from 'react'

interface Props {
  size?: number
  thinking?: boolean
  className?: string
}

export function AntonLogo({ size = 48, thinking = false, className }: Props) {
  const [eyeX, setEyeX] = useState(0)

  useEffect(() => {
    if (!thinking) {
      setEyeX(0)
      return
    }

    // When thinking, eyes dart left and right — fast and obvious
    let frame = 0
    const interval = setInterval(() => {
      frame++
      const x = Math.sin(frame * 0.22) * 3.5
      setEyeX(x)
    }, 30)

    return () => clearInterval(interval)
  }, [thinking])

  // Idle: periodic glances
  useEffect(() => {
    if (thinking) return

    const glance = () => {
      const targets = [-3, 0, 3, 0, 0, -2, 0, 3, 0]
      const target = targets[Math.floor(Math.random() * targets.length)]
      setEyeX(target)
    }

    const interval = setInterval(glance, 1400)
    return () => clearInterval(interval)
  }, [thinking])

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ verticalAlign: 'middle' }}
      role="img"
      aria-label="Anton logo"
    >
      {/* Monitor body */}
      <rect
        x="4"
        y="4"
        width="32"
        height="24"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
        fill="rgba(255,255,255,0.03)"
      />

      {/* Screen inner */}
      <rect x="7" y="7" width="26" height="18" rx="1.5" fill="rgba(255,255,255,0.04)" />

      {/* Eyes — thick lines that move together */}
      <g
        transform={`translate(${eyeX}, 0)`}
        style={{ transition: thinking ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        {/* Left eye */}
        <line
          x1="14"
          y1="12.5"
          x2="14"
          y2="19.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Right eye */}
        <line
          x1="26"
          y1="12.5"
          x2="26"
          y2="19.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>

      {/* Stand */}
      <line
        x1="20"
        y1="28"
        x2="20"
        y2="33"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Base */}
      <line
        x1="13"
        y1="33"
        x2="27"
        y2="33"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
