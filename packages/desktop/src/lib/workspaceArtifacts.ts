import { classifyUpload, getLanguageFromPath } from './artifacts.js'
import { useStore } from './store.js'
import { artifactStore } from './store/artifactStore.js'
import { projectStore } from './store/projectStore.js'
import { uiStore } from './store/uiStore.js'

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const KNOWN_EXTENSIONLESS_FILES = new Set(['dockerfile', 'makefile'])

export function fileBasename(path: string): string {
  const clean = stripQueryAndHash(path).replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

function stripQueryAndHash(path: string): string {
  const query = path.indexOf('?')
  const hash = path.indexOf('#')
  const endCandidates = [query, hash].filter((idx) => idx >= 0)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : path.length
  return path.slice(0, end)
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function activeWorkspaceRoot(): string | null {
  const state = projectStore.getState()
  const active = state.projects.find((p) => p.id === state.activeProjectId)
  return active?.workspacePath ?? null
}

function resolveWorkspacePath(path: string): string | null {
  if (!path) return null
  if (path.startsWith('/')) return path

  const root = activeWorkspaceRoot()
  if (!root) return path

  const trimmed = path.replace(/^\.\//, '')
  return `${root.replace(/\/$/, '')}/${trimmed}`
}

function hasFileSignal(path: string): boolean {
  const name = fileBasename(path).toLowerCase()
  if (!name || name === '.' || name === '..') return false
  return name.includes('.') || KNOWN_EXTENSIONLESS_FILES.has(name)
}

/**
 * Convert a markdown href into a local filesystem path when it clearly
 * references a file. HTTP(S), mailto, anchors, and generic app routes stay
 * as normal links.
 */
export function workspacePathFromHref(
  href: string | undefined,
  opts: { allowUnknownExtension?: boolean } = {},
): string | null {
  if (!href) return null
  const raw = href.trim()
  if (!raw || raw.startsWith('#')) return null

  let path = raw
  if (raw.startsWith('file://')) {
    try {
      path = new URL(raw).pathname
    } catch {
      return null
    }
  } else if (SCHEME_RE.test(raw)) {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(raw, window.location.href)
      if (url.origin !== window.location.origin) return null
      path = `${url.pathname}${url.search}${url.hash}`
    } catch {
      return null
    }
  }

  path = safeDecodeUriComponent(stripQueryAndHash(path))
  if (!path || path.endsWith('/')) return null
  if (!opts.allowUnknownExtension && !hasFileSignal(path)) return null

  return resolveWorkspacePath(path)
}

export function openWorkspaceFileArtifact(
  hrefOrPath: string,
  opts: {
    filename?: string
    allowUnknownExtension?: boolean
    source?: 'agent' | 'upload'
  } = {},
): boolean {
  const absPath = workspacePathFromHref(hrefOrPath, opts)
  if (!absPath) return false

  const filename = opts.filename || fileBasename(absPath) || absPath
  const renderType = classifyUpload(undefined, absPath) ?? 'code'
  const id = `workspace-file:${absPath}`
  const store = useStore.getState()
  const activeConversation = store.getActiveConversation()
  const conversationId = activeConversation?.sessionId ?? store.activeConversationId ?? undefined
  const projectId = projectStore.getState().activeProjectId ?? undefined

  artifactStore.getState().addArtifact({
    id,
    type: 'file',
    source: opts.source ?? 'agent',
    renderType,
    filename,
    filepath: absPath,
    sourcePath: absPath,
    language: getLanguageFromPath(absPath),
    content: '',
    toolCallId: id,
    timestamp: Date.now(),
    conversationId,
    projectId,
  })
  uiStore.getState().setSidePanelView('artifacts')
  artifactStore.getState().setArtifactPanelOpen(true)
  artifactStore.getState().setActiveArtifact(id)
  return true
}
