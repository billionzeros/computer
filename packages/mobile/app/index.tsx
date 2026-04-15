import { ActionsGroup } from '@/components/ActionsGroup'
import { AskUserSheet } from '@/components/AskUserSheet'
import { ChatInput } from '@/components/ChatInput'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { ConversationList } from '@/components/ConversationList'
import { MessageBubble } from '@/components/MessageBubble'
import { PlanReviewSheet } from '@/components/PlanReviewSheet'
import { StatusIndicator } from '@/components/StatusIndicator'
import { TaskChecklist } from '@/components/TaskChecklist'
import type { GroupedItem } from '@/lib/groupMessages'
import { groupMessages } from '@/lib/groupMessages'
import { useStore } from '@/lib/store'
import { connectionStore } from '@/lib/store/connectionStore'
import { sessionStore, useActiveSessionState } from '@/lib/store/sessionStore'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { router } from 'expo-router'
import { MessageSquare, Monitor, MoreHorizontal } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type Mode = 'chat' | 'projects'

export default function ChatScreen() {
  const insets = useSafeAreaInsets()
  const listRef = useRef<FlatList>(null)
  const [showConversations, setShowConversations] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')

  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const activeConv = useStore((s) => s.getActiveConversation())
  const messages = activeConv?.messages ?? []
  const initPhase = connectionStore((s) => s.initPhase)

  const agentStatus = useActiveSessionState((s) => s.status)
  const statusDetail = useActiveSessionState((s) => s.statusDetail)
  const tasks = useActiveSessionState((s) => s.tasks)
  const pendingConfirm = useActiveSessionState((s) => s.pendingConfirm)
  const pendingPlan = useActiveSessionState((s) => s.pendingPlan)
  const pendingAskUser = useActiveSessionState((s) => s.pendingAskUser)

  const hasMessages = messages.length > 0
  const grouped = useMemo(() => groupMessages(messages), [messages])

  // Auto-create conversation on first load
  useEffect(() => {
    if (initPhase === 'ready' && !activeConversationId) {
      useStore.getState().newConversation()
    }
  }, [initPhase, activeConversationId])

  // Fetch history when switching conversations
  const activeSessionId = activeConv?.sessionId
  const hasExistingMessages = (activeConv?.messages.length ?? 0) > 0
  useEffect(() => {
    if (activeSessionId && !hasExistingMessages && initPhase === 'ready') {
      useStore.getState().requestSessionHistory(activeSessionId)
    }
  }, [activeSessionId, hasExistingMessages, initPhase])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages.length])

  const handleSend = useCallback(
    async (text: string) => {
      const store = useStore.getState()
      const ss = sessionStore.getState()
      let conv = store.getActiveConversation()

      if (!conv) {
        const id = store.newConversation()
        conv = store.conversations.find((c) => c.id === id)!
        console.log('[Chat] Created new conversation:', id)
      }

      store.addMessage({
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })

      const sessionId = conv.sessionId

      // If session not yet registered on server, create it and wait for confirmation
      if (sessionId && !ss.currentSessionId) {
        console.log('[Chat] Creating session on server:', sessionId)
        const pending = ss.registerPendingSession(sessionId)
        ss.createSession(sessionId, {
          provider: ss.currentProvider,
          model: ss.currentModel,
          projectId: conv.projectId,
        })
        await pending
        console.log('[Chat] Session confirmed by server:', sessionId)
      }

      if (agentStatus === 'working' && sessionId) {
        console.log('[Chat] Steering session:', sessionId)
        ss.sendSteerMessage(text, sessionId)
      } else if (sessionId) {
        console.log('[Chat] Sending message to session:', sessionId)
        ss.sendAiMessageToSession(text, sessionId)
      } else {
        console.log('[Chat] Sending message (no session)')
        ss.sendAiMessage(text)
      }
    },
    [agentStatus],
  )

  const handleCancel = useCallback(() => {
    const sid = sessionStore.getState().currentSessionId
    if (sid) sessionStore.getState().sendCancelTurn(sid)
  }, [])

  const handleConfirmApprove = useCallback(() => {
    if (pendingConfirm) {
      sessionStore.getState().sendConfirmResponse(pendingConfirm.id, true)
      const sid = pendingConfirm.sessionId || sessionStore.getState().currentSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, { pendingConfirm: null })
      }
    }
  }, [pendingConfirm])

  const handleConfirmDeny = useCallback(() => {
    if (pendingConfirm) {
      sessionStore.getState().sendConfirmResponse(pendingConfirm.id, false)
      const sid = pendingConfirm.sessionId || sessionStore.getState().currentSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, { pendingConfirm: null })
      }
    }
  }, [pendingConfirm])

  const handlePlanApprove = useCallback(() => {
    if (pendingPlan) {
      sessionStore.getState().sendPlanResponse(pendingPlan.id, true)
      const sid = pendingPlan.sessionId || sessionStore.getState().currentSessionId
      if (sid) {
        sessionStore.getState().updateSessionState(sid, { pendingPlan: null })
      }
    }
  }, [pendingPlan])

  const handlePlanDeny = useCallback(
    (feedback?: string) => {
      if (pendingPlan) {
        sessionStore.getState().sendPlanResponse(pendingPlan.id, false, feedback)
        const sid = pendingPlan.sessionId || sessionStore.getState().currentSessionId
        if (sid) {
          sessionStore.getState().updateSessionState(sid, { pendingPlan: null })
        }
      }
    },
    [pendingPlan],
  )

  const handleAskUserSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (pendingAskUser) {
        sessionStore.getState().sendAskUserResponse(pendingAskUser.id, answers)
        const sid = pendingAskUser.sessionId || sessionStore.getState().currentSessionId
        if (sid) {
          sessionStore.getState().updateSessionState(sid, { pendingAskUser: null })
        }
      }
    },
    [pendingAskUser],
  )

  const renderGroupedItem = useCallback(
    ({ item, index }: { item: GroupedItem; index: number }) => {
      if (item.type === 'actions') {
        return <ActionsGroup actions={item.actions} />
      }
      if (item.type === 'task_section') {
        return <ActionsGroup actions={item.actions} title={item.title} done={item.done} />
      }
      // Regular message
      const next = grouped[index + 1]
      const nextIsMessage = next?.type === 'message'
      const isLastInGroup = !nextIsMessage || next.message.role !== item.message.role
      return <MessageBubble message={item.message} isLastInGroup={isLastInGroup} />
    },
    [grouped],
  )

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          {/* Avatar / Settings */}
          <Pressable style={styles.avatarBtn} onPress={() => router.push('/settings')}>
            <Text style={styles.avatarText}>A</Text>
          </Pressable>

          {/* Mode Toggle */}
          <View style={styles.modeToggle}>
            <Pressable
              style={[styles.modeBtn, mode === 'chat' && styles.modeBtnActive]}
              onPress={() => setMode('chat')}
            >
              <MessageSquare
                size={15}
                strokeWidth={1.5}
                color={mode === 'chat' ? colors.text : colors.textTertiary}
              />
              <Text style={[styles.modeBtnText, mode === 'chat' && styles.modeBtnTextActive]}>
                Chat
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, mode === 'projects' && styles.modeBtnActive]}
              onPress={() => {
                setMode('projects')
                router.push('/projects')
              }}
            >
              <Monitor
                size={15}
                strokeWidth={1.5}
                color={mode === 'projects' ? colors.text : colors.textTertiary}
              />
              <Text style={[styles.modeBtnText, mode === 'projects' && styles.modeBtnTextActive]}>
                Computer
              </Text>
            </Pressable>
          </View>

          {/* Menu */}
          <Pressable style={styles.menuBtn} onPress={() => setShowConversations(true)}>
            <MoreHorizontal size={18} strokeWidth={1.5} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Status bar (only when working) */}
        {agentStatus !== 'idle' && (
          <View style={styles.statusBar}>
            <StatusIndicator status={agentStatus} detail={statusDetail} />
          </View>
        )}

        {/* Tasks */}
        <TaskChecklist tasks={tasks} />

        {/* Messages or Empty State */}
        {hasMessages ? (
          <FlatList
            ref={listRef}
            data={grouped}
            renderItem={renderGroupedItem}
            keyExtractor={(item) => (item.type === 'message' ? item.message.id : item.id)}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyContent}>
              <Text style={styles.brandName}>anton</Text>
              <Text style={styles.brandSub}>computer</Text>
            </View>
          </View>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onCancel={handleCancel}
          isWorking={agentStatus === 'working'}
        />

        {/* Interaction sheets */}
        {pendingConfirm && (
          <ConfirmSheet
            confirm={pendingConfirm}
            onApprove={handleConfirmApprove}
            onDeny={handleConfirmDeny}
          />
        )}
        {pendingPlan && (
          <PlanReviewSheet
            plan={pendingPlan}
            onApprove={handlePlanApprove}
            onDeny={handlePlanDeny}
          />
        )}
        {pendingAskUser && <AskUserSheet askUser={pendingAskUser} onSubmit={handleAskUserSubmit} />}

        {/* Conversation drawer */}
        <Modal visible={showConversations} animationType="slide">
          <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
            <ConversationList
              conversations={conversations.filter((c) => !c.projectId)}
              activeId={activeConversationId}
              onSelect={(id) => {
                useStore.getState().switchConversation(id)
                setShowConversations(false)
              }}
              onDelete={(id) => useStore.getState().deleteConversation(id)}
              onClose={() => setShowConversations(false)}
            />
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgHover,
  },
  avatarText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  // Mode toggle pill
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    padding: 3,
    gap: 2,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.full,
    gap: 6,
  },
  modeBtnActive: {
    backgroundColor: colors.bgHover,
  },
  modeBtnText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: colors.text,
  },

  // Menu button
  menuBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },

  statusBar: {
    paddingHorizontal: spacing.md,
  },
  messageList: {
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContent: {
    alignItems: 'center',
    marginBottom: 80,
  },
  brandName: {
    color: colors.accent,
    fontSize: 32,
    fontWeight: '300',
    letterSpacing: 2,
  },
  brandSub: {
    color: colors.textTertiary,
    fontSize: fontSize.md,
    fontWeight: '300',
    letterSpacing: 4,
    marginTop: spacing.xs,
  },
})
