import type {
  MentionContext,
  MentionItem,
  MentionProvider,
  MentionSectionResult,
  MentionSelectResult,
} from './types.js'

/**
 * Central registry for `@` mention providers.
 *
 * Phase 3 ships the `files` provider only. Future providers (agents, web,
 * chat, notes, terminal) can register here without touching the dropdown
 * or the composer's trigger-detection logic.
 */
class MentionRegistry {
  private providers: MentionProvider[] = []

  register(p: MentionProvider) {
    // Idempotent registration keyed on id, so hot-reload / re-mount doesn't
    // double up.
    this.providers = this.providers.filter((x) => x.id !== p.id)
    this.providers.push(p)
    this.providers.sort((a, b) => a.priority - b.priority)
  }

  unregister(id: string) {
    this.providers = this.providers.filter((p) => p.id !== id)
  }

  list(): MentionProvider[] {
    return [...this.providers]
  }

  async searchAll(query: string, ctx: MentionContext): Promise<MentionSectionResult[]> {
    if (this.providers.length === 0) return []
    const settled = await Promise.all(
      this.providers.map(async (provider): Promise<MentionSectionResult> => {
        try {
          const items = await provider.search(query, ctx)
          return { provider, items }
        } catch {
          // A provider failure must not break the dropdown — drop silently.
          return { provider, items: [] }
        }
      }),
    )
    // Preserve provider priority order; drop empty sections so the dropdown
    // doesn't render empty section headers.
    return settled
      .filter((s) => s.items.length > 0)
      .sort((a, b) => a.provider.priority - b.provider.priority)
  }

  select(providerId: string, item: MentionItem): MentionSelectResult | null {
    const p = this.providers.find((x) => x.id === providerId)
    return p ? p.onSelect(item) : null
  }
}

export const mentionRegistry = new MentionRegistry()
