import type { ChatMessage } from '@/lib/store/types'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface Props {
  message: ChatMessage
  isLastInGroup?: boolean
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
    return (
      <View style={[styles.bubble, styles.thinkingBubble]}>
        <Text style={styles.thinkingLabel}>Thinking</Text>
        <Text style={styles.thinkingText} numberOfLines={3}>
          {truncate(message.content, 200)}
        </Text>
      </View>
    )
  }

  if (message.role === 'system') {
    if (message.askUserAnswers) {
      return (
        <View style={[styles.bubble, styles.systemBubble]}>
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
      <View style={[styles.bubble, styles.systemBubble]}>
        <Text style={[styles.messageText, message.isError && styles.errorText]}>
          {message.content}
        </Text>
      </View>
    )
  }

  const isUser = message.role === 'user'

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          isLastInGroup && styles.lastInGroup,
        ]}
      >
        {message.isSteering && <Text style={styles.steeringLabel}>Sent while working</Text>}
        <Text style={[styles.messageText, isUser && styles.userText]} selectable>
          {message.content}
        </Text>
      </View>
    </View>
  )
})

function ToolMessage({ message }: { message: ChatMessage }) {
  const isResult = message.id.startsWith('tr_')
  const isSubAgent = message.toolName === 'sub_agent'

  if (isResult) {
    if (!message.content && !message.isError) return null

    return (
      <View style={[styles.toolRow]}>
        <View
          style={[styles.toolIndicator, message.isError ? styles.toolError : styles.toolSuccess]}
        />
        <Text
          style={[styles.toolResultText, message.isError && styles.errorText]}
          numberOfLines={4}
        >
          {truncate(message.content, 300)}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.toolRow}>
      <View style={[styles.toolIndicator, styles.toolActive]} />
      <View style={styles.toolContent}>
        <Text style={styles.toolName}>
          {isSubAgent ? 'Sub-agent' : formatToolName(message.toolName || 'Tool')}
        </Text>
        {message.toolInput && !isSubAgent && (
          <Text style={styles.toolInput} numberOfLines={2}>
            {typeof message.toolInput === 'object'
              ? truncate(JSON.stringify(message.toolInput), 120)
              : String(message.toolInput)}
          </Text>
        )}
        {isSubAgent && (message.toolInput as Record<string, unknown>)?.task ? (
          <Text style={styles.toolInput} numberOfLines={2}>
            {String((message.toolInput as Record<string, unknown>).task)}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  lastInGroup: {
    marginBottom: spacing.md,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    backgroundColor: colors.assistantBubble,
    borderBottomLeftRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  systemBubble: {
    backgroundColor: colors.systemBubble,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  thinkingBubble: {
    backgroundColor: colors.thinkingBubble,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    opacity: 0.8,
  },
  thinkingLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thinkingText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  messageText: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  userText: {
    color: '#e0e7ff',
  },
  errorText: {
    color: colors.error,
  },
  steeringLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
    fontStyle: 'italic',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    paddingVertical: spacing.xs,
  },
  toolIndicator: {
    width: 3,
    minHeight: 16,
    borderRadius: 2,
    marginRight: spacing.sm,
    marginTop: 2,
    alignSelf: 'stretch',
  },
  toolActive: {
    backgroundColor: colors.working,
  },
  toolSuccess: {
    backgroundColor: colors.success,
  },
  toolError: {
    backgroundColor: colors.error,
  },
  toolContent: {
    flex: 1,
  },
  toolName: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  toolInput: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginTop: 2,
    fontFamily: 'Courier',
  },
  toolResultText: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    flex: 1,
    fontFamily: 'Courier',
  },
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
})
