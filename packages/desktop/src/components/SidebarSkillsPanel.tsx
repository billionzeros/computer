import {
  Activity,
  BarChart,
  Ban,
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
  Plus,
  RefreshCw,
  Rocket,
  Settings,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import {
  type Skill,
  addCustomSkill,
  executeSkill,
  getCustomSkills,
  getSkills,
  removeCustomSkill,
} from '../lib/skills.js'
import { SkillDialog } from './skills/SkillDialog.js'
import { Modal } from './ui/Modal.js'

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

export function SidebarSkillsPanel() {
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [, setRefresh] = useState(0)

  const skills = useMemo(() => getSkills(), [])

  const categories = useMemo(() => {
    const cats = new Map<string, Skill[]>()
    for (const skill of skills) {
      const list = cats.get(skill.category) || []
      list.push(skill)
      cats.set(skill.category, list)
    }
    return cats
  }, [skills])

  const handleDeleteCustom = (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    removeCustomSkill(skillId)
    setRefresh((r) => r + 1)
  }

  return (
    <div className="sidebar-skills">
      <div className="sidebar-skills__header">
        <span className="sidebar-section-label" style={{ padding: 0 }}>Skills</span>
        <button
          type="button"
          className="sidebar-skills__add-btn"
          onClick={() => setShowAddDialog(true)}
          aria-label="Add custom skill"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="sidebar-skills__list">
        {Array.from(categories.entries()).map(([cat, catSkills]) => (
          <div key={cat} className="sidebar-skills__category">
            <div className="sidebar-skills__cat-label">{cat}</div>
            {catSkills.map((skill) => {
              const Icon = iconMap[skill.icon] || Zap
              return (
                <button
                  key={skill.id}
                  type="button"
                  className="sidebar-skills__item"
                  onClick={() => setSelectedSkill(skill)}
                >
                  <span className="sidebar-skills__item-icon">
                    <Icon size={14} />
                  </span>
                  <span className="sidebar-skills__item-name">{skill.name}</span>
                  {skill.isCustom && (
                    <span
                      className="sidebar-skills__item-delete"
                      onClick={(e) => handleDeleteCustom(e, skill.id)}
                      onKeyDown={() => {}}
                      role="button"
                      tabIndex={-1}
                    >
                      <Trash2 size={12} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <SkillDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      <AddSkillDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={() => setRefresh((r) => r + 1)}
      />
    </div>
  )
}

// ── Add Skill Dialog ──────────────────────────────────────────────

function AddSkillDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [command, setCommand] = useState('')
  const [category, setCategory] = useState('Custom')
  const [prompt, setPrompt] = useState('')

  const canSave = name.trim() && command.trim() && prompt.trim()

  const handleSave = () => {
    if (!canSave) return
    const id = `custom_${Date.now().toString(36)}`
    const cmd = command.startsWith('/') ? command : `/${command}`
    addCustomSkill({
      id,
      name: name.trim(),
      description: description.trim(),
      icon: 'zap',
      command: cmd,
      category: category.trim() || 'Custom',
      prompt: prompt.trim(),
      isCustom: true,
    })
    setName('')
    setDescription('')
    setCommand('')
    setCategory('Custom')
    setPrompt('')
    onAdd()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Custom Skill">
      <div className="add-skill-form">
        <div className="add-skill-form__field">
          <label className="add-skill-form__label">Name *</label>
          <input
            type="text"
            className="add-skill-form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Custom Skill"
          />
        </div>
        <div className="add-skill-form__field">
          <label className="add-skill-form__label">Command *</label>
          <input
            type="text"
            className="add-skill-form__input"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="/my-skill"
          />
        </div>
        <div className="add-skill-form__field">
          <label className="add-skill-form__label">Category</label>
          <input
            type="text"
            className="add-skill-form__input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Custom"
          />
        </div>
        <div className="add-skill-form__field">
          <label className="add-skill-form__label">Description</label>
          <input
            type="text"
            className="add-skill-form__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this skill do?"
          />
        </div>
        <div className="add-skill-form__field">
          <label className="add-skill-form__label">Prompt *</label>
          <textarea
            className="add-skill-form__textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="The instructions to send to the agent. Use {param} for placeholders."
            rows={4}
          />
        </div>
        <div className="add-skill-form__actions">
          <button
            type="button"
            className="add-skill-form__cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="add-skill-form__save"
            disabled={!canSave}
            onClick={handleSave}
          >
            Add Skill
          </button>
        </div>
      </div>
    </Modal>
  )
}
