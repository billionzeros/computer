/**
 * Collapsible tool actions group - like Perplexity's compact tool display.
 * Shows a summary header that expands to reveal individual tool calls.
 */

import type { ToolAction } from '@/lib/groupMessages'
import { getActionLabel } from '@/lib/groupMessages'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import {
  Check,
  ChevronDown,
  FolderOpen,
  Globe,
  Loader,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

interface Props {
  actions: ToolAction[]
  title?: string
  done?: boolean
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'shell':
      return Terminal
    case 'filesystem':
      return FolderOpen
    case 'browser':
      return Globe
    default:
      return Wrench
  }
}

function buildSummary(actions: ToolAction[]): string {
  const toolNames = new Set(actions.map((a) => a.call.toolName || 'tool'))
  const names = [...toolNames].slice(0, 3).map((n) => {
    switch (n) {
      case 'filesystem':
        return 'Read'
      case 'shell':
        return 'Shell'
      case 'browser':
        return 'Browse'
      case 'sub_agent':
        return 'Agent'
      default:
        return n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }
  })
  const label = names.join(' · ')
  if (actions.length <= 1) return label
  return `${label} · ${actions.length} actions`
}

export function ActionsGroup({ actions, title, done }: Props) {
  const [expanded, setExpanded] = useState(false)
  const allDone = done ?? actions.every((a) => a.result !== null)
  const hasError = actions.some((a) => a.result?.isError)
  const summary = title || buildSummary(actions)

  return (
    <View style={styles.container}>
      {/* Summary header */}
      <Pressable style={styles.header} onPress={() => setExpanded(!expanded)}>
        <View style={styles.headerLeft}>
          {allDone ? (
            hasError ? (
              <XCircle size={14} strokeWidth={1.5} color={colors.error} />
            ) : (
              <Check size={14} strokeWidth={1.5} color={colors.success} />
            )
          ) : (
            <Loader size={14} strokeWidth={1.5} color={colors.working} />
          )}
          <Text style={styles.summaryText} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          color={colors.textTertiary}
          style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}
        />
      </Pressable>

      {/* Expanded tool list */}
      {expanded && (
        <View style={styles.toolList}>
          {actions.map((action) => (
            <ToolActionRow key={action.call.id} action={action} />
          ))}
        </View>
      )}
    </View>
  )
}

function ToolActionRow({ action }: { action: ToolAction }) {
  const [showResult, setShowResult] = useState(false)
  const Icon = getToolIcon(action.call.toolName || 'tool')
  const label = getActionLabel(
    action.call.toolName || 'tool',
    action.call.toolInput as Record<string, unknown>,
  )
  const hasResult = action.result && action.result.content.trim().length > 0

  return (
    <View style={styles.toolItem}>
      <Pressable style={styles.toolRow} onPress={() => hasResult && setShowResult(!showResult)}>
        <View style={styles.toolIconWrap}>
          <Icon size={12} strokeWidth={1.5} color={colors.textTertiary} />
        </View>
        <Text style={styles.toolLabel} numberOfLines={1}>
          {label}
        </Text>
        {action.result?.isError && <XCircle size={12} strokeWidth={1.5} color={colors.error} />}
        {action.result && !action.result.isError && (
          <Check size={12} strokeWidth={1.5} color={colors.success} />
        )}
        {!action.result && <Loader size={12} strokeWidth={1.5} color={colors.working} />}
      </Pressable>
      {showResult && action.result && (
        <Text
          style={[styles.resultText, action.result.isError && styles.errorText]}
          numberOfLines={6}
        >
          {action.result.content.slice(0, 400)}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  summaryText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    flex: 1,
  },
  toolList: {
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
  },
  toolItem: {
    marginBottom: 2,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toolIconWrap: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    flex: 1,
  },
  resultText: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    lineHeight: 16,
    paddingLeft: 28,
    paddingBottom: spacing.xs,
  },
  errorText: {
    color: colors.error,
  },
})
