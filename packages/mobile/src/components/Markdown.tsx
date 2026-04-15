/**
 * Themed markdown renderer for chat messages.
 * Wraps react-native-markdown-display with our dark theme.
 */

import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { memo } from 'react'
import { Platform, StyleSheet } from 'react-native'
import MarkdownDisplay from 'react-native-markdown-display'

interface Props {
  children: string
  variant?: 'assistant' | 'user'
}

export const Markdown = memo(function Markdown({ children, variant = 'assistant' }: Props) {
  const isUser = variant === 'user'

  return (
    <MarkdownDisplay style={isUser ? userStyles : assistantStyles} mergeStyle>
      {children}
    </MarkdownDisplay>
  )
})

const baseStyles = StyleSheet.create({
  body: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  strong: {
    fontWeight: '600',
  },
  em: {
    fontStyle: 'italic',
  },
  heading1: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  heading2: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  heading3: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  bullet_list: {
    marginBottom: spacing.sm,
  },
  ordered_list: {
    marginBottom: spacing.sm,
  },
  list_item: {
    marginBottom: spacing.xs,
  },
  bullet_list_icon: {
    marginRight: spacing.sm,
  },
  code_inline: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fontSize.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  code_block: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fontSize.sm,
    lineHeight: 18,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  fence: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fontSize.sm,
    lineHeight: 18,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  blockquote: {
    paddingLeft: spacing.md,
    borderLeftWidth: 3,
    marginBottom: spacing.sm,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
  link: {
    textDecorationLine: 'underline',
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  thead: {},
  th: {
    padding: spacing.sm,
    fontWeight: '600',
  },
  td: {
    padding: spacing.sm,
  },
  tr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})

const assistantStyles = StyleSheet.create({
  ...baseStyles,
  body: {
    ...baseStyles.body,
    color: colors.text,
  },
  strong: {
    ...baseStyles.strong,
    color: colors.text,
  },
  em: {
    ...baseStyles.em,
    color: colors.text,
  },
  heading1: {
    ...baseStyles.heading1,
    color: colors.text,
  },
  heading2: {
    ...baseStyles.heading2,
    color: colors.text,
  },
  heading3: {
    ...baseStyles.heading3,
    color: colors.text,
  },
  bullet_list_icon: {
    ...baseStyles.bullet_list_icon,
    color: colors.textSecondary,
  },
  code_inline: {
    ...baseStyles.code_inline,
    backgroundColor: colors.bgTertiary,
    color: colors.accentText,
  },
  code_block: {
    ...baseStyles.code_block,
    backgroundColor: colors.bgTertiary,
    color: colors.text,
  },
  fence: {
    ...baseStyles.fence,
    backgroundColor: colors.bgTertiary,
    color: colors.text,
  },
  blockquote: {
    ...baseStyles.blockquote,
    borderLeftColor: colors.borderLight,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  hr: {
    ...baseStyles.hr,
    backgroundColor: colors.border,
  },
  link: {
    ...baseStyles.link,
    color: colors.accentText,
  },
  table: {
    ...baseStyles.table,
    borderColor: colors.border,
  },
  th: {
    ...baseStyles.th,
    color: colors.text,
  },
  td: {
    ...baseStyles.td,
    color: colors.textSecondary,
  },
  tr: {
    ...baseStyles.tr,
    borderBottomColor: colors.border,
  },
})

const userStyles = StyleSheet.create({
  ...baseStyles,
  body: {
    ...baseStyles.body,
    color: '#e0e7ff',
  },
  strong: {
    ...baseStyles.strong,
    color: '#e0e7ff',
  },
  em: {
    ...baseStyles.em,
    color: '#e0e7ff',
  },
  heading1: {
    ...baseStyles.heading1,
    color: '#e0e7ff',
  },
  heading2: {
    ...baseStyles.heading2,
    color: '#e0e7ff',
  },
  heading3: {
    ...baseStyles.heading3,
    color: '#e0e7ff',
  },
  bullet_list_icon: {
    ...baseStyles.bullet_list_icon,
    color: '#c7d2fe',
  },
  code_inline: {
    ...baseStyles.code_inline,
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#c7d2fe',
  },
  code_block: {
    ...baseStyles.code_block,
    backgroundColor: 'rgba(0,0,0,0.2)',
    color: '#e0e7ff',
  },
  fence: {
    ...baseStyles.fence,
    backgroundColor: 'rgba(0,0,0,0.2)',
    color: '#e0e7ff',
  },
  blockquote: {
    ...baseStyles.blockquote,
    borderLeftColor: 'rgba(255,255,255,0.2)',
  },
  hr: {
    ...baseStyles.hr,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  link: {
    ...baseStyles.link,
    color: '#93c5fd',
  },
  table: {
    ...baseStyles.table,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  th: {
    ...baseStyles.th,
    color: '#e0e7ff',
  },
  td: {
    ...baseStyles.td,
    color: '#c7d2fe',
  },
  tr: {
    ...baseStyles.tr,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
})
