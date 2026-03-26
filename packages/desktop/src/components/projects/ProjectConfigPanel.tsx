import {
  Bell,
  Brain,
  ChevronRight,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  Type,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@anton/protocol'
import { Skeleton, SkeletonLines } from '../Skeleton.js'
import { Modal } from '../ui/Modal.js'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'

interface Props {
  project: Project
  loading?: boolean
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  action?: React.ReactNode
  headerAction?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}

function ConfigSection({ icon, title, action, headerAction, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="config-section">
      <div className="config-section__header-row">
        <button
          type="button"
          className="config-section__header"
          onClick={() => setOpen(!open)}
        >
          <span className="config-section__icon">{icon}</span>
          <span className="config-section__title">{title}</span>
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={`config-section__chevron${open ? ' config-section__chevron--open' : ''}`}
          />
        </button>
        {headerAction && (
          <div className="config-section__header-action">{headerAction}</div>
        )}
      </div>
      {action && !open && (
        <div className="config-section__action">{action}</div>
      )}
      {open && (
        <div className="config-section__content">
          {children}
          {action && <div className="config-section__action" style={{ marginTop: 8 }}>{action}</div>}
        </div>
      )}
    </div>
  )
}

// ── Instructions Modal ────────────────────────────────────────────

function InstructionsModal({
  open,
  onClose,
  projectId,
  initialValue,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initialValue: string
}) {
  const [text, setText] = useState(initialValue)

  useEffect(() => {
    if (open) setText(initialValue)
  }, [open, initialValue])

  function handleSave() {
    connection.sendProjectContextUpdate(projectId, 'notes', text)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Project Instructions">
      <div className="context-modal">
        <textarea
          className="context-modal__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add instructions to tailor the agent's responses for this project...&#10;&#10;Example:&#10;- Always use TypeScript&#10;- Follow existing code patterns&#10;- Run tests before committing"
        />
        <div className="context-modal__footer">
          <button type="button" className="button button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Memory Edit Modal ─────────────────────────────────────────────

function MemoryEditModal({
  open,
  onClose,
  projectId,
  initialValue,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initialValue: string
}) {
  const [text, setText] = useState(initialValue)

  useEffect(() => {
    if (open) setText(initialValue)
  }, [open, initialValue])

  function handleSave() {
    connection.sendProjectContextUpdate(projectId, 'summary', text)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Project Memory">
      <div className="context-modal">
        <p className="context-modal__hint">
          Auto-updated after sessions. You can also edit manually.
        </p>
        <textarea
          className="context-modal__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Project memory will build up as you work..."
        />
        <div className="context-modal__footer">
          <button type="button" className="button button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Text File Create Modal ────────────────────────────────────────

function TextFileModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
}) {
  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (open) {
      setFilename('')
      setContent('')
    }
  }, [open])

  function handleSave() {
    if (!filename.trim()) return
    connection.sendProjectFileTextCreate(projectId, filename.trim(), content)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Text Content">
      <div className="context-modal">
        <div className="form-field">
          <label className="form-field__label" htmlFor="text-file-filename">Filename</label>
          <input
            id="text-file-filename"
            className="form-field__input"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="e.g. notes.md, config.json"
          />
        </div>
        <textarea
          className="context-modal__textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="File contents..."
          style={{ marginTop: 8 }}
        />
        <div className="context-modal__footer">
          <button type="button" className="button button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleSave}
            disabled={!filename.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Files Section ─────────────────────────────────────────────────

function FilesSection({ projectId }: { projectId: string }) {
  const [showMenu, setShowMenu] = useState(false)
  const [textModalOpen, setTextModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectFiles = useStore((s) => s.projectFiles)

  useEffect(() => {
    connection.sendProjectFilesList(projectId)
  }, [projectId])

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be under 10MB')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove the data:...;base64, prefix
      const base64 = result.split(',')[1] || ''
      connection.sendProjectFileUpload(projectId, file.name, base64, file.type, file.size)
    }
    reader.readAsDataURL(file)

    // Reset input so same file can be uploaded again
    e.target.value = ''
  }

  function handleDelete(filename: string) {
    connection.sendProjectFileDelete(projectId, filename)
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <>
      <ConfigSection
        icon={<FolderOpen size={14} strokeWidth={1.5} />}
        title="Files"
        defaultOpen={projectFiles.length > 0}
        headerAction={
          <div className="files-add-wrap">
            <button
              type="button"
              className="config-section__icon-btn"
              onClick={() => setShowMenu(!showMenu)}
              aria-label="Add files"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
            {showMenu && (
              <>
                <div className="files-add-backdrop" onClick={() => setShowMenu(false)} onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)} />
                <div className="files-add-menu">
                  <button
                    type="button"
                    className="files-add-menu__item"
                    onClick={() => {
                      setShowMenu(false)
                      fileInputRef.current?.click()
                    }}
                  >
                    <Upload size={14} strokeWidth={1.5} />
                    <span>Upload from device</span>
                  </button>
                  <button
                    type="button"
                    className="files-add-menu__item"
                    onClick={() => {
                      setShowMenu(false)
                      setTextModalOpen(true)
                    }}
                  >
                    <Type size={14} strokeWidth={1.5} />
                    <span>Add text content</span>
                  </button>
                </div>
              </>
            )}
          </div>
        }
      >
        {projectFiles.length > 0 ? (
          <div className="files-list">
            {projectFiles.map((f) => {
              const ext = f.name.split('.').pop()?.toUpperCase() || 'FILE'
              return (
                <div key={f.name} className="file-card">
                  <div className="file-card__info">
                    <span className="file-card__name">{f.name}</span>
                    <span className="file-card__size">{formatSize(f.size)}</span>
                  </div>
                  <div className="file-card__actions">
                    <span className="file-card__badge">{ext}</span>
                    <button
                      type="button"
                      className="file-card__delete"
                      onClick={() => handleDelete(f.name)}
                      aria-label={`Delete ${f.name}`}
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="config-section__hint">
            Start by attaching files to your project.
          </p>
        )}
      </ConfigSection>

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      <TextFileModal
        open={textModalOpen}
        onClose={() => setTextModalOpen(false)}
        projectId={projectId}
      />
    </>
  )
}

// ── Main Panel ────────────────────────────────────────────────────

export function ProjectConfigPanel({ project, loading }: Props) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)

  if (loading) {
    return (
      <div className="config-panel">
        <div className="config-panel__inner">
          {['instructions', 'jobs', 'notifications', 'files'].map((section) => (
            <div key={section} className="config-section">
              <div className="config-section__header" style={{ cursor: 'default' }}>
                <Skeleton width={18} height={18} variant="rect" />
                <Skeleton width="60%" height={14} />
              </div>
              <div className="config-section__content">
                <SkeletonLines count={2} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const hasNotes = !!project.context.notes
  const hasSummary = !!project.context.summary

  return (
    <div className="config-panel">
      <div className="config-panel__inner">
        {/* Instructions */}
        <ConfigSection
          icon={<FileText size={14} strokeWidth={1.5} />}
          title="Instructions"
          defaultOpen={hasNotes}
          headerAction={
            hasNotes ? (
              <button
                type="button"
                className="config-section__icon-btn"
                onClick={() => setInstructionsOpen(true)}
                aria-label="Edit instructions"
              >
                <Pencil size={13} strokeWidth={1.5} />
              </button>
            ) : undefined
          }
          action={
            !hasNotes ? (
              <button
                type="button"
                className="config-section__add-btn"
                onClick={() => setInstructionsOpen(true)}
              >
                <Plus size={13} strokeWidth={1.5} />
                <span>Add</span>
              </button>
            ) : undefined
          }
        >
          {hasNotes ? (
            <p className="config-section__value config-section__value--clamp">
              {project.context.notes}
            </p>
          ) : (
            <p className="config-section__hint">
              Add instructions to tailor the agent's responses for this project.
            </p>
          )}
        </ConfigSection>

        {/* Jobs */}
        <ConfigSection
          icon={<Zap size={14} strokeWidth={1.5} />}
          title="Jobs"
          action={
            <button type="button" className="config-section__add-btn">
              <Plus size={13} strokeWidth={1.5} />
              <span>Add</span>
            </button>
          }
        >
          {project.stats.activeJobs > 0 ? (
            <p className="config-section__value">
              {project.stats.activeJobs} active job{project.stats.activeJobs !== 1 ? 's' : ''}
            </p>
          ) : (
            <p className="config-section__hint">
              No active jobs. Automate tasks like scraping, syncing, and monitoring.
            </p>
          )}
        </ConfigSection>

        {/* Notifications */}
        <ConfigSection
          icon={<Bell size={14} strokeWidth={1.5} />}
          title="Notifications"
        >
          <p className="config-section__hint">
            Activity feed for this project. Job results, errors, and things that need your attention.
          </p>
        </ConfigSection>

        {/* Files */}
        <FilesSection projectId={project.id} />

        {/* Memory */}
        <ConfigSection
          icon={<Brain size={14} strokeWidth={1.5} />}
          title="Memory"
          defaultOpen={hasSummary}
          headerAction={
            <button
              type="button"
              className="config-section__icon-btn"
              onClick={() => setMemoryOpen(true)}
              aria-label="Edit memory"
            >
              {hasSummary ? (
                <Pencil size={13} strokeWidth={1.5} />
              ) : (
                <Plus size={13} strokeWidth={1.5} />
              )}
            </button>
          }
        >
          {hasSummary ? (
            <p className="config-section__value">{project.context.summary}</p>
          ) : (
            <p className="config-section__hint">
              Project memory will build up after a few sessions.
            </p>
          )}
        </ConfigSection>
      </div>

      <InstructionsModal
        open={instructionsOpen}
        onClose={() => setInstructionsOpen(false)}
        projectId={project.id}
        initialValue={project.context.notes}
      />

      <MemoryEditModal
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        projectId={project.id}
        initialValue={project.context.summary}
      />
    </div>
  )
}
