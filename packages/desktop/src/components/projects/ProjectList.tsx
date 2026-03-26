import { motion } from 'framer-motion'
import { ArrowRight, FolderOpen, MessageSquare, Plus, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { CreateProjectModal } from './CreateProjectModal.js'

export function ProjectList() {
  const projects = useStore((s) => s.projects)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Listen for sidebar "New project" button
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener('anton:create-project', handler)
    return () => window.removeEventListener('anton:create-project', handler)
  }, [])

  const handleOpenProject = (id: string) => {
    setActiveProject(id)
    connection.sendProjectSessionsList(id)
  }

  const handleDeleteProject = () => {
    if (!deleteTarget) return
    connection.sendProjectDelete(deleteTarget)
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
            Organize your work into projects. Each project has its own
            sessions, jobs, and notifications.
          </p>
          <button
            type="button"
            className="projects-empty__cta"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} strokeWidth={1.5} />
            <span>Create a project</span>
          </button>
        </motion.div>
        {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}
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
          <div>
            <h2 className="projects-page__title">Your Projects</h2>
            <p className="projects-page__subtitle">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            type="button"
            className="projects-page__new-btn"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>New Project</span>
          </button>
        </div>

        {/* Project list */}
        <div className="projects-page__list">
          {projects.map((project, i) => (
            <motion.div
              key={project.id}
              className="project-row"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
            >
              <button
                type="button"
                className="project-row__main"
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-row__icon" style={{ backgroundColor: project.color }}>
                  {project.icon}
                </div>
                <div className="project-row__info">
                  <span className="project-row__name">{project.name}</span>
                  {project.description && (
                    <span className="project-row__desc">{project.description}</span>
                  )}
                </div>
                <div className="project-row__stats">
                  <span className="project-row__stat">
                    <MessageSquare size={12} strokeWidth={1.5} />
                    {project.stats.sessionCount}
                  </span>
                  <span className="project-row__stat">
                    <Zap size={12} strokeWidth={1.5} />
                    {project.stats.activeJobs}
                  </span>
                </div>
                <span className="project-row__time">{formatDate(project.stats.lastActive)}</span>
                <ArrowRight size={14} strokeWidth={1.5} className="project-row__arrow" />
              </button>
              <button
                type="button"
                className="project-row__delete"
                title="Delete project"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTarget(project.id)
                }}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}

      {deleteProject && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)} onKeyDown={(e) => e.key === 'Escape' && setDeleteTarget(null)}>
          <div className="modal-card modal-card--sm" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="modal-card__body">
              <h3>Delete "{deleteProject.name}"?</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
                This will delete all sessions, jobs, and data. This cannot be undone.
              </p>
            </div>
            <div className="modal-card__footer">
              <button type="button" className="button button--ghost" onClick={() => setDeleteTarget(null)}>
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
