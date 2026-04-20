import {
  BookOpen,
  Brain,
  Globe,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { projectStore } from '../../lib/store/projectStore.js'
import { sessionStore } from '../../lib/store/sessionStore.js'

type MemoryScope = 'global' | 'conversation' | 'project'
type Tab = 'instructions' | 'preferences' | 'memories'

interface ParsedMemory {
  name: string
  title: string
  content: string
  scope: MemoryScope
  savedAt?: string
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
  const projectPreferences = projectStore((s) => s.projectPreferences)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const [tab, setTab] = useState<Tab>('instructions')

  // Instructions
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState('')

  // Preferences
  const [addingPref, setAddingPref] = useState(false)
  const [prefTitleDraft, setPrefTitleDraft] = useState('')
  const [prefContentDraft, setPrefContentDraft] = useState('')

  // Memories filters
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!activeProjectId) return
    projectStore.setState({
      memoriesLoading: true,
      projectInstructionsLoading: true,
      projectPreferencesLoading: true,
    })
    sessionStore.getState().sendConfigQuery('memories', undefined, activeProjectId)
    projectStore.getState().getProjectInstructions(activeProjectId)
    projectStore.getState().getProjectPreferences(activeProjectId)
  }, [activeProjectId])

  useEffect(() => {
    if (!editingInstructions) {
      setInstructionsDraft(projectInstructions)
    }
  }, [projectInstructions, editingInstructions])

  const parsed = useMemo(() => memories.map(parseMemoryFile), [memories])
  const filteredMemories = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return parsed
    return parsed.filter(
      (m) => m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q),
    )
  }, [parsed, query])

  const handleSaveInstructions = () => {
    if (!activeProjectId) return
    projectStore.getState().saveProjectInstructions(activeProjectId, instructionsDraft)
    setEditingInstructions(false)
  }

  const handleAddPreference = () => {
    if (!activeProjectId || !prefTitleDraft.trim() || !prefContentDraft.trim()) return
    projectStore
      .getState()
      .addProjectPreference(activeProjectId, prefTitleDraft.trim(), prefContentDraft.trim())
    setPrefTitleDraft('')
    setPrefContentDraft('')
    setAddingPref(false)
  }

  const handleDeletePreference = (prefId: string) => {
    if (!activeProjectId) return
    projectStore.getState().deleteProjectPreference(activeProjectId, prefId)
  }

  return (
    <div className="mem-main">
      <div className="mem-header">
        <h1 className="mem-header__title">
          <Brain size={20} strokeWidth={1.5} />
          Memory
        </h1>
        <div className="mem-header__sub">
          What Anton knows about{' '}
          <strong style={{ color: 'var(--text-2)' }}>
            {activeProject?.name ?? 'this workspace'}
          </strong>
          .
        </div>
      </div>

      <div className="mem-tabs">
        <button
          type="button"
          className={`mem-tab${tab === 'instructions' ? ' active' : ''}`}
          onClick={() => setTab('instructions')}
        >
          <span>Instructions</span>
        </button>
        <button
          type="button"
          className={`mem-tab${tab === 'preferences' ? ' active' : ''}`}
          onClick={() => setTab('preferences')}
        >
          <span>Preferences</span>
          <span className="mem-tab__n">{projectPreferences.length}</span>
        </button>
        <button
          type="button"
          className={`mem-tab${tab === 'memories' ? ' active' : ''}`}
          onClick={() => setTab('memories')}
        >
          <span>Memories</span>
          <span className="mem-tab__n">{parsed.length}</span>
        </button>
      </div>

      <div className="mem-body">
        {tab === 'instructions' && (
          <div className="mem-section">
            <div className="mem-section__head">
              <div>
                <div className="mem-section__name">Project instructions</div>
                <div className="mem-section__hint">
                  Rules Anton follows on every task in this project. Keep them short and concrete.
                </div>
              </div>
              {!editingInstructions && (
                <div className="mem-section__actions">
                  <button
                    type="button"
                    className="mem-btn"
                    onClick={() => {
                      setInstructionsDraft(projectInstructions)
                      setEditingInstructions(true)
                    }}
                  >
                    <Pencil size={13} strokeWidth={1.5} />
                    {projectInstructions ? 'Edit' : 'Add'}
                  </button>
                </div>
              )}
            </div>

            {editingInstructions ? (
              <>
                <textarea
                  className="mem-textarea"
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  placeholder="e.g. Always use Python 3.12. Output as CSV. Be concise."
                  rows={10}
                />
                <div className="mem-actions">
                  <button
                    type="button"
                    className="mem-btn mem-btn--ghost"
                    onClick={() => setEditingInstructions(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mem-btn mem-btn--primary"
                    onClick={handleSaveInstructions}
                  >
                    <Save size={13} strokeWidth={1.5} />
                    Save
                  </button>
                </div>
              </>
            ) : projectInstructions ? (
              <div className="mem-prose">{projectInstructions}</div>
            ) : (
              <div className="mem-empty">
                <BookOpen size={20} strokeWidth={1.5} />
                <div>No instructions yet. Add rules to guide Anton in this project.</div>
              </div>
            )}
          </div>
        )}

        {tab === 'preferences' && (
          <div className="mem-section">
            <div className="mem-section__head">
              <div>
                <div className="mem-section__name">Preferences</div>
                <div className="mem-section__hint">
                  Named rules you can name, edit and remove. Less strict than instructions.
                </div>
              </div>
              <div className="mem-section__actions">
                <button
                  type="button"
                  className="mem-btn mem-btn--primary"
                  onClick={() => {
                    setAddingPref(true)
                    setPrefTitleDraft('')
                    setPrefContentDraft('')
                  }}
                >
                  <Plus size={13} strokeWidth={1.5} />
                  Add
                </button>
              </div>
            </div>

            <div className="mem-cards">
              {addingPref && (
                <div className="mem-card mem-card--editing">
                  <input
                    type="text"
                    className="mem-card__title-input"
                    placeholder="Preference title…"
                    value={prefTitleDraft}
                    onChange={(e) => setPrefTitleDraft(e.target.value)}
                  />
                  <textarea
                    className="mem-card__body-input"
                    placeholder="Describe the preference…"
                    value={prefContentDraft}
                    onChange={(e) => setPrefContentDraft(e.target.value)}
                    rows={3}
                  />
                  <div className="mem-actions">
                    <button
                      type="button"
                      className="mem-btn mem-btn--ghost"
                      onClick={() => setAddingPref(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mem-btn mem-btn--primary"
                      onClick={handleAddPreference}
                      disabled={!prefTitleDraft.trim() || !prefContentDraft.trim()}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {projectPreferences.map((pref) => {
                return (
                  <div key={pref.id} className="mem-card">
                    <div className="mem-card__head">
                      <span className="mem-card__title">{pref.title}</span>
                      <div className="mem-card__actions">
                        <button
                          type="button"
                          className="mem-iconbtn mem-iconbtn--danger"
                          aria-label="Delete"
                          onClick={() => handleDeletePreference(pref.id)}
                        >
                          <Trash2 size={13} strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                    <div className="mem-card__body">{pref.content}</div>
                  </div>
                )
              })}

              {projectPreferences.length === 0 && !addingPref && (
                <div className="mem-empty">
                  <Sparkles size={20} strokeWidth={1.5} />
                  <div>No preferences yet. Add one with the Add button above.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'memories' && (
          <div className="mem-section">
            <div className="mem-section__head">
              <div>
                <div className="mem-section__name">Chat memories</div>
                <div className="mem-section__hint">
                  Auto-captured snippets from past conversations. Read-only.
                </div>
              </div>
              <div className="mem-section__actions">
                <div className="mem-search">
                  <Search size={13} strokeWidth={1.5} />
                  <input
                    type="text"
                    placeholder="Search…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      className="mem-iconbtn"
                      aria-label="Clear search"
                      onClick={() => setQuery('')}
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {memoriesLoading && parsed.length === 0 ? (
              <div className="mem-empty">
                <Loader2 size={20} strokeWidth={1.5} className="spin" />
                <div>Loading memories…</div>
              </div>
            ) : filteredMemories.length === 0 ? (
              <div className="mem-empty">
                <MessageSquare size={20} strokeWidth={1.5} />
                <div>
                  {query
                    ? `No memories match "${query}".`
                    : 'No memories yet — Anton will note things as you chat.'}
                </div>
              </div>
            ) : (
              <div className="mem-cards">
                {filteredMemories.map((mem) => (
                  <div key={`${mem.scope}-${mem.name}`} className="mem-card">
                    <div className="mem-card__head">
                      <span className="mem-card__title">{mem.title}</span>
                      <span
                        className={`mem-badge${mem.scope === 'global' ? ' mem-badge--global' : ''}`}
                      >
                        {mem.scope === 'global' ? (
                          <Globe size={9} strokeWidth={1.5} />
                        ) : (
                          <MessageSquare size={9} strokeWidth={1.5} />
                        )}
                        {mem.scope}
                      </span>
                    </div>
                    <div className="mem-card__body">
                      {mem.content || <em style={{ color: 'var(--text-4)' }}>No content</em>}
                    </div>
                    {mem.savedAt && (
                      <div className="mem-card__meta">
                        Saved {new Date(mem.savedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
