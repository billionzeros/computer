import type { PendingAskUser } from '@/lib/store/types'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { useCallback, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

interface Props {
  askUser: PendingAskUser
  onSubmit: (answers: Record<string, string>) => void
}

export function AskUserSheet({ askUser, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const setAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }, [])

  const handleSubmit = useCallback(() => {
    onSubmit(answers)
  }, [answers, onSubmit])

  return (
    <Modal transparent animationType="slide" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Anton has a question</Text>

          <ScrollView style={styles.scroll}>
            {askUser.questions.map((q, i) => (
              <View key={q.question || String(i)} style={styles.questionBlock}>
                <Text style={styles.question}>{q.question}</Text>
                {q.description && <Text style={styles.description}>{q.description}</Text>}

                {q.options && q.options.length > 0 ? (
                  <View style={styles.options}>
                    {q.options.map((opt) => {
                      const optValue = typeof opt === 'string' ? opt : opt.label
                      const optLabel = typeof opt === 'string' ? opt : opt.label
                      const isSelected = answers[q.question] === optValue
                      return (
                        <Pressable
                          key={optValue}
                          style={[styles.option, isSelected && styles.optionSelected]}
                          onPress={() => setAnswer(q.question, optValue)}
                        >
                          <Text
                            style={[styles.optionText, isSelected && styles.optionTextSelected]}
                          >
                            {optLabel}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : (
                  <TextInput
                    style={styles.textInput}
                    value={answers[q.question] || ''}
                    onChangeText={(v) => setAnswer(q.question, v)}
                    placeholder={q.freeTextPlaceholder || 'Type your answer...'}
                    placeholderTextColor={colors.textTertiary}
                    multiline
                  />
                )}
              </View>
            ))}
          </ScrollView>

          <Pressable style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitText}>Submit</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xxl,
    paddingBottom: spacing.xxxl,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginBottom: spacing.lg,
  },
  scroll: {
    marginBottom: spacing.lg,
  },
  questionBlock: {
    marginBottom: spacing.xl,
  },
  question: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  optionSelected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  optionTextSelected: {
    color: colors.accentText,
  },
  textInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    padding: spacing.md,
    minHeight: 60,
  },
  submitButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
