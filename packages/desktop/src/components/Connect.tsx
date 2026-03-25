import { motion } from 'framer-motion'
import { ArrowRight, Monitor, Trash2, User, Wifi } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ConnectionConfig, connection } from '../lib/connection.js'
import { saveConversations } from '../lib/conversations.js'
import { type SavedMachine, loadMachines, saveMachines, useConnectionStatus, useStore } from '../lib/store.js'
import { AntonLogo } from './AntonLogo.js'

const PORT_PLAIN = 9876
const LAST_MACHINE_KEY = 'anton.lastMachineId'

const isDev =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

type ConnectMode = 'username' | 'ip'

export function Connect({ onConnected }: { onConnected: () => void }) {
  const status = useConnectionStatus()
  const [machines, setMachines] = useState(loadMachines)
  const [mode, setMode] = useState<ConnectMode>('username')
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')

  const isConnecting = status === 'connecting' || status === 'authenticating'

  const handleConnect = useCallback((config: ConnectionConfig, machineName?: string) => {
    setError('')

    // Clear stale session data if connecting to a different machine
    const machineId = `${config.host}:${config.port}`
    const lastMachineId = localStorage.getItem(LAST_MACHINE_KEY)
    if (lastMachineId && lastMachineId !== machineId) {
      saveConversations([])
      localStorage.removeItem('anton.activeConversationId')
      useStore.getState().resetForDisconnect()
    }
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

    connection.connect(config)
  }, [remember, onConnected])

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

  // Auto-connect from URL hash params (e.g. #computer=crazy&token=xxx)
  const autoConnectAttempted = useRef(false)
  useEffect(() => {
    if (autoConnectAttempted.current) return
    const hash = window.location.hash.slice(1) // remove #
    if (!hash) return
    const params = new URLSearchParams(hash)
    const computer = params.get('computer')
    const urlToken = params.get('token')
    if (computer && urlToken) {
      autoConnectAttempted.current = true
      // Clear hash from URL to avoid re-triggering
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
    }
  }, [handleConnect])

  const canSubmit = mode === 'username' ? username && token : host && token

  return (
    <div className="connect-screen">
      {/* Top-left branding */}
      <div className="connect-brand">
        <AntonLogo size={26} thinking={isConnecting} />
        <span className="connect-brand__text">anton.computer</span>
      </div>

      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="connect-center"
      >
        {/* Saved machines — show first if available */}
        {machines.length > 0 && (
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

            <div className="connect-divider">
              <span className="connect-divider__line" />
              <span className="connect-divider__text">or connect a new machine</span>
              <span className="connect-divider__line" />
            </div>
          </>
        )}

        {/* No saved machines — first time */}
        {machines.length === 0 && (
          <>
            <h1 className="connect-heading">Connect your machine</h1>
            <p className="connect-subheading">
              {isDev
                ? 'Sign in with your username or connect directly via IP.'
                : 'Enter your username and password to get started.'}
            </p>
          </>
        )}

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
              <input
                className="connect-input"
                placeholder="Username"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
              />
              <input
                type="password"
                className="connect-input"
                placeholder="Password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
              />
            </>
          ) : (
            <>
              <input
                className="connect-input"
                placeholder="Server address (e.g. 192.168.1.100)"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
              <input
                type="password"
                className="connect-input"
                placeholder="Access token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectFromForm()}
              />
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
      </motion.div>
    </div>
  )
}
