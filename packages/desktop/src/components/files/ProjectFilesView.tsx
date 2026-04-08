import {
  ChevronRight,
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
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const listDir = useCallback((path: string) => {
    setLoading(true)
    setError(null)
    setEntries([])
    setCwd(path)
    setSearch('')
    uiStore.getState().sendFilesystemList(path)
  }, [])

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
    listDir(startDir)
  }, [listDir, startDir])

  // Filter, search, sort
  const visibleEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) {
      filtered = filtered.filter((e) => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))
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

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      listDir(cwd === '/' ? `/${entry.name}` : `${cwd}/${entry.name}`)
    }
  }

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
          setTimeout(() => listDir(cwd), 500)
        }
        reader.readAsDataURL(file)
      }
    },
    [activeProjectId, cwd, listDir],
  )

  const handleDelete = useCallback(
    (filename: string) => {
      if (!activeProjectId) return
      projectStore.getState().deleteProjectFile(activeProjectId, filename)
      setDeleteTarget(null)
      setTimeout(() => listDir(cwd), 300)
    },
    [activeProjectId, cwd, listDir],
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
            <button type="button" className="fv-bar__btn">
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

          {visibleEntries.map((entry) => (
            <button
              type="button"
              key={entry.name}
              className={`fv-row${entry.type === 'dir' ? ' fv-row--dir' : ''}`}
              onClick={() => handleEntryClick(entry)}
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
              {entry.type === 'file' && (
                <button
                  type="button"
                  className="fv-row__delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(entry.name)
                  }}
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                </button>
              )}
            </button>
          ))}
        </div>
      </div>

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
              <h3>Delete &ldquo;{deleteTarget}&rdquo;?</h3>
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
              <button
                type="button"
                className="button button--danger"
                onClick={() => handleDelete(deleteTarget)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
