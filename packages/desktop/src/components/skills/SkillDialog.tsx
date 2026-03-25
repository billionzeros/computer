import {
  Activity,
  Ban,
  BarChart,
  Box,
  Clock,
  Database,
  Download,
  Eye,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Key,
  Lock,
  RefreshCw,
  Rocket,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Wifi,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { type Skill, executeSkill } from '../../lib/skills.js'
import { Modal } from '../ui/Modal.js'

const iconMap: Record<string, React.ElementType> = {
  rocket: Rocket,
  activity: Activity,
  globe: Globe,
  box: Box,
  'file-text': FileText,
  shield: Shield,
  'shield-check': ShieldCheck,
  database: Database,
  clock: Clock,
  lock: Lock,
  key: Key,
  ban: Ban,
  'hard-drive': HardDrive,
  wifi: Wifi,
  gauge: Gauge,
  users: Users,
  download: Download,
  settings: Settings,
  eye: Eye,
  'bar-chart': BarChart,
  'refresh-cw': RefreshCw,
  zap: Zap,
}

interface Props {
  skill: Skill | null
  onClose: () => void
}

export function SkillDialog({ skill, onClose }: Props) {
  const [params, setParams] = useState<Record<string, string>>({})

  if (!skill) return null

  const Icon = iconMap[skill.icon] || Activity
  const hasParams = skill.parameters && skill.parameters.length > 0

  const handleRun = () => {
    executeSkill(skill, params)
    setParams({})
    onClose()
  }

  const canRun = !skill.parameters?.some((p) => p.required && !params[p.name]?.trim())

  return (
    <Modal open={!!skill} onClose={onClose} title={skill.name}>
      <div className="skill-dialog__header">
        <div className="skill-dialog__iconWrap">
          <Icon className="skill-dialog__icon" />
        </div>
        <div>
          <div className="skill-dialog__description">{skill.description}</div>
          <div className="skill-dialog__command">{skill.command}</div>
        </div>
      </div>

      {hasParams && (
        <div className="skill-dialog__params">
          {skill.parameters!.map((param) => (
            <div key={param.name} className="skill-dialog__param">
              <span className="skill-dialog__param-label">
                {param.label}
                {param.required && <span className="skill-dialog__param-required">*</span>}
              </span>
              {param.type === 'select' ? (
                <select
                  value={params[param.name] || ''}
                  onChange={(e) => setParams((p) => ({ ...p, [param.name]: e.target.value }))}
                  className="skill-dialog__select"
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
                  className="skill-dialog__input"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="skill-dialog__actions">
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          className="skill-dialog__run-btn"
        >
          Run skill
        </button>
      </div>
    </Modal>
  )
}
