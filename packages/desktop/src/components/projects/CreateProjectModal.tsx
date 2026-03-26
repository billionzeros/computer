import { FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { connection } from '../../lib/connection.js'

const DEFAULT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']

interface Props {
  onClose: () => void
}

export function CreateProjectModal({ onClose }: Props) {
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')

  const handleCreate = () => {
    if (!name.trim()) return
    // Pick a random color for variety
    const color = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
    connection.sendProjectCreate({
      name: name.trim(),
      description: instructions.trim(),
      icon: '📁',
      color,
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal-card modal-card--create-project" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h2>Create project</h2>
          <button type="button" className="modal-card__close" onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="modal-card__body">
          {/* Folder icon */}
          <div className="create-project__icon-display">
            <FolderOpen size={40} strokeWidth={1.2} />
          </div>

          {/* Project name */}
          <div className="form-field">
            <label className="form-field__label" htmlFor="create-project-name">Project name</label>
            <input
              id="create-project-name"
              className="form-field__input"
              type="text"
              placeholder="Enter the name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCreate()}
            />
          </div>

          {/* Instructions */}
          <div className="form-field">
            <label className="form-field__label" htmlFor="create-project-instructions">
              Instructions <span className="form-field__optional">(optional)</span>
            </label>
            <textarea
              id="create-project-instructions"
              className="form-field__textarea"
              placeholder='e.g. "Focus on Python best practices", "Maintain a professional tone", or "Always provide sources for important conclusions".'
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
            />
          </div>
        </div>

        <div className="modal-card__footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
