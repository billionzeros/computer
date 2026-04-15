import type { ChatMessage } from '@/lib/store/types'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { ChevronDown, FileText, Loader, Zap } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Markdown } from './Markdown'

interface Props {
  message: ChatMessage
  isLastInGroup?: boolean
}

// Parse <think>...</think> blocks from assistant text
function parseThinkBlocks(content: string): { text: string; thinking: string[] } {
  const thinking: string[] = []
  const text = content
    .replace(/<think>([\s\S]*?)<\/think>/g, (_match, block) => {
      const trimmed = block.trim()
      if (trimmed) thinking.push(trimmed)
      return ''
    })
    .trim()
  return { text, thinking }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

export const MessageBubble = memo(function MessageBubble({ message, isLastInGroup }: Props) {
  if (message.role === 'tool') {
    return <ToolMessage message={message} />
  }

  if (message.isThinking) {
    return <ThinkingMessage message={message} />
  }

  if (message.role === 'system') {
    if (message.askUserAnswers) {
      return (
        <View style={styles.systemRow}>
          {Object.entries(message.askUserAnswers).map(([q, a]) => (
            <View key={q} style={styles.askUserEntry}>
              <Text style={styles.askUserQuestion}>{q}</Text>
              <Text style={styles.askUserAnswer}>{a}</Text>
            </View>
          ))}
        </View>
      )
    }
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, message.isError && styles.errorText]}>
          {message.content}
        </Text>
      </View>
    )
  }

  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <View style={[styles.userRow, isLastInGroup && styles.lastInGroup]}>
        <View style={styles.userBubble}>
          {message.isSteering && <Text style={styles.steeringLabel}>Sent while working</Text>}
          <Markdown variant="user">{message.content}</Markdown>
        </View>
      </View>
    )
  }

  // Assistant - parse out any <think> blocks, render plain text
  const { text: cleanText, thinking } = parseThinkBlocks(message.content)

  return (
    <View style={[styles.assistantRow, isLastInGroup && styles.lastInGroup]}>
      {thinking.length > 0 && <InlineThinking blocks={thinking} />}
      {cleanText ? <Markdown variant="assistant">{cleanText}</Markdown> : null}
    </View>
  )
})

function ThinkingMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Pressable style={styles.thinkingRow} onPress={() => setExpanded(!expanded)}>
      <View style={styles.thinkingHeader}>
        <Loader size={12} strokeWidth={1.5} color={colors.textTertiary} />
        <Text style={styles.thinkingLabel}>Thinking</Text>
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          color={colors.textTertiary}
          style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}
        />
      </View>
      {expanded && (
        <Text style={styles.thinkingText} numberOfLines={8}>
          {truncate(message.content, 500)}
        </Text>
      )}
    </Pressable>
  )
}

function InlineThinking({ blocks }: { blocks: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const combined = blocks.join('\n\n')

  return (
    <Pressable style={styles.inlineThinkingRow} onPress={() => setExpanded(!expanded)}>
      <View style={styles.thinkingHeader}>
        <Loader size={12} strokeWidth={1.5} color={colors.textTertiary} />
        <Text style={styles.thinkingLabel}>Thought process</Text>
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          color={colors.textTertiary}
          style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}
        />
      </View>
      {expanded && (
        <Text style={styles.thinkingText} numberOfLines={12}>
          {truncate(combined, 800)}
        </Text>
      )}
    </Pressable>
  )
}

function ToolMessage({ message }: { message: ChatMessage }) {
  const isResult = message.id.startsWith('tr_')
  const isSubAgent = message.toolName === 'sub_agent'

  if (isResult) {
    if (!message.content && !message.isError) return null

    return (
      <View style={styles.toolRow}>
        <View style={styles.toolIconWrap}>
          <Zap
            size={12}
            strokeWidth={1.5}
            color={message.isError ? colors.error : colors.success}
          />
        </View>
        <Text
          style={[styles.toolResultText, message.isError && styles.errorText]}
          numberOfLines={3}
        >
          {truncate(message.content, 200)}
        </Text>
      </View>
    )
  }

  // Tool call - show as compact indented line
  const toolLabel = isSubAgent ? 'Sub-agent' : formatToolName(message.toolName || 'Tool')
  let detail = ''
  if (isSubAgent && (message.toolInput as Record<string, unknown>)?.task) {
    detail = String((message.toolInput as Record<string, unknown>).task)
  } else if (message.toolInput && !isSubAgent) {
    const input = message.toolInput as Record<string, unknown>
    // Show file path or command for common tools
    const path = input.file_path || input.path || input.command || input.pattern
    if (path) {
      detail = String(path)
    }
  }

  return (
    <View style={styles.toolRow}>
      <View style={styles.toolIconWrap}>
        <FileText size={12} strokeWidth={1.5} color={colors.textTertiary} />
      </View>
      <View style={styles.toolContent}>
        <Text style={styles.toolName} numberOfLines={1}>
          {toolLabel}
        </Text>
        {detail ? (
          <Text style={styles.toolDetail} numberOfLines={1}>
            {truncate(detail, 80)}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // User messages - bubbles
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: colors.userBubble,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
  },
  steeringLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
    fontStyle: 'italic',
  },

  // Assistant messages - plain text, no bubble
  assistantRow: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xs,
  },

  lastInGroup: {
    marginBottom: spacing.lg,
  },

  // System messages
  systemRow: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  systemText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  errorText: {
    color: colors.error,
  },

  // Ask user
  askUserEntry: {
    marginBottom: spacing.sm,
  },
  askUserQuestion: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  askUserAnswer: {
    color: colors.text,
    fontSize: fontSize.md,
    marginTop: 2,
  },

  // Thinking - collapsible compact
  inlineThinkingRow: {
    marginBottom: spacing.sm,
  },
  thinkingRow: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  thinkingLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  thinkingText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xs,
    paddingLeft: spacing.xl,
  },

  // Tool calls - compact indented lines
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingLeft: spacing.xxl,
    marginBottom: 3,
    gap: spacing.sm,
  },
  toolIconWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  toolContent: {
    flex: 1,
  },
  toolName: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  toolDetail: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  toolResultText: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    flex: 1,
    lineHeight: 16,
  },
})
