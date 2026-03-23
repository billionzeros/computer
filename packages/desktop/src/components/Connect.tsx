import { motion } from 'framer-motion'
import { ArrowRight, Lock, Trash2, Unlock, Wifi } from 'lucide-react'
import { useState } from 'react'
import { type ConnectionConfig, connection } from '../lib/connection.js'
import { type SavedMachine, loadMachines, saveMachines, useConnectionStatus } from '../lib/store.js'
import { AntonLogo } from './AntonLogo.js'

const PORT_PLAIN = 9876
const PORT_TLS = 9877

export function Connect({ onConnected }: { onConnected: () => void }) {
  const status = useConnectionStatus()
  const [machines, setMachines] = useState(loadMachines)
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [useTLS, setUseTLS] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const port = useTLS ? PORT_TLS : PORT_PLAIN
  const isConnecting = status === 'connecting' || status === 'authenticating'

  const handleConnect = (config: ConnectionConfig, machineName?: string) => {
    setError('')

    const unsub = connection.onStatusChange((s, detail) => {
      if (s === 'connected') {
        // Always save machine if remember is checked
        if (remember || machineName) {
          const existing = loadMachines()
          const id = `${config.host}:${config.port}`
          const updated = existing.filter((m) => m.id !== id)
          updated.push({
            id,
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
  }

  const connectFromForm = () => {
    if (!host || !token) return
    handleConnect({ host, port, token, useTLS })
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
              Enter your server address and token to get started.
            </p>
          </>
        )}

        {/* Form */}
        <div className="connect-form">
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

          <label className="connect-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="connect-remember__checkbox"
            />
            <span className="connect-remember__text">Remember this machine</span>
          </label>

          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="connect-advanced"
            >
              <label className="connect-toggle">
                <input
                  type="checkbox"
                  checked={useTLS}
                  onChange={(e) => setUseTLS(e.target.checked)}
                  className="connect-toggle__checkbox"
                />
                <span className="connect-toggle__body">
                  {useTLS ? (
                    <Lock className="connect-toggle__icon" />
                  ) : (
                    <Unlock className="connect-toggle__icon" />
                  )}
                  <span className="connect-toggle__text">
                    {useTLS ? 'Secure connection (TLS)' : 'Standard connection'}
                  </span>
                </span>
              </label>
            </motion.div>
          )}

          {!showAdvanced && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="connect-advanced-toggle"
            >
              Advanced options
            </button>
          )}

          {error && <div className="connect-error">{error}</div>}

          <button
            type="button"
            onClick={connectFromForm}
            disabled={!host || !token || isConnecting}
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
