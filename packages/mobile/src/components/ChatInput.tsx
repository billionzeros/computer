import { sessionStore } from '@/lib/store/sessionStore'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { ChevronUp, Mic, Plus, Square } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Props {
  onSend: (text: string) => void
  onCancel?: () => void
  isWorking?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, onCancel, isWorking, placeholder }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<TextInput>(null)
  const insets = useSafeAreaInsets()
  const model = sessionStore((s) => s.currentModel)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }, [text, onSend])

  const handleCancel = useCallback(() => {
    onCancel?.()
  }, [onCancel])

  // Format model name for display
  const modelLabel = model
    .replace('claude-', '')
    .replace(/-\d[\w.-]*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const hasText = text.trim().length > 0

  return (
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View style={styles.card}>
        {/* Text input */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder || 'Ask anything...'}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={50000}
          returnKeyType="default"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (!text.includes('\n')) handleSend()
          }}
        />

        {/* Action row - inside the card */}
        <View style={styles.actionRow}>
          {/* Left actions */}
          <View style={styles.leftActions}>
            <Pressable style={styles.circleBtn} hitSlop={4}>
              <Plus size={16} strokeWidth={2} color={colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.modelPill}>
              <Text style={styles.modelText}>{modelLabel}</Text>
            </Pressable>
          </View>

          {/* Right actions */}
          <View style={styles.rightActions}>
            {isWorking ? (
              <Pressable style={styles.stopBtn} onPress={handleCancel} hitSlop={8}>
                <Square size={14} strokeWidth={2} color={colors.bg} fill={colors.bg} />
              </Pressable>
            ) : hasText ? (
              <Pressable style={styles.sendBtn} onPress={handleSend} hitSlop={8}>
                <ChevronUp size={18} strokeWidth={2.5} color={colors.bg} />
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.circleBtn} hitSlop={4}>
                  <Mic size={16} strokeWidth={1.5} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    paddingBottom: spacing.sm,
  },
  input: {
    color: colors.text,
    fontSize: fontSize.md,
    maxHeight: 120,
    minHeight: 28,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  circleBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelPill: {
    paddingHorizontal: spacing.md,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
