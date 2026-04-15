import { connection } from '@/lib/connection'
import {
  type SavedMachine,
  loadMachines,
  removeMachineToken,
  saveLastMachineId,
  saveMachines,
} from '@/lib/storage'
import { useConnectionStatus } from '@/lib/store'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type PageView = 'list' | 'login'

export default function ConnectScreen() {
  const status = useConnectionStatus()
  const insets = useSafeAreaInsets()

  const [machines, setMachines] = useState<SavedMachine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<PageView>('login')
  const [mode, setMode] = useState<'username' | 'ip'>('username')
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('9876')
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  useEffect(() => {
    loadMachines().then((m) => {
      setMachines(m)
      setView(m.length > 0 ? 'list' : 'login')
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (status === 'connected') {
      setConnecting(false)
      setConnectingId(null)
      setError(null)
      router.replace('/(tabs)')
    } else if (status === 'error') {
      setConnecting(false)
      setConnectingId(null)
      const detail = connection.statusDetail
      setError(detail || 'Connection failed. Check your credentials.')
    }
  }, [status])

  const handleConnect = useCallback(async () => {
    Keyboard.dismiss()
    setError(null)
    setConnecting(true)

    const config =
      mode === 'username'
        ? {
            host: `${username}.antoncomputer.in`,
            port: 443,
            token,
            useTLS: true,
          }
        : {
            host,
            port: Number.parseInt(port, 10) || 9876,
            token,
            useTLS: false,
          }

    if (!config.host || !config.token) {
      setError('Please fill in all fields')
      setConnecting(false)
      return
    }

    const machineId = `${config.host}:${config.port}`
    const machine: SavedMachine = {
      id: machineId,
      name: mode === 'username' ? username : config.host,
      host: config.host,
      port: config.port,
      token: config.token,
      useTLS: config.useTLS,
    }
    const updated = [machine, ...machines.filter((m) => m.id !== machineId)]
    setMachines(updated)
    await saveMachines(updated)
    await saveLastMachineId(machineId)

    connection.connect(config)
  }, [mode, username, host, port, token, machines])

  const handleQuickConnect = useCallback(async (machine: SavedMachine) => {
    if (!machine.token) {
      setError('Token missing. Please add this machine again.')
      return
    }
    setConnecting(true)
    setConnectingId(machine.id)
    setError(null)
    await saveLastMachineId(machine.id)
    connection.connect({
      host: machine.host,
      port: machine.port,
      token: machine.token,
      useTLS: machine.useTLS,
    })
  }, [])

  const handleDeleteMachine = useCallback(
    (id: string) => {
      setOpenMenuId(null)
      Alert.alert('Remove Machine', 'Remove this saved connection?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const updated = machines.filter((m) => m.id !== id)
            setMachines(updated)
            await saveMachines(updated)
            await removeMachineToken(id)
            if (updated.length === 0) {
              setView('login')
            }
          },
        },
      ])
    },
    [machines],
  )

  const goToLogin = useCallback(() => {
    setError(null)
    setUsername('')
    setHost('')
    setPort('9876')
    setToken('')
    setView('login')
  }, [])

  const goToList = useCallback(() => {
    setError(null)
    Keyboard.dismiss()
    setView('list')
  }, [])

  if (!loaded) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }, styles.centered]}>
        <ActivityIndicator color={colors.textTertiary} size="small" />
      </View>
    )
  }

  // ── Machine List View ──
  if (view === 'list') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.logo}>Anton</Text>
            <Text style={styles.subtitle}>Your machines</Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.machineList}>
            {machines.map((m) => (
              <View key={m.id} style={styles.machineCard}>
                <Pressable
                  style={styles.machineCardBody}
                  onPress={() => handleQuickConnect(m)}
                  disabled={connecting}
                >
                  <View
                    style={[
                      styles.machineDot,
                      connecting && connectingId === m.id && styles.machineDotConnecting,
                    ]}
                  />
                  <View style={styles.machineInfo}>
                    <Text style={styles.machineName} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={styles.machineHost} numberOfLines={1}>
                      {m.host}:{m.port}
                    </Text>
                  </View>
                  {connecting && connectingId === m.id && (
                    <ActivityIndicator
                      color={colors.textTertiary}
                      size="small"
                      style={{ marginRight: spacing.sm }}
                    />
                  )}
                </Pressable>

                {/* Three-dot menu */}
                <Pressable
                  style={styles.menuBtn}
                  onPress={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                  hitSlop={8}
                >
                  <Text style={styles.menuDots}>•••</Text>
                </Pressable>

                {/* Dropdown */}
                {openMenuId === m.id && (
                  <View style={styles.dropdown}>
                    <Pressable
                      style={styles.dropdownItem}
                      onPress={() => handleDeleteMachine(m.id)}
                    >
                      <Text style={styles.dropdownItemTextDestructive}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>

          <Pressable style={styles.addBtn} onPress={goToLogin}>
            <Text style={styles.addBtnText}>+ Add Machine</Text>
          </Pressable>
        </ScrollView>

        {/* Dismiss menu on background tap */}
        {openMenuId && (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenMenuId(null)} />
        )}
      </View>
    )
  }

  // ── Login / Add Machine View ──
  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Back button if machines exist */}
        {machines.length > 0 && (
          <Pressable style={styles.backBtn} onPress={goToList} hitSlop={12}>
            <Text style={styles.backBtnText}>← Machines</Text>
          </Pressable>
        )}

        <View style={[styles.header, machines.length === 0 && { paddingTop: 80 }]}>
          <Text style={styles.logo}>Anton</Text>
          <Text style={styles.subtitle}>Connect to your agent</Text>
        </View>

        {/* Mode toggle */}
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeBtn, mode === 'username' && styles.modeBtnActive]}
            onPress={() => setMode('username')}
          >
            <Text style={[styles.modeBtnText, mode === 'username' && styles.modeBtnTextActive]}>
              Username
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === 'ip' && styles.modeBtnActive]}
            onPress={() => setMode('ip')}
          >
            <Text style={[styles.modeBtnText, mode === 'ip' && styles.modeBtnTextActive]}>
              IP Address
            </Text>
          </Pressable>
        </View>

        {/* Fields */}
        <View style={styles.formFields}>
          {mode === 'username' ? (
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={host}
                onChangeText={setHost}
                placeholder="Host (e.g. 192.168.1.100)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TextInput
                style={styles.input}
                value={port}
                onChangeText={setPort}
                placeholder="Port (default 9876)"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </>
          )}

          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="Auth token"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.connectBtnText}>Connect</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: 40,
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 40,
  },
  logo: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },

  // ── Back button ──
  backBtn: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '500',
  },

  // ── Machine List ──
  machineList: {
    gap: spacing.sm,
  },
  machineCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  machineCardBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  machineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: spacing.md,
  },
  machineDotConnecting: {
    backgroundColor: colors.working,
  },
  machineInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  machineName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  machineHost: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },

  // ── Three-dot menu ──
  menuBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuDots: {
    color: colors.textTertiary,
    fontSize: 14,
    letterSpacing: 1,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    marginTop: 4,
    zIndex: 100,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dropdownItemTextDestructive: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },

  // ── Add button ──
  addBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },

  // ── Mode Toggle ──
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.xl,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  modeBtnActive: {
    backgroundColor: colors.bgElevated,
  },
  modeBtnText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: colors.text,
  },

  // ── Form ──
  formFields: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    height: 48,
  },
  error: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  connectBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  connectBtnDisabled: {
    opacity: 0.6,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
