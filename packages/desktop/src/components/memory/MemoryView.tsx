import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { projectStore } from '../../lib/store/projectStore.js'

type MemoryScope = 'global' | 'conversation' | 'project'

interface ParsedMemory {
  name: string
  title: string
  content: string
  scope: MemoryScope
  savedAt?: string
}

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: 'Global',
  conversation: 'Conversation',
  project: 'Project',
}

function parseMemoryFile(raw: { name: string; content: string; scope: MemoryScope }): ParsedMemory {
  const lines = raw.content.split('\n')
  const titleLine = lines.find((l) => l.startsWith('# '))
  const title = titleLine?.slice(2).trim() || raw.name.replace('.md', '')
  const savedLine = lines.find((l) => l.startsWith('_Saved:'))
  const savedAt = savedLine?.match(/_Saved:\s*(.+)_/)?.[1]

  let contentStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      contentStart = i + 1
      continue
    }
    if (lines[i].startsWith('_Saved:')) {
      contentStart = i + 1
      continue
    }
    if (lines[i].trim() === '' && contentStart === i) {
      contentStart = i + 1
      continue
    }
    break
  }
  const content = lines.slice(contentStart).join('\n').trim()
  return { name: raw.name, title, content, scope: raw.scope, savedAt }
}

export function MemoryView() {
  const memories = projectStore((s) => s.memories)
  const memoriesLoading = projectStore((s) => s.memoriesLoading)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const projectInstructions = projectStore((s) => s.projectInstructions)
  const projectInstructionsLoading = projectStore((s) => s.projectInstructionsLoading)
  const projectPreferences = projectStore((s) => s.projectPreferences)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterScope, setFilterScope] = useState<MemoryScope | 'all'>('all')

  // Instructions editing
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState('')

  // Preference adding
  const [addingPreference, setAddingPreference] = useState(false)
  const [newPrefTitle, setNewPrefTitle] = useState('')
  const [newPrefContent, setNewPrefContent] = useState('')

  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Fetch data on mount and project change
  useEffect(() => {
    if (!activeProjectId) return
    projectStore.setState({
      memoriesLoading: true,
      projectInstructionsLoading: true,
      projectPreferencesLoading: true,
    })
    connection.sendConfigQuery('memories', undefined, activeProjectId)
    projectStore.getState().getProjectInstructions(activeProjectId)
    projectStore.getState().getProjectPreferences(activeProjectId)
  }, [activeProjectId])

  // Sync draft when instructions load
  useEffect(() => {
    if (!editingInstructions) {
      setInstructionsDraft(projectInstructions)
    }
  }, [projectInstructions, editingInstructions])

  const parsed = useMemo(() => memories.map(parseMemoryFile), [memories])
  const filtered = useMemo(
    () => (filterScope === 'all' ? parsed : parsed.filter((m) => m.scope === filterScope)),
    [parsed, filterScope],
  )

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSaveInstructions = () => {
    if (!activeProjectId) return
    projectStore.getState().saveProjectInstructions(activeProjectId, instructionsDraft)
    setEditingInstructions(false)
  }

  const handleAddPreference = () => {
    if (!activeProjectId || !newPrefTitle.trim() || !newPrefContent.trim()) return
    projectStore
      .getState()
      .addProjectPreference(activeProjectId, newPrefTitle.trim(), newPrefContent.trim())
    setNewPrefTitle('')
    setNewPrefContent('')
    setAddingPreference(false)
  }

  const handleDeletePreference = (prefId: string) => {
    if (!activeProjectId) return
    projectStore.getState().deleteProjectPreference(activeProjectId, prefId)
  }

  const scopeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: parsed.length }
    for (const m of parsed) {
      counts[m.scope] = (counts[m.scope] || 0) + 1
    }
    return counts
  }, [parsed])

  return (
    <div className="memory-view">
      <div className="memory-view__inner">
        {/* ── Instructions Section ── */}
        <section className="memory-section">
          <div className="memory-section__header">
            <h3 className="memory-section__title">Instructions</h3>
            {!editingInstructions && (
              <button
                type="button"
                className="memory-section__add-btn"
                onClick={() => {
                  setInstructionsDraft(projectInstructions)
                  setEditingInstructions(true)
                }}
              >
                {projectInstructions ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
          <p className="memory-section__desc">
            Rules that guide the AI in <strong>{activeProject?.name || 'this project'}</strong>.
            Applied to every task.
          </p>

          {editingInstructions ? (
            <div className="instructions-editor">
              <textarea
                className="instructions-editor__textarea"
                value={instructionsDraft}
                onChange={(e) => setInstructionsDraft(e.target.value)}
                placeholder="e.g. Always use Python 3.12. Output as CSV. Be concise."
                rows={6}
                autoFocus
              />
              <div className="instructions-editor__actions">
                <button
                  type="button"
                  className="button button--sm button--primary"
                  onClick={handleSaveInstructions}
                >
                  <Save size={13} strokeWidth={1.5} />
                  Save
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() => setEditingInstructions(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : projectInstructions ? (
            <div
              className="instructions-preview"
              onClick={() => {
                setInstructionsDraft(projectInstructions)
                setEditingInstructions(true)
              }}
            >
              {projectInstructions}
            </div>
          ) : (
            <div className="memory-section__empty">
              <BookOpen size={20} strokeWidth={1.5} />
              <span>No instructions yet. Add rules to guide the AI in this project.</span>
            </div>
          )}
        </section>

        {/* ── Preferences Section ── */}
        <section className="memory-section">
          <div className="memory-section__header">
            <h3 className="memory-section__title">Preferences</h3>
            <button
              type="button"
              className="memory-section__add-btn"
              onClick={() => setAddingPreference(true)}
            >
              <Plus size={14} strokeWidth={1.5} />
              Add
            </button>
          </div>
          <p className="memory-section__desc">
            Custom preferences that guide how the AI works with you.
          </p>

          <div className="memory-section__list">
            {projectPreferences.map((pref) => (
              <div key={pref.id} className="memory-card">
                <div className="memory-card__header" onClick={() => toggleExpand(pref.id)}>
                  <span className="memory-card__chevron">
                    {expandedIds.has(pref.id) ? (
                      <ChevronDown size={14} strokeWidth={1.5} />
                    ) : (
                      <ChevronRight size={14} strokeWidth={1.5} />
                    )}
                  </span>
                  <span className="memory-card__title">{pref.title}</span>
                  <button
                    type="button"
                    className="memory-card__delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeletePreference(pref.id)
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
                {expandedIds.has(pref.id) && (
                  <div className="memory-card__body">{pref.content}</div>
                )}
              </div>
            ))}

            {addingPreference && (
              <div className="memory-card memory-card--adding">
                <input
                  type="text"
                  className="memory-card__input"
                  placeholder="Preference title..."
                  value={newPrefTitle}
                  onChange={(e) => setNewPrefTitle(e.target.value)}
                  autoFocus
                />
                <textarea
                  className="memory-card__textarea"
                  placeholder="Describe the preference..."
                  value={newPrefContent}
                  onChange={(e) => setNewPrefContent(e.target.value)}
                  rows={3}
                />
                <div className="memory-card__add-actions">
                  <button
                    type="button"
                    className="memory-card__save-btn"
                    onClick={handleAddPreference}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="memory-card__cancel-btn"
                    onClick={() => {
                      setAddingPreference(false)
                      setNewPrefTitle('')
                      setNewPrefContent('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {projectPreferences.length === 0 && !addingPreference && (
              <div className="memory-section__empty">
                <BookOpen size={20} strokeWidth={1.5} />
                <span>No preferences yet</span>
              </div>
            )}
          </div>
        </section>

        {/* ── Chat Memories Section ── */}
        <section className="memory-section">
          <div className="memory-section__header">
            <h3 className="memory-section__title">Chat Memories</h3>
            <span className="memory-section__count">{parsed.length}</span>
          </div>
          <p className="memory-section__desc">Auto-generated from your conversations over time.</p>

          {parsed.length > 0 && (
            <div className="memory-filter-tabs">
              {(['all', 'global', 'conversation'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className={`memory-filter-tab${filterScope === scope ? ' memory-filter-tab--active' : ''}`}
                  onClick={() => setFilterScope(scope)}
                >
                  {scope === 'all' ? 'All' : SCOPE_LABELS[scope]}
                  {scopeCounts[scope] ? ` (${scopeCounts[scope]})` : ''}
                </button>
              ))}
            </div>
          )}

          <div className="memory-section__list">
            {memoriesLoading && parsed.length === 0 && (
              <div className="memory-section__empty">
                <Loader2 size={20} strokeWidth={1.5} className="spin" />
                <span>Loading memories...</span>
              </div>
            )}

            {!memoriesLoading && filtered.length === 0 && (
              <div className="memory-section__empty">
                <BookOpen size={20} strokeWidth={1.5} />
                <span>No memories yet</span>
              </div>
            )}

            {filtered.map((mem) => {
              const ScopeIcon = mem.scope === 'global' ? Globe : MessageSquare
              return (
                <div key={`${mem.scope}-${mem.name}`} className="memory-card">
                  <div className="memory-card__header" onClick={() => toggleExpand(mem.name)}>
                    <span className="memory-card__chevron">
                      {expandedIds.has(mem.name) ? (
                        <ChevronDown size={14} strokeWidth={1.5} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} />
                      )}
                    </span>
                    <span className={`memory-card__badge memory-card__badge--${mem.scope}`}>
                      <ScopeIcon size={10} strokeWidth={1.5} />
                      {SCOPE_LABELS[mem.scope]}
                    </span>
                    <span className="memory-card__title">{mem.title}</span>
                  </div>
                  {expandedIds.has(mem.name) && (
                    <div className="memory-card__body">
                      {mem.content || <em style={{ color: 'var(--text-muted)' }}>No content</em>}
                      {mem.savedAt && (
                        <div className="memory-card__meta">
                          Saved: {new Date(mem.savedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
