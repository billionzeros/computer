import { Bot, FileCode, FileText, FolderOpen, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type Skill, executeSkill, getSkillCommand } from '../../lib/skills.js'
import { skillIconMap } from './SkillCard.js'

interface Props {
  skill: Skill | null
  onClose: () => void
}

export function SkillDetail({ skill, onClose }: Props) {
  const [params, setParams] = useState<Record<string, string>>({})

  // Reset params when skill changes
  useEffect(() => {
    setParams({})
  }, [skill?.name])

  if (!skill) return null

  const Icon = skillIconMap[skill.icon || ''] || FolderOpen
  const hasParams = skill.parameters && skill.parameters.length > 0
  const canRun = !skill.parameters?.some((p) => p.required && !params[p.name]?.trim())
  const command = getSkillCommand(skill)

  const assetSummary = useMemo(() => {
    if (!skill.assets) return null
    const parts: string[] = []
    if (skill.assets.agents?.length) {
      parts.push(`${skill.assets.agents.length} agent${skill.assets.agents.length > 1 ? 's' : ''}`)
    }
    if (skill.assets.scripts?.length) {
      parts.push(
        `${skill.assets.scripts.length} script${skill.assets.scripts.length > 1 ? 's' : ''}`,
      )
    }
    if (skill.assets.references?.length) {
      parts.push(
        `${skill.assets.references.length} reference${skill.assets.references.length > 1 ? 's' : ''}`,
      )
    }
    if (skill.assets.other?.length) {
      parts.push(
        `${skill.assets.other.length} asset${skill.assets.other.length > 1 ? 's' : ''}`,
      )
    }
    return parts.length > 0 ? parts : null
  }, [skill.assets])

  const handleRun = () => {
    executeSkill(skill, params)
    setParams({})
    onClose()
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="skill-detail-overlay" onClick={handleOverlayClick}>
      <div className="skill-detail">
        {/* Close button */}
        <button type="button" className="skill-detail__close" onClick={onClose}>
          <X size={16} strokeWidth={1.5} />
        </button>

        {/* Icon */}
        <div className="skill-detail__icon-wrap">
          <Icon size={24} strokeWidth={1.5} />
        </div>

        {/* Name */}
        <h2 className="skill-detail__name">{skill.name}</h2>

        {/* Description */}
        <p className="skill-detail__desc">{skill.description}</p>

        {/* Badges row */}
        <div className="skill-detail__badges">
          <span className="skill-detail__badge skill-detail__badge--command">{command}</span>
          <span className="skill-detail__badge">
            {skill.context === 'fork' ? 'Runs as sub-agent' : 'Runs inline'}
          </span>
        </div>

        {/* Bundled assets */}
        {assetSummary && (
          <div className="skill-detail__assets">
            <FolderOpen size={14} strokeWidth={1.5} />
            <span>Includes: {assetSummary.join(', ')}</span>
          </div>
        )}

        {/* Parameters */}
        {hasParams && (
          <div className="skill-detail__params">
            {skill.parameters!.map((param) => (
              <div key={param.name} className="skill-detail__param">
                <label className="skill-detail__param-label">
                  {param.label}
                  {param.required && <span className="skill-detail__param-required">*</span>}
                </label>
                {param.type === 'select' ? (
                  <select
                    value={params[param.name] || ''}
                    onChange={(e) => setParams((p) => ({ ...p, [param.name]: e.target.value }))}
                    className="skill-detail__select"
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
                    className="skill-detail__input"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Run button */}
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          className="skill-detail__run-btn"
        >
          <Play size={14} strokeWidth={2} />
          Run Skill
        </button>
      </div>
    </div>
  )
}
