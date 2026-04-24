import type { ComponentType } from 'react'

export type MentionKind = 'file' | 'dir' | 'agent' | 'web' | 'chat' | 'notes' | 'terminal'

export interface MentionContext {
  /** Active project workspace path (may be empty when no project is open). */
  workspaceRoot: string
  /** Conversation for recent-reference tracking and session-scoped ranking. */
  conversationId?: string
}

export interface MentionItem<P = unknown> {
  /** Stable ID per item — provider-scoped. */
  id: string
  kind: MentionKind
  /** Lucide-style icon component. */
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  /** Primary label shown in the dropdown row. */
  label: string
  /** Optional secondary line (folder path, "12 files", "Agent", etc). */
  secondary?: string
  /** 0..1, higher = more relevant. Used to sort within a provider section. */
  score?: number
  /** Arbitrary provider-specific data, echoed back to `onSelect`. */
  payload: P
}

export interface MentionSelectResult {
  /**
   * Text that should be inserted in place of the `@query` trigger.
   * For files/folders this is a marker like `[file:path]` or `[dir:path]`;
   * Phase 4 will upgrade these to visual pills. A trailing space is added
   * by the caller, so markers don't need to include one.
   */
  markerText: string
  /** Optional payload snapshot for future pill resolution / live name lookup. */
  snapshot?: Record<string, unknown>
}

export interface MentionProvider {
  /** Stable ID, used as a section key. */
  id: string
  /** Section header in the dropdown. */
  label: string
  /** Lower first. Files: 10, Agents (future): 20, Web (future): 30, etc. */
  priority: number
  /** Async search — returns items ranked provider-locally. Dropdown merges by priority. */
  search(query: string, ctx: MentionContext): Promise<MentionItem[]>
  /** Called on item selection; returns the text to insert. */
  onSelect(item: MentionItem): MentionSelectResult
}

export interface MentionSectionResult {
  provider: MentionProvider
  items: MentionItem[]
}
