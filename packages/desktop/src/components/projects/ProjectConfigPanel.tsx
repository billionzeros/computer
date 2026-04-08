import type { Project } from '@anton/protocol'
import { Brain, ChevronRight, FileText, FolderOpen, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { Skeleton, SkeletonLines } from '../Skeleton.js'
import { Modal } from '../ui/Modal.js'

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

function ConfigSection({
  icon,
  title,
  action,
  headerAction,
  children,
  defaultOpen = false,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="config-section">
      <div className="config-section__header-row">
        <button type="button" className="config-section__header" onClick={() => setOpen(!open)}>
          <span className="config-section__icon">{icon}</span>
          <span className="config-section__title">{title}</span>
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={`config-section__chevron${open ? ' config-section__chevron--open' : ''}`}
          />
        </button>
        {headerAction && <div className="config-section__header-action">{headerAction}</div>}
      </div>
      {action && !open && <div className="config-section__action">{action}</div>}
      {open && (
        <div className="config-section__content">
          {children}
          {action && (
            <div className="config-section__action" style={{ marginTop: 8 }}>
              {action}
            </div>
          )}
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
    projectStore.getState().updateProjectContext(projectId, 'notes', text)
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
    projectStore.getState().updateProjectContext(projectId, 'summary', text)
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

// ── Files Section ─────────────────────────────────────────────────

function FilesSection() {
  return (
    <ConfigSection icon={<FolderOpen size={14} strokeWidth={1.5} />} title="Files">
      <button
        type="button"
        className="config-section__link"
        onClick={() => uiStore.getState().setActiveView('files')}
      >
        Manage files <ChevronRight size={12} strokeWidth={1.5} />
      </button>
    </ConfigSection>
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

        {/* Files */}
        <FilesSection />

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
