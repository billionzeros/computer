import {
  ChevronRight,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  Image,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { FilePreview } from './FilePreview.js'

interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
}

// Hidden entries to filter out by default
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
  if (entry.type === 'dir') return <Folder size={16} strokeWidth={1.5} />
  const cat = getCategory(entry.name)
  switch (cat) {
    case 'code':
      return <FileCode size={16} strokeWidth={1.5} />
    case 'data':
      return <FileSpreadsheet size={16} strokeWidth={1.5} />
    case 'text':
      return <FileText size={16} strokeWidth={1.5} />
    case 'image':
      return <Image size={16} strokeWidth={1.5} />
    default:
      return <File size={16} strokeWidth={1.5} />
  }
}

function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return CODE_EXTS.has(ext) || DATA_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === 'svg'
}

export function ProjectFilesView() {
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const startDir = activeProject?.workspacePath || '/root'

  // Navigation
  const [cwd, setCwd] = useState(startDir)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const expectedPathRef = useRef(startDir)

  // Selection & preview
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Upload & delete
  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Breadcrumb parts
  const pathParts = useMemo(() => {
    const projectLabel = activeProject?.name || 'Project'
    if (cwd === startDir) return [projectLabel]
    if (cwd.startsWith(`${startDir}/`)) {
      const rel = cwd.slice(startDir.length + 1)
      return [projectLabel, ...rel.split('/').filter(Boolean)]
    }
    return cwd === '/' ? ['/'] : ['/', ...cwd.split('/').filter(Boolean)]
  }, [cwd, startDir, activeProject?.name])

  // List a directory
  const listDir = useCallback((path: string) => {
    setLoading(true)
    setError(null)
    setEntries([])
    setCwd(path)
    setSelected(null)
    setPreviewContent(null)
    expectedPathRef.current = path
    uiStore.getState().sendFilesystemList(path)
  }, [])

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

  // Listen for fs_read responses (preview)
  useEffect(() => {
    const unsub = connection.onFilesystemReadResponse((_path, content, _trunc, err) => {
      if (err) {
        setPreviewError(err)
        setPreviewLoading(false)
      } else {
        setPreviewContent(content)
        setPreviewLoading(false)
        setPreviewError(null)
      }
    })
    return unsub
  }, [])

  // Timeout for loading
  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setError('No response — restart the agent server to enable file browsing.')
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

  // Filter & sort entries
  const visibleEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) {
      filtered = filtered.filter((e) => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))
    }
    return filtered.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.name.localeCompare(b.name)
    })
  }, [entries, showHidden])

  const navigateToBreadcrumb = (index: number) => {
    if (index === 0) {
      listDir(pathParts[0] === '/' ? '/' : startDir)
    } else {
      const isAbsRoot = pathParts[0] === '/'
      const base = isAbsRoot ? '' : startDir
      const path = `${base}/${pathParts.slice(1, index + 1).join('/')}`
      listDir(path)
    }
  }

  const handleEntryClick = (entry: FileEntry) => {
    setSelected(entry)
    // Load preview for text-based files
    if (entry.type === 'file' && isPreviewable(entry.name)) {
      const filePath = cwd === '/' ? `/${entry.name}` : `${cwd}/${entry.name}`
      setPreviewLoading(true)
      setPreviewContent(null)
      setPreviewError(null)
      connection.sendFilesystemRead(filePath)
    } else {
      setPreviewContent(null)
      setPreviewLoading(false)
      setPreviewError(null)
    }
  }

  const handleEntryDoubleClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      const newPath = cwd === '/' ? `/${entry.name}` : `${cwd}/${entry.name}`
      listDir(newPath)
    }
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
          // Refresh after upload
          setTimeout(() => listDir(cwd), 500)
        }
        reader.readAsDataURL(file)
      }
    },
    [activeProjectId, cwd, listDir],
  )

  // Delete
  const handleDelete = useCallback(
    (filename: string) => {
      if (!activeProjectId) return
      projectStore.getState().deleteProjectFile(activeProjectId, filename)
      setDeleteTarget(null)
      setSelected(null)
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

  const itemCount = visibleEntries.length
  const dirCount = visibleEntries.filter((e) => e.type === 'dir').length
  const fileCount = itemCount - dirCount

  return (
    <div
      className={`finder${dragging ? ' finder--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-breadcrumb">
          {pathParts.map((part, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb parts can have duplicate names
            <span key={`${part}-${i}`} className="finder-breadcrumb__segment">
              {i > 0 && (
                <ChevronRight size={12} strokeWidth={1.5} className="finder-breadcrumb__sep" />
              )}
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(i)}
                className={`finder-breadcrumb__btn${i === pathParts.length - 1 ? ' finder-breadcrumb__btn--active' : ''}`}
              >
                {part === '/' ? '~' : part}
              </button>
            </span>
          ))}
        </div>

        <div className="finder-toolbar__actions">
          <label className="finder-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>Hidden</span>
          </label>
          <button
            type="button"
            className="finder-toolbar__btn"
            onClick={() => listDir(cwd)}
            aria-label="Refresh"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={loading ? 'spin' : ''} />
          </button>
          <button
            type="button"
            className="finder-toolbar__btn finder-toolbar__btn--upload"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} strokeWidth={1.5} />
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
        </div>
      </div>

      {/* Main body: file list + preview */}
      <div className="finder-body">
        <div className="finder-list">
          {/* Column header */}
          <div className="finder-list__header">
            <span className="finder-list__header-name">Name</span>
            <span className="finder-list__header-size">Size</span>
          </div>

          {/* Loading */}
          {loading && (
            <div className="finder-status">
              <Loader2 size={18} strokeWidth={1.5} className="spin" />
              <span>Loading...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="finder-status finder-status--error">
              <span>{error}</span>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && visibleEntries.length === 0 && (
            <div className="finder-status">
              <span>Empty folder</span>
            </div>
          )}

          {/* Parent directory */}
          {cwd !== startDir && cwd !== '/' && !loading && (
            <button
              type="button"
              onClick={() => {
                const parent = cwd.split('/').slice(0, -1).join('/') || '/'
                listDir(parent)
              }}
              className="finder-row finder-row--parent"
            >
              <span className="finder-row__icon">
                <Folder size={16} strokeWidth={1.5} />
              </span>
              <span className="finder-row__name">..</span>
              <span className="finder-row__size" />
            </button>
          )}

          {/* Entries */}
          {visibleEntries.map((entry) => (
            <button
              type="button"
              key={entry.name}
              onClick={() => handleEntryClick(entry)}
              onDoubleClick={() => handleEntryDoubleClick(entry)}
              className={`finder-row${entry.type === 'dir' ? ' finder-row--dir' : ''}${selected?.name === entry.name ? ' finder-row--selected' : ''}`}
            >
              <span
                className={`finder-row__icon finder-row__icon--${entry.type === 'dir' ? 'dir' : getCategory(entry.name)}`}
              >
                {getFileIcon(entry)}
              </span>
              <span className="finder-row__name">{entry.name}</span>
              <span className="finder-row__size">{entry.type === 'file' ? entry.size : ''}</span>
              {entry.type === 'file' && (
                <button
                  type="button"
                  className="finder-row__delete"
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

        {/* Preview panel */}
        {selected && (
          <div className="finder-preview">
            <FilePreview
              name={selected.name}
              type={selected.type}
              size={selected.size}
              content={previewContent}
              loading={previewLoading}
              error={previewError}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="finder-statusbar">
        <span>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
          {dirCount > 0 && ` · ${dirCount} folder${dirCount !== 1 ? 's' : ''}`}
          {fileCount > 0 && ` · ${fileCount} file${fileCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Drag overlay */}
      {dragging && (
        <div className="finder-drop-overlay">
          <Upload size={28} strokeWidth={1.5} />
          <span>Drop files to upload</span>
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
                This will permanently delete the file from the project workspace.
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
