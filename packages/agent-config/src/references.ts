/**
 * Reference knowledge system — contextual coding guides loaded into the agent's prompt.
 *
 * References are organized into "packs" (e.g., web-dev, api) that group related
 * .md reference files. When a code project session starts, relevant packs are
 * auto-selected based on project type and the user's first message.
 *
 * Loading priority: ~/.anton/references/{name}.md → embedded defaults
 * Pack definitions: ~/.anton/references/_packs.yaml → embedded defaults
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getAntonDir } from './config.js'
import { EMBEDDED_REFERENCES, EMBEDDED_REFERENCE_PACKS } from './embedded-prompts.js'

// ── Types ────────────────────────────────────────────────────────────

export interface ReferencePack {
  description: string
  tags: string[]
  refs: string[]
}

// ── Paths ────────────────────────────────────────────────────────────

let _referencesDir: string | undefined
function referencesDir(): string {
  _referencesDir ??= join(getAntonDir(), 'references')
  return _referencesDir
}

// ── Pack loading ─────────────────────────────────────────────────────

/**
 * Load reference packs — merges user-defined packs with embedded defaults.
 * User packs in ~/.anton/references/_packs.yaml override embedded packs by name.
 */
export function loadReferencePacks(): Record<string, ReferencePack> {
  const packs: Record<string, ReferencePack> = { ...EMBEDDED_REFERENCE_PACKS }

  // Merge user-defined packs (override by name)
  const userPacksPath = join(referencesDir(), '_packs.yaml')
  if (existsSync(userPacksPath)) {
    try {
      const raw = readFileSync(userPacksPath, 'utf-8')
      const userPacks = parseYaml(raw) as Record<string, ReferencePack>
      if (userPacks && typeof userPacks === 'object') {
        for (const [name, pack] of Object.entries(userPacks)) {
          packs[name] = pack
        }
      }
    } catch (err) {
      console.error('Failed to load user reference packs:', err)
    }
  }

  return packs
}

// ── Single reference loading ─────────────────────────────────────────

/**
 * Load a single reference by name.
 * Checks ~/.anton/references/{name}.md first, falls back to embedded.
 */
function loadSingleReference(name: string): string | undefined {
  // User override
  const userPath = join(referencesDir(), `${name}.md`)
  if (existsSync(userPath)) {
    try {
      return readFileSync(userPath, 'utf-8')
    } catch {
      // fall through to embedded
    }
  }
  // Embedded default
  return EMBEDDED_REFERENCES[name]
}

// ── Pack selection ───────────────────────────────────────────────────

/**
 * Determine which packs to load based on project type, user message, and explicit overrides.
 */
function selectPacks(
  packs: Record<string, ReferencePack>,
  opts: {
    projectType?: string
    firstMessage?: string
    explicitRefs?: string[]
  },
): string[] {
  const selected = new Set<string>()

  // Tier 1: Project type auto-load
  if (opts.projectType === 'code') {
    if (packs['web-dev']) selected.add('web-dev')
  }

  // Tier 2: Tag matching against first message
  if (opts.firstMessage) {
    const msg = opts.firstMessage.toLowerCase()
    for (const [packName, pack] of Object.entries(packs)) {
      if (selected.has(packName)) continue
      const matched = pack.tags.some((tag) => msg.includes(tag.toLowerCase()))
      if (matched) selected.add(packName)
    }
  }

  // Tier 3: Explicit pack names
  if (opts.explicitRefs) {
    for (const ref of opts.explicitRefs) {
      if (packs[ref]) selected.add(ref)
    }
  }

  return Array.from(selected)
}

// ── Main loader ──────────────────────────────────────────────────────

/**
 * Load all relevant references for a session.
 * Returns a formatted string ready for injection into the system prompt,
 * or empty string if no references matched.
 */
export function loadReferences(opts: {
  projectType?: string
  firstMessage?: string
  explicitRefs?: string[]
}): string {
  const packs = loadReferencePacks()
  const selectedPackNames = selectPacks(packs, opts)

  if (selectedPackNames.length === 0) return ''

  // Collect unique ref names across all selected packs
  const refNames = new Set<string>()
  for (const packName of selectedPackNames) {
    const pack = packs[packName]
    if (pack) {
      for (const ref of pack.refs) {
        refNames.add(ref)
      }
    }
  }

  // Load each reference
  const sections: string[] = []
  for (const name of refNames) {
    const content = loadSingleReference(name)
    if (content) {
      sections.push(content.trim())
    }
  }

  if (sections.length === 0) return ''

  return sections.join('\n\n---\n\n')
}

// ── Setup ────────────────────────────────────────────────────────────

/**
 * Ensure the user references directory exists.
 * Called during agent startup.
 */
export function ensureReferencesDir(): void {
  mkdirSync(referencesDir(), { recursive: true })
}
