import { File, FileCode, FileSpreadsheet, FileText, Folder, Image as ImageIcon } from 'lucide-react'
import { connection } from '../connection.js'
import type { MentionContext, MentionItem, MentionProvider, MentionSelectResult } from './types.js'

// ── Icon classification ────────────────────────────────────────────────

const CODE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rs',
  'go',
  'sh',
  'rb',
  'java',
  'c',
  'cpp',
  'html',
  'css',
  'scss',
  'swift',
  'kt',
  'vue',
  'svelte',
])
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'sql', 'xlsx', 'xls'])
const TEXT_EXTS = new Set(['md', 'txt', 'log', 'pdf', 'doc', 'docx', 'rtf', 'mdx'])
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',
  'bmp',
  'heic',
  'heif',
])

function iconForFile(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return ImageIcon
  if (DATA_EXTS.has(ext)) return FileSpreadsheet
  if (CODE_EXTS.has(ext)) return FileCode
  if (TEXT_EXTS.has(ext)) return FileText
  return File
}

const HIDDEN_NAMES = new Set(['.DS_Store', '.anton.json', 'Thumbs.db', '.git'])

// ── Promisified listing, correlated by echoed path ─────────────────────

interface FsEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
}

/**
 * Promise-based wrapper around the filesync `fs_list` op. We correlate
 * the response to our request by the `path` echoed by the server — see
 * server.ts fs_list_response.
 *
 * Using a per-call one-shot listener means concurrent list calls for
 * different paths don't interfere with each other (or with the
 * always-on ProjectFilesView listener).
 */
function listDir(path: string, timeoutMs = 5000): Promise<FsEntry[]> {
  return new Promise((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      unsub?.()
      resolve([])
    }, timeoutMs)

    const unsub = connection.onFilesystemResponse((entries, error, respPath) => {
      if (settled) return
      // Only accept the response for our path. Responses for other paths
      // (e.g., the user browsing in ProjectFilesView) slip past us.
      if (respPath && respPath !== path) return
      settled = true
      window.clearTimeout(timer)
      unsub?.()
      resolve(error ? [] : entries)
    })

    connection.sendFilesystemList(path, false)
  })
}

// ── Short cache so repeated keystrokes don't thrash fs_list ────────────

interface CacheEntry {
  entries: FsEntry[]
  ts: number
}

const CACHE_TTL_MS = 15_000
const cache = new Map<string, CacheEntry>()

async function getListing(path: string): Promise<FsEntry[]> {
  const cached = cache.get(path)
  const now = Date.now()
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.entries
  const entries = await listDir(path)
  cache.set(path, { entries, ts: now })
  return entries
}

/** Invalidate cache — used when we know the filesystem just changed. */
export function invalidateFilesProviderCache(path?: string) {
  if (path) cache.delete(path)
  else cache.clear()
}

// ── Query parsing + scoring ────────────────────────────────────────────

/**
 * Split the query into a folder prefix + leaf fragment.
 * - `""`           → prefix `""`,         leaf `""`
 * - `"sal"`        → prefix `""`,         leaf `"sal"`
 * - `"data/"`      → prefix `"data/"`,    leaf `""`
 * - `"data/sal"`   → prefix `"data/"`,    leaf `"sal"`
 * - `"a/b/f"`      → prefix `"a/b/"`,     leaf `"f"`
 */
function splitQuery(q: string): { prefix: string; leaf: string } {
  const idx = q.lastIndexOf('/')
  if (idx < 0) return { prefix: '', leaf: q }
  return { prefix: q.slice(0, idx + 1), leaf: q.slice(idx + 1) }
}

/**
 * Simple substring / subsequence score for ranking. Subsequence match
 * (letters appear in order but not adjacent) is lower-scored than
 * substring match, both beat no-match.
 */
function score(name: string, leaf: string): number {
  if (!leaf) return 0.5
  const n = name.toLowerCase()
  const q = leaf.toLowerCase()
  if (n === q) return 1.0
  if (n.startsWith(q)) return 0.9
  const idx = n.indexOf(q)
  if (idx >= 0) return 0.75 - Math.min(idx / n.length, 0.3)
  // Subsequence fallback
  let qi = 0
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) qi++
  }
  return qi === q.length ? 0.4 : 0
}

// ── Provider impl ──────────────────────────────────────────────────────

function joinPath(root: string, rel: string): string {
  if (!rel) return root
  if (root.endsWith('/')) return `${root}${rel}`
  return `${root}/${rel}`
}

function relFromRoot(root: string, absolute: string): string {
  if (absolute === root) return ''
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1)
  return absolute
}

export const filesProvider: MentionProvider = {
  id: 'files',
  label: 'Files',
  priority: 10,

  async search(query: string, ctx: MentionContext): Promise<MentionItem[]> {
    if (!ctx.workspaceRoot) return []

    const { prefix, leaf } = splitQuery(query)
    const dirAbs = joinPath(ctx.workspaceRoot, prefix.replace(/\/$/, ''))
    const entries = await getListing(dirAbs)

    const visible = entries.filter((e) => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))

    const scored = visible
      .map((e) => {
        const s = score(e.name, leaf)
        // Folders get a small ranking boost when leaf is empty or matches
        // them exactly — users drilling into directories first.
        const boost =
          e.type === 'dir' && (leaf === '' || e.name.toLowerCase() === leaf.toLowerCase())
            ? 0.05
            : 0
        return { e, score: s + boost }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)

    return scored.map(({ e, score: s }): MentionItem => {
      const abs = joinPath(dirAbs, e.name)
      const rel = relFromRoot(ctx.workspaceRoot, abs)
      if (e.type === 'dir') {
        return {
          id: `dir:${rel}`,
          kind: 'dir',
          icon: Folder,
          label: e.name,
          secondary: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'folder',
          score: s,
          payload: { relPath: rel, absPath: abs, isDir: true },
        }
      }
      return {
        id: `file:${rel}`,
        kind: 'file',
        icon: iconForFile(e.name),
        label: e.name,
        secondary: e.size || (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : undefined),
        score: s,
        payload: { relPath: rel, absPath: abs, isDir: false, size: e.size },
      }
    })
  },

  onSelect(item: MentionItem): MentionSelectResult {
    const payload = item.payload as { relPath: string; isDir: boolean; absPath: string }
    const marker = payload.isDir ? `[dir:${payload.relPath}]` : `[file:${payload.relPath}]`
    return {
      markerText: marker,
      snapshot: {
        relPath: payload.relPath,
        absPath: payload.absPath,
        name: item.label,
        kind: item.kind,
      },
    }
  },
}
