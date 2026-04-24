/**
 * Upload default-folder strategy + recent-folder memory.
 *
 * When the DestinationPicker opens, we want a sensible starting folder
 * so the user hits Enter and gets their file somewhere reasonable.
 *
 * Priority:
 *   1. Most recently used folder for this project + mime family
 *   2. Mime-family default (xlsx → data/, pdf → references/, etc.)
 *   3. Project root
 *
 * Folders are stored workspace-relative (no leading `/`) so the same
 * memory works if the user renames / moves the project.
 */

export type MimeFamily = 'data' | 'document' | 'pdf' | 'image' | 'text' | 'other'

const DATA_EXTS = new Set(['xlsx', 'xls', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml'])
const DOCUMENT_EXTS = new Set(['docx', 'doc', 'rtf', 'odt'])
const PDF_EXTS = new Set(['pdf'])
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'bmp',
  'heic',
  'heif',
])
const TEXT_EXTS = new Set(['txt', 'md', 'mdx', 'log'])

function extFromFilename(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? ''
}

/** Classify a file by its MIME type or filename into a coarse family. */
export function classifyMimeFamily(mime: string | undefined, filename: string): MimeFamily {
  if (mime) {
    const m = mime.toLowerCase()
    if (m === 'application/pdf') return 'pdf'
    if (m.startsWith('image/')) return 'image'
    if (
      m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      m === 'application/msword' ||
      m === 'application/rtf'
    )
      return 'document'
    if (
      m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      m === 'application/vnd.ms-excel' ||
      m === 'text/csv' ||
      m === 'text/tab-separated-values' ||
      m === 'application/json'
    )
      return 'data'
    if (m === 'text/markdown' || m === 'text/x-markdown' || m === 'text/plain') return 'text'
  }

  const ext = extFromFilename(filename)
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DOCUMENT_EXTS.has(ext)) return 'document'
  if (DATA_EXTS.has(ext)) return 'data'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

/** Hard-coded per-family default folder. Workspace-relative. */
export function mimeFamilyDefaultFolder(family: MimeFamily): string {
  switch (family) {
    case 'data':
      return 'data'
    case 'document':
      return 'documents'
    case 'pdf':
      return 'references'
    case 'image':
      return 'images'
    case 'text':
      return 'notes'
    default:
      return '' // root
  }
}

// ── Recent-folder memory ─────────────────────────────────────────────

const KEY_PREFIX = 'anton.recentUploadFolder.v1'

function storageKey(projectId: string, family: MimeFamily): string {
  return `${KEY_PREFIX}.${projectId}.${family}`
}

/** Read the most recently used folder for this project + mime family.
 *  Returned value is workspace-relative, or null if none recorded. */
export function getRecentUploadFolder(
  projectId: string | undefined,
  family: MimeFamily,
): string | null {
  if (!projectId) return null
  try {
    return localStorage.getItem(storageKey(projectId, family))
  } catch {
    return null
  }
}

/** Persist the folder a successful upload just landed in. */
export function saveRecentUploadFolder(
  projectId: string | undefined,
  family: MimeFamily,
  relFolder: string,
): void {
  if (!projectId) return
  try {
    localStorage.setItem(storageKey(projectId, family), relFolder)
  } catch {
    /* storage quota / incognito: silently skip */
  }
}

/**
 * Resolve the best starting folder given project + files being uploaded.
 * If the batch contains mixed families, falls back to 'other' — no
 * speculative multi-folder hopping, just a sane single default.
 */
export function resolveInitialFolder(
  projectId: string | undefined,
  files: { mime?: string; name: string }[],
): { folderRelPath: string; family: MimeFamily } {
  if (files.length === 0) return { folderRelPath: '', family: 'other' }
  const families = new Set(files.map((f) => classifyMimeFamily(f.mime, f.name)))
  const family: MimeFamily = families.size === 1 ? [...families][0]! : 'other'
  const recent = getRecentUploadFolder(projectId, family)
  if (recent !== null) return { folderRelPath: recent, family }
  return { folderRelPath: mimeFamilyDefaultFolder(family), family }
}
