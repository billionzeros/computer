import {
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderOpen,
  Image,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'

type FileTypeFilter = 'all' | 'code' | 'data' | 'text' | 'image' | 'other'

const FILE_CATEGORIES: Record<string, FileTypeFilter> = {
  // Code
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  sh: 'code',
  rb: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  html: 'code',
  css: 'code',
  scss: 'code',
  // Data
  json: 'data',
  yaml: 'data',
  yml: 'data',
  csv: 'data',
  xml: 'data',
  toml: 'data',
  sql: 'data',
  // Text
  md: 'text',
  txt: 'text',
  log: 'text',
  pdf: 'text',
  doc: 'text',
  docx: 'text',
  // Image
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  ico: 'image',
  webp: 'image',
}

function getFileCategory(name: string): FileTypeFilter {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FILE_CATEGORIES[ext] || 'other'
}

function getFileIcon(name: string) {
  const cat = getFileCategory(name)
  switch (cat) {
    case 'code':
      return <FileCode size={24} strokeWidth={1.2} />
    case 'data':
      return <FileSpreadsheet size={24} strokeWidth={1.2} />
    case 'text':
      return <FileText size={24} strokeWidth={1.2} />
    case 'image':
      return <Image size={24} strokeWidth={1.2} />
    default:
      return <File size={24} strokeWidth={1.2} />
  }
}

function getFileExt(name: string): string {
  return `.${name.split('.').pop()?.toLowerCase() || '?'}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FILTER_LABELS: Record<FileTypeFilter, string> = {
  all: 'All types',
  code: 'Code',
  data: 'Data',
  text: 'Documents',
  image: 'Images',
  other: 'Other',
}

export function ProjectFilesView() {
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const projectFiles = projectStore((s) => s.projectFiles)
  const projectFilesLoading = projectStore((s) => s.projectFilesLoading)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [filter, setFilter] = useState<FileTypeFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch files on mount and project change
  useEffect(() => {
    if (activeProjectId) {
      projectStore.getState().listProjectFiles(activeProjectId)
    }
  }, [activeProjectId])

  const filtered = useMemo(() => {
    if (filter === 'all') return projectFiles
    return projectFiles.filter((f) => getFileCategory(f.name) === filter)
  }, [projectFiles, filter])

  // Group by "date" — we don't have real timestamps from listProjectFiles,
  // so just show as a flat list for now
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
          // Refresh file list after a short delay
          setTimeout(() => {
            projectStore.getState().listProjectFiles(activeProjectId)
          }, 500)
        }
        reader.readAsDataURL(file)
      }
    },
    [activeProjectId],
  )

  const handleDelete = useCallback(
    (filename: string) => {
      if (!activeProjectId) return
      projectStore.getState().deleteProjectFile(activeProjectId, filename)
      setDeleteTarget(null)
      setTimeout(() => {
        projectStore.getState().listProjectFiles(activeProjectId)
      }, 300)
    },
    [activeProjectId],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files)
      }
    },
    [handleUpload],
  )

  return (
    <div
      className={`pf-view${dragging ? ' pf-view--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="pf-view__inner">
        <p className="pf-view__desc">
          Files in <strong>{activeProject?.name || 'your project'}</strong>
          {activeProject?.workspacePath && (
            <span className="pf-view__path">{activeProject.workspacePath}</span>
          )}
        </p>

        {/* Toolbar */}
        <div className="pf-toolbar">
          <div className="pf-toolbar__left">
            <div className="pf-filter">
              <button
                type="button"
                className="pf-filter__btn"
                onClick={() => setFilterOpen(!filterOpen)}
              >
                {FILTER_LABELS[filter]}
                <FileType size={12} strokeWidth={1.5} />
              </button>
              {filterOpen && (
                <>
                  <div
                    className="pf-filter__backdrop"
                    onClick={() => setFilterOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setFilterOpen(false)
                    }}
                    role="button"
                    tabIndex={-1}
                  />
                  <div className="pf-filter__dropdown">
                    {(Object.keys(FILTER_LABELS) as FileTypeFilter[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`pf-filter__item${filter === key ? ' pf-filter__item--active' : ''}`}
                        onClick={() => {
                          setFilter(key)
                          setFilterOpen(false)
                        }}
                      >
                        {FILTER_LABELS[key]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="pf-toolbar__right">
            <button
              type="button"
              className="pf-upload-btn"
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

        {/* File grid */}
        <div className="pf-grid">
          {projectFilesLoading && filtered.length === 0 && (
            <div className="pf-empty">
              <Loader2 size={24} strokeWidth={1.5} className="spin" />
              <span>Loading files...</span>
            </div>
          )}

          {!projectFilesLoading && filtered.length === 0 && (
            <div className="pf-empty">
              <FolderOpen size={32} strokeWidth={1} />
              <span>No files yet</span>
              <p>Upload files or let the AI create them during tasks.</p>
            </div>
          )}

          {filtered.map((file) => (
            <div key={file.name} className={`pf-card pf-card--${getFileCategory(file.name)}`}>
              <div className="pf-card__icon">{getFileIcon(file.name)}</div>
              <div className="pf-card__info">
                <span className="pf-card__name" title={file.name}>
                  {file.name}
                </span>
                <span className="pf-card__meta">
                  <span className="pf-card__ext">{getFileExt(file.name)}</span>
                  <span className="pf-card__size">{formatSize(file.size)}</span>
                </span>
              </div>
              <button
                type="button"
                className="pf-card__delete"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTarget(file.name)
                }}
              >
                <Trash2 size={13} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>

        {/* Drag overlay */}
        {dragging && (
          <div className="pf-drop-overlay">
            <Upload size={32} strokeWidth={1.5} />
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
                <h3>Delete "{deleteTarget}"?</h3>
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
    </div>
  )
}
