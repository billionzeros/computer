import { motion } from 'framer-motion'
import { FolderOpen, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'

export function ProjectList() {
  const projects = projectStore((s) => s.projects)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleOpenProject = (id: string) => {
    setActiveProject(id)
    uiStore.getState().setActiveView('home')
  }

  const handleDeleteProject = () => {
    if (!deleteTarget) return
    projectStore.getState().deleteProject(deleteTarget)
    setDeleteTarget(null)
  }

  const deleteProject = deleteTarget ? projects.find((p) => p.id === deleteTarget) : null

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
    return d.toLocaleDateString()
  }

  if (projects.length === 0) {
    return (
      <div className="projects-empty">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="projects-empty__inner"
        >
          <div className="projects-empty__icon-wrap">
            <FolderOpen size={28} strokeWidth={1.5} />
          </div>
          <h2 className="projects-empty__title">Projects</h2>
          <p className="projects-empty__desc">
            Organize your work into projects. Each project has its own sessions, agents, and
            context.
          </p>
          <button
            type="button"
            className="projects-empty__cta"
            onClick={() => window.dispatchEvent(new CustomEvent('anton:create-project'))}
          >
            <Plus size={16} strokeWidth={1.5} />
            <span>Create a project</span>
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="projects-page">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="projects-page__inner"
      >
        {/* Header */}
        <div className="projects-page__header">
          <h2 className="projects-page__title">Projects</h2>
          <button
            type="button"
            className="projects-page__new-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('anton:create-project'))}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>New Project</span>
          </button>
        </div>

        {/* Project grid */}
        <div className="projects-page__grid">
          {[...projects]
            .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
            .map((project, i) => (
              <motion.button
                key={project.id}
                type="button"
                className="project-card"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-card__top">
                  <div className="project-card__icon" style={{ backgroundColor: project.color }}>
                    {project.icon}
                  </div>
                  {!project.isDefault && (
                    <button
                      type="button"
                      className="project-card__delete"
                      data-tooltip="Delete project"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(project.id)
                      }}
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
                <div className="project-card__body">
                  <span className="project-card__name">{project.name}</span>
                  {project.description && (
                    <span className="project-card__desc">{project.description}</span>
                  )}
                </div>
                <div className="project-card__footer">
                  <span className="project-card__stat">
                    <MessageSquare size={11} strokeWidth={1.5} />
                    {project.stats.sessionCount} session
                    {project.stats.sessionCount !== 1 ? 's' : ''}
                  </span>
                  <span className="project-card__time">{formatDate(project.stats.lastActive)}</span>
                </div>
              </motion.button>
            ))}

          {/* New project card */}
          <button
            type="button"
            className="project-card project-card--new"
            onClick={() => window.dispatchEvent(new CustomEvent('anton:create-project'))}
          >
            <Plus size={20} strokeWidth={1.5} />
            <span>New Project</span>
          </button>
        </div>
      </motion.div>

      {deleteProject && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteTarget(null)}
          onKeyDown={(e) => e.key === 'Escape' && setDeleteTarget(null)}
        >
          <div
            className="modal-card modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="modal-card__body">
              <h3>Delete "{deleteProject.name}"?</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                This will delete all sessions, agents, and data. This cannot be undone.
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
              <button type="button" className="button button--danger" onClick={handleDeleteProject}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
