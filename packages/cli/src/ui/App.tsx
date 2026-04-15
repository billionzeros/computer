/**
 * Main TUI — full interactive experience.
 *
 * Keybindings:
 *   Ctrl+P  Provider panel (manage API keys)
 *   Ctrl+E  Model picker (switch model for current session)
 *   Ctrl+S  Session list (view/switch/create sessions)
 *   Ctrl+Q  Quit
 *   Ctrl+C  Quit
 */

import { Channel } from '@anton/protocol'
import type { AiMessage, ControlMessage, EventMessage } from '@anton/protocol'
import type { TokenUsage } from '@anton/protocol'
import { Box, useApp, useInput } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Connection } from '../lib/connection.js'
import type { ConnectionStatus } from '../lib/connection.js'
import type { SavedMachine } from '../lib/machines.js'
import { ChatInput } from './ChatInput.js'
import { ConfirmPrompt } from './ConfirmPrompt.js'
import { MessageList } from './MessageList.js'
import type { ChatMessage } from './MessageList.js'
import { ModelPicker } from './ModelPicker.js'
import { ProviderPanel } from './ProviderPanel.js'
import type { ProviderInfo } from './ProviderPanel.js'
import { SessionList } from './SessionList.js'
import type { SessionInfo } from './SessionList.js'
import { StatusBar } from './StatusBar.js'
import { Welcome } from './Welcome.js'

type Overlay = 'none' | 'providers' | 'models' | 'sessions'

interface AppProps {
  machine: SavedMachine
}

export function App({ machine }: AppProps) {
  const { exit } = useApp()
  const [conn] = useState(() => new Connection())
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected')
  const [agentStatus, setAgentStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingConfirm, setPendingConfirm] = useState<{
    id: string
    command: string
    reason: string
  } | null>(null)
  const [agentId, setAgentId] = useState('')

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState('default')
  const [currentProvider, setCurrentProvider] = useState('anthropic')
  const [currentModel, setCurrentModel] = useState('claude-sonnet-4-6')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  // Token usage state
  const [turnUsage, setTurnUsage] = useState<TokenUsage | null>(null)
  const [sessionUsage, setSessionUsage] = useState<TokenUsage | null>(null)

  // Provider state
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [defaults, setDefaults] = useState({ provider: 'anthropic', model: 'claude-sonnet-4-6' })

  // Overlay state
  const [overlay, setOverlay] = useState<Overlay>('none')

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      },
    ])
  }, [])

  const appendAgentText = useCallback((content: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.role === 'agent') {
        return [...prev.slice(0, -1), { ...last, content: last.content + content }]
      }
      return [
        ...prev,
        {
          role: 'agent',
          content,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        },
      ]
    })
  }, [])

  // ── Message handlers ────────────────────────────────────────────

  const handleAiMessage = useCallback(
    (msg: AiMessage) => {
      switch (msg.type) {
        case 'text':
          appendAgentText(msg.content)
          break
        case 'thinking':
          addMessage({ role: 'thinking', content: msg.text })
          break
        case 'tool_call':
          addMessage({
            role: 'tool_call',
            content: JSON.stringify(msg.input),
            toolName: msg.name,
            toolId: msg.id,
          })
          break
        case 'tool_result':
          addMessage({
            role: 'tool_result',
            content: msg.output,
            toolId: msg.id,
            isError: msg.isError,
          })
          break
        case 'confirm':
          setPendingConfirm({ id: msg.id, command: msg.command, reason: msg.reason })
          break
        case 'error':
          addMessage({ role: 'error', content: msg.message })
          break
        case 'done':
          if (msg.usage) setTurnUsage(msg.usage)
          if (msg.cumulativeUsage) setSessionUsage(msg.cumulativeUsage)
          break

        // Compaction events
        case 'compaction_start':
          addMessage({ role: 'agent', content: 'Compacting context...' })
          break
        case 'compaction_complete':
          addMessage({
            role: 'agent',
            content: `Context compacted: ${msg.compactedMessages} messages summarized (compaction #${msg.totalCompactions})`,
          })
          break

        // Session responses
        case 'session_created':
          setCurrentSessionId(msg.id)
          setCurrentProvider(msg.provider)
          setCurrentModel(msg.model)
          addMessage({ role: 'agent', content: `Session started: ${msg.provider}/${msg.model}` })
          setOverlay('none')
          break
        case 'sessions_list_response':
          setSessions(msg.sessions)
          break
        case 'session_destroyed':
          setSessions((prev) => prev.filter((s) => s.id !== msg.id))
          break

        // Provider responses
        case 'providers_list_response':
          setProviders(msg.providers)
          setDefaults(msg.defaults)
          // Only set current provider/model from defaults if no session is active yet
          if (currentSessionId === 'default') {
            setCurrentProvider(msg.defaults.provider)
            setCurrentModel(msg.defaults.model)
          }
          break
        case 'provider_set_key_response':
          if (msg.success) {
            conn.sendProvidersList() // refresh
          }
          break
        case 'provider_set_default_response':
          if (msg.success) {
            setCurrentProvider(msg.provider)
            setCurrentModel(msg.model)
            setDefaults({ provider: msg.provider, model: msg.model })
          }
          break
      }
    },
    [addMessage, appendAgentText, conn, currentSessionId],
  )

  const handleEvent = useCallback((event: EventMessage) => {
    if (event.type === 'routine_status') {
      setAgentStatus(event.status)
    }
  }, [])

  const handleControl = useCallback((_msg: ControlMessage) => {
    // Handle config responses if needed
  }, [])

  // Keep a ref to the latest message handler so the useEffect closure always calls the current version
  const handleAiMessageRef = useRef(handleAiMessage)
  const handleEventRef = useRef(handleEvent)
  const handleControlRef = useRef(handleControl)
  useEffect(() => {
    handleAiMessageRef.current = handleAiMessage
  }, [handleAiMessage])
  useEffect(() => {
    handleEventRef.current = handleEvent
  }, [handleEvent])
  useEffect(() => {
    handleControlRef.current = handleControl
  }, [handleControl])

  // Connect on mount — conn and machine are stable refs, intentionally run once
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time connection setup
  useEffect(() => {
    conn.onStatusChange((status) => {
      setConnStatus(status)
      if (status === 'connected') {
        setAgentId(conn.agentId)
        // Fetch providers and sessions after connecting
        conn.sendProvidersList()
        conn.sendSessionsList()
      }
    })

    conn.onMessage((channel, payload) => {
      if (channel === Channel.AI) {
        handleAiMessageRef.current(payload as AiMessage)
      } else if (channel === Channel.EVENTS) {
        handleEventRef.current(payload as EventMessage)
      } else if (channel === Channel.CONTROL) {
        handleControlRef.current(payload as ControlMessage)
      }
    })

    conn
      .connect({
        host: machine.host,
        port: machine.port,
        token: machine.token,
        useTLS: machine.useTLS,
      })
      .catch((err) => {
        addMessage({ role: 'error', content: `Connection failed: ${err.message}` })
      })

    return () => conn.disconnect()
  }, [])

  // ── Actions ─────────────────────────────────────────────────────

  const handleSend = useCallback(
    (content: string) => {
      if (content === '/quit' || content === '/exit') {
        conn.disconnect()
        exit()
        return
      }

      addMessage({ role: 'user', content })
      conn.sendAiMessageToSession(content, currentSessionId)
    },
    [conn, addMessage, exit, currentSessionId],
  )

  const handleConfirmResponse = useCallback(
    (id: string, approved: boolean) => {
      conn.sendConfirmResponse(id, approved)
      setPendingConfirm(null)
      addMessage({
        role: approved ? 'tool_result' : 'error',
        content: approved ? 'Approved' : 'Denied',
        toolId: id,
      })
    },
    [conn, addMessage],
  )

  const handleModelSelect = useCallback(
    (provider: string, model: string) => {
      // Create a new session with the selected model
      const newId = `sess_${Date.now().toString(36)}`
      conn.sendSessionCreate(newId, { provider, model })
      setMessages([]) // clear chat for new session
      setOverlay('none')
    },
    [conn],
  )

  const handleSessionSelect = useCallback((_id: string) => {
    setMessages([])
    setOverlay('none')
  }, [])

  const handleNewSession = useCallback(() => {
    setOverlay('models') // pick a model for the new session
  }, [])

  const handleSessionDelete = useCallback(
    (id: string) => {
      conn.sendSessionDestroy(id)
    },
    [conn],
  )

  const handleProviderSetKey = useCallback(
    (provider: string, apiKey: string) => {
      conn.sendProviderSetKey(provider, apiKey)
    },
    [conn],
  )

  // ── Keybindings ─────────────────────────────────────────────────

  useInput((input, key) => {
    // Global quit
    if (key.ctrl && input === 'c') {
      conn.disconnect()
      exit()
      return
    }
    if (key.ctrl && input === 'q') {
      conn.disconnect()
      exit()
      return
    }

    // Don't intercept when overlay is handling its own input
    if (overlay !== 'none') return
    // Don't intercept when editing or confirming
    if (pendingConfirm) return

    if (key.ctrl && input === 'p') {
      conn.sendProvidersList()
      setOverlay('providers')
    } else if (key.ctrl && input === 'e') {
      conn.sendProvidersList()
      setOverlay('models')
    } else if (key.ctrl && input === 's') {
      conn.sendSessionsList()
      setOverlay('sessions')
    }
  })

  const isWorking = agentStatus === 'working'

  return (
    <Box flexDirection="column" height="100%">
      <Welcome version="0.2.0" machineName={machine.name} agentId={agentId} status={connStatus} />

      {/* Chat area */}
      <Box flexDirection="column" flexGrow={1} paddingX={0}>
        <MessageList messages={messages} />
      </Box>

      {/* Overlays */}
      {overlay === 'providers' && (
        <ProviderPanel
          providers={providers}
          defaults={defaults}
          onSetKey={handleProviderSetKey}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'models' && (
        <ModelPicker
          providers={providers}
          currentProvider={currentProvider}
          currentModel={currentModel}
          onSelect={handleModelSelect}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'sessions' && (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={handleSessionSelect}
          onNew={handleNewSession}
          onDelete={handleSessionDelete}
          onClose={() => setOverlay('none')}
        />
      )}

      {/* Confirm dialog */}
      {pendingConfirm && (
        <ConfirmPrompt
          id={pendingConfirm.id}
          command={pendingConfirm.command}
          reason={pendingConfirm.reason}
          onRespond={handleConfirmResponse}
        />
      )}

      {/* Input */}
      <Box
        borderStyle="single"
        borderColor="gray"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <ChatInput
          onSubmit={handleSend}
          disabled={isWorking || !!pendingConfirm || overlay !== 'none'}
        />
      </Box>

      {/* Status bar with model info + keybindings */}
      <StatusBar
        connectionStatus={connStatus}
        agentStatus={agentStatus}
        machineName={machine.name}
        agentId={agentId}
        provider={currentProvider}
        model={currentModel}
        sessionId={currentSessionId}
        turnUsage={turnUsage}
        sessionUsage={sessionUsage}
      />
    </Box>
  )
}
