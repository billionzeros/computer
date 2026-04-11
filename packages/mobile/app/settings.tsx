import { connection } from '@/lib/connection'
import { useStore } from '@/lib/store'
import { sessionStore } from '@/lib/store/sessionStore'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { router } from 'expo-router'
import { ArrowLeft, Brain, ChevronRight, Cpu, LogOut, Server, Zap } from 'lucide-react-native'
import { useCallback } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const providers = sessionStore((s) => s.providers)
  const _currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const thinkingEnabled = sessionStore((s) => s.thinkingEnabled)
  const agentVersion = connection.currentAgentVersion
  const agentId = connection.currentAgentId

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect', 'Disconnect from this agent?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          connection.disconnect()
          useStore.getState().resetForDisconnect()
          router.replace('/connect')
        },
      },
    ])
  }, [])

  const handleToggleThinking = useCallback(() => {
    sessionStore.getState().setThinkingEnabled(!thinkingEnabled)
  }, [thinkingEnabled])

  const handleSelectModel = useCallback(() => {
    const allModels: { provider: string; model: string }[] = []
    for (const p of providers) {
      for (const m of p.models) {
        allModels.push({ provider: p.name, model: m })
      }
    }

    if (allModels.length === 0) {
      Alert.alert('No Models', 'No models available. Check your provider configuration.')
      return
    }

    // Simple picker using Alert on iOS (works well for small lists)
    const options = allModels.slice(0, 10).map((m) => ({
      text: `${m.model}`,
      onPress: () => {
        sessionStore
          .getState()
          .setCurrentSession(sessionStore.getState().currentSessionId || '', m.provider, m.model)
        connection.sendProviderSetDefault(m.provider, m.model)
      },
    }))

    Alert.alert('Select Model', undefined, [...options, { text: 'Cancel', style: 'cancel' }])
  }, [providers])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={20} strokeWidth={1.5} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Agent info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agent</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Server size={18} strokeWidth={1.5} color={colors.textSecondary} />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Agent ID</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {agentId || 'Unknown'}
                </Text>
              </View>
            </View>
            <View style={styles.separator} />
            <View style={styles.row}>
              <Zap size={18} strokeWidth={1.5} color={colors.textSecondary} />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Version</Text>
                <Text style={styles.rowValue}>{agentVersion || 'Unknown'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Model */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Model</Text>
          <Pressable style={styles.card} onPress={handleSelectModel}>
            <View style={styles.row}>
              <Cpu size={18} strokeWidth={1.5} color={colors.textSecondary} />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Current Model</Text>
                <Text style={styles.rowValue}>{currentModel}</Text>
              </View>
              <ChevronRight size={16} strokeWidth={1.5} color={colors.textTertiary} />
            </View>
          </Pressable>
        </View>

        {/* Thinking */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Features</Text>
          <Pressable style={styles.card} onPress={handleToggleThinking}>
            <View style={styles.row}>
              <Brain size={18} strokeWidth={1.5} color={colors.textSecondary} />
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Extended Thinking</Text>
                <Text style={styles.rowValue}>{thinkingEnabled ? 'Enabled' : 'Disabled'}</Text>
              </View>
              <View style={[styles.toggle, thinkingEnabled && styles.toggleOn]}>
                <View style={[styles.toggleKnob, thinkingEnabled && styles.toggleKnobOn]} />
              </View>
            </View>
          </Pressable>
        </View>

        {/* Disconnect */}
        <View style={styles.section}>
          <Pressable style={[styles.card, styles.dangerCard]} onPress={handleDisconnect}>
            <View style={styles.row}>
              <LogOut size={18} strokeWidth={1.5} color={colors.error} />
              <Text style={styles.dangerText}>Disconnect</Text>
            </View>
          </Pressable>
        </View>

        <Text style={styles.footer}>Anton Mobile v1.0.0</Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  rowValue: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 50,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bgHover,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: colors.accent,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
  },
  dangerCard: {
    borderColor: colors.errorDim,
  },
  dangerText: {
    color: colors.error,
    fontSize: fontSize.md,
    fontWeight: '500',
    flex: 1,
  },
  footer: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
})
