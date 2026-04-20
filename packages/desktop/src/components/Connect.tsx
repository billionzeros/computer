import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, Monitor, Plus, Trash2, User, Wifi } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ConnectionConfig, connection } from '../lib/connection.js'
import { saveConversations } from '../lib/conversations.js'
import {
  type SavedMachine,
  loadMachines,
  saveMachines,
  useConnectionStatus,
  useStore,
} from '../lib/store.js'
import { AntonLogo } from './AntonLogo.js'

const PORT_PLAIN = 9876
const LAST_MACHINE_KEY = 'anton.lastMachineId'

const isDev =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

type ConnectMode = 'username' | 'ip'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

/** Animated canvas particle network background */
function ParticleNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const sizeRef = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const PARTICLE_COUNT = 60
    const CONNECTION_DIST = 140
    const SPEED = 0.3

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const parent = canvas.parentElement!
      const w = parent.clientWidth
      const h = parent.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sizeRef.current = { w, h }
    }

    const initParticles = () => {
      const { w, h } = sizeRef.current
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        radius: Math.random() * 1.5 + 0.5,
      }))
    }

    const draw = () => {
      const { w, h } = sizeRef.current
      const particles = particlesRef.current
      ctx.clearRect(0, 0, w, h)

      // Update positions
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > w) p.vx *= -1
        if (p.y < 0 || p.y > h) p.vy *= -1
      }

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < CONNECTION_DIST) {
            const opacity = (1 - dist / CONNECTION_DIST) * 0.15
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.fill()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    resize()
    initParticles()
    draw()

    window.addEventListener('resize', () => {
      resize()
      initParticles()
    })

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="connect-canvas" aria-hidden />
}

export function Connect({ onConnected }: { onConnected: () => void }) {
  const status = useConnectionStatus()
  const [machines, setMachines] = useState(loadMachines)
  const [mode, setMode] = useState<ConnectMode>('username')
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [showNewMachine, setShowNewMachine] = useState(false)

  const isConnecting = status === 'connecting' || status === 'authenticating'

  const handleConnect = useCallback(
    (config: ConnectionConfig, machineName?: string) => {
      setError('')

      const machineId = `${config.host}:${config.port}`
      const lastMachineId = localStorage.getItem(LAST_MACHINE_KEY)
      const isMachineSwitch = lastMachineId && lastMachineId !== machineId

      if (isMachineSwitch) {
        saveConversations([])
        localStorage.removeItem('anton.activeConversationId')
        useStore.getState().resetForMachineSwitch()
      }

      connection.connect(config)
      localStorage.setItem(LAST_MACHINE_KEY, machineId)

      const unsub = connection.onStatusChange((s, detail) => {
        if (s === 'connected') {
          if (remember || machineName) {
            const existing = loadMachines()
            const updated = existing.filter((m) => m.id !== machineId)
            updated.push({
              id: machineId,
              name: machineName || config.host,
              host: config.host,
              port: config.port,
              token: config.token,
              useTLS: config.useTLS,
            })
            saveMachines(updated)
          }
          unsub()
          onConnected()
        } else if (s === 'error') {
          setError(detail || 'Connection failed')
          unsub()
        }
      })
    },
    [remember, onConnected],
  )

  const connectFromForm = () => {
    if (mode === 'username') {
      if (!username || !token) return
      handleConnect(
        {
          host: `${username}.antoncomputer.in`,
          port: 443,
          token,
          useTLS: true,
        },
        username,
      )
    } else {
      if (!host || !token) return
      handleConnect({ host, port: PORT_PLAIN, token, useTLS: false })
    }
  }

  const connectSaved = (machine: SavedMachine) => {
    handleConnect(
      {
        host: machine.host,
        port: machine.port,
        token: machine.token,
        useTLS: machine.useTLS,
      },
      machine.name,
    )
  }

  const removeSaved = (e: React.MouseEvent, machine: SavedMachine) => {
    e.stopPropagation()
    const updated = machines.filter((m) => m.id !== machine.id)
    saveMachines(updated)
    setMachines(updated)
  }

  // Auto-connect: if saved machines exist, connect to last used one
  const autoConnectAttempted = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectSaved is a stable closure; adding it would re-run auto-connect
  useEffect(() => {
    if (autoConnectAttempted.current) return

    // First check URL hash params (e.g. #computer=crazy&token=xxx)
    const hash = window.location.hash.slice(1)
    if (hash) {
      const params = new URLSearchParams(hash)
      const computer = params.get('computer')
      const urlToken = params.get('token')
      if (computer && urlToken) {
        autoConnectAttempted.current = true
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        handleConnect(
          {
            host: `${computer}.antoncomputer.in`,
            port: 443,
            token: urlToken,
            useTLS: true,
          },
          computer,
        )
        return
      }
    }

    // Auto-connect to last used machine (only if we have a remembered last-used ID)
    const lastId = localStorage.getItem(LAST_MACHINE_KEY)
    if (lastId && machines.length > 0) {
      const target = machines.find((m) => m.id === lastId)
      if (target) {
        autoConnectAttempted.current = true
        connectSaved(target)
      }
    }
  }, [handleConnect, machines])

  const canSubmit = mode === 'username' ? username && token : host && token

  // Auto-connecting state — minimal screen with logo + status
  if (isConnecting && !error && !showNewMachine) {
    return (
      <div className="connect-screen">
        <ParticleNetwork />
        <div className="connect-brand">
          <AntonLogo size={24} thinking />
          <span className="connect-brand__text">anton.computer</span>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="connect-auto"
        >
          <AntonLogo size={48} thinking />
          <span className="connect-auto__status">Connecting...</span>
          <button
            type="button"
            className="connect-auto__switch"
            onClick={() => setShowNewMachine(true)}
          >
            Switch machine
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="connect-screen">
      <ParticleNetwork />

      <div className="connect-brand">
        <AntonLogo size={24} thinking={isConnecting} />
        <span className="connect-brand__text">anton.computer</span>
      </div>

      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="connect-center"
      >
        {/* Has saved machines */}
        {machines.length > 0 && !showNewMachine && (
          <>
            <h1 className="connect-heading">Welcome back</h1>
            <p className="connect-subheading">Pick a machine or connect a new one.</p>

            <div className="connect-saved">
              {machines.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => connectSaved(m)}
                  disabled={isConnecting}
                  className="connect-saved__item"
                >
                  <Wifi className="connect-saved__icon" />
                  <div className="connect-saved__info">
                    <span className="connect-saved__name">{m.name}</span>
                    <span className="connect-saved__host">
                      {m.host}
                      {m.useTLS ? ' (TLS)' : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="connect-saved__remove"
                    onClick={(e) => removeSaved(e, m)}
                    aria-label="Remove"
                  >
                    <Trash2 />
                  </button>
                  <ArrowRight className="connect-saved__arrow" />
                </button>
              ))}
            </div>

            <button
              type="button"
              className="connect-new-machine-btn"
              onClick={() => setShowNewMachine(true)}
            >
              <Plus size={15} strokeWidth={1.5} />
              <span>Connect a new machine</span>
            </button>
          </>
        )}

        {/* New machine form (or first time with no machines) */}
        {(machines.length === 0 || showNewMachine) && (
          <>
            {showNewMachine && machines.length > 0 && (
              <button
                type="button"
                className="connect-back-btn"
                onClick={() => setShowNewMachine(false)}
              >
                <ChevronDown size={14} strokeWidth={1.5} style={{ transform: 'rotate(90deg)' }} />
                <span>Back to saved machines</span>
              </button>
            )}

            <h1 className="connect-heading">
              {showNewMachine ? 'New machine' : 'Connect your machine'}
            </h1>
            <p className="connect-subheading">
              {isDev
                ? 'Sign in with your username or connect directly via IP.'
                : 'Enter your username and password to get started.'}
            </p>

            {/* Mode tabs — dev only */}
            {isDev && (
              <div className="connect-tabs">
                <button
                  type="button"
                  className={`connect-tabs__btn${mode === 'username' ? ' connect-tabs__btn--active' : ''}`}
                  onClick={() => {
                    setMode('username')
                    setError('')
                  }}
                >
                  <User className="connect-tabs__icon" />
                  Username
                </button>
                <button
                  type="button"
                  className={`connect-tabs__btn${mode === 'ip' ? ' connect-tabs__btn--active' : ''}`}
                  onClick={() => {
                    setMode('ip')
                    setError('')
                  }}
                >
                  <Monitor className="connect-tabs__icon" />
                  Direct IP
                </button>
              </div>
            )}

            {/* Form */}
            <div className="connect-form">
              {mode === 'username' || !isDev ? (
                <>
                  <div className="connect-field">
                    <label className="connect-label" htmlFor="connect-username">
                      Username
                    </label>
                    <input
                      id="connect-username"
                      className="connect-input"
                      placeholder="your-name"
                      value={username}
                      onChange={(e) =>
                        setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
                    />
                  </div>
                  <div className="connect-field">
                    <label className="connect-label" htmlFor="connect-password">
                      Password
                    </label>
                    <input
                      id="connect-password"
                      type="password"
                      className="connect-input"
                      placeholder="Enter your password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="connect-field">
                    <label className="connect-label" htmlFor="connect-host">
                      Server address
                    </label>
                    <input
                      id="connect-host"
                      className="connect-input"
                      placeholder="192.168.1.100"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </div>
                  <div className="connect-field">
                    <label className="connect-label" htmlFor="connect-token">
                      Access token
                    </label>
                    <input
                      id="connect-token"
                      type="password"
                      className="connect-input"
                      placeholder="Enter your token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
                    />
                  </div>
                </>
              )}

              <label className="connect-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="connect-remember__checkbox"
                />
                <span className="connect-remember__text">Remember this machine</span>
              </label>

              {error && <div className="connect-error">{error}</div>}

              <button
                type="button"
                onClick={connectFromForm}
                disabled={!canSubmit || isConnecting}
                className="connect-submit"
              >
                {isConnecting
                  ? status === 'connecting'
                    ? 'Connecting...'
                    : 'Verifying...'
                  : 'Connect'}
                {!isConnecting && <ArrowRight className="connect-submit__icon" />}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
