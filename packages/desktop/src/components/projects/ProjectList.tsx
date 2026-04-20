import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../../lib/store.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { uiStore } from '../../lib/store/uiStore.js'
import { AntonModal } from '../ui/AntonModal.js'

function formatLastUsed(ts: number): string {
  if (!ts) return 'Never used'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} minute${Math.floor(diff / 60_000) === 1 ? '' : 's'} ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hour${Math.floor(diff / 3600_000) === 1 ? '' : 's'} ago`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} day${Math.floor(diff / 86400_000) === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

export function ProjectList() {
  const projects = projectStore((s) => s.projects)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const setActiveProject = projectStore((s) => s.setActiveProject)
  const conversations = useStore((s) => s.conversations)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const handleOpenProject = (id: string) => {
    setActiveProject(id)
    uiStore.getState().setActiveView('home')
  }

  const handleDeleteProject = () => {
    if (!deleteTargetId) return
    projectStore.getState().deleteProject(deleteTargetId)
    setDeleteTargetId(null)
  }

  const openCreate = () => uiStore.getState().setActiveView('new-project')

  const deleteProject = deleteTargetId ? projects.find((p) => p.id === deleteTargetId) : null

  const fileCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of conversations) {
      const key = c.projectId ?? '__none__'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [conversations])

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if ((b.isDefault ? 1 : 0) !== (a.isDefault ? 1 : 0)) {
        return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
      }
      return (b.stats.lastActive ?? 0) - (a.stats.lastActive ?? 0)
    })
  }, [projects])

  return (
    <div className="pr-main">
      <div className="pr-header">
        <div>
          <h1 className="pr-header__title">
            <FolderOpen size={22} strokeWidth={1.5} />
            Projects
          </h1>
          <p className="pr-header__sub">
            Named workspaces — each with its own instructions, files, and task history.
          </p>
        </div>
        <button type="button" className="pr-btn pr-btn--primary" onClick={openCreate}>
          <Plus size={14} strokeWidth={1.5} />
          New project
        </button>
      </div>

      <div className="pr-grid">
        {sortedProjects.map((project) => {
          const isActive = project.id === activeProjectId
          const fileCount = fileCounts.get(project.id) ?? project.stats.sessionCount ?? 0
          return (
            <div
              key={project.id}
              className={`pr-card pr-card--workspace${isActive ? ' selected' : ''}`}
            >
              <button
                type="button"
                className="pr-card__hit"
                onClick={() => handleOpenProject(project.id)}
                aria-label={`Open ${project.name}`}
              />
              <div className="pr-card__head">
                <div className="pr-card__icon">
                  <FolderOpen size={14} strokeWidth={1.5} />
                </div>
                <div className="pr-card__files">
                  {fileCount} file{fileCount === 1 ? '' : 's'}
                </div>
              </div>
              <div>
                <div className="pr-card__name">{project.name}</div>
                {project.description && (
                  <div className="pr-card__blurb">{project.description}</div>
                )}
              </div>
              <div className="pr-card__foot">
                <span>Last used {formatLastUsed(project.stats.lastActive)}</span>
                {!project.isDefault && (
                  <>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="pr-iconbtn"
                      aria-label="Delete project"
                      title="Delete project"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTargetId(project.id)
                      }}
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}

        <button type="button" className="pr-card pr-card--add" onClick={openCreate}>
          <Plus size={20} strokeWidth={1.5} />
          <span className="pr-card--add__label">New project</span>
          <span className="pr-card--add__hint">Give it a name and some context</span>
        </button>
      </div>

      <AntonModal
        open={!!deleteProject}
        onClose={() => setDeleteTargetId(null)}
        title={deleteProject ? `Delete "${deleteProject.name}"?` : 'Delete project'}
        subtitle="This will delete all sessions, agents, and memory. This cannot be undone."
        size="sm"
        icon={<Trash2 size={14} strokeWidth={1.5} />}
        footer={
          <>
            <button type="button" className="am-btn" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </button>
            <button type="button" className="am-btn am-btn--danger" onClick={handleDeleteProject}>
              Delete project
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, margin: 0 }}>
          Everything associated with this project — sessions, routines, files, memories — will be
          permanently removed.
        </p>
      </AntonModal>
    </div>
  )
}
