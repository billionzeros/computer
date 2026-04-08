import {
  ArrowLeft,
  ChevronRight,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Loader2,
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

function getFileIcon(entry: FileEntry, size = 18) {
  if (entry.type === 'dir') return <Folder size={size} strokeWidth={1.5} />
  const cat = getCategory(entry.name)
  switch (cat) {
    case 'code':
      return <FileCode size={size} strokeWidth={1.5} />
    case 'data':
      return <FileSpreadsheet size={size} strokeWidth={1.5} />
    case 'text':
      return <FileText size={size} strokeWidth={1.5} />
    case 'image':
      return <Image size={size} strokeWidth={1.5} />
    default:
      return <File size={size} strokeWidth={1.5} />
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

  const [cwd, setCwd] = useState(startDir)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Breadcrumb
  const pathParts = useMemo(() => {
    const label = activeProject?.name || 'Project'
    if (cwd === startDir) return [label]
    if (cwd.startsWith(`${startDir}/`)) {
      const rel = cwd.slice(startDir.length + 1)
      return [label, ...rel.split('/').filter(Boolean)]
    }
    return cwd === '/' ? ['/'] : ['/', ...cwd.split('/').filter(Boolean)]
  }, [cwd, startDir, activeProject?.name])

  const canGoBack = cwd !== startDir && cwd !== '/'

  const listDir = useCallback((path: string) => {
    setLoading(true)
    setError(null)
    setEntries([])
    setCwd(path)
    setSelected(null)
    setPreviewContent(null)
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

  const visibleEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) {
      filtered = filtered.filter((e) => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))
    }
    return [...filtered].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.name.localeCompare(b.name)
    })
  }, [entries, showHidden])

  const navigateToBreadcrumb = (index: number) => {
    if (index === 0) {
      listDir(pathParts[0] === '/' ? '/' : startDir)
    } else {
      const base = pathParts[0] === '/' ? '' : startDir
      listDir(`${base}/${pathParts.slice(1, index + 1).join('/')}`)
    }
  }

  const goBack = () => {
    const parent = cwd.split('/').slice(0, -1).join('/') || '/'
    listDir(parent)
  }

  const handleEntryClick = (entry: FileEntry) => {
    setSelected(entry)
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

  // Click on empty space deselects
  const handleListBgClick = (e: React.MouseEvent) => {
    if (e.target === listRef.current) {
      setSelected(null)
      setPreviewContent(null)
    }
  }

  const dirCount = visibleEntries.filter((e) => e.type === 'dir').length
  const fileCount = visibleEntries.length - dirCount

  return (
    <div
      className={`finder${dragging ? ' finder--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Path bar */}
      <div className="finder-pathbar">
        <button
          type="button"
          className={`finder-pathbar__back${!canGoBack ? ' finder-pathbar__back--disabled' : ''}`}
          onClick={canGoBack ? goBack : undefined}
          disabled={!canGoBack}
        >
          <ArrowLeft size={15} strokeWidth={1.8} />
        </button>

        <div className="finder-pathbar__path">
          {pathParts.map((part, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb segments can repeat
            <span key={`${part}-${i}`} className="finder-pathbar__segment">
              {i > 0 && <ChevronRight size={11} strokeWidth={2} className="finder-pathbar__sep" />}
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(i)}
                className={`finder-pathbar__crumb${i === pathParts.length - 1 ? ' finder-pathbar__crumb--current' : ''}`}
              >
                {i === 0 && (
                  <Folder size={13} strokeWidth={1.5} className="finder-pathbar__folder-icon" />
                )}
                {part === '/' ? '~' : part}
              </button>
            </span>
          ))}
        </div>

        <div className="finder-pathbar__actions">
          <label className="finder-pathbar__toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Hidden
          </label>
          <button
            type="button"
            className="finder-pathbar__action"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} strokeWidth={1.5} />
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

      {/* Body */}
      <div className="finder-body">
        {/* File list */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: deselect on background click */}
        <div ref={listRef} className="finder-list" onClick={handleListBgClick}>
          {loading && (
            <div className="finder-empty">
              <Loader2 size={20} strokeWidth={1.5} className="spin" />
            </div>
          )}

          {error && (
            <div className="finder-empty">
              <p className="finder-empty__error">{error}</p>
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="finder-empty">
              <FolderOpen size={40} strokeWidth={0.8} />
              <p>This folder is empty</p>
              <span className="finder-empty__hint">Drop files here or use the upload button</span>
            </div>
          )}

          {visibleEntries.map((entry, idx) => (
            <button
              type="button"
              key={entry.name}
              onClick={() => handleEntryClick(entry)}
              onDoubleClick={() => handleEntryDoubleClick(entry)}
              className={`finder-item${selected?.name === entry.name ? ' finder-item--selected' : ''}${entry.type === 'dir' ? ' finder-item--dir' : ''}${idx % 2 === 1 ? ' finder-item--alt' : ''}`}
            >
              <span
                className={`finder-item__icon finder-item__icon--${entry.type === 'dir' ? 'dir' : getCategory(entry.name)}`}
              >
                {getFileIcon(entry)}
              </span>
              <span className="finder-item__name">{entry.name}</span>
              {entry.type === 'file' && entry.size && (
                <span className="finder-item__size">{entry.size}</span>
              )}
              {entry.type === 'dir' && (
                <ChevronRight size={14} strokeWidth={1.5} className="finder-item__chevron" />
              )}
              {entry.type === 'file' && (
                <button
                  type="button"
                  className="finder-item__delete"
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
        <div className={`finder-preview${selected ? ' finder-preview--open' : ''}`}>
          {selected ? (
            <FilePreview
              name={selected.name}
              type={selected.type}
              size={selected.size}
              content={previewContent}
              loading={previewLoading}
              error={previewError}
            />
          ) : (
            <div className="finder-preview__empty">
              <File size={28} strokeWidth={0.8} />
              <span>Select a file to preview</span>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="finder-statusbar">
        {!loading && !error && (
          <span>
            {visibleEntries.length} item{visibleEntries.length !== 1 ? 's' : ''}
            {dirCount > 0 && fileCount > 0 && (
              <span className="finder-statusbar__detail">
                {' '}
                &mdash; {dirCount} folder{dirCount !== 1 ? 's' : ''}, {fileCount} file
                {fileCount !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Drag overlay */}
      {dragging && (
        <div className="finder-drop">
          <div className="finder-drop__inner">
            <Upload size={24} strokeWidth={1.5} />
            <span>Drop to upload</span>
          </div>
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
