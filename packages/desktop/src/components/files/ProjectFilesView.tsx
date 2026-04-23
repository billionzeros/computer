import {
  ChevronRight,
  Eye,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Image,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'

interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
}

const HIDDEN_NAMES = new Set(['.DS_Store', '.anton.json', 'Thumbs.db', '.git'])

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
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'sql'])
const TEXT_EXTS = new Set(['md', 'txt', 'log', 'pdf', 'doc', 'docx'])
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

function getCategory(name: string): 'code' | 'data' | 'text' | 'image' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (CODE_EXTS.has(ext)) return 'code'
  if (DATA_EXTS.has(ext)) return 'data'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

function isPreviewable(name: string): boolean {
  const cat = getCategory(name)
  return cat !== 'other'
}

function isImageFile(name: string): boolean {
  return getCategory(name) === 'image'
}

function getMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mimes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return mimes[ext] || 'application/octet-stream'
}

function iconFor(entry: { name: string; type: 'file' | 'dir' | 'link' }) {
  if (entry.type === 'dir') return <Folder size={15} strokeWidth={1.5} />
  const cat = getCategory(entry.name)
  switch (cat) {
    case 'code':
      return <FileCode size={15} strokeWidth={1.5} />
    case 'data':
      return <FileSpreadsheet size={15} strokeWidth={1.5} />
    case 'text':
      return <FileText size={15} strokeWidth={1.5} />
    case 'image':
      return <Image size={15} strokeWidth={1.5} />
    default:
      return <File size={15} strokeWidth={1.5} />
  }
}

function kindLabel(entry: FileEntry): string {
  if (entry.type === 'dir') return 'Folder'
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  if (!ext) return 'File'
  const cat = getCategory(entry.name)
  return `${ext.toUpperCase()} ${cat === 'other' ? 'file' : cat}`
}

type SortKey = 'name' | 'kind' | 'size' | 'mod'

export function ProjectFilesView() {
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const initPhase = connectionStore((s) => s.initPhase)
  // Never guess at a startDir: an unknown workspacePath used to fall back to
  // `/root`, which EACCES on any non-root agent-server. Render an explicit
  // waiting state instead and don't dispatch fs_list until the real path lands.
  const startDir = activeProject?.workspacePath ?? null

  const [cwd, setCwd] = useState<string>(startDir ?? '')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(startDir !== null)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, _setShowHidden] = useState(false)
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Modals / overlays
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; path: string } | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Preview pane state
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewIsImage, setPreviewIsImage] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    if (!startDir) return []
    const rootLabel = activeProject?.name || 'Files'
    const crumbs: { label: string; path: string }[] = [{ label: rootLabel, path: startDir }]
    if (cwd !== startDir && cwd.startsWith(`${startDir}/`)) {
      const rel = cwd.slice(startDir.length + 1)
      const parts = rel.split('/').filter(Boolean)
      let acc = startDir
      for (const p of parts) {
        acc = `${acc}/${p}`
        crumbs.push({ label: p, path: acc })
      }
    } else if (cwd !== startDir) {
      // Fallback: outside start dir — use raw segments.
      const segs = cwd.split('/').filter(Boolean)
      let acc = ''
      for (const s of segs) {
        acc = `${acc}/${s}`
        crumbs.push({ label: s, path: acc })
      }
    }
    return crumbs
  }, [cwd, startDir, activeProject?.name])

  const listDir = useCallback(
    (path: string) => {
      setLoading(true)
      setError(null)
      setEntries([])
      setCwd(path)
      setSearch('')
      uiStore.getState().sendFilesystemList(path, showHidden)
    },
    [showHidden],
  )

  const refresh = useCallback(() => {
    if (!cwd) return
    setLoading(true)
    setError(null)
    uiStore.getState().sendFilesystemList(cwd, showHidden)
  }, [cwd, showHidden])

  useEffect(() => {
    const unsub = connection.onFilesystemResponse((newEntries, err) => {
      if (err) {
        setError(err)
        setLoading(false)
      } else {
        setEntries(newEntries)
        setLoading(false)
        setError(null)
      }
    })
    return unsub
  }, [])

  // Auto-refresh when a harness session (Codex, Claude Code) or Pi SDK
  // tool writes a file inside the currently-viewed directory. We track
  // the artifact count so a zustand subscription triggers exactly on
  // new additions (not on unrelated field updates to existing
  // artifacts, e.g. publish status).
  useEffect(() => {
    if (!cwd) return
    let prevCount = artifactStore.getState().artifacts.length
    const unsub = artifactStore.subscribe((state) => {
      const artifacts = state.artifacts
      if (artifacts.length <= prevCount) {
        prevCount = artifacts.length
        return
      }
      const newest = artifacts[artifacts.length - 1]
      prevCount = artifacts.length
      const fp = newest?.filepath
      if (!fp || typeof fp !== 'string') return
      // Refresh only if the new file lives inside the currently-viewed
      // directory (exact match, or direct child). Artifacts in unrelated
      // dirs won't be visible here anyway.
      if (fp === cwd || fp.startsWith(`${cwd}/`)) {
        uiStore.getState().sendFilesystemList(cwd, showHidden)
      }
    })
    return unsub
  }, [cwd, showHidden])

  useEffect(() => {
    const unsub = connection.onFilesystemReadResponse((_path, content, _trunc, err) => {
      if (err) {
        setPreviewError(err)
        setPreviewLoading(false)
      } else {
        setPreview(content)
        setPreviewLoading(false)
        setPreviewError(null)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = connection.onFilesystemMkdirResponse((_path, success, err) => {
      if (success) refresh()
      else setError(`Failed to create folder: ${err}`)
      setNewFolderOpen(false)
      setNewFolderName('')
    })
    return unsub
  }, [refresh])

  useEffect(() => {
    const unsub = connection.onFilesystemDeleteResponse((_path, success, err) => {
      if (success) refresh()
      else setError(`Failed to delete: ${err}`)
      setDeleteTarget(null)
    })
    return unsub
  }, [refresh])

  useEffect(() => {
    const unsub = connection.onFilesystemWriteResponse((_path, success, err) => {
      if (success) refresh()
      else setError(`Upload failed: ${err}`)
    })
    return unsub
  }, [refresh])

  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setError('No response — restart the agent server.')
          return false
        }
        return prev
      })
    }, 5000)
    return () => clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    if (startDir) listDir(startDir)
  }, [listDir, startDir])

  useEffect(() => {
    refresh()
  }, [refresh])

  const resolvePath = useCallback(
    (name: string) => (cwd === '/' ? `/${name}` : `${cwd}/${name}`),
    [cwd],
  )

  const visibleEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) filtered = filtered.filter((e) => !HIDDEN_NAMES.has(e.name))
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter((e) => e.name.toLowerCase().includes(q))
    }
    const sorted = [...filtered].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'kind':
          return kindLabel(a).localeCompare(kindLabel(b)) * dir
        case 'size':
          return (a.size || '').localeCompare(b.size || '') * dir
        case 'mod':
          return a.name.localeCompare(b.name) * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
    return sorted
  }, [entries, showHidden, search, sortKey, sortDir])

  const handleRowClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      listDir(resolvePath(entry.name))
      setSelected(null)
      return
    }
    setSelected(entry)
    if (isPreviewable(entry.name)) {
      const path = resolvePath(entry.name)
      const image = isImageFile(entry.name)
      setPreview(null)
      setPreviewLoading(true)
      setPreviewError(null)
      setPreviewIsImage(image)
      connection.sendFilesystemRead(path, image ? 'base64' : undefined)
    } else {
      setPreview(null)
      setPreviewLoading(false)
      setPreviewError(null)
      setPreviewIsImage(false)
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleNewFolder = () => {
    setNewFolderOpen(true)
    setNewFolderName('')
    setTimeout(() => newFolderInputRef.current?.focus(), 30)
  }

  const submitNewFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    connection.sendFilesystemMkdir(resolvePath(name))
  }

  const cancelNewFolder = () => {
    setNewFolderOpen(false)
    setNewFolderName('')
  }

  const handleDelete = () => {
    if (!selected) return
    setDeleteTarget({ name: selected.name, path: resolvePath(selected.name) })
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    connection.sendFilesystemDelete(deleteTarget.path)
    setSelected(null)
    setPreview(null)
  }

  const handleUpload = useCallback(
    (files: FileList) => {
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] || ''
          connection.sendFilesystemWrite(resolvePath(file.name), base64, 'base64')
        }
        reader.readAsDataURL(file)
      }
    },
    [resolvePath],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])
  const handleDragLeave = useCallback(() => setDragging(false), [])
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files)
    },
    [handleUpload],
  )

  const canGoUp = startDir !== null && cwd !== startDir
  // Treat "startDir changed but cwd hasn't caught up yet" as loading. This
  // closes the one-frame gap where `loading` is still false but cwd points
  // outside the new startDir tree (initial null→real, or project switch).
  // We explicitly allow subdirectories of startDir so that normal navigation
  // (e.g. into `${startDir}/subfolder`) doesn't keep the loader stuck on.
  const cwdWithinStartDir =
    startDir !== null && (cwd === startDir || cwd.startsWith(`${startDir}/`))
  const awaitingInitialFetch = startDir !== null && !cwdWithinStartDir
  const showLoader = loading || awaitingInitialFetch

  // Until the active project (and therefore its workspacePath) is known,
  // show an explicit waiting state rather than guessing a directory — a
  // guess like `/root` EACCES on any non-root agent-server.
  if (!startDir) {
    const stillSyncing = initPhase !== 'ready'
    return (
      <div className="fl-main">
        <div className="fl-empty">
          {stillSyncing ? (
            <>
              <Loader2 size={20} strokeWidth={1.5} className="spin" />
              <div style={{ marginTop: 10 }}>Loading projects…</div>
            </>
          ) : (
            <>
              <FolderOpen size={32} strokeWidth={1} />
              <div style={{ marginTop: 10 }}>Select a project to browse its files.</div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fl-main${dragging ? ' fl-main--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="fl-toolbar">
        <div className="fl-crumbs">
          <button
            type="button"
            className="fl-crumb"
            onClick={() => listDir(startDir)}
            aria-label="Home"
            title="Home"
          >
            <Home size={14} strokeWidth={1.5} />
          </button>
          {breadcrumbs.map((c, i) => {
            const isLast = i === breadcrumbs.length - 1
            return (
              <span
                key={`${c.path}-${i}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <ChevronRight size={12} strokeWidth={1.5} className="fl-crumb-sep" />
                {isLast ? (
                  <span className="fl-crumb-current">{c.label}</span>
                ) : (
                  <button type="button" className="fl-crumb-link" onClick={() => listDir(c.path)}>
                    {c.label}
                  </button>
                )}
              </span>
            )
          })}
        </div>

        <div className="fl-search">
          <Search size={13} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search files by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="fl-toolbar__actions">
          <button type="button" className="fl-btn" onClick={() => fileInputRef.current?.click()}>
            <Upload size={12} strokeWidth={1.5} />
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) handleUpload(e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" className="fl-btn" onClick={handleNewFolder}>
            <FolderPlus size={12} strokeWidth={1.5} />
            New folder
          </button>
        </div>
      </div>

      {/* Split: list + preview */}
      <div className="fl-split">
        <div className="fl-list-wrap">
          <div className="fl-colhead">
            <button
              type="button"
              className={`fl-colhead__col${sortKey === 'name' ? ' active' : ''}`}
              onClick={() => handleSort('name')}
            >
              Name
            </button>
            <button
              type="button"
              className={`fl-colhead__col${sortKey === 'kind' ? ' active' : ''}`}
              onClick={() => handleSort('kind')}
            >
              Kind
            </button>
            <button
              type="button"
              className={`fl-colhead__col fl-col-size${sortKey === 'size' ? ' active' : ''}`}
              onClick={() => handleSort('size')}
            >
              Size
            </button>
            <button
              type="button"
              className={`fl-colhead__col fl-col-mod${sortKey === 'mod' ? ' active' : ''}`}
              onClick={() => handleSort('mod')}
            >
              Modified
            </button>
          </div>

          <div className="fl-list">
            {showLoader && (
              <div className="fl-empty">
                <Loader2 size={20} strokeWidth={1.5} className="spin" />
              </div>
            )}
            {error && !showLoader && <div className="fl-empty">{error}</div>}

            {canGoUp && !showLoader && !error && (
              <button
                type="button"
                className="fl-row is-folder fl-row--parent"
                onClick={() => {
                  const parent = cwd.split('/').slice(0, -1).join('/') || '/'
                  listDir(parent)
                }}
              >
                <span className="fl-col-name">
                  <span className="fl-row__icon">
                    <Folder size={15} strokeWidth={1.5} />
                  </span>
                  <span className="fl-row__name">..</span>
                </span>
                <span className="fl-col-kind">Folder</span>
                <span className="fl-col-size">—</span>
                <span className="fl-col-mod">—</span>
              </button>
            )}

            {newFolderOpen && (
              <div className="fl-row is-folder">
                <span className="fl-col-name">
                  <span className="fl-row__icon">
                    <FolderPlus size={15} strokeWidth={1.5} />
                  </span>
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    value={newFolderName}
                    placeholder="Folder name…"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNewFolder()
                      if (e.key === 'Escape') cancelNewFolder()
                    }}
                    onBlur={() => {
                      if (!newFolderName.trim()) cancelNewFolder()
                    }}
                    style={{
                      background: 'transparent',
                      border: 0,
                      outline: 'none',
                      color: 'var(--text)',
                      font: 'inherit',
                      flex: 1,
                      minWidth: 0,
                    }}
                  />
                  <button
                    type="button"
                    className="fl-iconbtn"
                    onClick={cancelNewFolder}
                    aria-label="Cancel"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
                <span className="fl-col-kind">Folder</span>
                <span className="fl-col-size">—</span>
                <span className="fl-col-mod">—</span>
              </div>
            )}

            {!showLoader && !error && visibleEntries.length === 0 && !newFolderOpen && !canGoUp && (
              <div className="fl-empty">
                <FolderOpen size={32} strokeWidth={1} />
                <div style={{ marginTop: 10 }}>
                  {search ? 'No files match your search.' : 'This folder is empty.'}
                </div>
              </div>
            )}

            {visibleEntries.map((entry) => {
              const isSelected = selected?.name === entry.name && entry.type === 'file'
              const isFolder = entry.type === 'dir'
              return (
                <button
                  type="button"
                  key={entry.name}
                  className={`fl-row${isFolder ? ' is-folder' : ''}${isSelected ? ' selected' : ''}`}
                  onClick={() => handleRowClick(entry)}
                >
                  <span className="fl-col-name">
                    <span className="fl-row__icon">{iconFor(entry)}</span>
                    <span className="fl-row__name">{entry.name}</span>
                    {isFolder && (
                      <ChevronRight size={12} strokeWidth={1.5} className="fl-row__chev" />
                    )}
                  </span>
                  <span className="fl-col-kind">{kindLabel(entry)}</span>
                  <span className="fl-col-size">{entry.size || '—'}</span>
                  <span className="fl-col-mod">—</span>
                </button>
              )
            })}
          </div>

          <div className="fl-statusbar">
            <span>
              {visibleEntries.length} item{visibleEntries.length === 1 ? '' : 's'}
            </span>
            {search && (
              <>
                <span className="fl-statusbar__sep">·</span>
                <span>filter: "{search}"</span>
              </>
            )}
            <span className="fl-statusbar__spacer" />
            <span>{cwd}</span>
          </div>
        </div>

        {/* Preview pane */}
        <aside className="fl-preview">
          {!selected ? (
            <div className="fl-preview__empty">
              <Eye size={20} strokeWidth={1.2} />
              <div style={{ marginTop: 10 }}>Select a file to preview.</div>
            </div>
          ) : (
            <>
              <div className="fl-preview__thumb">
                {previewLoading ? (
                  <Loader2 size={20} strokeWidth={1.5} className="spin" />
                ) : previewError ? (
                  <div
                    style={{
                      color: 'var(--danger)',
                      fontSize: 12,
                      textAlign: 'center',
                      padding: 20,
                    }}
                  >
                    {previewError}
                  </div>
                ) : preview !== null ? (
                  previewIsImage ? (
                    <img
                      src={`data:${getMimeType(selected.name)};base64,${preview}`}
                      alt={selected.name}
                      style={{
                        maxWidth: '100%',
                        maxHeight: 260,
                        objectFit: 'contain',
                        borderRadius: 6,
                      }}
                    />
                  ) : (
                    <pre
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        lineHeight: 1.5,
                        color: 'var(--text-3)',
                        maxHeight: 260,
                        overflow: 'hidden',
                        width: '100%',
                        margin: 0,
                        whiteSpace: 'pre',
                      }}
                    >
                      {preview.slice(0, 2000)}
                    </pre>
                  )
                ) : (
                  iconFor(selected)
                )}
              </div>
              <div className="fl-preview__info">
                <div className="fl-preview__name">{selected.name}</div>
                <div className="fl-preview__kind">
                  {iconFor(selected)}
                  <span>{kindLabel(selected)}</span>
                  {selected.size && (
                    <>
                      <span className="fl-preview__sep">·</span>
                      <span>{selected.size}</span>
                    </>
                  )}
                </div>
                <dl className="fl-preview__meta">
                  <dt>Path</dt>
                  <dd>{resolvePath(selected.name)}</dd>
                </dl>
                <div className="fl-preview__actions">
                  {isPreviewable(selected.name) && (
                    <button
                      type="button"
                      className="fl-btn"
                      onClick={() => handleRowClick(selected)}
                    >
                      <Eye size={12} strokeWidth={1.5} />
                      Reload preview
                    </button>
                  )}
                  <button type="button" className="fl-btn" onClick={handleDelete}>
                    <Trash2 size={12} strokeWidth={1.5} />
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {dragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            border: '2px dashed var(--accent)',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            color: 'var(--accent)',
            fontSize: 14,
            fontWeight: 500,
            zIndex: 50,
          }}
        >
          <Upload size={24} strokeWidth={1.5} />
          <span>Drop to upload</span>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteTarget(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeleteTarget(null)
          }}
        >
          <div
            className="modal-card modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="modal-card__body">
              <h3>Delete &ldquo;{deleteTarget.name}&rdquo;?</h3>
              <p style={{ color: 'var(--text-3)', marginTop: 8 }}>
                This will permanently remove it from your project.
              </p>
            </div>
            <div className="modal-card__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button type="button" className="button button--danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
