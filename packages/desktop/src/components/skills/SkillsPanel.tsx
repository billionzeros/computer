import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Puzzle,
  Search,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import type { Skill } from '../../lib/skills.js'
import { executeSkill, getSkillCommand } from '../../lib/skills.js'
import { useStore } from '../../lib/store.js'
import { skillStore } from '../../lib/store/skillStore.js'

/** Files that indicate a file is a code/text file viewable in the panel */
const VIEWABLE_EXTS = new Set([
  'md',
  'txt',
  'yaml',
  'yml',
  'json',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'go',
  'rs',
  'sh',
  'rb',
  'java',
  'c',
  'cpp',
  'html',
  'css',
  'scss',
  'toml',
  'xml',
  'sql',
  'csv',
  'log',
  'vue',
  'svelte',
  'swift',
  'kt',
])

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif'])

function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.has(ext)
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
  }
  return mimes[ext] || 'application/octet-stream'
}

function getFileIcon(name: string) {
  if (name === 'SKILL.md') return <FileText size={15} strokeWidth={1.5} />
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (VIEWABLE_EXTS.has(ext) && !['md', 'txt'].includes(ext)) {
    return <FileCode size={15} strokeWidth={1.5} />
  }
  return <File size={15} strokeWidth={1.5} />
}

/** What's selected in the right panel */
type Selection =
  | { type: 'skill'; skill: Skill }
  | { type: 'file'; skill: Skill; fileName: string; filePath: string }

export function SkillsPanel() {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)

  // File viewer state
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileIsImage, setFileIsImage] = useState(false)

  // Skill params
  const [params, setParams] = useState<Record<string, string>>({})

  // Divider drag
  const [leftWidth, setLeftWidth] = useState(280)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const skills = skillStore((s) => s.skills)
  const loaded = skillStore((s) => s.loaded)
  const connectionStatus = useStore((s) => s.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      skillStore.getState().requestSkills()
    }
  }, [connectionStatus])

  // Filter out empty skills (no prompt and no description)
  const validSkills = useMemo(() => {
    return skills.filter((s) => s.prompt.trim() || s.description.trim())
  }, [skills])

  const filtered = useMemo(() => {
    if (!search) return validSkills
    const q = search.toLowerCase()
    return validSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q),
    )
  }, [search, validSkills])

  // Build file list for each skill from assets
  const getSkillFiles = useCallback((skill: Skill): string[] => {
    const files: string[] = ['SKILL.md']
    if (skill.assets) {
      if (skill.assets.agents) {
        for (const f of skill.assets.agents) files.push(`agents/${f}`)
      }
      if (skill.assets.scripts) {
        for (const f of skill.assets.scripts) files.push(`scripts/${f}`)
      }
      if (skill.assets.references) {
        for (const f of skill.assets.references) files.push(`references/${f}`)
      }
      if (skill.assets.other) {
        for (const f of skill.assets.other) files.push(f)
      }
    }
    return files
  }, [])

  // Toggle expand/collapse
  const toggleExpand = useCallback((skillName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(skillName)) next.delete(skillName)
      else next.add(skillName)
      return next
    })
  }, [])

  // Select a skill (show detail in right panel)
  const selectSkill = useCallback((skill: Skill) => {
    setSelection({ type: 'skill', skill })
    setFileContent(null)
    setFileError(null)
    setFileLoading(false)
    setParams({})
  }, [])

  // Select a file (fetch content and show in right panel)
  const selectFile = useCallback((skill: Skill, fileName: string) => {
    if (!skill.skillDir) return
    const filePath = `${skill.skillDir}/${fileName}`
    const img = isImage(fileName)
    setSelection({ type: 'file', skill, fileName, filePath })
    setFileContent(null)
    setFileLoading(true)
    setFileError(null)
    setFileIsImage(img)
    pendingReadPath.current = filePath
    connection.sendFilesystemRead(filePath, img ? 'base64' : undefined)
  }, [])

  // Track the path we're currently reading so we ignore responses for other readers
  const pendingReadPath = useRef<string | null>(null)

  // Listen for fs_read responses
  useEffect(() => {
    const unsub = connection.onFilesystemReadResponse((path, content, _trunc, err) => {
      // Only handle responses for our pending read
      if (path !== pendingReadPath.current) return
      pendingReadPath.current = null
      if (err) {
        setFileError(err)
        setFileLoading(false)
      } else {
        setFileContent(content)
        setFileLoading(false)
        setFileError(null)
      }
    })
    return unsub
  }, [])

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<Skill | null>(null)

  // Run skill
  const handleRun = useCallback(() => {
    if (selection?.type !== 'skill') return
    executeSkill(selection.skill, params)
    setParams({})
    setSelection(null)
  }, [selection, params])

  // Delete skill
  const handleDelete = useCallback((skill: Skill) => {
    setDeleteConfirm(skill)
  }, [])

  // Track the path we're currently deleting so we ignore responses for other deleters
  const pendingDeletePath = useRef<string | null>(null)

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm?.skillDir) return
    pendingDeletePath.current = deleteConfirm.skillDir
    connection.sendFilesystemDelete(deleteConfirm.skillDir)
    setSelection(null)
    setDeleteConfirm(null)
  }, [deleteConfirm])

  // Listen for fs_delete responses
  useEffect(() => {
    const unsub = connection.onFilesystemDeleteResponse((path, success, _err) => {
      if (path !== pendingDeletePath.current) return
      pendingDeletePath.current = null
      if (success) {
        skillStore.getState().requestSkills()
      }
    })
    return unsub
  }, [])

  // Divider drag logic
  const handleDividerStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: leftWidth }
      setIsDragging(true)
    },
    [leftWidth],
  )

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      setLeftWidth(Math.min(500, Math.max(220, dragRef.current.startW + delta)))
    }
    const onUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  // Check if a tree item is selected
  const isSkillSelected = useCallback(
    (skill: Skill) => selection?.type === 'skill' && selection.skill.name === skill.name,
    [selection],
  )
  const isFileSelected = useCallback(
    (skill: Skill, fileName: string) =>
      selection?.type === 'file' &&
      selection.skill.name === skill.name &&
      selection.fileName === fileName,
    [selection],
  )

  const hasSelection = !!selection

  return (
    <div className="sk">
      {/* Left panel — skill tree */}
      <div className="sk-left" style={{ width: hasSelection ? leftWidth : '100%' }}>
        <div className="sk-left__header">
          <span className="sk-left__title">Personal skills</span>
        </div>

        {/* Search */}
        <div className="sk-search">
          <Search size={14} strokeWidth={1.8} className="sk-search__icon" />
          <input
            type="text"
            className="sk-search__input"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Tree */}
        <div className="sk-tree">
          {!loaded && (
            <div className="sk-empty">
              <Loader2 size={20} strokeWidth={1.5} className="spin" />
            </div>
          )}

          {loaded && filtered.length === 0 && (
            <div className="sk-empty">
              <Puzzle size={24} strokeWidth={1.5} />
              <p>No skills found</p>
            </div>
          )}

          {filtered.map((skill) => {
            const isExpanded = expanded.has(skill.name)
            const files = getSkillFiles(skill)
            const hasFiles = files.length > 1 // more than just SKILL.md
            return (
              <div key={skill.name} className="sk-node">
                {/* Skill row */}
                <button
                  type="button"
                  className={`sk-row sk-row--skill${isSkillSelected(skill) ? ' sk-row--active' : ''}`}
                  onClick={() => {
                    selectSkill(skill)
                    if (hasFiles) toggleExpand(skill.name)
                  }}
                >
                  <span className="sk-row__chevron">
                    {hasFiles ? (
                      isExpanded ? (
                        <ChevronDown size={14} strokeWidth={1.5} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} />
                      )
                    ) : (
                      <span style={{ width: 14 }} />
                    )}
                  </span>
                  <span className="sk-row__icon">
                    {isExpanded ? (
                      <FolderOpen size={15} strokeWidth={1.5} />
                    ) : (
                      <Folder size={15} strokeWidth={1.5} />
                    )}
                  </span>
                  <span className="sk-row__name">
                    {skill.name.toLowerCase().replace(/\s+/g, '-')}
                  </span>
                </button>

                {/* Child files */}
                {isExpanded && (
                  <div className="sk-children">
                    {files.map((fileName) => (
                      <button
                        type="button"
                        key={fileName}
                        className={`sk-row sk-row--file${isFileSelected(skill, fileName) ? ' sk-row--active' : ''}`}
                        onClick={() => {
                          if (fileName === 'SKILL.md') {
                            selectSkill(skill)
                          } else {
                            selectFile(skill, fileName)
                          }
                        }}
                      >
                        <span className="sk-row__indent" />
                        <span className="sk-row__icon">
                          {getFileIcon(fileName.split('/').pop() || fileName)}
                        </span>
                        <span className="sk-row__name">{fileName.split('/').pop()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      {hasSelection && (
        <div
          className={`sk-divider${isDragging ? ' sk-divider--active' : ''}`}
          onMouseDown={handleDividerStart}
        />
      )}

      {/* Right panel */}
      {hasSelection && (
        <div className="sk-right">
          {selection.type === 'skill' && (
            <SkillDetailPanel
              skill={selection.skill}
              params={params}
              setParams={setParams}
              onRun={handleRun}
              onDelete={selection.skill.skillDir ? () => handleDelete(selection.skill) : undefined}
            />
          )}
          {selection.type === 'file' && (
            <FileViewerPanel
              fileName={selection.fileName}
              content={fileContent}
              loading={fileLoading}
              error={fileError}
              isImage={fileIsImage}
            />
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteConfirm(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeleteConfirm(null)
          }}
        >
          <div
            className="modal-card modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="modal-card__body">
              <h3>Uninstall &ldquo;{deleteConfirm.name}&rdquo;?</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                This will permanently remove the skill and all its files.
              </p>
            </div>
            <div className="modal-card__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button type="button" className="button button--danger" onClick={confirmDelete}>
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Skill Detail (inline panel, not modal) ─────────────────────── */

function SkillDetailPanel({
  skill,
  params,
  setParams,
  onRun,
  onDelete,
}: {
  skill: Skill
  params: Record<string, string>
  setParams: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onRun: () => void
  onDelete?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const command = getSkillCommand(skill)
  const hasParams = skill.parameters && skill.parameters.length > 0
  const canRun = !skill.parameters?.some((p) => p.required && !params[p.name]?.trim())

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div className="sk-detail">
      <div className="sk-detail__header">
        <h2 className="sk-detail__name">{skill.name}</h2>
        {skill.source === 'builtin' && <span className="sk-detail__badge">Built-in</span>}
        <div className="sk-detail__actions" ref={menuRef}>
          <button type="button" className="sk-detail__more" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
          {menuOpen && (
            <div className="sk-detail__menu">
              <button
                type="button"
                className="sk-detail__menu-item"
                disabled={!canRun}
                onClick={() => {
                  setMenuOpen(false)
                  onRun()
                }}
              >
                <MessageSquare size={14} strokeWidth={1.5} />
                Try in chat
              </button>
              {onDelete && (
                <button
                  type="button"
                  className="sk-detail__menu-item sk-detail__menu-item--danger"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete()
                  }}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  Uninstall
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="sk-detail__meta">
        <div className="sk-detail__meta-item">
          <span className="sk-detail__meta-label">Invoked by</span>
          <span className="sk-detail__meta-value">{command}</span>
        </div>
        {skill.context && (
          <div className="sk-detail__meta-item">
            <span className="sk-detail__meta-label">Trigger</span>
            <span className="sk-detail__meta-value">Slash command + auto</span>
          </div>
        )}
        {skill.category && (
          <div className="sk-detail__meta-item">
            <span className="sk-detail__meta-label">Category</span>
            <span className="sk-detail__meta-value">{skill.category}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {skill.description && (
        <div className="sk-detail__section">
          <h3 className="sk-detail__section-title">Description</h3>
          <p className="sk-detail__text">{skill.description}</p>
        </div>
      )}

      {/* Prompt */}
      {skill.prompt && (
        <div className="sk-detail__section">
          <h3 className="sk-detail__section-title">Prompt</h3>
          <pre className="sk-detail__prompt">{skill.prompt}</pre>
        </div>
      )}

      {/* Parameters */}
      {hasParams && (
        <div className="sk-detail__section">
          <h3 className="sk-detail__section-title">Parameters</h3>
          <div className="sk-detail__params">
            {skill.parameters!.map((param) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: label wraps the input
              <label key={param.name} className="sk-detail__param">
                <span className="sk-detail__param-label">
                  {param.label}
                  {param.required && <span className="sk-detail__param-req">*</span>}
                </span>
                {param.type === 'select' ? (
                  <select
                    value={params[param.name] || ''}
                    onChange={(e) => setParams((p) => ({ ...p, [param.name]: e.target.value }))}
                    className="sk-detail__input"
                  >
                    <option value="">Select...</option>
                    {param.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={params[param.name] || ''}
                    onChange={(e) => setParams((p) => ({ ...p, [param.name]: e.target.value }))}
                    placeholder={param.placeholder}
                    className="sk-detail__input"
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Run button (shown when skill has params that need filling) */}
      {hasParams && (
        <button type="button" onClick={onRun} disabled={!canRun} className="sk-detail__run">
          <Play size={14} strokeWidth={2} />
          Run Skill
        </button>
      )}
    </div>
  )
}

/* ── File Viewer (inline panel) ────────────────────────────────── */

function FileViewerPanel({
  fileName,
  content,
  loading,
  error,
  isImage,
}: {
  fileName: string
  content: string | null
  loading: boolean
  error: string | null
  isImage: boolean
}) {
  const displayName = fileName.split('/').pop() || fileName

  return (
    <div className="sk-file">
      <div className="sk-file__header">
        <span className="sk-file__icon">{getFileIcon(displayName)}</span>
        <span className="sk-file__name">{displayName}</span>
      </div>
      <div className="sk-file__body">
        {loading && (
          <div className="sk-file__status">
            <Loader2 size={20} strokeWidth={1.5} className="spin" />
          </div>
        )}
        {error && <div className="sk-file__status sk-file__status--error">{error}</div>}
        {!loading &&
          !error &&
          content !== null &&
          (isImage ? (
            <div className="sk-file__image-wrap">
              <img
                src={`data:${getMimeType(displayName)};base64,${content}`}
                alt={displayName}
                className="sk-file__image"
              />
            </div>
          ) : (
            <pre className="sk-file__code">{content}</pre>
          ))}
      </div>
    </div>
  )
}
