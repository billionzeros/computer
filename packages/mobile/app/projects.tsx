import { connection } from '@/lib/connection'
import { useStore } from '@/lib/store'
import { projectStore } from '@/lib/store/projectStore'
import type { SessionMeta } from '@/lib/store/types'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import type { AgentSession, Project } from '@anton/protocol'
import { router } from 'expo-router'
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  FolderOpen,
  MessageSquare,
  Pause,
  Play,
} from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function ProjectsScreen() {
  const insets = useSafeAreaInsets()
  const projects = projectStore((s) => s.projects)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const projectSessions = projectStore((s) => s.projectSessions)
  const projectAgents = projectStore((s) => s.projectAgents)

  const handleExpand = useCallback(
    (id: string) => {
      if (expandedId === id) {
        setExpandedId(null)
      } else {
        setExpandedId(id)
        projectStore.getState().setActiveProject(id)
      }
    },
    [expandedId],
  )

  const handleOpenSession = useCallback((session: SessionMeta, projectId: string) => {
    const store = useStore.getState()
    const conv = store.conversations.find((c) => c.sessionId === session.id)

    if (!conv) {
      store.newConversation(session.title, session.id, projectId)
    } else {
      store.switchConversation(conv.id)
    }
    router.navigate('/')
  }, [])

  const handleAgentAction = useCallback(
    (projectId: string, agent: AgentSession, action: 'start' | 'stop') => {
      connection.sendAgentAction(projectId, agent.sessionId, action)
    },
    [],
  )

  const renderProject = useCallback(
    ({ item }: { item: Project }) => {
      const isExpanded = expandedId === item.id

      return (
        <View style={styles.projectCard}>
          <Pressable style={styles.projectHeader} onPress={() => handleExpand(item.id)}>
            <Text style={styles.projectIcon}>{item.icon || '📁'}</Text>
            <View style={styles.projectInfo}>
              <Text style={styles.projectName}>{item.name}</Text>
              {item.description ? (
                <Text style={styles.projectDesc} numberOfLines={1}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <View style={styles.projectStats}>
              <Text style={styles.statText}>{item.stats?.sessionCount || 0} chats</Text>
              <ChevronRight
                size={16}
                strokeWidth={1.5}
                color={colors.textTertiary}
                style={isExpanded ? { transform: [{ rotate: '90deg' }] } : undefined}
              />
            </View>
          </Pressable>

          {isExpanded && (
            <View style={styles.expandedContent}>
              {/* Agents */}
              {projectAgents.length > 0 && (
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Agents</Text>
                  {projectAgents.map((agent) => (
                    <View key={agent.sessionId} style={styles.agentRow}>
                      <Bot size={14} strokeWidth={1.5} color={colors.textSecondary} />
                      <View style={styles.agentInfo}>
                        <Text style={styles.agentName}>{agent.agent.name}</Text>
                        <Text style={styles.agentStatus}>
                          {agent.agent.status}
                          {agent.agent.schedule?.cron ? ` • ${agent.agent.schedule.cron}` : ''}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.agentAction}
                        onPress={() =>
                          handleAgentAction(
                            item.id,
                            agent,
                            agent.agent.status === 'running' ? 'stop' : 'start',
                          )
                        }
                      >
                        {agent.agent.status === 'running' ? (
                          <Pause size={14} strokeWidth={1.5} color={colors.warning} />
                        ) : (
                          <Play size={14} strokeWidth={1.5} color={colors.success} />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {/* Sessions */}
              {projectSessions.length > 0 && (
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Conversations</Text>
                  {projectSessions.slice(0, 10).map((session) => (
                    <Pressable
                      key={session.id}
                      style={styles.sessionRow}
                      onPress={() => handleOpenSession(session, item.id)}
                    >
                      <MessageSquare size={14} strokeWidth={1.5} color={colors.textTertiary} />
                      <Text style={styles.sessionTitle} numberOfLines={1}>
                        {session.title || 'Untitled'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {projectAgents.length === 0 && projectSessions.length === 0 && (
                <Text style={styles.emptyExpanded}>No sessions or agents yet</Text>
              )}
            </View>
          )}
        </View>
      )
    },
    [
      expandedId,
      projectSessions,
      projectAgents,
      handleExpand,
      handleOpenSession,
      handleAgentAction,
    ],
  )

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={20} strokeWidth={1.5} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Projects</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FolderOpen size={32} strokeWidth={1.5} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No projects yet</Text>
            <Text style={styles.emptySubtext}>
              Projects will appear here when you create them on Anton
            </Text>
          </View>
        }
      />
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
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  list: {
    padding: spacing.lg,
  },
  projectCard: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  projectIcon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  projectDesc: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  projectStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statText: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
  },
  expandedContent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  subsection: {
    marginBottom: spacing.md,
  },
  subsectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  agentStatus: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  agentAction: {
    padding: spacing.sm,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sessionTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    flex: 1,
  },
  emptyExpanded: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: fontSize.lg,
    fontWeight: '500',
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    maxWidth: 260,
  },
})
