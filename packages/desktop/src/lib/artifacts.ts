import type { ChatMessage } from './store.js'

// ── Types ───────────────────────────────────────────────────────────

export type ArtifactRenderType =
  | 'code'
  | 'markdown'
  | 'html'
  | 'svg'
  | 'mermaid'
  | 'docx'
  | 'xlsx'
  | 'pdf'
  | 'image'

/** Render types whose content is binary and must be fetched via sourcePath. */
export const BINARY_RENDER_TYPES: ReadonlySet<ArtifactRenderType> = new Set([
  'docx',
  'xlsx',
  'pdf',
  'image',
])

export function isBinaryRenderType(t: ArtifactRenderType): boolean {
  return BINARY_RENDER_TYPES.has(t)
}

export interface Artifact {
  id: string
  type: 'file' | 'output' | 'artifact'
  renderType: ArtifactRenderType
  title?: string
  filename?: string
  filepath?: string
  language: string
  /** Text content for string-backed artifacts. Empty for binary kinds. */
  content: string
  toolCallId: string
  timestamp: number
  /** Set when artifact has been published to a public URL */
  publishedUrl?: string
  publishedSlug?: string
  publishedAt?: number
  /** Conversation this artifact belongs to */
  conversationId?: string
  /** Project this artifact belongs to */
  projectId?: string
  /** Origin of the artifact. Defaults to 'agent' when omitted. */
  source?: 'agent' | 'upload'
  /** Workspace-relative path for binary/upload artifacts. Fetched lazily via fs_read_bytes. */
  sourcePath?: string
  /** MIME type for binary artifacts (sniffed server-side where possible). */
  mimeType?: string
}

const TYPE_LABELS: Record<ArtifactRenderType, string> = {
  html: 'HTML',
  code: 'Code',
  markdown: 'Markdown',
  svg: 'SVG',
  mermaid: 'Diagram',
  docx: 'Document',
  xlsx: 'Spreadsheet',
  pdf: 'PDF',
  image: 'Image',
}

const TYPE_EXTENSIONS: Record<ArtifactRenderType, string> = {
  html: 'html',
  code: 'txt',
  markdown: 'md',
  svg: 'svg',
  mermaid: 'md',
  docx: 'docx',
  xlsx: 'xlsx',
  pdf: 'pdf',
  image: 'png',
}

export function getArtifactTypeLabel(renderType: ArtifactRenderType): string {
  return TYPE_LABELS[renderType] || renderType
}

export function getArtifactFileExtension(
  renderType: ArtifactRenderType,
  language?: string,
): string {
  if (renderType === 'code' && language) {
    // Reverse lookup from EXT_MAP
    for (const [ext, lang] of Object.entries(EXT_MAP)) {
      if (lang === language) return ext
    }
  }
  return TYPE_EXTENSIONS[renderType] || 'txt'
}

// ── Language detection ──────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  md: 'markdown',
  mdx: 'markdown',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  env: 'text',
  txt: 'text',
  csv: 'text',
  svg: 'xml',
  vue: 'vue',
  svelte: 'svelte',
}

export function getLanguageFromPath(path: string): string {
  const filename = path.split('/').pop() || ''
  const lower = filename.toLowerCase()

  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'

  const ext = lower.split('.').pop() || ''
  return EXT_MAP[ext] || 'text'
}

/** Map language to render type for file writes */
function languageToRenderType(language: string): ArtifactRenderType {
  if (language === 'markdown') return 'markdown'
  if (language === 'html') return 'html'
  return 'code'
}

// ── MIME classification ─────────────────────────────────────────────

/** Map MIME types to their canonical artifact render type.
 *  Intended for classifying user-uploaded files. Returns null when unknown
 *  so callers can fall back to path-extension inspection or 'code'. */
export function classifyMime(mime: string | undefined): ArtifactRenderType | null {
  if (!mime) return null
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? ''

  // Documents
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/msword'
  ) {
    return 'docx'
  }

  // Spreadsheets
  if (
    m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    m === 'application/vnd.ms-excel'
  ) {
    return 'xlsx'
  }

  if (m === 'application/pdf') return 'pdf'

  if (m.startsWith('image/')) {
    // SVG is XML and already has a render path; keep it on the text side.
    if (m === 'image/svg+xml') return 'svg'
    return 'image'
  }

  if (m === 'text/markdown' || m === 'text/x-markdown') return 'markdown'
  if (m === 'text/html') return 'html'
  if (m === 'text/csv' || m === 'text/tab-separated-values') return 'code'
  if (m.startsWith('text/')) return 'code'

  if (m === 'application/json' || m === 'application/xml') return 'code'

  return null
}

/** Known file-extension fallback for mime classification (used when MIME is
 *  missing or generic, e.g., application/octet-stream). */
export function classifyPathExtension(path: string): ArtifactRenderType | null {
  const lower = path.toLowerCase()
  const ext = lower.split('.').pop() ?? ''
  switch (ext) {
    case 'docx':
    case 'doc':
      return 'docx'
    case 'xlsx':
    case 'xls':
      return 'xlsx'
    case 'pdf':
      return 'pdf'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'avif':
    case 'bmp':
    case 'ico':
    case 'heic':
    case 'heif':
      return 'image'
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'html':
    case 'htm':
      return 'html'
    case 'svg':
      return 'svg'
    case 'csv':
    case 'tsv':
    case 'json':
    case 'txt':
    case 'log':
      return 'code'
    default:
      return null
  }
}

/** Combined classifier: MIME first, then path extension. */
export function classifyUpload(mime: string | undefined, path: string): ArtifactRenderType | null {
  return classifyMime(mime) ?? classifyPathExtension(path)
}

// ── Artifact extraction ─────────────────────────────────────────────

export function extractArtifact(
  toolCallMsg: ChatMessage,
  _toolResultMsg: ChatMessage,
): Artifact | null {
  const toolName = toolCallMsg.toolName
  const toolInput = toolCallMsg.toolInput

  if (!toolName || !toolInput) return null

  // Explicit artifact tool calls
  if (toolName === 'artifact') {
    const artifactType = (toolInput.type as string) || 'code'
    const language =
      artifactType === 'code' ? (toolInput.language as string) || 'text' : artifactType

    return {
      id: `artifact_${toolCallMsg.id}_${Date.now()}`,
      type: 'artifact',
      renderType: artifactType as ArtifactRenderType,
      title: toolInput.title as string,
      filename: toolInput.filename as string | undefined,
      filepath: toolInput.filename as string | undefined,
      language,
      content: toolInput.content as string,
      toolCallId: toolCallMsg.id,
      timestamp: Date.now(),
    }
  }

  // File writes
  if (toolName === 'filesystem' && toolInput.operation === 'write' && toolInput.content) {
    const filepath = toolInput.path as string
    const filename = filepath?.split('/').pop() || 'untitled'
    const language = getLanguageFromPath(filepath || '')

    return {
      id: `artifact_${toolCallMsg.id}_${Date.now()}`,
      type: 'file',
      renderType: languageToRenderType(language),
      filename,
      filepath,
      language,
      content: toolInput.content as string,
      toolCallId: toolCallMsg.id,
      timestamp: Date.now(),
    }
  }

  // Shell command outputs are surfaced inline as expandable tool-call chips,
  // not as artifacts — promoting every long stdout into a pinned "Code" card
  // (e.g. `pip install …`, `python3 -c "…"`) is noisy and conflates terminal
  // runs with first-class agent outputs.

  return null
}
