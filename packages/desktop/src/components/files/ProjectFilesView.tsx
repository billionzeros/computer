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
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
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
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'])

function getCategory(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (CODE_EXTS.has(ext)) return 'code'
  if (DATA_EXTS.has(ext)) return 'data'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return CODE_EXTS.has(ext) || DATA_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === 'svg'
}

function getFileIcon(entry: FileEntry) {
  if (entry.type === 'dir') return <Folder size={18} strokeWidth={1.5} />
  const cat = getCategory(entry.name)
  switch (cat) {
    case 'code':
      return <FileCode size={18} strokeWidth={1.5} />
    case 'data':
      return <FileSpreadsheet size={18} strokeWidth={1.5} />
    case 'text':
      return <FileText size={18} strokeWidth={1.5} />
    case 'image':
      return <Image size={18} strokeWidth={1.5} />
    default:
      return <File size={18} strokeWidth={1.5} />
  }
}

export function ProjectFilesView() {
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const startDir = activeProject?.workspacePath || '/root'

  const [cwd, setCwd] = useState(startDir)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)

  // Modals / overlays
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; path: string } | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // File viewer
  const [viewingFile, setViewingFile] = useState<{ name: string; path: string } | null>(null)
  const [viewContent, setViewContent] = useState<string | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    entry: FileEntry
    x: number
    y: number
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    const label = activeProject?.name || 'Files'
    if (cwd === startDir) return [{ label, path: startDir }]
    if (cwd.startsWith(`${startDir}/`)) {
      const rel = cwd.slice(startDir.length + 1)
      const parts = rel.split('/').filter(Boolean)
      const crumbs = [{ label, path: startDir }]
      let acc = startDir
      for (const p of parts) {
        acc = `${acc}/${p}`
        crumbs.push({ label: p, path: acc })
      }
      return crumbs
    }
    const segs = cwd.split('/').filter(Boolean)
    const crumbs = [{ label: '/', path: '/' }]
    let acc = ''
    for (const s of segs) {
      acc = `${acc}/${s}`
      crumbs.push({ label: s, path: acc })
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
      setContextMenu(null)
      uiStore.getState().sendFilesystemList(path, showHidden)
    },
    [showHidden],
  )

  // Re-list current dir (e.g. after create/delete)
  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    uiStore.getState().sendFilesystemList(cwd, showHidden)
  }, [cwd, showHidden])

  // Listen for fs_list responses
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

  // Listen for fs_read (file viewer)
  useEffect(() => {
    const unsub = connection.onFilesystemReadResponse((_path, content, _trunc, err) => {
      if (err) {
        setViewError(err)
        setViewLoading(false)
      } else {
        setViewContent(content)
        setViewLoading(false)
        setViewError(null)
      }
    })
    return unsub
  }, [])

  // Listen for mkdir response
  useEffect(() => {
    const unsub = connection.onFilesystemMkdirResponse((_path, success, err) => {
      if (success) {
        refresh()
      } else {
        setError(`Failed to create folder: ${err}`)
      }
      setNewFolderOpen(false)
      setNewFolderName('')
    })
    return unsub
  }, [refresh])

  // Listen for delete response
  useEffect(() => {
    const unsub = connection.onFilesystemDeleteResponse((_path, success, err) => {
      if (success) {
        refresh()
      } else {
        setError(`Failed to delete: ${err}`)
      }
      setDeleteTarget(null)
    })
    return unsub
  }, [refresh])

  // Timeout
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

  // Load on mount / project switch
  useEffect(() => {
    listDir(startDir)
  }, [listDir, startDir])

  // Re-fetch when showHidden changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  // Filter, search, sort
  const visibleEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) {
      filtered = filtered.filter((e) => !HIDDEN_NAMES.has(e.name))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter((e) => e.name.toLowerCase().includes(q))
    }
    return [...filtered].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.name.localeCompare(b.name)
    })
  }, [entries, showHidden, search])

  const resolvePath = (name: string) => (cwd === '/' ? `/${name}` : `${cwd}/${name}`)

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      listDir(resolvePath(entry.name))
    } else {
      // Open file viewer
      openFileViewer(entry)
    }
  }

  const openFileViewer = (entry: FileEntry) => {
    const path = resolvePath(entry.name)
    if (isPreviewable(entry.name)) {
      setViewingFile({ name: entry.name, path })
      setViewContent(null)
      setViewLoading(true)
      setViewError(null)
      connection.sendFilesystemRead(path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ entry, x: e.clientX, y: e.clientY })
  }

  // New Folder
  const handleNewFolder = () => {
    setNewFolderOpen(true)
    setNewFolderName('')
    setTimeout(() => newFolderInputRef.current?.focus(), 50)
  }

  const submitNewFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    const path = resolvePath(name)
    connection.sendFilesystemMkdir(path)
  }

  // Delete (uses FILESYNC fs_delete for absolute path)
  const handleDelete = (name: string) => {
    const path = resolvePath(name)
    setDeleteTarget({ name, path })
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    connection.sendFilesystemDelete(deleteTarget.path)
  }

  // Upload
  const handleUpload = useCallback(
    (files: FileList) => {
      if (!activeProjectId) return
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] || ''
          projectStore
            .getState()
            .uploadProjectFile(
              activeProjectId,
              file.name,
              base64,
              file.type || 'application/octet-stream',
              file.size,
            )
          setTimeout(() => refresh(), 500)
        }
        reader.readAsDataURL(file)
      }
    },
    [activeProjectId, refresh],
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

  const canGoUp = cwd !== startDir

  return (
    <div
      className={`fv${dragging ? ' fv--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="fv-inner">
        {/* Breadcrumb bar */}
        <div className="fv-bar">
          <div className="fv-crumbs">
            <button type="button" className="fv-crumbs__home" onClick={() => listDir(startDir)}>
              <Home size={14} strokeWidth={1.8} />
            </button>
            {breadcrumbs.map((crumb, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb segments can share names
              <span key={`${crumb.path}-${i}`} className="fv-crumbs__item">
                <ChevronRight size={13} strokeWidth={1.8} className="fv-crumbs__sep" />
                <button
                  type="button"
                  className={`fv-crumbs__btn${i === breadcrumbs.length - 1 ? ' fv-crumbs__btn--active' : ''}`}
                  onClick={() => listDir(crumb.path)}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>

          <div className="fv-bar__actions">
            <span className="fv-bar__label">Show hidden</span>
            <button
              type="button"
              className={`fv-toggle${showHidden ? ' fv-toggle--on' : ''}`}
              onClick={() => setShowHidden(!showHidden)}
            >
              <span className="fv-toggle__thumb" />
            </button>
            <button
              type="button"
              className="fv-bar__btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} strokeWidth={1.8} />
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
            <button type="button" className="fv-bar__btn" onClick={handleNewFolder}>
              <FolderPlus size={14} strokeWidth={1.8} />
              New Folder
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="fv-search">
          <Search size={15} strokeWidth={1.8} className="fv-search__icon" />
          <input
            type="text"
            className="fv-search__input"
            placeholder="Search files by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* File list */}
        <div className="fv-list">
          {loading && (
            <div className="fv-empty">
              <Loader2 size={24} strokeWidth={1.5} className="spin" />
            </div>
          )}

          {error && (
            <div className="fv-empty">
              <p className="fv-empty__error">{error}</p>
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="fv-empty">
              <FolderOpen size={40} strokeWidth={0.8} />
              <p>{search ? 'No files match your search' : 'This folder is empty'}</p>
            </div>
          )}

          {/* Go up row */}
          {canGoUp && !loading && (
            <button
              type="button"
              className="fv-row fv-row--dir fv-row--parent"
              onClick={() => {
                const parent = cwd.split('/').slice(0, -1).join('/') || '/'
                listDir(parent)
              }}
            >
              <span className="fv-row__icon fv-row__icon--dir">
                <Folder size={18} strokeWidth={1.5} />
              </span>
              <span className="fv-row__name fv-row__name--muted">..</span>
            </button>
          )}

          {visibleEntries.map((entry) => (
            <button
              type="button"
              key={entry.name}
              className={`fv-row${entry.type === 'dir' ? ' fv-row--dir' : ''}`}
              onClick={() => handleEntryClick(entry)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              <span
                className={`fv-row__icon fv-row__icon--${entry.type === 'dir' ? 'dir' : getCategory(entry.name)}`}
              >
                {getFileIcon(entry)}
              </span>
              <span className="fv-row__name">{entry.name}</span>
              {entry.type === 'file' && entry.size && (
                <span className="fv-row__size">{entry.size}</span>
              )}
              {entry.type === 'dir' && (
                <ChevronRight size={14} strokeWidth={1.5} className="fv-row__chevron" />
              )}
              <button
                type="button"
                className="fv-row__more"
                onClick={(e) => {
                  e.stopPropagation()
                  handleContextMenu(e, entry)
                }}
              >
                <MoreHorizontal size={15} strokeWidth={1.5} />
              </button>
            </button>
          ))}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fv-ctx" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.entry.type === 'file' && isPreviewable(contextMenu.entry.name) && (
            <button
              type="button"
              className="fv-ctx__item"
              onClick={() => {
                openFileViewer(contextMenu.entry)
                setContextMenu(null)
              }}
            >
              <Eye size={14} strokeWidth={1.5} />
              View
            </button>
          )}
          {contextMenu.entry.type === 'dir' && (
            <button
              type="button"
              className="fv-ctx__item"
              onClick={() => {
                listDir(resolvePath(contextMenu.entry.name))
                setContextMenu(null)
              }}
            >
              <FolderOpen size={14} strokeWidth={1.5} />
              Open
            </button>
          )}
          <button
            type="button"
            className="fv-ctx__item fv-ctx__item--danger"
            onClick={() => {
              handleDelete(contextMenu.entry.name)
              setContextMenu(null)
            }}
          >
            <Trash2 size={14} strokeWidth={1.5} />
            Delete
          </button>
        </div>
      )}

      {/* File viewer modal */}
      {viewingFile && (
        <div
          className="modal-overlay"
          onClick={() => setViewingFile(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setViewingFile(null)
          }}
        >
          <div
            className="fv-viewer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="fv-viewer__header">
              <span className="fv-viewer__title">{viewingFile.name}</span>
              <button
                type="button"
                className="fv-viewer__close"
                onClick={() => setViewingFile(null)}
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
            <div className="fv-viewer__body">
              {viewLoading && (
                <div className="fv-viewer__status">
                  <Loader2 size={20} strokeWidth={1.5} className="spin" />
                </div>
              )}
              {viewError && (
                <div className="fv-viewer__status fv-viewer__status--error">{viewError}</div>
              )}
              {!viewLoading && !viewError && viewContent !== null && (
                <pre className="fv-viewer__code">{viewContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Folder modal */}
      {newFolderOpen && (
        <div
          className="modal-overlay"
          onClick={() => setNewFolderOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setNewFolderOpen(false)
          }}
        >
          <div
            className="modal-card modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewFolder()
              e.stopPropagation()
            }}
          >
            <div className="modal-card__body">
              <h3>New Folder</h3>
              <input
                ref={newFolderInputRef}
                type="text"
                className="fv-search__input"
                style={{ marginTop: '12px' }}
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
            </div>
            <div className="modal-card__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setNewFolderOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={submitNewFolder}
                disabled={!newFolderName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {dragging && (
        <div className="fv-drop">
          <Upload size={24} strokeWidth={1.5} />
          <span>Drop to upload</span>
        </div>
      )}

      {/* Delete confirmation */}
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
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
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
