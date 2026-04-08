/**
 * SkillsPanel — two-pane skills browser (matches ConnectorsView layout).
 *
 * Left sidebar: list of skills grouped by source (Personal / Project),
 * each expandable to show directory tree (SKILL.md + asset files).
 * Right pane: selected skill metadata + SKILL.md content preview.
 */

import {
  ChevronDown,
  ChevronRight,
  Eye,
  Code as CodeIcon,
  File,
  FileText,
  FolderOpen,
  Play,
  Search,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type Skill, executeSkill } from '../../lib/skills.js'
import { useStore } from '../../lib/store.js'
import { skillStore } from '../../lib/store/skillStore.js'

// ── Main view ──────────────────────────────────────────────────────────

export function SkillsPanel() {
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())

  const skills = skillStore((s) => s.skills)
  const loaded = skillStore((s) => s.loaded)
  const connectionStatus = useStore((s) => s.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      skillStore.getState().requestSkills()
    }
  }, [connectionStatus])

  const filtered = useMemo(() => {
    if (!search) return skills
    const q = search.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q),
    )
  }, [search, skills])

  // Group by source, tracking original index in filtered array
  const { personalSkills, projectSkills } = useMemo(() => {
    const personal: { skill: Skill; idx: number }[] = []
    const project: { skill: Skill; idx: number }[] = []
    for (let i = 0; i < filtered.length; i++) {
      const s = filtered[i]
      if (s.source === 'project') project.push({ skill: s, idx: i })
      else personal.push({ skill: s, idx: i })
    }
    return { personalSkills: personal, projectSkills: project }
  }, [filtered])

  // Reset selection when filtered list changes; auto-select first
  useEffect(() => {
    setSelectedIdx(filtered.length > 0 ? 0 : null)
  }, [filtered])

  const selected = selectedIdx !== null ? filtered[selectedIdx] ?? null : null

  const toggleExpanded = (name: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="skills-view">
      {/* ── Left sidebar ─────────────────────────────────── */}
      <aside className="skills-view__sidebar">
        <div className="skills-view__sidebar-header">
          <span className="skills-view__sidebar-title">Skills</span>
        </div>

        <div className="skills-view__search">
          <Search size={14} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search skills"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="skills-view__sidebar-body">
          {personalSkills.length > 0 && (
            <div className="skills-view__group">
              <div className="skills-view__group-label">Personal skills</div>
              {personalSkills.map(({ skill, idx }) => (
                  <SkillSidebarRow
                    key={skill.name}
                    skill={skill}
                    active={selectedIdx === idx}
                    expanded={expandedSkills.has(skill.name)}
                    onSelect={() => setSelectedIdx(idx)}
                    onToggle={() => toggleExpanded(skill.name)}
                  />
              ))}
            </div>
          )}

          {projectSkills.length > 0 && (
            <div className="skills-view__group">
              <div className="skills-view__group-label">Project skills</div>
              {projectSkills.map(({ skill, idx }) => (
                  <SkillSidebarRow
                    key={skill.name}
                    skill={skill}
                    active={selectedIdx === idx}
                    expanded={expandedSkills.has(skill.name)}
                    onSelect={() => setSelectedIdx(idx)}
                    onToggle={() => toggleExpanded(skill.name)}
                  />
              ))}
            </div>
          )}

          {filtered.length === 0 && (
            <div className="skills-view__empty-list">
              {search
                ? 'No skills match your search.'
                : loaded
                  ? 'No skills available.'
                  : 'Loading skills...'}
            </div>
          )}
        </div>
      </aside>

      {/* ── Right detail pane ────────────────────────────── */}
      <section className="skills-view__detail">
        {selected ? (
          <SkillDetailPane skill={selected} />
        ) : (
          <div className="skills-view__placeholder">
            <Zap size={32} strokeWidth={1.25} />
            <p>Select a skill to view its details.</p>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Sidebar row with expandable tree ──────────────────────────────────

function SkillSidebarRow({
  skill,
  active,
  expanded,
  onSelect,
  onToggle,
}: {
  skill: Skill
  active: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const hasAssets = !!(
    skill.assets?.agents?.length ||
    skill.assets?.scripts?.length ||
    skill.assets?.references?.length ||
    skill.assets?.other?.length
  )

  return (
    <div className="skills-view__tree-item">
      <button
        type="button"
        className={`skills-view__row${active ? ' skills-view__row--active' : ''}`}
        onClick={onSelect}
      >
        {hasAssets ? (
          <span
            className="skills-view__row-chevron"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} />
            )}
          </span>
        ) : (
          <span className="skills-view__row-chevron skills-view__row-chevron--leaf" />
        )}
        <span className="skills-view__row-icon">
          <FolderOpen size={15} strokeWidth={1.5} />
        </span>
        <span className="skills-view__row-name">
          {skill.name.toLowerCase().replace(/\s+/g, '-')}
        </span>
      </button>

      {expanded && hasAssets && (
        <div className="skills-view__tree-children">
          <div className="skills-view__tree-file">
            <FileText size={13} strokeWidth={1.5} />
            <span>SKILL.md</span>
          </div>

          {skill.assets?.agents?.map((f) => (
            <div key={f} className="skills-view__tree-file">
              <File size={13} strokeWidth={1.5} />
              <span>{f}</span>
            </div>
          ))}

          {skill.assets?.scripts?.map((f) => (
            <div key={f} className="skills-view__tree-file">
              <File size={13} strokeWidth={1.5} />
              <span>{f}</span>
            </div>
          ))}

          {skill.assets?.references?.map((f) => (
            <div key={f} className="skills-view__tree-file">
              <FileText size={13} strokeWidth={1.5} />
              <span>{f}</span>
            </div>
          ))}

          {skill.assets?.other?.map((f) => (
            <div key={f} className="skills-view__tree-file">
              <File size={13} strokeWidth={1.5} />
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Detail pane ──────────────────────────────────────────────────────

function SkillDetailPane({ skill }: { skill: Skill }) {
  const [showRaw, setShowRaw] = useState(false)
  const [params, setParams] = useState<Record<string, string>>({})

  useEffect(() => {
    setParams({})
    setShowRaw(false)
  }, [skill.name])

  const canRun = !skill.parameters?.some((p) => p.required && !params[p.name]?.trim())
  const sourceLabel =
    skill.source === 'builtin' ? 'Built-in' : skill.source === 'project' ? 'Project' : 'User'
  const triggerLabel = skill.schedule
    ? `Scheduled (${skill.schedule})`
    : 'Slash command + auto'

  const handleRun = () => {
    executeSkill(skill, params)
    setParams({})
  }

  return (
    <div className="skills-view__detail-inner">
      {/* Header */}
      <div className="skills-view__detail-header">
        <h2 className="skills-view__detail-title">{skill.name}</h2>
        <div className="skills-view__detail-actions">
          <button
            type="button"
            className="skills-view__btn skills-view__btn--primary"
            onClick={handleRun}
            disabled={!canRun}
          >
            <Play size={13} strokeWidth={2} />
            Run
          </button>
        </div>
      </div>

      {/* Metadata row */}
      <div className="skills-view__detail-meta">
        <div className="skills-view__detail-meta-item">
          <span className="skills-view__detail-meta-label">Added by</span>
          <span className="skills-view__detail-meta-value">{sourceLabel}</span>
        </div>
        <div className="skills-view__detail-meta-item">
          <span className="skills-view__detail-meta-label">Trigger</span>
          <span className="skills-view__detail-meta-value">{triggerLabel}</span>
        </div>
        {skill.category && (
          <div className="skills-view__detail-meta-item">
            <span className="skills-view__detail-meta-label">Category</span>
            <span className="skills-view__detail-meta-value">{skill.category}</span>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="skills-view__detail-section">
        <span className="skills-view__detail-section-label">Description</span>
        <p className="skills-view__detail-desc">{skill.description}</p>
      </div>

      {/* Parameters */}
      {skill.parameters && skill.parameters.length > 0 && (
        <div className="skills-view__detail-section">
          <span className="skills-view__detail-section-label">Parameters</span>
          <div className="skills-view__detail-params">
            {skill.parameters.map((param) => (
              <div key={param.name} className="skills-view__detail-param">
                <label className="skills-view__detail-param-label">
                  {param.label}
                  {param.required && <span className="skills-view__detail-param-req">*</span>}
                </label>
                {param.type === 'select' ? (
                  <select
                    value={params[param.name] || ''}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [param.name]: e.target.value }))
                    }
                    className="skills-view__input"
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
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [param.name]: e.target.value }))
                    }
                    placeholder={param.placeholder}
                    className="skills-view__input"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt preview */}
      <div className="skills-view__detail-section">
        <div className="skills-view__detail-prompt-header">
          <span className="skills-view__detail-section-label">Prompt</span>
          <div className="skills-view__detail-prompt-toggle">
            <button
              type="button"
              className={`skills-view__toggle-btn${!showRaw ? ' skills-view__toggle-btn--active' : ''}`}
              onClick={() => setShowRaw(false)}
              title="Preview"
            >
              <Eye size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className={`skills-view__toggle-btn${showRaw ? ' skills-view__toggle-btn--active' : ''}`}
              onClick={() => setShowRaw(true)}
              title="Source"
            >
              <CodeIcon size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="skills-view__detail-prompt">
          {showRaw ? (
            <pre className="skills-view__detail-prompt-raw">{skill.prompt}</pre>
          ) : (
            <div className="skills-view__detail-prompt-preview">{skill.prompt}</div>
          )}
        </div>
      </div>
    </div>
  )
}
