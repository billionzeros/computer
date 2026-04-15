import type { Conversation } from '@/lib/store/types'
import { colors, fontSize, radius, spacing } from '@/theme/colors'
import { ArrowLeft, MessageSquare, MoreHorizontal, Search } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function ConversationList({ conversations, activeId, onSelect, onDelete, onClose }: Props) {
  const [search, setSearch] = useState('')
  const sorted = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()))

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => {
      const isActive = item.id === activeId
      const lastMsg = item.messages[item.messages.length - 1]
      const preview = lastMsg ? lastMsg.content.slice(0, 80).replace(/\n/g, ' ') : 'No messages yet'

      return (
        <Pressable
          style={[styles.item, isActive && styles.itemActive]}
          onPress={() => {
            onSelect(item.id)
            onClose()
          }}
        >
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, isActive && styles.itemTitleActive]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.itemPreview} numberOfLines={1}>
              {preview}
            </Text>
            <View style={styles.itemMeta}>
              <Text style={styles.itemTime}>{timeAgo(item.updatedAt)}</Text>
            </View>
          </View>
          <Pressable style={styles.moreBtn} onPress={() => onDelete(item.id)} hitSlop={8}>
            <MoreHorizontal size={16} strokeWidth={1.5} color={colors.textTertiary} />
          </Pressable>
        </Pressable>
      )
    },
    [activeId, onSelect, onDelete, onClose],
  )

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8}>
          <ArrowLeft size={20} strokeWidth={1.5} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Threads</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={16} strokeWidth={1.5} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search threads"
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
        </View>
      </View>

      {/* List */}
      <FlatList
        data={sorted}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.empty}>
            <MessageSquare size={32} strokeWidth={1.5} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
              {search ? 'No matching threads' : 'No threads yet'}
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
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 38,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingVertical: 0,
  },
  list: {
    paddingVertical: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  itemActive: {
    backgroundColor: colors.surfaceActive,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemTitleActive: {
    color: colors.accentText,
  },
  itemPreview: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemTime: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
  },
  moreBtn: {
    padding: spacing.sm,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: fontSize.md,
  },
})
