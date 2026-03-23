import type { TokenUsage } from '@anton/protocol'
import { Box, Text } from 'ink'
import type { ConnectionStatus } from '../lib/connection.js'
import { ICONS } from '../lib/theme.js'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface StatusBarProps {
  connectionStatus: ConnectionStatus
  agentStatus: 'idle' | 'working' | 'error'
  machineName?: string
  agentId?: string
  provider?: string
  model?: string
  sessionId?: string
  turnUsage?: TokenUsage | null
  sessionUsage?: TokenUsage | null
}

export function StatusBar({
  connectionStatus,
  agentStatus,
  machineName,
  provider,
  model,
  sessionId,
  turnUsage,
  sessionUsage,
}: StatusBarProps) {
  const connIcon =
    connectionStatus === 'connected'
      ? ICONS.connected
      : connectionStatus === 'connecting' || connectionStatus === 'authenticating'
        ? ICONS.connecting
        : ICONS.disconnected

  return (
    <Box paddingX={1} justifyContent="space-between">
      {/* Left: connection + model info + tokens */}
      <Text>
        {connIcon} <Text dimColor>{machineName ?? 'not connected'}</Text>
        {provider && model && (
          <Text dimColor>
            {' '}
            · {provider}/{model}
          </Text>
        )}
        {sessionId && sessionId !== 'default' && <Text dimColor> · {sessionId}</Text>}
        {sessionUsage && (
          <Text dimColor>
            {' '}
            · <Text color="cyan">{formatTokens(sessionUsage.totalTokens)}</Text> tokens
            {turnUsage && (
              <Text>
                {' '}
                (<Text color="cyan">{formatTokens(turnUsage.totalTokens)}</Text> last)
              </Text>
            )}
          </Text>
        )}
      </Text>

      {/* Right: status + keybinding hints */}
      <Text>
        {agentStatus === 'working' ? (
          <Text color="yellow">● working </Text>
        ) : (
          <Text dimColor>idle </Text>
        )}
        <Text dimColor>^P providers · ^E model · ^S sessions · ^Q quit</Text>
      </Text>
    </Box>
  )
}
